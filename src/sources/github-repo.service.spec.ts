import { GithubHttpError, GithubHttpService } from '../github/github-http';
import { GithubRepoService, parseRepoMeta } from './github-repo.service';

function httpWith(getJson: jest.Mock): GithubHttpService {
  // mapLimited 用真實實作（保序），getJson 由測試控制。
  const real = { getJson } as Partial<GithubHttpService>;
  real.mapLimited = async <I, O>(items: readonly I[], fn: (i: I, idx: number) => Promise<O>): Promise<O[]> =>
    Promise.all(items.map((it, idx) => fn(it, idx)));
  return real as GithubHttpService;
}

describe('parseRepoMeta', () => {
  it('映射 id/topics/stargazers_count/created_at → RepoMeta', () => {
    expect(
      parseRepoMeta({ id: 42, topics: ['llm'], stargazers_count: 1200, created_at: '2026-07-05T00:00:00Z', extra: 1 }),
    ).toEqual({ repoId: 42, topics: ['llm'], totalStars: 1200, createdAt: '2026-07-05T00:00:00Z' });
  });

  it('缺 topics 時預設空陣列', () => {
    expect(parseRepoMeta({ id: 1, stargazers_count: 5, created_at: '2026-07-10T00:00:00Z' }).topics).toEqual([]);
  });
});

describe('GithubRepoService.fetchRepoMetas', () => {
  it('成功者進 metas；並發呼叫每筆一次', async () => {
    const getJson = jest.fn(async (url: string) => {
      const fn = url.replace('https://api.github.com/repos/', '');
      return { id: fn === 'a/x' ? 1 : 2, topics: ['ai'], stargazers_count: 100, created_at: '2026-07-08T00:00:00Z' };
    });
    const svc = new GithubRepoService(httpWith(getJson));
    const { metas, failures } = await svc.fetchRepoMetas(['a/x', 'b/y']);
    expect(getJson).toHaveBeenCalledTimes(2);
    expect(metas.get('a/x')?.repoId).toBe(1);
    expect(metas.get('b/y')?.repoId).toBe(2);
    expect(failures).toEqual([]);
  });

  it('單筆失敗（403）→ 進 failures、不在 metas、不中斷其他候選', async () => {
    const getJson = jest.fn(async (url: string) => {
      if (url.endsWith('/bad/repo')) {
        throw new GithubHttpError(403);
      }
      return { id: 9, topics: [], stargazers_count: 10, created_at: '2026-07-09T00:00:00Z' };
    });
    const svc = new GithubRepoService(httpWith(getJson));
    const { metas, failures } = await svc.fetchRepoMetas(['ok/repo', 'bad/repo']);
    expect(metas.has('ok/repo')).toBe(true);
    expect(metas.has('bad/repo')).toBe(false);
    expect(failures).toEqual([{ fullName: 'bad/repo', status: 403 }]);
  });

  it('非 HTTP 錯誤（解析失敗）→ status 為 null', async () => {
    const getJson = jest.fn(async () => ({ id: 'not-a-number', stargazers_count: 1, created_at: 'x' }));
    const svc = new GithubRepoService(httpWith(getJson));
    const { metas, failures } = await svc.fetchRepoMetas(['o/r']);
    expect(metas.size).toBe(0);
    expect(failures).toEqual([{ fullName: 'o/r', status: null }]);
  });
});
