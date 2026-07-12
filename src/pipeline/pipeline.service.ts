import { Injectable, Logger } from '@nestjs/common';
import { BoardBuilderService } from '../board/board-builder.service';
import { formatCurrentBoard } from '../board/board-log';

/**
 * F2 編排：建置三領域當前榜並以結構化 log 印出（M1 觀測，research D8）。
 *
 * 邊界（憲章 III/VI 不受影響）：**不** diff、**不**推播 Discord、**不**寫回 state/board.json。
 * 來源隔離容錯與告警於 BoardBuilderService 內處理（US4）；本層只負責觸發與輸出。
 */
@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(private readonly boardBuilder: BoardBuilderService) {}

  async run(): Promise<void> {
    const board = await this.boardBuilder.build();
    this.logger.log('\n' + formatCurrentBoard(board));
  }
}
