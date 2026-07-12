import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { GithubHttpService, TextResult } from '../github/github-http';
import { GithubTrendingService, parseTrendingHtml } from './github-trending.service';

const FIXTURE_PATH = path.resolve(process.cwd(), 'tests/fixtures/trending-weekly.html');

async function loadFixture(): Promise<string> {
  return fs.readFile(FIXTURE_PATH, 'utf-8');
}

function textResult(text: string): TextResult {
  return { text, status: 200, etag: null, lastModified: null, notModified: false };
}

describe('parseTrendingHtml（快照回歸，FR-009）', () => {
  it('依 fixture 選擇器解析出各列 fullName/description/language/starsThisWeek', async () => {
    const rows = parseTrendingHtml(await loadFixture());
    expect(rows).toEqual([
      {
        fullName: 'acme/agent-sandbox',
        description: 'An autonomous LLM agent sandbox for building RAG pipelines.',
        language: 'Python',
        starsThisWeek: 8600,
      },
      {
        fullName: 'globex/gitops-flow',
        description: 'Declarative Kubernetes GitOps controller with observability baked in.',
        language: 'Go',
        starsThisWeek: 11000,
      },
      {
        fullName: 'initech/svelte-things',
        description: 'A React and Svelte component toolkit for modern frontend apps.',
        language: 'TypeScript',
        starsThisWeek: 4300,
      },
      {
        fullName: 'hooli/quantum-notes',
        description: 'A minimalist note-taking desktop app.',
        language: 'C++',
        starsThisWeek: 1900,
      },
    ]);
  });

  it('無 article.Box-row → 回空陣列（交由呼叫端判斷全 0）', () => {
    expect(parseTrendingHtml('<html><body><main></main></body></html>')).toEqual([]);
  });

  it('有 Box-row 但欄位抽不到（stars 缺）→ 擲可辨識錯誤', () => {
    const broken = `
      <article class="Box-row">
        <h2><a href="/o/r"><span>o /</span> r</a></h2>
        <p>desc</p>
      </article>`;
    expect(() => parseTrendingHtml(broken)).toThrow(/頁面改版/);
  });
});

describe('GithubTrendingService.fetchTrending', () => {
  it('跨頁以 fullName 去重、合併多頁候選', async () => {
    const fixture = await loadFixture();
    const getText = jest.fn().mockResolvedValue(textResult(fixture));
    const http = { getText } as unknown as GithubHttpService;
    const rows = await new GithubTrendingService(http).fetchTrending();
    // 6 頁皆回同一 fixture → 去重後仍為 4 筆唯一
    expect(getText).toHaveBeenCalledTimes(6);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.fullName)).toEqual([
      'acme/agent-sandbox',
      'globex/gitops-flow',
      'initech/svelte-things',
      'hooli/quantum-notes',
    ]);
  });

  it('合併後 0 筆（各頁皆無 Box-row）→ 擲錯（疑似改版，不視為本週無熱門）', async () => {
    const getText = jest.fn().mockResolvedValue(textResult('<html><body></body></html>'));
    const http = { getText } as unknown as GithubHttpService;
    await expect(new GithubTrendingService(http).fetchTrending()).rejects.toThrow(/0 筆/);
  });
});
