import { Module } from '@nestjs/common';
import { GithubHttpService } from '../github/github-http';
import { LlmModule } from '../llm/llm.module';
import { IntroService } from './intro.service';

/**
 * repo 簡介資料流模組（F5）：重用 LlmModule（LLM 統一入口）；GithubHttpService 直接提供
 * （沿用 F2 慣例，ConfigModule 為全域）。
 */
@Module({
  imports: [LlmModule],
  providers: [GithubHttpService, IntroService],
  exports: [IntroService],
})
export class IntroModule {}
