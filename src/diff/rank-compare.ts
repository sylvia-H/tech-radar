/**
 * 四層全序比較器（FR-004、research D2）。同時用於三處：保底席次挑選、跨領域競爭、
 * 最終 `#1..#N` 名次指派——選榜全程只用這一把尺，避免平手時產生兩套判準。
 */

/** 比較器所需的最小結構（`BoardRow` 與 `PushBoardRow` 皆滿足）。 */
export interface RankInput {
  repoId: number;
  weeklyStarsEstimate: number;
  totalStars: number | null;
}

/**
 * 回傳依 `prevIds` 閉包的比較器 `(a, b) => number`：
 *   1. `weeklyStarsEstimate` 降序
 *   2. `totalStars ?? 0` 降序（null 視為最低）
 *   3. 新進者優先：不在 `prevIds` 者在前
 *   4. `repoId` 升序（最終決勝）
 *
 * 第 4 層保證**全序**：不同 repo 的 `repoId` 必不相等（GitHub 數字 id 唯一），故永不回傳
 * `0` → 排序結果不依賴 `Array.prototype.sort` 是否穩定（SC-008）。
 */
export function compareForPushBoard(
  prevIds: ReadonlySet<number>,
): (a: RankInput, b: RankInput) => number {
  return (a, b) => {
    if (a.weeklyStarsEstimate !== b.weeklyStarsEstimate) {
      return b.weeklyStarsEstimate - a.weeklyStarsEstimate;
    }
    const aTotal = a.totalStars ?? 0;
    const bTotal = b.totalStars ?? 0;
    if (aTotal !== bTotal) {
      return bTotal - aTotal;
    }
    const aExisting = prevIds.has(a.repoId) ? 1 : 0;
    const bExisting = prevIds.has(b.repoId) ? 1 : 0;
    if (aExisting !== bExisting) {
      return aExisting - bExisting; // 新進(0) 排在既有(1) 之前
    }
    return a.repoId - b.repoId;
  };
}
