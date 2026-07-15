import { GithubHttpError, GithubHttpService } from '../github/github-http';
import { DOMAIN_KEYWORDS, DOMAIN_KEYWORD_SETS } from '../classify/domain-keywords';
import {
  buildSearchQuery,
  createdSince,
  GithubSearchService,
  parseSearchResponse,
  SEARCH_QUERIES,
  searchUrl,
} from './github-search.service';

describe('Search query 組裝', () => {
  it('三組 q 帶關鍵字 OR 群、created 時間窗與 stars 門檻', () => {
    const since = '2026-07-05';
    const [ai, devops, fe] = SEARCH_QUERIES;
    expect(buildSearchQuery(ai, since)).toBe('(llm OR rag OR agent OR gpt) created:>2026-07-05 stars:>30');
    expect(buildSearchQuery(devops, since)).toBe('(kubernetes OR terraform OR gitops) created:>2026-07-05 stars:>20');
    expect(buildSearchQuery(fe, since)).toBe(
      '(nextjs OR react OR svelte OR nodejs OR golang) created:>2026-07-05 stars:>20',
    );
  });

  it('OR 群衍生自分類種子集的 search 群，不另抄字面量（防兩份清單漂移）', () => {
    for (const cfg of SEARCH_QUERIES) {
      expect(cfg.keywords).toBe(DOMAIN_KEYWORD_SETS[cfg.domain].search);
      // 種子集完整集必然涵蓋 OR 群 → 搜尋得到的一定分類得到
      expect(DOMAIN_KEYWORDS[cfg.domain]).toEqual(expect.arrayContaining(cfg.keywords));
    }
  });

  it('createdSince = 今天 − 7 天（YYYY-MM-DD）', () => {
    expect(createdSince(new Date('2026-07-12T10:00:00Z'))).toBe('2026-07-05');
  });

  it('searchUrl 帶 sort=stars、order=desc、per_page，且 q 經 URL 編碼', () => {
    const url = searchUrl(SEARCH_QUERIES[0], '2026-07-05');
    expect(url).toContain('sort=stars&order=desc&per_page=30');
    expect(url).toContain(encodeURIComponent('(llm OR rag OR agent OR gpt) created:>2026-07-05 stars:>30'));
  });
});

describe('parseSearchResponse', () => {
  it('映射 id/full_name/topics/stars/created_at → RawSearchRepo', () => {
    const raw = {
      items: [
        {
          id: 55,
          full_name: 'acme/new-rag',
          description: 'a new rag lib',
          language: 'Python',
          topics: ['rag', 'llm'],
          stargazers_count: 120,
          created_at: '2026-07-08T00:00:00Z',
        },
      ],
    };
    expect(parseSearchResponse(raw)).toEqual([
      {
        repoId: 55,
        fullName: 'acme/new-rag',
        description: 'a new rag lib',
        language: 'Python',
        topics: ['rag', 'llm'],
        totalStars: 120,
        createdAt: '2026-07-08T00:00:00Z',
      },
    ]);
  });

  it('items 為空 → 回空陣列（該組 0 筆）', () => {
    expect(parseSearchResponse({ items: [] })).toEqual([]);
  });
});

describe('GithubSearchService.fetchSearch', () => {
  it('三組皆成功 → 合併 repos、無 failures', async () => {
    const getJson = jest.fn(async () => ({
      items: [{ id: 1, full_name: 'o/r', stargazers_count: 50, created_at: '2026-07-09T00:00:00Z' }],
    }));
    const http = { getJson } as unknown as GithubHttpService;
    const { repos, failures } = await new GithubSearchService(http).fetchSearch(new Date('2026-07-12T00:00:00Z'));
    expect(getJson).toHaveBeenCalledTimes(3);
    expect(repos).toHaveLength(3); // 每組一筆
    expect(failures).toEqual([]);
  });

  it('某組 0 筆屬正常 → 不列入 failures', async () => {
    const getJson = jest.fn(async (url: string) =>
      url.includes(encodeURIComponent('kubernetes'))
        ? { items: [] }
        : { items: [{ id: 1, full_name: 'o/r', stargazers_count: 50, created_at: '2026-07-09T00:00:00Z' }] },
    );
    const http = { getJson } as unknown as GithubHttpService;
    const { repos, failures } = await new GithubSearchService(http).fetchSearch(new Date('2026-07-12T00:00:00Z'));
    expect(repos).toHaveLength(2); // devops 組 0 筆
    expect(failures).toEqual([]);
  });

  it('某組失敗 → 進 failures（帶 domain 與 status），其餘組續行', async () => {
    const getJson = jest.fn(async (url: string) => {
      if (url.includes(encodeURIComponent('nextjs'))) {
        throw new GithubHttpError(503);
      }
      return { items: [{ id: 1, full_name: 'o/r', stargazers_count: 50, created_at: '2026-07-09T00:00:00Z' }] };
    });
    const http = { getJson } as unknown as GithubHttpService;
    const { repos, failures } = await new GithubSearchService(http).fetchSearch(new Date('2026-07-12T00:00:00Z'));
    expect(repos).toHaveLength(2); // ai + devops 成功
    expect(failures).toEqual([{ domain: 'frontend-backend', status: 503 }]);
  });
});
