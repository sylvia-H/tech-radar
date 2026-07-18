import { hnAlgoliaFetcher } from './hn-algolia.fetcher';
import { FetcherContext } from './fetcher';
import { NewsHttp } from '../news-http';
import { NewsSource } from '../news.types';

const SRC: NewsSource = {
  id: 'hn',
  type: 'hn-algolia',
  url: 'https://hn.algolia.com/api/v1/search?tags=story',
  domain: 'cross',
  tier: 1,
};

function ctxWithJson(json: unknown, now: Date): { ctx: FetcherContext; getJson: jest.Mock } {
  const getJson = jest.fn().mockResolvedValue(json);
  const ctx: FetcherContext = {
    now,
    http: { getJson, getText: jest.fn() } as unknown as NewsHttp,
    parser: { parseString: jest.fn() },
  };
  return { ctx, getJson };
}

describe('hnAlgoliaFetcher（FR-005/010/015）', () => {
  const now = new Date('2026-07-18T00:00:00Z');
  const weekAgo = Math.floor(now.getTime() / 1000) - 7 * 24 * 3600;

  it('近 7 天過濾、points→score、url 空退回 HN permalink', async () => {
    const { ctx, getJson } = ctxWithJson(
      {
        hits: [
          { objectID: '1', title: 'A', url: 'https://a.com/x', points: 150, created_at_i: weekAgo + 1000 },
          { objectID: '2', title: 'Ask HN: B', url: '', points: 5, created_at_i: weekAgo + 2000 },
          { objectID: '3', title: 'old', url: 'https://c.com', points: 999, created_at_i: weekAgo - 5000 },
        ],
      },
      now,
    );
    const items = await hnAlgoliaFetcher(SRC, ctx);

    expect(items).toHaveLength(2); // 超過 7 天者濾除
    expect(items[0]).toMatchObject({ title: 'A', targetUrl: 'https://a.com/x', score: 150, summary: null });
    expect(items[1].targetUrl).toBe('https://news.ycombinator.com/item?id=2');
    expect(getJson.mock.calls[0][0]).toContain(`numericFilters=created_at_i>${weekAgo}`);
  });
});
