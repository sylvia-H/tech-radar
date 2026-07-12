import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { GithubHttpError, GithubHttpService } from '../github/github-http';
import { Domain, RawSearchRepo } from '../board/board.types';

/** Search 每組領域查詢設定（v1 canonical，門檻 clarify 已定；增刪只改此檔）。 */
export interface SearchQueryConfig {
  domain: Domain;
  /** OR 群關鍵字（同時為分類種子集前段；contracts §2）。 */
  keywords: string[];
  minStars: number;
}

export const SEARCH_QUERIES: readonly SearchQueryConfig[] = [
  { domain: 'ai', keywords: ['llm', 'rag', 'agent', 'gpt'], minStars: 30 },
  { domain: 'devops', keywords: ['kubernetes', 'terraform', 'gitops'], minStars: 20 },
  { domain: 'frontend-backend', keywords: ['nextjs', 'react', 'svelte', 'nodejs', 'golang'], minStars: 20 },
];

const SEARCH_WINDOW_DAYS = 7;
const PER_PAGE = 30;

/** 某組 Search 查詢失敗紀錄（status 供 board-builder 告警；0 筆屬正常不列入）。 */
export interface SearchFailure {
  domain: Domain;
  status: number | null;
}

export interface SearchResult {
  repos: RawSearchRepo[];
  failures: SearchFailure[];
}

const searchResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.number(),
      full_name: z.string(),
      description: z.string().nullable().optional().default(null),
      language: z.string().nullable().optional().default(null),
      topics: z.array(z.string()).optional().default([]),
      stargazers_count: z.number(),
      created_at: z.string(),
    }),
  ),
});

/**
 * 補位：GitHub Search API（新崛起 repo，contracts §2、research D3）。
 * 三組領域各發一次查詢（`created:>今天−7天` ＋ stars 門檻 ＋ sort=stars）。
 * 每組獨立 try/catch：成功納入 `repos`；失敗記 `failures`（由 board-builder 發
 * `github-search:{domain}` 告警）；**某組 0 筆屬正常**（該週無新星），不列入 failures。
 */
@Injectable()
export class GithubSearchService {
  constructor(private readonly http: GithubHttpService) {}

  async fetchSearch(now: Date = new Date()): Promise<SearchResult> {
    const since = createdSince(now);
    const repos: RawSearchRepo[] = [];
    const failures: SearchFailure[] = [];

    for (const cfg of SEARCH_QUERIES) {
      try {
        const raw = await this.http.getJson<unknown>(searchUrl(cfg, since), 'search');
        repos.push(...parseSearchResponse(raw, cfg.domain));
      } catch (err) {
        failures.push({ domain: cfg.domain, status: err instanceof GithubHttpError ? err.status : null });
      }
    }
    return { repos, failures };
  }
}

/** `created:>` 用的日期（今天 − 7 天，YYYY-MM-DD）。 */
export function createdSince(now: Date): string {
  return new Date(now.getTime() - SEARCH_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
}

/** 組 Search query 字串：`(kw OR kw...) created:>{date} stars:>{min}`。 */
export function buildSearchQuery(cfg: SearchQueryConfig, since: string): string {
  return `(${cfg.keywords.join(' OR ')}) created:>${since} stars:>${cfg.minStars}`;
}

export function searchUrl(cfg: SearchQueryConfig, since: string): string {
  const q = encodeURIComponent(buildSearchQuery(cfg, since));
  return `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=${PER_PAGE}`;
}

/** 解析 Search 回應 → RawSearchRepo[]（zod 邊界驗證；帶 queriedDomain 提示）。 */
export function parseSearchResponse(raw: unknown, queriedDomain: Domain): RawSearchRepo[] {
  const { items } = searchResponseSchema.parse(raw);
  return items.map((it) => ({
    repoId: it.id,
    fullName: it.full_name,
    description: it.description,
    language: it.language,
    topics: it.topics,
    totalStars: it.stargazers_count,
    createdAt: it.created_at,
    queriedDomain,
  }));
}
