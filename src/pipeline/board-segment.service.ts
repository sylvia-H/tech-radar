import { Injectable, Logger } from '@nestjs/common';
import { BoardBuilderService } from '../board/board-builder.service';
import { BoardRow } from '../board/board.types';
import { StateStore } from '../state/state.store';
import { BoardState } from '../state/state.schema';
import { DiscordWebhookService } from '../discord/discord.webhook.service';
import { bestEffortFailureAlert } from '../discord/best-effort-alert';
import { decideCadence } from '../diff/board-cadence';
import { pickPushBoard } from '../diff/push-board';
import { diffBoard } from '../diff/board-diff';
import { commitBoardPush } from '../diff/board-commit';
import { BoardSegmentResult } from '../diff/diff.types';
import { IntroService } from '../intro/intro.service';
import { IntroInput, IntroResult } from '../intro/intro.types';
import { BoardSummaryService } from '../curation/board-summary.service';
import { toBoardChangeDigest } from './layout/board-change-digest';
import { buildCoverEmbed, buildRepoCard } from './layout/board-embeds';
import { chunkEmbeds } from './layout/embed-split';
import { taipeiDateLabel } from './layout/date-label';

/** 空榜告警文案（沿用 F3 `board-diff.service.ts` 同文案；該檔於 US3/T015 退役，此處獨立持有純文字）。 */
const EMPTY_BOARD_ALERT = '榜單為空：上游來源全數失敗或候選全被過濾';

/** 時鐘異常告警文案（同上，沿用 F3 文案）。 */
const CLOCK_ANOMALY_ALERT = '榜單推播時間戳晚於當前時間（時鐘異常），仍照常執行本次榜單段';

/**
 * `BoardSegmentService.run()` 的回傳型別：`BoardSegmentResult`（F3 `diff.types.ts`，不動）
 * 再加一個 F7 新增的 `push-failed` 案例（榜單段推播失敗，F3 從未有「推播」故無此狀態）。
 * 以獨立 union 型別呈現，不修改 F3 原型別檔案。
 */
export type BoardSegmentOutcome = BoardSegmentResult | { status: 'push-failed' };

/**
 * 榜單段（US3，contract pipeline-orchestration.md C2）：cadence → build → pickPushBoard
 * →（空榜中止）→ diffBoard → intro join（快照 `intros` 供失敗還原）→ F6 TL;DR → 組版 →
 * 依序推播 → **push-then-commit**（`Object.assign` 回寫共享 `state`，取代 F3「log 成功即
 * commit」）。推播/組版/上游任一失敗 → 還原 `state.intros`、best-effort 告警、不 commit。
 */
@Injectable()
export class BoardSegmentService {
  private readonly logger = new Logger(BoardSegmentService.name);

  constructor(
    private readonly boardBuilder: BoardBuilderService,
    private readonly discord: DiscordWebhookService,
    private readonly introService: IntroService,
    private readonly boardSummary: BoardSummaryService,
    private readonly stateStore: StateStore,
  ) {}

  async run(state: BoardState, now: Date): Promise<BoardSegmentOutcome> {
    const cadence = decideCadence(state.lastBoardPushAt, now);
    if (cadence.reason === 'clock-anomaly') {
      // 未來時間戳：告警但照常執行，lastBoardPushAt 不因此變動（FR-019a 沿用 F3）。
      await bestEffortFailureAlert(this.discord, this.logger, CLOCK_ANOMALY_ALERT);
    }
    if (!cadence.due) {
      // 未到期：早退，不 build、不抓取、不耗 GitHub 配額（FR-007）。
      return { status: 'skipped' };
    }

    const current = await this.boardBuilder.build();
    const prevIds = new Set(Object.keys(state.board).map(Number));
    const pushBoard = pickPushBoard(current.boards, prevIds);

    if (pushBoard.length === 0) {
      // 空榜＝上游全滅，屬異常而非「這週沒變化」：告警並中止，不 diff、不 commit（FR-013/025）。
      await bestEffortFailureAlert(this.discord, this.logger, EMPTY_BOARD_ALERT);
      return { status: 'aborted' };
    }

    const diff = diffBoard(state.board, pushBoard);
    const rowByRepoId = flattenBoardRows(current.boards);

    // 進入 intro 生成前先快照，供本次未成功推播時還原（FR-011/SC-003；避免外溢至晨報段的 save）。
    const introsBefore = { ...state.intros };

    try {
      const introResults = new Map<number, IntroResult>();
      for (const change of diff.changes) {
        if (!change.needsIntro) {
          continue;
        }
        const row = rowByRepoId.get(change.repoId);
        if (!row) {
          // 不應發生：每個 diff.changes 的 repoId 皆源自本次 pushBoard ← current.boards（research D1 全命中保證）。
          throw new Error(`intro join 缺 BoardRow：repoId=${change.repoId}`);
        }
        const input: IntroInput = {
          repoId: change.repoId,
          fullName: row.fullName,
          description: row.description,
          language: row.language,
          topics: row.topics,
          starsThisWeek: row.starsThisWeek,
        };
        const result = await this.introService.ensureIntro(input, state, () => now);
        introResults.set(change.repoId, result);
      }

      const summary = await this.boardSummary.summarize(toBoardChangeDigest(diff));

      const dateLabel = taipeiDateLabel(now);
      const cover = buildCoverEmbed(summary, diff, dateLabel);
      const cards = diff.changes
        .filter((c) => c.needsIntro)
        .map((c) => buildRepoCard(c, introResults.get(c.repoId)!, rowByRepoId.get(c.repoId)!));
      const embeds = [cover, ...cards];

      for (const batch of chunkEmbeds(embeds, 10)) {
        await this.discord.send({ username: 'Tech Radar', embeds: batch });
      }

      // push-then-commit：commitBoardPush 為純函式回傳新 BoardState。順序為「先原子 save→成功後才
      // Object.assign 回寫共享 state」（而非先回寫再 save）：若 save 擲錯，共享 state 的
      // board/lastBoardPushAt 尚未被動過，catch 只需還原 intros 即完全回滾——不會讓一個未成功落檔的
      // 榜單推播經晨報段（若同 run 執行）的 save 外溢落檔。回寫後晨報段的 save 一起帶回（contract C1 步驟 4）。
      const next = commitBoardPush(state, pushBoard, now);
      await this.stateStore.save(next);
      Object.assign(state, next);

      return { status: 'ok', diff };
    } catch (err) {
      // 未成功推播：還原 intros，確保未推出的簡介不落檔、不外溢至晨報段的 save（FR-011/SC-003）。
      state.intros = introsBefore;
      await bestEffortFailureAlert(this.discord, this.logger, `榜單推播失敗：${errMsg(err)}`);
      return { status: 'push-failed' };
    }
  }
}

/** 攤平兩領域榜為 `Map<repoId, BoardRow>`，供 intro join 與組卡查表（research D1）。 */
function flattenBoardRows(boards: { entries: BoardRow[] }[]): Map<number, BoardRow> {
  const map = new Map<number, BoardRow>();
  for (const domainBoard of boards) {
    for (const row of domainBoard.entries) {
      map.set(row.repoId, row);
    }
  }
  return map;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
