/**
 * 統一排序鍵 `weeklyStarsEstimate`（純函式，research D5 / FR-005）。
 *
 * 一個領域榜可能混合兩來源，需單一可比排序鍵：
 * - Trending 候選（有 `starsThisWeek`）：直接用官方週增星。
 * - 純 Search 候選：`round(totalStars / max(ageDays, 1) × 7)`，把「崛起速度」換算成
 *   週增星等值以與主力同尺；`max(ageDays, 1)` 避免今日新建（ageDays=0）除以零。
 *
 * 同一 repo 同時來自兩來源者，合併時已保留 `starsThisWeek`（FR-004），故走第一分支。
 */
export interface WeeklyStarsInput {
  starsThisWeek: number | null;
  totalStars: number | null;
  ageDays: number | null;
}

export function weeklyStarsEstimate(input: WeeklyStarsInput): number {
  if (input.starsThisWeek !== null) {
    return input.starsThisWeek;
  }
  const total = input.totalStars ?? 0;
  const age = Math.max(input.ageDays ?? 1, 1);
  return Math.round((total / age) * 7);
}
