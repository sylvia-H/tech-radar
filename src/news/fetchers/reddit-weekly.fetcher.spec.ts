import { redditWeeklyFetcher } from './reddit-weekly.fetcher';
import { FetcherContext, RssItem } from './fetcher';
import { NewsHttp } from '../news-http';
import { NewsSource } from '../news.types';

const SRC: NewsSource = {
  id: 'reddit-x',
  type: 'reddit-weekly',
  url: 'https://www.reddit.com/r/x/top/.rss?t=week',
  domain: 'ai',
  tier: 1,
};

function ctxWithFeed(items: RssItem[], now = new Date()): FetcherContext {
  return {
    now,
    http: { getText: jest.fn().mockResolvedValue({ text: '<feed/>', notModified: false }), getJson: jest.fn() } as unknown as NewsHttp,
    parser: { parseString: jest.fn().mockResolvedValue({ items }) },
  };
}

describe('redditWeeklyFetcher（research D5/D8）', () => {
  it('解析 title/link/摘要/isoDate；score 一律 null（RSS 無分數）', async () => {
    const items = await redditWeeklyFetcher(
      SRC,
      ctxWithFeed([{ title: 'T', link: 'https://a.com', contentSnippet: 's', isoDate: '2026-07-17T00:00:00Z' }]),
    );
    expect(items[0]).toEqual({
      title: 'T',
      targetUrl: 'https://a.com',
      summary: 's',
      score: null,
      publishedAt: '2026-07-17T00:00:00Z',
    });
  });

  it('條件式 304（notModified）→ 回 0 筆', async () => {
    const ctx: FetcherContext = {
      now: new Date(),
      http: { getText: jest.fn().mockResolvedValue({ text: '', notModified: true }), getJson: jest.fn() } as unknown as NewsHttp,
      parser: { parseString: jest.fn() },
    };
    expect(await redditWeeklyFetcher(SRC, ctx)).toEqual([]);
  });
});
