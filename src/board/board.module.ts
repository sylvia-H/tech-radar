import { Module } from '@nestjs/common';
import { DiscordModule } from '../discord/discord.module';
import { GithubModule } from '../github/github.module';
import { GithubTrendingService } from '../sources/github-trending.service';
import { GithubRepoService } from '../sources/github-repo.service';
import { GithubSearchService } from '../sources/github-search.service';
import { ClassifyService } from '../classify/classify.service';
import { BoardBuilderService } from './board-builder.service';

/**
 * F2 榜單模組：主力/補位來源＋分類＋編排器。GitHub HTTP 客戶端改由共享 GithubModule 提供
 * （全 app 單一 GithubHttpService 實例，rate-limit 狀態與呼叫計數跨資料流共用）。
 * 復用 F1 DiscordModule 的 DiscordWebhookService 發來源隔離告警（US4）。
 */
@Module({
  imports: [GithubModule, DiscordModule],
  providers: [
    GithubTrendingService,
    GithubRepoService,
    GithubSearchService,
    ClassifyService,
    BoardBuilderService,
  ],
  exports: [BoardBuilderService],
})
export class BoardModule {}
