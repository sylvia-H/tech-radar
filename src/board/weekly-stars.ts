/**
 * 統一排序鍵 `weeklyStarsEstimate`（純函式，research D5 / FR-005）。
 *
 * 一個領域榜可能混合兩來源，需單一可比排序鍵：
 * - Trending 候選（有 `starsThisWeek`）：直接用官方週增星。
 * - 純 Search 候選：`min(round(totalStars / max(ageDays, 1) × 7), totalStars)`，把「崛起
 *   速度」換算成週增星等值以與主力同尺。`max(ageDays, 1)` 避免今日新建除以零；**上限
 *   `totalStars`** 則是真值上界——補位只撈 `created:>7天` 的 repo，它的星全部是這週來的，
 *   本週增星不可能超過總星數，少了這道上限，今日新建的 repo 會被 ×7 外推而壓過主力龍頭。
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
  return Math.min(Math.round((total / age) * 7), total);
}
