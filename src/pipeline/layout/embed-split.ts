import { DiscordEmbed } from '../../discord/discord.embed';

/**
 * Discord 單則訊息 ≤`max` embeds 的通用切分（純函式，contracts/embed-split.md）。
 * 依輸入順序（顯示順序：榜單封面 → 卡片 → 晨報）每 `max` 個切一批，取代 dev-guide §7.2
 * 「晨報改送第二則」特例——冷啟動（封面＋10 卡）恰 11 個 embeds 時該特例仍超限，通用
 * chunk-by-10 涵蓋所有情境（research D3）。
 */
export function chunkEmbeds(embeds: DiscordEmbed[], max = 10): DiscordEmbed[][] {
  if (embeds.length === 0) {
    return [];
  }
  const batches: DiscordEmbed[][] = [];
  for (let i = 0; i < embeds.length; i += max) {
    batches.push(embeds.slice(i, i + max));
  }
  return batches;
}
