import { Module } from '@nestjs/common';
import { StateModule } from '../state/state.module';
import { DiscordModule } from '../discord/discord.module';
import { BoardModule } from '../board/board.module';
import { IntroModule } from '../intro/intro.module';
import { NewsModule } from '../news/news.module';
import { CurationModule } from '../curation/curation.module';
import { PipelineService } from './pipeline.service';
import { BoardSegmentService } from './board-segment.service';
import { NewsSegmentService } from './news-segment.service';

@Module({
  imports: [StateModule, DiscordModule, BoardModule, IntroModule, NewsModule, CurationModule],
  providers: [PipelineService, BoardSegmentService, NewsSegmentService],
  exports: [PipelineService],
})
export class PipelineModule {}
