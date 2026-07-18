import { Module } from '@nestjs/common';
import { GithubModule } from '../github/github.module';
import { LlmModule } from '../llm/llm.module';
import { IntroService } from './intro.service';

/**
 * repo 簡介資料流模組（F5）：重用 LlmModule（LLM 統一入口）與 GithubModule（共享
 * GithubHttpService 單一實例，rate-limit 節流狀態與呼叫計數與榜單資料流共用，FR-010）。
 */
@Module({
  imports: [GithubModule, LlmModule],
  providers: [IntroService],
  exports: [IntroService],
})
export class IntroModule {}
