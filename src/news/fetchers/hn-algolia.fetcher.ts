import { RawItem } from '../news.types';
import { SourceFetcher } from './fetcher';

const HN_ITEM_BASE = 'https://news.ycombinator.com/item?id=';

/**
 * HN 抓取視窗（天）。2026-09-12 由 7 天縮為 4 天：pipeline 每日執行，7 天視窗會讓同一批未入選的
 * HN 候選被 LLM 重複評估最多 7 次，且當日候選池 50 席中有 24 席為 HN；HN 熱度多在 48 小時內定型，
 * 4 天仍能接住慢熱文。
 */
export const HN_WINDOW_DAYS = 4;
const HN_WINDOW_SECONDS = HN_WINDOW_DAYS * 24 * 60 * 60;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 舊年份尾綴的寬限天數。對齊 `funnel.ts` 的 `freshnessWindowDays`（30 天）——非 HN 來源的新鮮度
 * 視窗是 30 天，HN 舊文判定也用同一把尺：該年份的最後一刻（12/31 23:59:59 UTC）距 `now` 超過此
 * 天數才算舊。不直接 import 漏斗常數，避免 fetcher 依賴漏斗層。（2026-09-12）
 */
export const OLD_YEAR_GRACE_DAYS = 30;

/**
 * 舊文尾綴慣例：標題結尾為 `(YYYY)`，YYYY 為 19xx／20xx 四位數，年份後允許零到多個 HN 格式標籤
 * （`[pdf]`、`[video]`、`[pdf, 2.3MB]` …）。2026-09-12 起納入標籤形態：原本 `\((19|20)\d{2}\)$`
 * 漏掉「A Mathematical Theory of Communication (1948) [pdf]」這類 HN 最常見的舊文標題。
 */
const OLD_YEAR_SUFFIX_RE = /\((?<year>(?:19|20)\d{2})\)(?:\s*\[[^\]]*\])*$/;

interface AlgoliaHit {
  title?: string | null;
  story_title?: string | null;
  url?: string | null;
  story_url?: string | null;
  objectID: string;
  points?: number | null;
  created_at_i?: number | null;
}
interface AlgoliaResponse {
  hits?: AlgoliaHit[];
}

/**
 * 判斷 HN 標題是否帶「舊年份尾綴」。HN 慣例會在舊文標題尾端加 `(YYYY)`（例：「Your intellectual
 * fly is open … (2025)」）；HN 的 `publishedAt` 是投稿時間而非原文發佈時間，因此漏斗的新鮮度視窗對
 * HN 豁免，舊文只能靠此慣例把關。證據：2026-09-06 曾推出 2026-07 的舊文、2026-09-12 候選池含 2025
 * 文章。規則：標題（trim 後）以 `(YYYY)` 結尾（後方可接零到多個 `[標籤]`），且 `YYYY` 年的最後
 * 一刻（12/31 23:59:59 UTC）距 `now` 超過 `OLD_YEAR_GRACE_DAYS` 天 → `true`。2026-09-12 由
 * 「`YYYY < now` 的 UTC 年份」改為此寬限判定：舊規則在 1 月會把上年度的年度報告（例：2027-01-02
 * 投稿的「State of JS (2026)」）誤殺，比非 HN 來源的 30 天新鮮度視窗嚴格得多。
 */
export function isOldYearSuffixed(title: string, now: Date): boolean {
  const match = OLD_YEAR_SUFFIX_RE.exec(title.trim());
  const yearText = match?.groups?.year;
  if (yearText === undefined) {
    return false;
  }
  const year = Number.parseInt(yearText, 10);
  const yearEnd = Date.UTC(year, 11, 31, 23, 59, 59);
  return now.getTime() - yearEnd > OLD_YEAR_GRACE_DAYS * DAY_MS;
}

/**
 * HN 熱門（Algolia JSON，research D4）：依 `now` 補 `created_at_i>{HN_WINDOW_DAYS 天前}` 過濾
 * 近 `HN_WINDOW_DAYS` 天（FR-010；2026-09-12 起為 4 天，理由見 `HN_WINDOW_DAYS`）。HN 的
 * `publishedAt` 是投稿時間（`created_at_i`）而非原文發佈時間，故漏斗新鮮度視窗對 HN 豁免；舊文改由
 * `isOldYearSuffixed` 依「(YYYY)」尾綴慣例濾除。target-URL 取命中項 `url`（外部連結）；為空
 * （Ask HN／純文字貼）時退回 HN permalink 作為去重鍵（FR-015）。`points`→score；`domain: cross`
 * 交 `news-classify` 歸類。
 */
export const hnAlgoliaFetcher: SourceFetcher = async (source, ctx) => {
  const cutoff = Math.floor(ctx.now.getTime() / 1000) - HN_WINDOW_SECONDS;
  const sep = source.url.includes('?') ? '&' : '?';
  const url = `${source.url}${sep}numericFilters=created_at_i>${cutoff}&hitsPerPage=100`;
  const data = await ctx.http.getJson<AlgoliaResponse>(url);

  const hits = data.hits ?? [];
  const items: RawItem[] = [];
  for (const hit of hits) {
    const createdAt = typeof hit.created_at_i === 'number' ? hit.created_at_i : null;
    if (createdAt !== null && createdAt <= cutoff) {
      continue; // 近 HN_WINDOW_DAYS 天雙重保險（query 已濾，防端點行為變動）；與 query 的 `>` 同界（等於 cutoff 亦丟，2026-09-12）
    }
    const title = (hit.title ?? hit.story_title ?? '').trim();
    if (title.length === 0) {
      continue;
    }
    if (isOldYearSuffixed(title, ctx.now)) {
      continue; // 舊文尾綴「(YYYY)」：HN 豁免新鮮度視窗，靠標題慣例把關
    }
    const external = hit.url ?? hit.story_url ?? null;
    const targetUrl = external && external.length > 0 ? external : `${HN_ITEM_BASE}${hit.objectID}`;
    items.push({
      title,
      targetUrl,
      summary: null, // HN 命中項無摘要欄位
      score: typeof hit.points === 'number' ? hit.points : null,
      publishedAt: createdAt !== null ? new Date(createdAt * 1000).toISOString() : null,
    });
  }
  // parsedCount 取原始 hits 數：Algolia 有回應（即使全被視窗／空標題／舊年份尾綴濾除）即非「解析到 0 筆」。
  return { parsedCount: hits.length, items };
};
