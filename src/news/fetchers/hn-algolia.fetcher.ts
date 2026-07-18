import { RawItem } from '../news.types';
import { SourceFetcher } from './fetcher';

const HN_ITEM_BASE = 'https://news.ycombinator.com/item?id=';
const WEEK_SECONDS = 7 * 24 * 60 * 60;

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
 * HN 週熱門（Algolia JSON，research D4）：依 `now` 補 `created_at_i>{7天前}` 過濾近 7 天
 * （FR-010）。target-URL 取命中項 `url`（外部連結）；為空（Ask HN／純文字貼）時退回 HN
 * permalink 作為去重鍵（FR-015）。`points`→score；`domain: cross` 交 `news-classify` 歸類。
 */
export const hnAlgoliaFetcher: SourceFetcher = async (source, ctx) => {
  const cutoff = Math.floor(ctx.now.getTime() / 1000) - WEEK_SECONDS;
  const sep = source.url.includes('?') ? '&' : '?';
  const url = `${source.url}${sep}numericFilters=created_at_i>${cutoff}&hitsPerPage=100`;
  const data = await ctx.http.getJson<AlgoliaResponse>(url);

  const items: RawItem[] = [];
  for (const hit of data.hits ?? []) {
    const createdAt = typeof hit.created_at_i === 'number' ? hit.created_at_i : null;
    if (createdAt !== null && createdAt < cutoff) {
      continue; // 近 7 天雙重保險（query 已濾，防端點行為變動）
    }
    const title = (hit.title ?? hit.story_title ?? '').trim();
    if (title.length === 0) {
      continue;
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
  return items;
};
