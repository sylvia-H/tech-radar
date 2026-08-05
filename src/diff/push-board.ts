import { BoardRow, DomainBoard } from '../board/board.types';
import { PushBoard, PushBoardRow } from './diff.types';
import { compareForPushBoard } from './rank-compare';

/** 綜合榜視窗與每領域保底席次（FR-001/FR-003）。 */
export const PUSH_BOARD_SIZE = 10;
export const RESERVED_PER_DOMAIN = 2;

/**
 * 兩領域榜 → 跨領域綜合 top 10（FR-001/FR-003/FR-004）。
 *
 * 1. 攤平兩領域全部候選（≤30 筆）。
 * 2. **保底**：每領域依 `compareForPushBoard` 取最高 `RESERVED_PER_DOMAIN` 筆（不足照實取）。
 * 3. **競爭**：其餘候選依同一比較器取 `10 − 保底數` 筆（跨領域，空席由另一領域遞補）。
 * 4. 合併後依同一比較器排序，指派 `rank = 1..N`。
 *
 * 不變式：`length ≤ 10`；`rank` 連續由 1 起；候選 <10 照實回傳（不湊數）；候選 0 筆回 `[]`
 * （呼叫端須依 FR-025 中止）。保底、競爭、指派名次**全程只用這一把尺**（FR-003）。
 */
export function pickPushBoard(boards: DomainBoard[], prevIds: ReadonlySet<number>): PushBoard {
  const compare = compareForPushBoard(prevIds);

  const reserved: BoardRow[] = [];
  const reservedIds = new Set<number>();
  for (const db of boards) {
    const top = [...db.entries].sort(compare).slice(0, RESERVED_PER_DOMAIN);
    for (const row of top) {
      reserved.push(row);
      reservedIds.add(row.repoId);
    }
  }

  // 現行常數下 reserved ≤ 2 領域 × 2 = 4，故 remainingSlots ≥ 6；`Math.max(0, …)` 僅在日後
  // 調高保底席次／增加領域致其為負時，擋掉 `slice(0, 負值)` 從尾端反向取的靜默錯誤。
  const remainingSlots = PUSH_BOARD_SIZE - reserved.length;
  const contenders = boards
    .flatMap((db) => db.entries)
    .filter((row) => !reservedIds.has(row.repoId))
    .sort(compare)
    .slice(0, Math.max(0, remainingSlots));

  return [...reserved, ...contenders]
    .sort(compare)
    .map((row, i) => toPushRow(row, i + 1));
}

function toPushRow(row: BoardRow, rank: number): PushBoardRow {
  return {
    rank,
    repoId: row.repoId,
    fullName: row.fullName,
    url: row.url,
    language: row.language,
    domain: row.domain,
    weeklyStarsEstimate: row.weeklyStarsEstimate,
    totalStars: row.totalStars,
  };
}
