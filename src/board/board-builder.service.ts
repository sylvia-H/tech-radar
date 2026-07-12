import { Injectable } from '@nestjs/common';
import { GithubHttpService } from '../github/github-http';
import { GithubTrendingService } from '../sources/github-trending.service';
import { GithubRepoService } from '../sources/github-repo.service';
import { GithubSearchService } from '../sources/github-search.service';
import { ClassifyService } from '../classify/classify.service';
import { weeklyStarsEstimate } from './weekly-stars';
import {
  BoardRow,
  CandidateRepo,
  CurrentBoard,
  Domain,
  DomainBoard,
  DOMAINS,
  RawSearchRepo,
  RawTrendingRepo,
  RepoMeta,
  SourceTag,
} from './board.types';

/** 每領域榜追蹤深度（FR-005；> 推播呈現，保留竄升／下降偵測空間）。 */
export const MAX_PER_DOMAIN = 15;

const MS_PER_DAY = 86_400_000;

/** 合併去重的中間結構（以 repoId 為同一性；classify/estimate 前）。 */
interface MergedRepo {
  repoId: number;
  fullName: string;
  url: string;
  description: string | null;
  language: string | null;
  topics: string[];
  starsThisWeek: number | null;
  totalStars: number | null;
  createdAt: string | null;
  sources: SourceTag[];
}

/**
 * 編排器：sources → classify → merge(repoId 去重) → weeklyStarsEstimate → 每領域 top 15。
 * 產出僅記憶體＋log 的 `CurrentBoard`（不寫 state/board.json）；即 F3 `buildCurrentBoard()` 契約。
 *
 * US1 Trending 主力、US2 併入 Search 補位、US3 以 repoId 合併去重＋穩定排序。
 * US4 將主力/補位以 try/catch 隔離並發來源告警（本階段直接串接，失敗冒泡至頂層）。
 */
@Injectable()
export class BoardBuilderService {
  constructor(
    private readonly http: GithubHttpService,
    private readonly trending: GithubTrendingService,
    private readonly repos: GithubRepoService,
    private readonly search: GithubSearchService,
    private readonly classify: ClassifyService,
  ) {}

  async build(): Promise<CurrentBoard> {
    this.http.resetCounts();
    const candidates = await this.collectCandidates();
    return {
      builtAt: new Date().toISOString(),
      boards: assembleBoards(candidates),
      apiCalls: this.http.counts,
    };
  }

  /** 收集兩來源、以 repoId 合併去重、歸類後產出 CandidateRepo[]（US2/US3）。 */
  private async collectCandidates(): Promise<CandidateRepo[]> {
    // 主力 Trending：補 repoId/topics（缺 repoId 略過，U1/FR-004）。
    const trendingRepos = await this.trending.fetchTrending();
    const { metas } = await this.repos.fetchRepoMetas(trendingRepos.map((r) => r.fullName));

    // 補位 Search：回應已含 topics。
    const { repos: searchRepos } = await this.search.fetchSearch();

    const merged = mergeById(trendingRepos, metas, searchRepos);

    const candidates: CandidateRepo[] = [];
    for (const m of merged) {
      const domain = this.classify.classify({ topics: m.topics, description: m.description });
      if (!domain) {
        continue; // 無法歸類 → 排除（寧缺勿濫）
      }
      candidates.push(finalizeCandidate(m, domain));
    }
    return candidates;
  }
}

/**
 * 以 GitHub 數字 `repoId` 合併兩來源、去重（抗改名，FR-004）。
 * 同一 repo 同時來自兩來源 → 合併 `sources`、**保留主力 `starsThisWeek`**（優於補位估算）。
 * Trending 候選缺 repoId（metas 無）→ 略過（U1）。處理順序不影響結果（repoId 為鍵）。
 */
export function mergeById(
  trendingRepos: readonly RawTrendingRepo[],
  metas: ReadonlyMap<string, RepoMeta>,
  searchRepos: readonly RawSearchRepo[],
): MergedRepo[] {
  const byId = new Map<number, MergedRepo>();

  for (const t of trendingRepos) {
    const meta = metas.get(t.fullName);
    if (!meta) {
      continue; // 缺 repoId → 略過（U1/FR-004）
    }
    byId.set(meta.repoId, {
      repoId: meta.repoId,
      fullName: t.fullName,
      url: `https://github.com/${t.fullName}`,
      description: t.description,
      language: t.language,
      topics: meta.topics,
      starsThisWeek: t.starsThisWeek,
      totalStars: meta.totalStars,
      createdAt: meta.createdAt,
      sources: ['trending'],
    });
  }

  for (const s of searchRepos) {
    const existing = byId.get(s.repoId);
    if (existing) {
      // 已來自主力：加 search 標記，保留主力欄位（含 starsThisWeek）。
      if (!existing.sources.includes('search')) {
        existing.sources.push('search');
      }
      continue;
    }
    byId.set(s.repoId, {
      repoId: s.repoId,
      fullName: s.fullName,
      url: `https://github.com/${s.fullName}`,
      description: s.description,
      language: s.language,
      topics: s.topics,
      starsThisWeek: null,
      totalStars: s.totalStars,
      createdAt: s.createdAt,
      sources: ['search'],
    });
  }

  return [...byId.values()];
}

/** 合併結果 → CandidateRepo（計 ageDays 與 weeklyStarsEstimate）。 */
function finalizeCandidate(m: MergedRepo, domain: Domain): CandidateRepo {
  const ageDays = m.createdAt !== null ? ageInDays(m.createdAt) : null;
  return {
    repoId: m.repoId,
    fullName: m.fullName,
    url: m.url,
    description: m.description,
    language: m.language,
    topics: m.topics,
    starsThisWeek: m.starsThisWeek,
    totalStars: m.totalStars,
    ageDays,
    sources: m.sources,
    domain,
    weeklyStarsEstimate: weeklyStarsEstimate({
      starsThisWeek: m.starsThisWeek,
      totalStars: m.totalStars,
      ageDays,
    }),
  };
}

/**
 * 每領域穩定排序取 top 15（純函式，SC-005/FR-005）。
 * tie-break：`weeklyStarsEstimate desc, repoId asc` → 相同輸入必得相同順序、不受來源處理順序影響。
 * `boards` 恰含三領域（DOMAINS 順序）；不足 15 照實呈現、不硬湊。
 */
export function assembleBoards(candidates: readonly CandidateRepo[]): DomainBoard[] {
  return DOMAINS.map((domain) => {
    const entries: BoardRow[] = candidates
      .filter((c) => c.domain === domain)
      .slice()
      .sort((a, b) => b.weeklyStarsEstimate - a.weeklyStarsEstimate || a.repoId - b.repoId)
      .slice(0, MAX_PER_DOMAIN)
      .map((c, i) => ({
        rank: i + 1,
        repoId: c.repoId,
        fullName: c.fullName,
        url: c.url,
        domain,
        weeklyStarsEstimate: c.weeklyStarsEstimate,
        starsThisWeek: c.starsThisWeek,
        sources: c.sources,
      }));
    return { domain, entries };
  });
}

function ageInDays(createdAt: string, now: number = Date.now()): number {
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) {
    return 0;
  }
  return Math.max(0, Math.floor((now - created) / MS_PER_DAY));
}
