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

/** Discord 單則訊息內所有 embeds 的 title＋description＋fields 合計字元上限（官方限制 6,000）。 */
export const MESSAGE_CHAR_BUDGET = 6000;

/** 單張 embed 計入訊息預算的字元數（code point 計，與 `digest-embeds.ts` 同口徑）。 */
export function embedCharLength(e: DiscordEmbed): number {
  const fields = e.fields ?? [];
  return (
    [...e.title].length +
    [...(e.description ?? '')].length +
    fields.reduce((n, f) => n + [...f.name].length + [...f.value].length, 0)
  );
}

/**
 * 同時受「≤`max` 個 embeds」與「合計 ≤`budget` 字元」約束的切分（2026-09-25 新增，晨報段使用）。
 * `buildDigestEmbeds` 只保證單張 description ≤4,096，晨報上限由 10 則放寬到 15 則後，一次推播可能
 * 拆成三張近 4,096 的 embed、合計逾 6,000，Discord 會整則 400 拒收——`chunkEmbeds` 只數張數擋不住。
 * 貪婪依序裝批：加入下一張會超出張數或字元預算就另起一批；單張本身超出預算者仍自成一批送出
 * （交由 Discord 回錯、不在此靜默丟內容）。
 */
export function chunkEmbedsByBudget(embeds: DiscordEmbed[], max = 10, budget = MESSAGE_CHAR_BUDGET): DiscordEmbed[][] {
  const batches: DiscordEmbed[][] = [];
  let current: DiscordEmbed[] = [];
  let currentLen = 0;
  for (const e of embeds) {
    const len = embedCharLength(e);
    if (current.length > 0 && (current.length >= max || currentLen + len > budget)) {
      batches.push(current);
      current = [];
      currentLen = 0;
    }
    current.push(e);
    currentLen += len;
  }
  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}
