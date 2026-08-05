import { GithubHttpService } from '../github/github-http';
import { GithubTrendingService, TrendingResult } from '../sources/github-trending.service';
import { GithubRepoService, RepoMetasResult } from '../sources/github-repo.service';
import { GithubSearchService, SearchResult } from '../sources/github-search.service';
import { ClassifyService } from '../classify/classify.service';
import { BoardBuilderService, assembleBoards, mergeById, shouldAlertRepoFailures } from './board-builder.service';
import { CandidateRepo, RawSearchRepo, RawTrendingRepo, RepoMeta } from './board.types';

function trending(fullName: string, starsThisWeek: number, description: string | null = null): RawTrendingRepo {
  return { fullName, description, language: null, starsThisWeek };
}

function meta(repoId: number, topics: string[], createdAt = '2026-07-01T00:00:00Z'): RepoMeta {
  return { repoId, topics, totalStars: 500, createdAt };
}

function searchRepo(repoId: number, fullName: string, topics: string[], totalStars: number, ageDaysAgoIso: string): RawSearchRepo {
  return {
    repoId,
    fullName,
    description: null,
    language: null,
    topics,
    totalStars,
    createdAt: ageDaysAgoIso,
  };
}

const EMPTY_SEARCH: SearchResult = { repos: [], failures: [] };

/** fetchTrending 的成功回傳（無失敗頁）。 */
function trendingOk(repos: RawTrendingRepo[]): TrendingResult {
  return { repos, failedPages: [] };
}

function buildService(
  trendingRepos: RawTrendingRepo[],
  metasResult: RepoMetasResult,
  searchResult: SearchResult = EMPTY_SEARCH,
): BoardBuilderService {
  const http = {
    resetCounts: jest.fn(),
    get counts() {
      return { core: metasResult.metas.size, search: 3 };
    },
  } as unknown as GithubHttpService;
  const trendingSvc = {
    fetchTrending: jest.fn().mockResolvedValue(trendingOk(trendingRepos)),
  } as unknown as GithubTrendingService;
  const reposSvc = { fetchRepoMetas: jest.fn().mockResolvedValue(metasResult) } as unknown as GithubRepoService;
  const searchSvc = { fetchSearch: jest.fn().mockResolvedValue(searchResult) } as unknown as GithubSearchService;
  const discord = { postFailureAlert: jest.fn().mockResolvedValue(undefined) };
  return new BoardBuilderService(http, trendingSvc, reposSvc, searchSvc, new ClassifyService(), discord as never);
}

describe('BoardBuilderService.build（Trending-only, US1）', () => {
  it('每領域以 weeklyStarsEstimate 排序、rank 連號；boards 恰兩領域', async () => {
    const trendingRepos = [
      trending('acme/ai1', 8600),
      trending('acme/ai2', 9000),
      trending('globex/dev1', 11000),
      trending('initech/fe1', 4300),
    ];
    const metas = new Map<string, RepoMeta>([
      ['acme/ai1', meta(101, ['llm'])],
      ['acme/ai2', meta(102, ['rag'])],
      // 純 DevOps topics：榜單已無此領域 → 即使週增星最高也排除
      ['globex/dev1', meta(201, ['kubernetes'])],
      ['initech/fe1', meta(301, ['react'])],
    ]);
    const board = await buildService(trendingRepos, { metas, failures: [] }).build();

    expect(board.boards.map((b) => b.domain)).toEqual(['ai', 'frontend-backend']);
    expect(board.boards.flatMap((b) => b.entries.map((e) => e.fullName))).not.toContain('globex/dev1');
    const ai = board.boards.find((b) => b.domain === 'ai')!;
    expect(ai.entries.map((e) => [e.rank, e.fullName, e.weeklyStarsEstimate])).toEqual([
      [1, 'acme/ai2', 9000],
      [2, 'acme/ai1', 8600],
    ]);
    expect(board.boards.find((b) => b.domain === 'frontend-backend')!.entries[0].fullName).toBe('initech/fe1');
  });

  it('缺 repoId（metas 無該筆）→ 略過該候選（U1）', async () => {
    const trendingRepos = [trending('acme/ai1', 8600), trending('ghost/no-meta', 9999)];
    const metas = new Map<string, RepoMeta>([['acme/ai1', meta(101, ['llm'])]]);
    const board = await buildService(trendingRepos, { metas, failures: [{ fullName: 'ghost/no-meta', status: 500 }] }).build();
    expect(board.boards.flatMap((b) => b.entries.map((e) => e.fullName))).toEqual(['acme/ai1']);
  });

  it('無法歸類 → 排除；build 開頭重置計數', async () => {
    const trendingRepos = [trending('acme/misc', 5000, 'grow tomatoes')];
    const metas = new Map<string, RepoMeta>([['acme/misc', meta(101, ['gardening'])]]);
    const svc = buildService(trendingRepos, { metas, failures: [] });
    const board = await svc.build();
    expect(board.boards.every((b) => b.entries.length === 0)).toBe(true);
  });
});

describe('BoardBuilderService.build（併入 Search 補位, US2/US3）', () => {
  it('純 Search 候選以估算 weeklyStarsEstimate 入榜、標 [search]', async () => {
    const search: SearchResult = {
      repos: [searchRepo(500, 'newbie/rag', ['rag'], 700, '2026-07-05T00:00:00Z')],
      failures: [],
    };
    const board = await buildService([], { metas: new Map(), failures: [] }, search).build();
    const ai = board.boards.find((b) => b.domain === 'ai')!;
    expect(ai.entries).toHaveLength(1);
    expect(ai.entries[0].sources).toEqual(['search']);
    expect(ai.entries[0].starsThisWeek).toBeNull();
    expect(ai.entries[0].weeklyStarsEstimate).toBeGreaterThan(0);
  });

  it('同一 repoId 同時來自兩來源 → 一筆、保留主力 starsThisWeek、sources 合併', async () => {
    const trendingRepos = [trending('acme/dup', 5000)];
    const metas = new Map<string, RepoMeta>([['acme/dup', meta(100, ['llm'])]]);
    // 改名情境：search 回同一 repoId 但 fullName 不同
    const search: SearchResult = {
      repos: [searchRepo(100, 'acme/dup-renamed', ['llm'], 9999, '2026-07-05T00:00:00Z')],
      failures: [],
    };
    const board = await buildService(trendingRepos, { metas, failures: [] }, search).build();
    const ai = board.boards.find((b) => b.domain === 'ai')!;
    expect(ai.entries).toHaveLength(1); // 去重
    expect(ai.entries[0].repoId).toBe(100);
    expect(ai.entries[0].weeklyStarsEstimate).toBe(5000); // 保留主力 starsThisWeek
    expect(ai.entries[0].sources.sort()).toEqual(['search', 'trending']);
    expect(ai.entries[0].fullName).toBe('acme/dup'); // 保留主力 fullName
  });
});

describe('mergeById（repoId 去重，FR-004/SC-003）', () => {
  it('改名（fullName 變、repoId 同）視為同一筆；保留主力 starsThisWeek', () => {
    const merged = mergeById(
      [trending('o/old-name', 3000)],
      new Map([['o/old-name', meta(7, ['llm'])]]),
      [searchRepo(7, 'o/new-name', ['llm'], 8000, '2026-07-05T00:00:00Z')],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].starsThisWeek).toBe(3000);
    expect(merged[0].sources.sort()).toEqual(['search', 'trending']);
  });

  it('缺 repoId 的 Trending 候選略過；純 Search 候選保留', () => {
    const merged = mergeById(
      [trending('o/no-meta', 100)],
      new Map(), // 無 meta → 略過
      [searchRepo(9, 'o/search-only', ['rag'], 500, '2026-07-06T00:00:00Z')],
    );
    expect(merged.map((m) => m.repoId)).toEqual([9]);
  });
});

describe('BoardBuilderService 容錯與告警（US4, FR-007/FR-009/SC-004）', () => {
  function makeService(o: {
    trending?: jest.Mock;
    metas?: RepoMetasResult;
    search?: jest.Mock;
  }): { svc: BoardBuilderService; discord: { postFailureAlert: jest.Mock } } {
    const discord = { postFailureAlert: jest.fn().mockResolvedValue(undefined) };
    const http = { resetCounts: jest.fn(), get counts() { return { core: 0, search: 0 }; } };
    const trendingSvc = { fetchTrending: o.trending ?? jest.fn().mockResolvedValue(trendingOk([])) };
    const reposSvc = { fetchRepoMetas: jest.fn().mockResolvedValue(o.metas ?? { metas: new Map(), failures: [] }) };
    const searchSvc = { fetchSearch: o.search ?? jest.fn().mockResolvedValue({ repos: [], failures: [] }) };
    const svc = new BoardBuilderService(
      http as never,
      trendingSvc as never,
      reposSvc as never,
      searchSvc as never,
      new ClassifyService(),
      discord as never,
    );
    return { svc, discord };
  }

  const okSearch = { repos: [searchRepo(500, 'newbie/rag', ['rag'], 700, '2026-07-05T00:00:00Z')], failures: [] };

  it('主力 Trending 失敗 → 補位仍出榜、告警 github-trending', async () => {
    const { svc, discord } = makeService({
      trending: jest.fn().mockRejectedValue(new Error('trending down')),
      search: jest.fn().mockResolvedValue(okSearch),
    });
    const board = await svc.build();
    expect(board.boards.find((b) => b.domain === 'ai')!.entries).toHaveLength(1); // 補位出榜
    expect(discord.postFailureAlert).toHaveBeenCalledWith(expect.stringContaining('github-trending'));
  });

  it('主力解析 0 筆（擲錯）→ 告警 github-trending', async () => {
    const { svc, discord } = makeService({
      trending: jest.fn().mockRejectedValue(new Error('Trending 解析 0 筆（疑似頁面改版）')),
      search: jest.fn().mockResolvedValue(okSearch),
    });
    await svc.build();
    expect(discord.postFailureAlert).toHaveBeenCalledWith(expect.stringContaining('github-trending'));
  });

  it('主力部分語言頁失敗 → 逐頁告警 github-trending:{page}，其餘頁仍出榜', async () => {
    const { svc, discord } = makeService({
      trending: jest.fn().mockResolvedValue({
        repos: [trending('acme/ai1', 8600)],
        failedPages: ['python', 'rust'],
      }),
      metas: { metas: new Map([['acme/ai1', meta(101, ['llm'])]]), failures: [] },
    });
    const board = await svc.build();
    expect(board.boards.find((b) => b.domain === 'ai')!.entries).toHaveLength(1); // 存活頁照常出榜
    expect(discord.postFailureAlert).toHaveBeenCalledTimes(2);
    expect(discord.postFailureAlert).toHaveBeenCalledWith(expect.stringContaining('github-trending:python'));
    expect(discord.postFailureAlert).toHaveBeenCalledWith(expect.stringContaining('github-trending:rust'));
  });

  it('補位某組失敗 → 告警 github-search:{domain}，主力仍出榜', async () => {
    const { svc, discord } = makeService({
      trending: jest.fn().mockResolvedValue(trendingOk([trending('acme/ai1', 8600)])),
      metas: { metas: new Map([['acme/ai1', meta(101, ['llm'])]]), failures: [] },
      search: jest.fn().mockResolvedValue({ repos: [], failures: [{ domain: 'frontend-backend', status: 503 }] }),
    });
    const board = await svc.build();
    expect(board.boards.find((b) => b.domain === 'ai')!.entries).toHaveLength(1); // 主力出榜
    expect(discord.postFailureAlert).toHaveBeenCalledWith(expect.stringContaining('github-search:frontend-backend'));
  });

  it('補位某組 0 筆屬正常 → 不告警', async () => {
    const { svc, discord } = makeService({
      trending: jest.fn().mockResolvedValue(trendingOk([trending('acme/ai1', 8600)])),
      metas: { metas: new Map([['acme/ai1', meta(101, ['llm'])]]), failures: [] },
      search: jest.fn().mockResolvedValue({ repos: [], failures: [] }),
    });
    await svc.build();
    expect(discord.postFailureAlert).not.toHaveBeenCalled();
  });

  it('GET /repos 出現 403 → 告警 github-repo', async () => {
    const { svc, discord } = makeService({
      trending: jest.fn().mockResolvedValue(trendingOk([trending('a/x', 100), trending('b/y', 200)])),
      metas: { metas: new Map([['a/x', meta(1, ['llm'])]]), failures: [{ fullName: 'b/y', status: 403 }] },
    });
    await svc.build();
    expect(discord.postFailureAlert).toHaveBeenCalledWith(expect.stringContaining('github-repo'));
  });

  it('GET /repos 零星失敗（<50%、無 401/403）→ 不告警', async () => {
    const trendingRepos = Array.from({ length: 10 }, (_, i) => trending(`o/r${i}`, 100));
    const metas = new Map(trendingRepos.slice(1).map((t, i) => [t.fullName, meta(i + 10, ['llm'])] as const));
    const { svc, discord } = makeService({
      trending: jest.fn().mockResolvedValue(trendingOk(trendingRepos)),
      metas: { metas, failures: [{ fullName: 'o/r0', status: 500 }] },
    });
    await svc.build();
    expect(discord.postFailureAlert).not.toHaveBeenCalled();
  });

  it('兩來源皆正常 → 不發任何來源告警', async () => {
    const { svc, discord } = makeService({
      trending: jest.fn().mockResolvedValue(trendingOk([trending('acme/ai1', 8600)])),
      metas: { metas: new Map([['acme/ai1', meta(101, ['llm'])]]), failures: [] },
      search: jest.fn().mockResolvedValue(okSearch),
    });
    await svc.build();
    expect(discord.postFailureAlert).not.toHaveBeenCalled();
  });
});

describe('shouldAlertRepoFailures（github-repo 告警門檻, U3）', () => {
  it('出現 401/403 即告警', () => {
    expect(shouldAlertRepoFailures([{ fullName: 'a', status: 403 }], 10)).toBe(true);
    expect(shouldAlertRepoFailures([{ fullName: 'a', status: 401 }], 10)).toBe(true);
  });

  it('其餘錯誤失敗率 > 50% 才告警', () => {
    expect(shouldAlertRepoFailures([{ fullName: 'a', status: 500 }, { fullName: 'b', status: 500 }, { fullName: 'c', status: null }], 5)).toBe(true);
    expect(shouldAlertRepoFailures([{ fullName: 'a', status: 500 }], 10)).toBe(false);
  });

  it('無失敗 → 不告警', () => {
    expect(shouldAlertRepoFailures([], 10)).toBe(false);
  });
});

describe('assembleBoards（純函式排序穩定性, SC-005）', () => {
  function candidate(repoId: number, estimate: number, domain: CandidateRepo['domain']): CandidateRepo {
    return {
      repoId,
      fullName: `o/r${repoId}`,
      url: `https://github.com/o/r${repoId}`,
      description: null,
      language: null,
      topics: [],
      starsThisWeek: estimate,
      totalStars: null,
      ageDays: null,
      sources: ['trending'],
      domain,
      weeklyStarsEstimate: estimate,
    };
  }

  it('同 estimate 以 repoId asc tie-break；超過 15 只留前 15、rank 連號', () => {
    const many = Array.from({ length: 20 }, (_, i) => candidate(20 - i, 100, 'ai'));
    const [ai] = assembleBoards(many);
    expect(ai.entries).toHaveLength(15);
    expect(ai.entries[0].repoId).toBe(1);
    expect(ai.entries.map((e) => e.rank)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  });

  it('打亂輸入順序，名次不變（決定性）', () => {
    const base = [candidate(5, 300, 'ai'), candidate(9, 300, 'ai'), candidate(2, 900, 'ai')];
    const order1 = assembleBoards(base)[0].entries.map((e) => e.repoId);
    const order2 = assembleBoards([...base].reverse())[0].entries.map((e) => e.repoId);
    expect(order1).toEqual([2, 5, 9]);
    expect(order2).toEqual(order1);
  });

  it('BoardRow 攜帶 description/topics（F7 T005，供 IntroInput join，research D1）', () => {
    const withMeta: CandidateRepo = {
      ...candidate(42, 500, 'ai'),
      description: 'An LLM framework',
      topics: ['llm', 'rag'],
    };
    const [ai] = assembleBoards([withMeta]);
    expect(ai.entries[0].description).toBe('An LLM framework');
    expect(ai.entries[0].topics).toEqual(['llm', 'rag']);
  });
});
