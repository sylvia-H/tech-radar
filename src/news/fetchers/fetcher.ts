import { Injectable } from '@nestjs/common';
import Parser from 'rss-parser';
import { NewsSource, NewsSourceType, RawItem } from '../news.types';
import { NewsHttp } from '../news-http';
import { hnAlgoliaFetcher } from './hn-algolia.fetcher';
import { redditWeeklyFetcher } from './reddit-weekly.fetcher';
import { rssFetcher } from './rss.fetcher';
import { githubReleasesFetcher } from './github-releases.fetcher';

/** feed 摘要節錄上限（供 F6 階段 B 產出 300 字內容的素材，FR-007）。 */
export const SUMMARY_MAX = 500;

/** rss-parser 條目的最小可用子集（可注入 mock）。 */
export interface RssItem {
  title?: string;
  link?: string;
  contentSnippet?: string;
  content?: string;
  isoDate?: string;
  pubDate?: string;
}

/** parser 介面：只需 `parseString`（fetcher 先以 `NewsHttp` 抓文字再交此解析，利於注入測試）。 */
export interface RssParser {
  parseString(xml: string): Promise<{ items: RssItem[] }>;
}

/**
 * `rss-parser` 的注入式包裝（DI провider）。fetcher 走 `NewsHttp` 抓取（帶 UA／退避），
 * 再交此 `parseString` 解析——不用 `parser.parseURL`，以統一抓取禮貌與可測性。
 */
@Injectable()
export class NewsRssParser implements RssParser {
  private readonly parser = new Parser();
  async parseString(xml: string): Promise<{ items: RssItem[] }> {
    return (await this.parser.parseString(xml)) as unknown as { items: RssItem[] };
  }
}

/** 抓取器執行脈絡：注入時間、HTTP 客戶端、RSS parser（皆可於測試替換）。 */
export interface FetcherContext {
  now: Date;
  http: NewsHttp;
  parser: RssParser;
}

/** 抓取器介面（FR-004）：`(source, ctx) => RawItem[]`。 */
export type SourceFetcher = (source: NewsSource, ctx: FetcherContext) => Promise<RawItem[]>;

/** `type` → fetcher 的分派表（策略表；新增同型別來源只改設定，不動此處，FR-004）。 */
export const FETCHERS: Record<NewsSourceType, SourceFetcher> = {
  'hn-algolia': hnAlgoliaFetcher,
  'reddit-weekly': redditWeeklyFetcher,
  rss: rssFetcher,
  'github-releases': githubReleasesFetcher,
};

/** feed 摘要／描述節錄並截斷至 `SUMMARY_MAX`；空白回 `null`（FR-007）。 */
export function truncateSummary(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.length > SUMMARY_MAX ? trimmed.slice(0, SUMMARY_MAX) : trimmed;
}
