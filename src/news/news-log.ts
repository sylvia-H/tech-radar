import { NewsCandidate } from './news.types';

const RULE = '────────────────────────────────';

/**
 * 把階段 A 候選集格式化為觀測 log（本 Feature 唯一產出面；不推播、不寫狀態）。
 * 每則一段：名次、`domain`／`tier`／加權分／原始分／`sources[]`、標題、正規化 URL。
 */
export function formatCandidateSet(cands: readonly NewsCandidate[]): string {
  const lines: string[] = [];
  lines.push(`📰 NewsCandidateSet（${cands.length} 則）${RULE}`);
  if (cands.length === 0) {
    lines.push('   （本次無候選）');
    return lines.join('\n');
  }
  cands.forEach((c, i) => {
    const rank = `#${i + 1}`.padStart(4);
    const domain = c.domain.padEnd(16);
    const score = c.score !== null ? String(c.score) : '-';
    const src = `[${c.sources.join(',')}]`;
    lines.push(
      ` ${rank}  ${domain} T${c.tier}  w=${c.weightedScore.toFixed(1)}  score=${score}  ${src}`,
    );
    lines.push(`       ${c.title}`);
    lines.push(`       ${c.normalizedUrl}`);
  });
  return lines.join('\n');
}
