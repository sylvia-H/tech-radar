import { CurrentBoard, DOMAIN_LABELS } from './board.types';

const RULE = '────────────────────────────────';

/**
 * 將 CurrentBoard 格式化為 M1 觀測 log（contracts/board-output.md）。
 * 每領域一段，每筆一行：名次、`owner/name`、`~weeklyStarsEstimate/wk`、`[sources]`、領域。
 * 領域標題用中文；資料列 `domain` 用 enum 值。`~` 標示（Trending 為實際週增星、Search 為估算）。
 */
export function formatCurrentBoard(board: CurrentBoard): string {
  const lines: string[] = [];
  lines.push(
    `📊 CurrentBoard @ ${board.builtAt}  (api: core=${board.apiCalls.core}, search=${board.apiCalls.search})`,
  );
  for (const db of board.boards) {
    lines.push(`── ${DOMAIN_LABELS[db.domain]} ${RULE}`);
    if (db.entries.length === 0) {
      lines.push('   （本週無符合候選）');
      continue;
    }
    for (const e of db.entries) {
      const rank = `#${e.rank}`.padStart(4);
      const name = e.fullName.padEnd(30);
      const est = `~${e.weeklyStarsEstimate}/wk`.padStart(12);
      const src = `[${e.sources.join(',')}]`.padEnd(18);
      lines.push(` ${rank}  ${name} ${est}  ${src} ${e.domain}`);
    }
  }
  return lines.join('\n');
}
