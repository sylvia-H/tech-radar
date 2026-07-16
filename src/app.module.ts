import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DiscordModule } from './discord/discord.module';
import { StateModule } from './state/state.module';
import { DiffModule } from './diff/diff.module';
import { PipelineModule } from './pipeline/pipeline.module';

/**
 * 應用根模組。組裝 ConfigModule、DiscordModule、StateModule、DiffModule 與 PipelineModule。
 */
@Module({
  imports: [ConfigModule, DiscordModule, StateModule, DiffModule, PipelineModule],
})
export class AppModule {}
