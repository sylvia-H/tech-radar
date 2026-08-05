import { BoardChange, BoardDiff } from '../../diff/diff.types';
import { BoardChangeSummary } from '../../curation/board-summary.types';
import { BoardRow, Domain, DOMAIN_LABELS } from '../../board/board.types';
import { IntroResult } from '../../intro/intro.types';
import {
  COLOR_AI,
  COLOR_BOARD_COVER,
  COLOR_FRONTEND_BACKEND,
  DiscordEmbed,
} from '../../discord/discord.embed';

/** 領域配色（contract discord-layout.md L1）。 */
export function domainColor(domain: Domain): number {
  return domain === 'ai' ? COLOR_AI : COLOR_FRONTEND_BACKEND;
}

/** 週增星緊湊表示：8600 → 8.6k（沿用 `src/diff/diff-log.ts` 同精神的獨立實作，避免碰 F3 檔案）。 */
function compact(n: number): string {
  if (n < 1000) {
    return String(n);
  }
  const k = n / 1000;
  return `${k.toFixed(k < 10 ? 1 : 0)}k`;
}

/**
 * 榜單封面（contract discord-layout.md L2）：TL;DR＋下降一行式；`diff.unchanged` 時
 * `summary.summary` 已是 F6 的「本次無變化」事實型摘要，**仍推封面**（FR-012）。
 * 掉出 top10 者本就不出現於 `diff.changes`（diffBoard 不變式），無需另行過濾。
 */
export function buildCoverEmbed(
  summary: BoardChangeSummary,
  diff: BoardDiff,
  dateLabel: string,
): DiscordEmbed {
  const parts = [`**本次榜單變化**\n${summary.summary}`];

  const declined = diff.changes.filter((c) => c.kind === 'declined');
  if (declined.length > 0) {
    const lines = declined.map(
      (c) => `[${c.fullName}](${c.url}) #${c.previousRank} → #${c.currentRank}`,
    );
    parts.push(`🔻 下降\n${lines.join('\n')}`);
  }

  return {
    title: `📊 榜單變化 · ${dateLabel}`,
    color: COLOR_BOARD_COVER,
    description: parts.join('\n\n'),
  };
}

/**
 * 新進／竄升 repo 卡（contract discord-layout.md L3）。僅對 `needsIntro=true` 的變化項呼叫。
 * 簡介降級（`introResult.status==='degraded'`）以「（簡介暫缺）」前綴與正常簡介卡區分（FR-010/SC-006）。
 */
export function buildRepoCard(
  change: BoardChange,
  introResult: IntroResult,
  row: BoardRow,
): DiscordEmbed {
  const isNew = change.kind === 'newcomer';

  const description =
    introResult.status === 'degraded'
      ? `（簡介暫缺）${introResult.description ?? ''}`
      : introResult.intro;

  const rankOrDomainField = isNew
    ? { name: '領域', value: DOMAIN_LABELS[change.domain], inline: true }
    : {
        name: '名次',
        value: `#${change.previousRank} → #${change.currentRank}`,
        inline: true,
      };

  return {
    title: `${isNew ? '🆕' : '🔺'} ${change.fullName}`,
    url: change.url,
    color: domainColor(change.domain),
    description,
    fields: [
      {
        name: '本週增星',
        value: `⭐ +${compact(row.starsThisWeek ?? change.weeklyStarsEstimate)}`,
        inline: true,
      },
      { name: '語言', value: `\`${row.language ?? '—'}\``, inline: true },
      rankOrDomainField,
    ],
  };
}
