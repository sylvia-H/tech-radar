import { Injectable } from '@nestjs/common';
import { BoardDiffService } from '../diff/board-diff.service';

/**
 * F3 編排：執行榜單段（節奏判定 → 建置兩領域榜 → 跨領域綜合 top 10 → 與上次快照 diff →
 * 輸出變化 log →（交付成功後）寫回狀態）。判定與副作用皆封裝於 `BoardDiffService`；
 * 本層只負責觸發並傳入當前時間（時間可注入，spec Assumptions）。
 *
 * 邊界（憲章 III/VI）：**不**推播 Discord（F7）、**不**生成簡介（F5）、**不**碰新聞（F4/F6）。
 */
@Injectable()
export class PipelineService {
  constructor(private readonly boardDiff: BoardDiffService) {}

  async run(): Promise<void> {
    await this.boardDiff.runBoardSegment(new Date());
  }
}
