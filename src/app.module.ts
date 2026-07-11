import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DiscordModule } from './discord/discord.module';
import { StateModule } from './state/state.module';
import { PipelineModule } from './pipeline/pipeline.module';

/**
 * 應用根模組。組裝 ConfigModule、DiscordModule、StateModule 與 PipelineModule。
 */
@Module({
  imports: [ConfigModule, DiscordModule, StateModule, PipelineModule],
})
export class AppModule {}
