import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DiscordModule } from './discord/discord.module';
import { StateModule } from './state/state.module';
import { DiffModule } from './diff/diff.module';
import { NewsModule } from './news/news.module';
import { IntroModule } from './intro/intro.module';
import { CurationModule } from './curation/curation.module';
import { PipelineModule } from './pipeline/pipeline.module';

/**
 * 應用根模組。組裝 ConfigModule、DiscordModule、StateModule、DiffModule、NewsModule、
 * IntroModule、CurationModule 與 PipelineModule。
 */
@Module({
  imports: [
    ConfigModule,
    DiscordModule,
    StateModule,
    DiffModule,
    NewsModule,
    IntroModule,
    CurationModule,
    PipelineModule,
  ],
})
export class AppModule {}
