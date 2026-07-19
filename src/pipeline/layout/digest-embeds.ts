import { CuratedDigest, CuratedNewsItem } from '../../curation/curation.types';
import { COLOR_DIGEST, DiscordEmbed } from '../../discord/discord.embed';

const DESCRIPTION_MAX = 4096;

/** Unicode code point 計數（沿用 F5/F6 與憲章字數口徑，非 UTF-16 code unit）。 */
function codePointLength(s: string): number {
  return [...s].length;
}

function formatItem(item: CuratedNewsItem, index: number): string {
  const link = `${index}. [${item.title}](${item.url})`;
  if (item.content === null) {
    // 降級（單則降級或整份 digest.degraded）：原文標題＋連結，不套 300 字改寫（FR-004）。
    return link;
  }
  return `${link}\n${item.content}`;
}

/** 依 4096 上限貪婪把已組好的 lines 分組，盡量塞滿前一組（research D4）。 */
function greedyGroup(lines: string[], max: number, sep: string): string[][] {
  const groups: string[][] = [];
  let current: string[] = [];
  let currentLen = 0;

  for (const line of lines) {
    const lineLen = codePointLength(line);
    const addedLen = current.length === 0 ? lineLen : currentLen + codePointLength(sep) + lineLen;
    if (current.length > 0 && addedLen > max) {
      groups.push(current);
      current = [line];
      currentLen = lineLen;
    } else {
      current.push(line);
      currentLen = addedLen;
    }
  }
  if (current.length > 0) {
    groups.push(current);
  }
  return groups;
}

/**
 * 晨報組版純函式（research D4；contract discord-layout.md L4）。AI 優先在前的順序沿用 F6
 * `digest.items`（F7 不重排）。若整體 description 超過 4096 code points，貪婪拆成多張橙 embed
 * （皆併入 `chunkEmbeds`，仍受單則 ≤10 約束，FR-018）。
 */
export function buildDigestEmbeds(digest: CuratedDigest, dateLabel: string): DiscordEmbed[] {
  const lines = digest.items.map((item, i) => formatItem(item, i + 1));
  const sep = '\n\n';
  const full = lines.join(sep);

  const title = `📡 Tech Radar 晨報 · ${dateLabel}`;

  if (codePointLength(full) <= DESCRIPTION_MAX) {
    return [{ title, color: COLOR_DIGEST, description: full }];
  }

  const groups = greedyGroup(lines, DESCRIPTION_MAX, sep);
  return groups.map((group) => ({ title, color: COLOR_DIGEST, description: group.join(sep) }));
}
