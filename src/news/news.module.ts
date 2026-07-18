import { Module } from '@nestjs/common';
import { DiscordModule } from '../discord/discord.module';
import { StateModule } from '../state/state.module';
import { NewsHttp } from './news-http';
import { NewsRssParser } from './fetchers/fetcher';
import { NewsIngestService } from './news-ingest.service';

/**
 * F4 新聞資料流模組（階段 A）：通用 HTTP 客戶端 ＋ RSS parser ＋ 編排器。
 * 復用 DiscordModule（來源隔離告警）與 StateModule（讀 `seenNews`／`board` 快照，只讀不寫回）。
 */
@Module({
  imports: [DiscordModule, StateModule],
  providers: [NewsHttp, NewsRssParser, NewsIngestService],
  exports: [NewsIngestService],
})
export class NewsModule {}
