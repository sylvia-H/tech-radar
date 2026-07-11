import { Module } from '@nestjs/common';
import { DiscordModule } from '../discord/discord.module';
import { StateModule } from '../state/state.module';
import { PipelineService } from './pipeline.service';

@Module({
  imports: [DiscordModule, StateModule],
  providers: [PipelineService],
  exports: [PipelineService],
})
export class PipelineModule {}
