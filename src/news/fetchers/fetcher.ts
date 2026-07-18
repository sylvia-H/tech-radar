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

/**
 * 抓取器輸出（FR-004）：`items` 為過濾後產出的候選原料；`parsedCount` 為**過濾前**、fetcher 從
 * 來源實際解析到的原始條目數。二者分離，讓呼叫端能區分「來源空／壞掉」（`parsedCount === 0` →
 * 發 0 筆告警）與「來源正常、只是內容過濾後無合格項」（`parsedCount > 0` 但 `items` 空 → 不告警，
 * 避免 github-releases 過濾光 patch 時的誤告警，FR-025/026）。
 */
export interface FetchResult {
  /** 過濾前解析到的原始條目數（0 = 來源空／壞，才是「解析到 0 筆」）。 */
  parsedCount: number;
  /** 過濾後產出的候選原料。 */
  items: RawItem[];
}

/** 抓取器介面（FR-004）：`(source, ctx) => FetchResult`。 */
export type SourceFetcher = (source: NewsSource, ctx: FetcherContext) => Promise<FetchResult>;

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
