import { Module } from '@nestjs/common';
import { GithubHttpService } from '../github/github-http';
import { GithubTrendingService } from '../sources/github-trending.service';
import { GithubRepoService } from '../sources/github-repo.service';
import { ClassifyService } from '../classify/classify.service';
import { BoardBuilderService } from './board-builder.service';

/**
 * F2 榜單模組：GitHub HTTP 客戶端＋主力/補位來源＋分類＋編排器。
 * ConfigModule 為全域（GithubHttpService 直接注入 ConfigService 取 GH_API_TOKEN）。
 * US2 起註冊 GithubSearchService、US4 起併入 DiscordModule 供來源告警。
 */
@Module({
  providers: [
    GithubHttpService,
    GithubTrendingService,
    GithubRepoService,
    ClassifyService,
    BoardBuilderService,
  ],
  exports: [BoardBuilderService],
})
export class BoardModule {}
