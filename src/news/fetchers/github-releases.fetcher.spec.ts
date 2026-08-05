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
    const result = await githubReleasesFetcher(
      SRC,
      ctxWithFeed([
        { title: 'v20.11.0', link: 'https://gh/1' }, // minor → keep
        { title: 'v20.11.1', link: 'https://gh/2' }, // 純 patch → drop
        { title: 'v21.0.0-rc.1', link: 'https://gh/3' }, // rc → drop
        { title: 'v18.19.1 (Security)', link: 'https://gh/4' }, // 安全 patch（標題）→ keep
      ]),
    );
    expect(result.items.map((i) => i.title)).toEqual(['v20.11.0', 'v18.19.1 (Security)']);
    expect(result.items[0].score).toBeNull();
    // parsedCount 為過濾前原始筆數（供 0 筆告警判定），非過濾後結果。
    expect(result.parsedCount).toBe(4);
  });

  it('安全字樣僅在內文(body)、標題只有版號的純 patch → 仍 keep（Fix 3）', async () => {
    const result = await githubReleasesFetcher(
      SRC,
      ctxWithFeed([
        { title: 'v18.19.1', link: 'https://gh/1', content: 'This release fixes CVE-2026-1234 in the TLS stack.' },
        { title: 'v18.19.2', link: 'https://gh/2', contentSnippet: 'Routine bugfixes and documentation updates.' },
      ]),
    );
    // 內文含 CVE 者豁免保留；純內文無安全字樣的 patch 照丟。
    expect(result.items.map((i) => i.title)).toEqual(['v18.19.1']);
  });

  it('原始有解析但全被過濾 → items 空、parsedCount > 0（不觸 0 筆告警的依據）', async () => {
    const result = await githubReleasesFetcher(
      SRC,
      ctxWithFeed([
        { title: 'v1.0.1', link: 'https://gh/1' }, // 純 patch → drop
        { title: 'v2.0.0-beta', link: 'https://gh/2' }, // pre-release → drop
      ]),
    );
    expect(result.items).toEqual([]);
    expect(result.parsedCount).toBe(2);
  });
});
