import { rssFetcher } from './rss.fetcher';
import { FetcherContext, RssItem, SUMMARY_MAX } from './fetcher';
import { NewsHttp } from '../news-http';
import { NewsSource } from '../news.types';

const SRC: NewsSource = { id: 'blog', type: 'rss', url: 'https://blog.com/feed', domain: 'ai', tier: 2 };

function ctxWithFeed(items: RssItem[]): FetcherContext {
  return {
    now: new Date(),
    http: { getText: jest.fn().mockResolvedValue({ text: '<rss/>', notModified: false }), getJson: jest.fn() } as unknown as NewsHttp,
    parser: { parseString: jest.fn().mockResolvedValue({ items }) },
  };
}

describe('rssFetcher（FR-005/007）', () => {
  it('title/link/摘要截 ~500 字/isoDate；缺 title 或 link 者略過', async () => {
    const long = 'x'.repeat(SUMMARY_MAX + 100);
    const items = await rssFetcher(
      SRC,
      ctxWithFeed([
        { title: 'Keep', link: 'https://a.com', content: long, isoDate: '2026-07-17T00:00:00Z' },
        { title: '', link: 'https://b.com' }, // 缺 title → 略過
        { link: 'https://c.com' }, // 缺 title → 略過
        { title: 'NoLink' }, // 缺 link → 略過
      ]),
    );
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Keep');
    expect(items[0].summary!.length).toBe(SUMMARY_MAX);
    expect(items[0].score).toBeNull();
  });
});
