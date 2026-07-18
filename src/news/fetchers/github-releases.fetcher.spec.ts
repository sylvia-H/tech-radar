import { githubReleasesFetcher } from './github-releases.fetcher';
import { FetcherContext, RssItem } from './fetcher';
import { NewsHttp } from '../news-http';
import { NewsSource } from '../news.types';

const SRC: NewsSource = {
  id: 'gh-node',
  type: 'github-releases',
  url: 'https://github.com/nodejs/node/releases.atom',
  domain: 'frontend-backend',
  tier: 2,
};

function ctxWithFeed(items: RssItem[]): FetcherContext {
  return {
    now: new Date(),
    http: { getText: jest.fn().mockResolvedValue({ text: '<atom/>', notModified: false }), getJson: jest.fn() } as unknown as NewsHttp,
    parser: { parseString: jest.fn().mockResolvedValue({ items }) },
  };
}

describe('githubReleasesFetcher（FR-005/008, SC-010）', () => {
  it('解析 releases.atom 並套版本過濾（drop pre-release／純 patch，keep major/minor/security）', async () => {
    const items = await githubReleasesFetcher(
      SRC,
      ctxWithFeed([
        { title: 'v20.11.0', link: 'https://gh/1' }, // minor → keep
        { title: 'v20.11.1', link: 'https://gh/2' }, // 純 patch → drop
        { title: 'v21.0.0-rc.1', link: 'https://gh/3' }, // rc → drop
        { title: 'v18.19.1 (Security)', link: 'https://gh/4' }, // 安全 patch → keep
      ]),
    );
    expect(items.map((i) => i.title)).toEqual(['v20.11.0', 'v18.19.1 (Security)']);
    expect(items[0].score).toBeNull();
  });
});
