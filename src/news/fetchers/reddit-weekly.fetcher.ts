import { SourceFetcher } from './fetcher';
import { fetchAndParse, rssItemsToRaw } from './rss.fetcher';

/**
 * Reddit 週熱門 `/top/.rss?t=week`（research D5）。與一般 RSS 同解析路徑；**Reddit RSS 不帶
 * upvote 數**，故 `score` 一律 `null`（走漏斗「無分數不套門檻」路徑，D8）。`t=week` 本身即
 * 對齊「本週」口徑（FR-010）。
 */
export const redditWeeklyFetcher: SourceFetcher = async (source, ctx) => {
  const parsed = await fetchAndParse(source, ctx);
  return { parsedCount: parsed.length, items: rssItemsToRaw(parsed) };
};
