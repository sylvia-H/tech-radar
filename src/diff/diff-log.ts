import { DOMAIN_LABELS } from '../board/board.types';
import { BoardChange, BoardDiff, CadenceDecision, PushBoardRow } from './diff.types';

const RULE = '────────────────────────────────';

/** 節奏判定一行（跑／跳過＋原因），供 M2 觀測。 */
export function formatCadence(decision: CadenceDecision): string {
  const verb = decision.due ? '執行' : '跳過';
  return `⏱ 榜單節奏：${verb}（${decision.reason}）`;
}

/**
 * 將 `BoardDiff` 印成結構化區塊（M2 唯一觀測面，research D8）：綜合 top 10、三類變化
 * （含 `#舊 → #新`），或「榜單無變化 + 榜首一行摘要」。比照 `board/board-log.ts` 風格。
 */
export function formatBoardDiff(diff: BoardDiff): string {
  const lines: string[] = [];

  lines.push(`📊 綜合 top ${diff.pushBoard.length} ${RULE}`);
  for (const row of diff.pushBoard) {
    lines.push(formatPushRow(row));
  }

  if (diff.unchanged) {
    lines.push(formatUnchangedSummary(diff.topEntry));
    return lines.join('\n');
  }

  lines.push(`變化（${diff.changes.length}）${RULE}`);
  for (const change of diff.changes) {
    lines.push(formatChange(change));
  }
  return lines.join('\n');
}

function formatPushRow(row: PushBoardRow): string {
  const rank = `#${row.rank}`.padStart(4);
  const name = row.fullName.padEnd(30);
  const est = `~${row.weeklyStarsEstimate}/wk`.padStart(12);
  return ` ${rank}  ${name} ${est}  [${row.domain}]`;
}

function formatChange(change: BoardChange): string {
  const name = change.fullName.padEnd(30);
  const est = `⭐+${compact(change.weeklyStarsEstimate)}`;
  switch (change.kind) {
    case 'newcomer':
      return ` 🆕 #${change.currentRank}  ${name} ${est}  [${change.domain}]`;
    case 'climbed':
      return ` 🔺 #${change.previousRank} → #${change.currentRank}  ${name} ${est}  [${change.domain}]`;
    case 'declined':
      return ` 🔻 #${change.previousRank} → #${change.currentRank}  ${name} ${est}  [${change.domain}]`;
  }
}

/** 「無變化」一行摘要（dev-guide §5.2）：`📊 榜單無變化 · AI 榜首 owner/name ⭐+8.6k`。 */
function formatUnchangedSummary(top: PushBoardRow): string {
  return `📊 榜單無變化 · ${DOMAIN_LABELS[top.domain]} 榜首 ${top.fullName} ⭐+${compact(top.weeklyStarsEstimate)}`;
}

/** 週增星緊湊表示：8600 → 8.6k。 */
function compact(n: number): string {
  if (n < 1000) {
    return String(n);
  }
  const k = n / 1000;
  return `${k.toFixed(k < 10 ? 1 : 0)}k`;
}
