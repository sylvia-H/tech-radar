import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { NewsCurationService } from './curation.service';

/**
 * 新聞策展與榜單摘要模組（F6）：重用 `LlmModule`（LLM 統一入口，FR-018）。
 * `BoardSummaryService` 於 US4 加入。
 */
@Module({
  imports: [LlmModule],
  providers: [NewsCurationService],
  exports: [NewsCurationService],
})
export class CurationModule {}
