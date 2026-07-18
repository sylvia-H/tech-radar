import { Module } from '@nestjs/common';
import { LlmService } from './llm.service';

/** 通用 LLM 封裝模組（F5 簡介與 F6 新聞策展共用入口，FR-011）。ConfigModule 為全域，直接注入。 */
@Module({
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule {}
