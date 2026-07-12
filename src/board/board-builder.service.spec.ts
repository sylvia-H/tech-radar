import { GithubHttpService } from '../github/github-http';
import { GithubTrendingService } from '../sources/github-trending.service';
import { GithubRepoService, RepoMetasResult } from '../sources/github-repo.service';
import { ClassifyService } from '../classify/classify.service';
import { BoardBuilderService, assembleBoards } from './board-builder.service';
import { CandidateRepo, RawTrendingRepo, RepoMeta } from './board.types';

function trending(fullName: string, starsThisWeek: number, description: string | null = null): RawTrendingRepo {
  return { fullName, description, language: null, starsThisWeek };
}

function meta(repoId: number, topics: string[]): RepoMeta {
  return { repoId, topics, totalStars: 500, createdAt: '2026-07-01T00:00:00Z' };
}

function buildService(
  trendingRepos: RawTrendingRepo[],
  metasResult: RepoMetasResult,
): BoardBuilderService {
  const http = {
    resetCounts: jest.fn(),
    get counts() {
      return { core: metasResult.metas.size, search: 0 };
    },
  } as unknown as GithubHttpService;
  const trendingSvc = { fetchTrending: jest.fn().mockResolvedValue(trendingRepos) } as unknown as GithubTrendingService;
  const reposSvc = { fetchRepoMetas: jest.fn().mockResolvedValue(metasResult) } as unknown as GithubRepoService;
  return new BoardBuilderService(http, trendingSvc, reposSvc, new ClassifyService());
}

describe('BoardBuilderService.build（Trending-only, US1）', () => {
  it('每領域以 weeklyStarsEstimate 排序、rank 連號；boards 恰三領域；apiCalls 計數', async () => {
    const trendingRepos = [
      trending('acme/ai1', 8600),
      trending('acme/ai2', 9000),
      trending('globex/dev1', 11000),
      trending('initech/fe1', 4300),
    ];
    const metas = new Map<string, RepoMeta>([
      ['acme/ai1', meta(101, ['llm'])],
      ['acme/ai2', meta(102, ['rag'])],
      ['globex/dev1', meta(201, ['kubernetes'])],
      ['initech/fe1', meta(301, ['react'])],
    ]);
    const board = await buildService(trendingRepos, { metas, failures: [] }).build();

    expect(board.boards.map((b) => b.domain)).toEqual(['ai', 'devops', 'frontend-backend']);
    const ai = board.boards.find((b) => b.domain === 'ai')!;
    expect(ai.entries.map((e) => [e.rank, e.fullName, e.weeklyStarsEstimate])).toEqual([
      [1, 'acme/ai2', 9000],
      [2, 'acme/ai1', 8600],
    ]);
    expect(board.boards.find((b) => b.domain === 'devops')!.entries[0].fullName).toBe('globex/dev1');
    expect(board.boards.find((b) => b.domain === 'frontend-backend')!.entries[0].fullName).toBe('initech/fe1');
    expect(board.apiCalls).toEqual({ core: 4, search: 0 });
    expect(typeof board.builtAt).toBe('string');
  });

  it('缺 repoId（metas 無該筆）→ 略過該候選（U1）', async () => {
    const trendingRepos = [trending('acme/ai1', 8600), trending('ghost/no-meta', 9999)];
    const metas = new Map<string, RepoMeta>([['acme/ai1', meta(101, ['llm'])]]);
    const board = await buildService(trendingRepos, { metas, failures: [{ fullName: 'ghost/no-meta', status: 500 }] }).build();
    const all = board.boards.flatMap((b) => b.entries.map((e) => e.fullName));
    expect(all).toEqual(['acme/ai1']);
  });

  it('無法歸類（topics/description 皆無命中）→ 排除', async () => {
    const trendingRepos = [trending('acme/misc', 5000, 'grow tomatoes')];
    const metas = new Map<string, RepoMeta>([['acme/misc', meta(101, ['gardening'])]]);
    const board = await buildService(trendingRepos, { metas, failures: [] }).build();
    expect(board.boards.every((b) => b.entries.length === 0)).toBe(true);
  });

  it('build 開頭重置呼叫計數', async () => {
    const http = { resetCounts: jest.fn(), get counts() { return { core: 0, search: 0 }; } } as unknown as GithubHttpService;
    const trendingSvc = { fetchTrending: jest.fn().mockResolvedValue([]) } as unknown as GithubTrendingService;
    const reposSvc = { fetchRepoMetas: jest.fn().mockResolvedValue({ metas: new Map(), failures: [] }) } as unknown as GithubRepoService;
    await new BoardBuilderService(http, trendingSvc, reposSvc, new ClassifyService()).build();
    expect(http.resetCounts).toHaveBeenCalledTimes(1);
  });
});

describe('assembleBoards（純函式排序穩定性）', () => {
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
    const many = Array.from({ length: 20 }, (_, i) => candidate(20 - i, 100, 'ai')); // 同 estimate、repoId 20..1
    const [ai] = assembleBoards(many);
    expect(ai.entries).toHaveLength(15);
    expect(ai.entries[0].repoId).toBe(1); // repoId 最小者第一
    expect(ai.entries.map((e) => e.rank)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  });

  it('打亂輸入順序，名次不變（決定性）', () => {
    const base = [candidate(5, 300, 'ai'), candidate(9, 300, 'ai'), candidate(2, 900, 'ai')];
    const order1 = assembleBoards(base)[0].entries.map((e) => e.repoId);
    const order2 = assembleBoards([...base].reverse())[0].entries.map((e) => e.repoId);
    expect(order1).toEqual([2, 5, 9]); // 900 first；同 300 以 repoId asc（5 前於 9）
    expect(order2).toEqual(order1);
  });
});
