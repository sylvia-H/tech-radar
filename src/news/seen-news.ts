import { NewsCandidate } from './news.types';
import { SeenNewsEntry } from '../state/state.schema';
import { normalizeTargetUrl } from './url-normalize';
import { jaccard, normalizeTitle, TITLE_JACCARD_THRESHOLD } from './title-similarity';

const DAY_MS = 86_400_000;

/**
 * 已推清單保留天數（2026-09-02 由 7 天改為 45 天）。
 *
 * 下限必須 ≥ 一則新聞「最久還能當候選」的時間，否則修剪後它與從未推過的新聞無法區分、會被
 * 再推一次。無分數來源（RSS／GitHub Releases）的候選視窗是 `freshnessWindowDays`（30 天，
 * funnel.ts），而官方 feed 常把同一篇掛上數週；原本 7 天只涵蓋 HN 的近 7 天口徑，實測
 * 2026-07-19～09-01 的 310 則推播中有 46 則重複（15%），相鄰兩次推播間隔 46 次有 38 次落在
 * 7～8 天，正是保留期到期的隔天。45 天 = 30 天視窗 + 15 天緩衝，緩衝吸收 Atom `updated`
 * 日期事後編修往後推、同一 URL 數週後重新投稿 HN 等視窗外漂移；實測最長重推間隔 23 天，全數
 * 涵蓋。代價：seenNews 由約 50 筆／7 KB 增至約 320 筆／40 KB，每日 diff 量不變。
 * `seen-news.spec.ts` 以耦合測試斷言此值 ≥ `freshnessWindowDays`，兩常數不得再各自漂移。
 */
export const SEEN_NEWS_RETENTION_DAYS = 45;

/**
 * 修剪已見紀錄（FR-023 / SC-008）：剔除 `seenAt` 超過保留期（預設 `SEEN_NEWS_RETENTION_DAYS`）
 * 者，使紀錄不無限膨脹。無法解析的 `seenAt` 一併剔除（避免壞值永久殘留）。純函式、`now` 注入。
 */
export function pruneSeenNews(
  entries: readonly SeenNewsEntry[],
  now: Date,
  retentionDays: number = SEEN_NEWS_RETENTION_DAYS,
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

/**
 * 跨日標題去重的回看視窗（2026-10-06 新增）。同一件事的多篇報導不會相差數月，與當日池內標題合併的
 * `TITLE_MERGE_MAX_GAP_DAYS`（14 天）同一把尺；不用整個 45 天保留期，避免一個月前的舊事件壓掉同名新版本。
 */
export const SEEN_TITLE_WINDOW_DAYS = 14;

/** 跨日標題去重門檻：沿用當日池內的 `TITLE_JACCARD_THRESHOLD`（0.6），保守起步避免誤殺同主題的新進展。 */
export const SEEN_TITLE_JACCARD_THRESHOLD = TITLE_JACCARD_THRESHOLD;

/** `excludeSeenByTitle` 的結果：保留的候選，與被排除者及其命中的已推標題（供 log 揭露）。 */
export interface ExcludeSeenByTitleResult {
  kept: NewsCandidate[];
  dropped: Array<{ candidate: NewsCandidate; seenTitle: string }>;
}

/**
 * 跨日標題去重（2026-10-06 新增）：`excludeSeen` 只比 URL，同一事件換一條連結隔日再出現（官方 blog 推過、
 * 隔天 HN 投稿連到另一頁；或同一發布的不同報導）會再推一次——1.3.1 上線九天內荷蘭 NixOS、Gemini 4 Argon、
 * Sonnet 5.5 各重推兩次。本函式對近 `windowDays` 天內**帶標題**的已推紀錄（2026-10-06 起落檔才有 `title`）
 * 以 `normalizeTitle`＋Jaccard 比對，相似度 ≥ `threshold` 即排除。純函式、零 LLM、`now` 注入；舊條目無標題者
 * 跳過。回傳被排除者與命中的已推標題，呼叫端印 log。
 */
export function excludeSeenByTitle(
  cands: readonly NewsCandidate[],
  seen: readonly SeenNewsEntry[],
  now: Date,
  windowDays: number = SEEN_TITLE_WINDOW_DAYS,
  threshold: number = SEEN_TITLE_JACCARD_THRESHOLD,
): ExcludeSeenByTitleResult {
  const cutoff = now.getTime() - windowDays * DAY_MS;
  const recent = seen
    .filter((e) => typeof e.title === 'string' && e.title.length > 0)
    .filter((e) => {
      const t = Date.parse(e.seenAt);
      return Number.isFinite(t) && t >= cutoff;
    })
    .map((e) => ({ title: e.title as string, tokens: normalizeTitle(e.title as string) }))
    .filter((e) => e.tokens.length > 0);
  if (recent.length === 0) {
    return { kept: [...cands], dropped: [] };
  }
  const kept: NewsCandidate[] = [];
  const dropped: ExcludeSeenByTitleResult['dropped'] = [];
  for (const c of cands) {
    const tokens = normalizeTitle(c.title);
    const hit = recent.find((e) => jaccard(tokens, e.tokens) >= threshold);
    if (hit) {
      dropped.push({ candidate: c, seenTitle: hit.title });
    } else {
      kept.push(c);
    }
  }
  return { kept, dropped };
}
