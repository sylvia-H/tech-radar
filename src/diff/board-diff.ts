import { BoardEntry } from '../state/state.schema';
import { BoardChange, BoardDiff, PushBoard } from './diff.types';

/**
 * 名次移動門檻（兩方向對稱、單一常數可調，FR-010）。`T=1` 即任何名次移動皆計入變化。
 * 調整門檻**只改此常數**（FR-010 決策第 5 點：可逆）。
 */
export const RANK_JUMP_THRESHOLD = 1;

/**
 * 與上次快照比對，產出新進／竄升／下降三類變化（掉出與穩定留榜靜默）。
 *
 * - 在 `pushBoard`、不在 `prev` → `newcomer`（`previousRank: null`、`needsIntro: true`，FR-008）
 * - 兩者皆有、`prev.rank − curr.rank >= T` → `climbed`（`needsIntro: true`，FR-008）
 * - 兩者皆有、`curr.rank − prev.rank >= T` → `declined`（`needsIntro: false`，FR-009/FR-016）
 * - 兩者皆有、名次相同 → 不出現（FR-012）
 * - 在 `prev`、不在 `pushBoard`（掉出）→ 不出現（FR-011）
 *
 * `prev` 直接吃 `state.board`（key 為 `repoId` 字串）。同一性以 `repoId` 判定（抗改名，FR-006）。
 * 變化項目的領域／人氣落差一律取**本次** `pushBoard`（FR-015）。`changes` 依 `currentRank` 升序。
 */
export function diffBoard(prev: Record<string, BoardEntry>, pushBoard: PushBoard): BoardDiff {
  const changes: BoardChange[] = [];

  for (const row of pushBoard) {
    const previous = prev[String(row.repoId)];

    if (!previous) {
      changes.push(change('newcomer', row, null, true));
      continue;
    }

    const delta = previous.rank - row.rank;
    if (delta >= RANK_JUMP_THRESHOLD) {
      changes.push(change('climbed', row, previous.rank, true));
    } else if (-delta >= RANK_JUMP_THRESHOLD) {
      changes.push(change('declined', row, previous.rank, false));
    }
    // delta === 0（名次未變）→ 靜默（FR-012）
  }

  changes.sort((a, b) => a.currentRank - b.currentRank);

  return {
    changes,
    unchanged: changes.length === 0,
    topEntry: pushBoard[0],
    pushBoard,
  };
}

function change(
  kind: BoardChange['kind'],
  row: PushBoard[number],
  previousRank: number | null,
  needsIntro: boolean,
): BoardChange {
  return {
    kind,
    repoId: row.repoId,
    fullName: row.fullName,
    url: row.url,
    domain: row.domain,
    weeklyStarsEstimate: row.weeklyStarsEstimate,
    currentRank: row.rank,
    previousRank,
    needsIntro,
  };
}
