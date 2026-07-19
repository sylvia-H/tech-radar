import { Module } from '@nestjs/common';
import { StateModule } from '../state/state.module';
import { DiscordModule } from '../discord/discord.module';
import { NewsModule } from '../news/news.module';
import { CurationModule } from '../curation/curation.module';
import { PipelineService } from './pipeline.service';
import { NewsSegmentService } from './news-segment.service';

@Module({
  imports: [StateModule, DiscordModule, NewsModule, CurationModule],
  providers: [PipelineService, NewsSegmentService],
  exports: [PipelineService],
})
export class PipelineModule {}
