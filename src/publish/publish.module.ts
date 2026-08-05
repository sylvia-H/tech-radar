import { Module } from '@nestjs/common';
import { StateModule } from '../state/state.module';
import { GithubModule } from '../github/github.module';
import { DiscordModule } from '../discord/discord.module';
import { RepoVisibilityService } from './repo-visibility.service';
import { PublishService } from './publish.service';

/**
 * F8 發佈段模組：可見性查詢 + 編排。復用既有 StateModule（讀 state，唯讀）、GithubModule
 * （共享節流客戶端）、DiscordModule（best-effort 告警）。不 import 任何 LLM 模組，
 * 結構性滿足 FR-010「發佈段 0 次 LLM 呼叫」。
 */
@Module({
  imports: [StateModule, GithubModule, DiscordModule],
  providers: [RepoVisibilityService, PublishService],
  exports: [PublishService],
})
export class PublishModule {}
