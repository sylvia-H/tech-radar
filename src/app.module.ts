import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DiscordModule } from './discord/discord.module';
import { StateModule } from './state/state.module';
import { NewsModule } from './news/news.module';
import { IntroModule } from './intro/intro.module';
import { CurationModule } from './curation/curation.module';
import { PipelineModule } from './pipeline/pipeline.module';

/**
 * 應用根模組。組裝 ConfigModule、DiscordModule、StateModule、NewsModule、
 * IntroModule、CurationModule 與 PipelineModule（榜單段由 `PipelineModule` 內的
 * `BoardModule`/`IntroModule` 供應，F3 薄編排 `DiffModule` 已於 F7 US3 退役——見 research D2）。
 */
@Module({
  imports: [
    ConfigModule,
    DiscordModule,
    StateModule,
    NewsModule,
    IntroModule,
    CurationModule,
    PipelineModule,
  ],
})
export class AppModule {}
