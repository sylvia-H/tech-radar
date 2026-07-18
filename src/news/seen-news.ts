import { NewsCandidate } from './news.types';
import { SeenNewsEntry } from '../state/state.schema';
import { normalizeTargetUrl } from './url-normalize';

const DAY_MS = 86_400_000;

/**
 * 修剪已見紀錄（FR-023 / SC-008）：剔除 `seenAt` 超過保留期（預設 7 天）者，使紀錄不無限
 * 膨脹。無法解析的 `seenAt` 一併剔除（避免壞值永久殘留）。純函式、`now` 注入。
 */
export function pruneSeenNews(
  entries: readonly SeenNewsEntry[],
  now: Date,
  retentionDays = 7,
): SeenNewsEntry[] {
  const cutoff = now.getTime() - retentionDays * DAY_MS;
  return entries.filter((e) => {
    const seenAt = Date.parse(e.seenAt);
    return Number.isFinite(seenAt) && seenAt >= cutoff;
  });
}

/**
 * 跨天去重排除（FR-022 / SC-007）：以**正規化 target-URL**（與 FR-011 同一套 `normalizeTargetUrl`）
 * 比對，已出現過的候選自輸出排除。候選 `normalizedUrl` 已正規化、`seen` 的 `url` 再正規化一次
 * （對已正規化字串為冪等），使帶不同追蹤參數的同一連結仍被判為已見。純函式。
 */
export function excludeSeen(
  cands: readonly NewsCandidate[],
  seen: readonly SeenNewsEntry[],
): NewsCandidate[] {
  const seenSet = new Set(seen.map((e) => normalizeTargetUrl(e.url)));
  return cands.filter((c) => !seenSet.has(c.normalizedUrl));
}
