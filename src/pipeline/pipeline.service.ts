import { Injectable, Logger } from '@nestjs/common';
import { StateStore } from '../state/state.store';
import { DiscordWebhookService } from '../discord/discord.webhook.service';
import { bestEffortFailureAlert } from '../discord/best-effort-alert';
import { BoardSegmentService } from './board-segment.service';
import { NewsSegmentService } from './news-segment.service';

/**
 * F7 頂層編排（contract pipeline-orchestration.md C1）：一次 `load()` 後依序執行**榜單段**
 * （US3）再**晨報段**（US1），兩段共用同一可變 `state` 累積物件；各段各自
 * 「組版 → 推播 → 推播成功後才寫回自己那份狀態」，至多兩次原子 `save()`（憲章 VI）。
 *
 * **段間隔離（US4/FR-013）**：兩段各自已在段內處理其已知失敗模式（guard/cadence 跳過、空內容、
 * 推播失敗——皆 best-effort 告警且不擲錯）。此處的 try/catch 是**未預期例外的安全網**：若某段
 * 擲出其自身未捕捉的錯誤（如上游服務出現非預期的 bug），仍 best-effort 告警、**不中止另一段**、
 * **不再上拋**（避免誤觸 `main.cli.ts` 頂層 catch，FR-014/FR-016）；已成功落檔的另一段狀態不回滾。
 */
@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    private readonly stateStore: StateStore,
    private readonly discord: DiscordWebhookService,
    private readonly boardSegment: BoardSegmentService,
    private readonly newsSegment: NewsSegmentService,
  ) {}

  async run(): Promise<void> {
    const state = await this.stateStore.load();
    const now = new Date();

    try {
      await this.boardSegment.run(state, now);
    } catch (err) {
      await bestEffortFailureAlert(this.discord, this.logger, `榜單段發生未預期錯誤：${errMsg(err)}`);
    }

    try {
      await this.newsSegment.run(state, now);
    } catch (err) {
      await bestEffortFailureAlert(this.discord, this.logger, `晨報段發生未預期錯誤：${errMsg(err)}`);
    }
  }

  /**
   * 晨報乾跑（2026-09-27，`NEWS_DRY_RUN=1`）：只 load 狀態、只跑晨報段的 `dryRun()`（不跑榜單段、
   * 不 save）。錯誤刻意**不吞**：乾跑是人工觸發的驗證，失敗直接上拋讓 `main.cli.ts` 送告警並以非零 exit
   * 結束，比 best-effort 告警後回 exit 0 更直接。
   */
  async runNewsDryRun(): Promise<void> {
    const state = await this.stateStore.load();
    await this.newsSegment.dryRun(state, new Date());
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
