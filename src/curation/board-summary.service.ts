import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { factSummary } from './board-summary-fallback';
import { buildBoardSummaryPrompt } from './board-summary-prompt';
import { BoardChangeDigest, BoardChangeSummary } from './board-summary.types';

/**
 * 榜單日「本次變化」TL;DR 服務（§10 第 (2) 種 LLM 呼叫，FR-015~017）：把榜單 diff 的計數／
 * 領域分布交給 `LlmService` 摘成一句繁中封面文案；僅榜單日被呼叫，與新聞策展的「每日 1 次」
 * 相互獨立。LLM 呼叫失敗時**不擲錯**，退回程式產生的事實型摘要（`factSummary`），並以
 * `logger.warn` 記錄失敗（不含 prompt／回應全文，FR-016）。
 */
@Injectable()
export class BoardSummaryService {
  private readonly logger = new Logger(BoardSummaryService.name);

  constructor(private readonly llm: LlmService) {}

  async summarize(digest: BoardChangeDigest): Promise<BoardChangeSummary> {
    try {
      const summary = await this.llm.generate(buildBoardSummaryPrompt(digest));
      return { summary, degraded: false };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`榜單日 TL;DR 生成失敗，退回事實型摘要：${reason}`);
      return { summary: factSummary(digest), degraded: true };
    }
  }
}
