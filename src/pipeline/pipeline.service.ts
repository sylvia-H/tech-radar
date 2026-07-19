import { Injectable } from '@nestjs/common';
import { StateStore } from '../state/state.store';
import { BoardSegmentService } from './board-segment.service';
import { NewsSegmentService } from './news-segment.service';

/**
 * F7 頂層編排（contract pipeline-orchestration.md C1）：一次 `load()` 後依序執行**榜單段**
 * （US3）再**晨報段**（US1），兩段共用同一可變 `state` 累積物件；各段各自
 * 「組版 → 推播 → 推播成功後才寫回自己那份狀態」，至多兩次原子 `save()`（憲章 VI）。
 * 段間隔離（US4）於 T017 加上。
 */
@Injectable()
export class PipelineService {
  constructor(
    private readonly stateStore: StateStore,
    private readonly boardSegment: BoardSegmentService,
    private readonly newsSegment: NewsSegmentService,
  ) {}

  async run(): Promise<void> {
    const state = await this.stateStore.load();
    const now = new Date();

    await this.boardSegment.run(state, now);
    await this.newsSegment.run(state, now);
  }
}
