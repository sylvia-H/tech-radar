import { Module } from '@nestjs/common';
import { BoardModule } from '../board/board.module';
import { PipelineService } from './pipeline.service';

@Module({
  imports: [BoardModule],
  providers: [PipelineService],
  exports: [PipelineService],
})
export class PipelineModule {}
