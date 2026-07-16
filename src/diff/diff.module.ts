import { Module } from '@nestjs/common';
import { BoardModule } from '../board/board.module';
import { StateModule } from '../state/state.module';
import { DiscordModule } from '../discord/discord.module';
import { BoardDiffService } from './board-diff.service';

/**
 * F3 榜單狀態與變化偵測模組。復用 F2 BoardModule（榜單建置）、F1 StateModule（唯一權威狀態）
 * 與 DiscordModule（空榜／時鐘異常告警）。
 */
@Module({
  imports: [BoardModule, StateModule, DiscordModule],
  providers: [BoardDiffService],
  exports: [BoardDiffService],
})
export class DiffModule {}
