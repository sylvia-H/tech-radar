import { Module } from '@nestjs/common';
import { DiffModule } from '../diff/diff.module';
import { PipelineService } from './pipeline.service';

@Module({
  imports: [DiffModule],
  providers: [PipelineService],
  exports: [PipelineService],
})
export class PipelineModule {}
