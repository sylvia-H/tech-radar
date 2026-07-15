import { Module } from '@nestjs/common';
import { DiscordModule } from '../discord/discord.module';
import { GithubHttpService } from '../github/github-http';
import { GithubTrendingService } from '../sources/github-trending.service';
import { GithubRepoService } from '../sources/github-repo.service';
import { GithubSearchService } from '../sources/github-search.service';
import { ClassifyService } from '../classify/classify.service';
import { BoardBuilderService } from './board-builder.service';

/**
 * F2 榜單模組：GitHub HTTP 客戶端＋主力/補位來源＋分類＋編排器。
 * ConfigModule 為全域（GithubHttpService 直接注入 ConfigService 取 GH_API_TOKEN）。
 * 復用 F1 DiscordModule 的 DiscordWebhookService 發來源隔離告警（US4）。
 */
@Module({
  imports: [DiscordModule],
  providers: [
    GithubHttpService,
    GithubTrendingService,
    GithubRepoService,
    GithubSearchService,
    ClassifyService,
    BoardBuilderService,
  ],
  exports: [BoardBuilderService],
})
export class BoardModule {}
