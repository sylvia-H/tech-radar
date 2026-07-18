import { RawItem } from '../news.types';
import { FetcherContext, RssItem, SourceFetcher, truncateSummary } from './fetcher';

/**
 * RSS/Atom 條目 → RawItem（research D5）。RSS 通常無社群分數 → `score = null`（走漏斗的
 * 「無分數不套門檻」路徑，D8）。摘要取 `contentSnippet`／`content` 截 ~500 字（FR-007）。
 * 缺 `title` 或 `link` 者略過。
 */
export function rssItemsToRaw(items: RssItem[]): RawItem[] {
  const out: RawItem[] = [];
  for (const item of items) {
    const title = item.title?.trim();
    const link = item.link?.trim();
    if (!title || !link) {
      continue;
    }
    out.push({
      title,
      targetUrl: link,
      summary: truncateSummary(item.contentSnippet ?? item.content),
      score: null,
      publishedAt: item.isoDate ?? null,
    });
  }
  return out;
}

/** 先以 `NewsHttp` 抓文字（UA／退避）再交注入的 parser 解析（利於測試）。 */
export async function fetchAndParse(source: { url: string }, ctx: FetcherContext): Promise<RssItem[]> {
  const { text, notModified } = await ctx.http.getText(source.url);
  if (notModified) {
    return [];
  }
  const feed = await ctx.parser.parseString(text);
  return feed.items ?? [];
}

/** 一般 RSS/Atom（官方 blog、Lobste.rs 標籤…）。 */
export const rssFetcher: SourceFetcher = async (source, ctx) => {
  return rssItemsToRaw(await fetchAndParse(source, ctx));
};
