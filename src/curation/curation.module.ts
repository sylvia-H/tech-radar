import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { BoardSummaryService } from './board-summary.service';
import { NewsCurationService } from './curation.service';

/**
 * 新聞策展與榜單摘要模組（F6）：重用 `LlmModule`（LLM 統一入口，FR-018）。
 * `NewsCurationService`（每日新聞策展）與 `BoardSummaryService`（榜單日 TL;DR）
 * 共用同一注入的 `LlmModule`。
 */
@Module({
  imports: [LlmModule],
  providers: [NewsCurationService, BoardSummaryService],
  exports: [NewsCurationService, BoardSummaryService],
})
export class CurationModule {}
