import { Injectable, Logger } from '@nestjs/common';
import { BoardBuilderService } from '../board/board-builder.service';
import { StateStore } from '../state/state.store';
import { DiscordWebhookService } from '../discord/discord.webhook.service';
import { bestEffortFailureAlert } from '../discord/best-effort-alert';
import { pickPushBoard } from './push-board';
import { diffBoard } from './board-diff';
import { decideCadence } from './board-cadence';
import { commitBoardPush } from './board-commit';
import { formatBoardDiff, formatCadence } from './diff-log';
import { BoardSegmentResult } from './diff.types';

/** 空榜告警文案（FR-025，research D4：不帶單一來源 id——空榜是聚合結果）。 */
const EMPTY_BOARD_ALERT = '榜單為空：上游來源全數失敗或候選全被過濾';

/** 時鐘異常告警文案（FR-019a，與 FR-025 同一種紅色告警——本專案不區分嚴重度）。 */
const CLOCK_ANOMALY_ALERT = '榜單推播時間戳晚於當前時間（時鐘異常），仍照常執行本次榜單段';

/**
 * 榜單段薄編排層（唯一持有副作用：狀態讀寫、告警）。判定邏輯全在純函式
 * （`pickPushBoard`／`diffBoard`），本層只串接並輸出觀測 log。
 *
 * 流程：節奏 guard（未到期即早退，不抓取、不耗配額）→ 讀 `prev` → `build()` → `pickPushBoard`
 * →（空榜即告警並中止）→ `diffBoard` → 輸出 log →（交付成功後）`commitBoardPush` + `save()`。
 *
 * F7 接上 Discord 後，只需把「log 成功 → commit」的觸發點換成「推播回報成功 → commit」，
 * 純函式 `commitBoardPush` 與其測試不動（research D5）。
 */
@Injectable()
export class BoardDiffService {
  private readonly logger = new Logger(BoardDiffService.name);

  constructor(
    private readonly stateStore: StateStore,
    private readonly boardBuilder: BoardBuilderService,
    private readonly discord: DiscordWebhookService,
  ) {}

  async runBoardSegment(now: Date): Promise<BoardSegmentResult> {
    const state = await this.stateStore.load();

    const cadence = decideCadence(state.lastBoardPushAt, now);
    this.logger.log(formatCadence(cadence));
    if (cadence.reason === 'clock-anomaly') {
      // 未來時間戳：告警但不中止（FR-019a），lastBoardPushAt 不因此變動。
      await bestEffortFailureAlert(this.discord, this.logger, CLOCK_ANOMALY_ALERT);
    }
    if (!cadence.due) {
      // 未到期：在 build() 之前早退，確保不抓取、不耗 GitHub API 配額（憲章 I）。
      return { status: 'skipped' };
    }

    const current = await this.boardBuilder.build();
    const prevIds = new Set(Object.keys(state.board).map(Number));
    const pushBoard = pickPushBoard(current.boards, prevIds);

    if (pushBoard.length === 0) {
      // 空榜＝上游全滅，屬異常而非「這週沒變化」：告警並中止，不 diff、不 commit（FR-025）。
      await bestEffortFailureAlert(this.discord, this.logger, EMPTY_BOARD_ALERT);
      return { status: 'aborted' };
    }

    const diff = diffBoard(state.board, pushBoard);
    this.logger.log('\n' + formatBoardDiff(diff));

    // 交付成功（本階段＝變化結果已輸出到 log）之後才寫回：單一提交點，快照與 lastBoardPushAt
    // 同次落檔（FR-020/FR-021）。log 或 save 任一步擲錯即不 commit → 狀態逐位元組不變（SC-006）。
    const next = commitBoardPush(state, pushBoard, now);
    await this.stateStore.save(next);

    return { status: 'ok', diff };
  }
}
