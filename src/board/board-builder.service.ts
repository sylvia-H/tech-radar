import { Injectable } from '@nestjs/common';
import { GithubHttpService } from '../github/github-http';
import { GithubTrendingService } from '../sources/github-trending.service';
import { GithubRepoService } from '../sources/github-repo.service';
import { ClassifyService } from '../classify/classify.service';
import { weeklyStarsEstimate } from './weekly-stars';
import {
  BoardRow,
  CandidateRepo,
  CurrentBoard,
  DomainBoard,
  DOMAINS,
  RawTrendingRepo,
  RepoMeta,
} from './board.types';

/** 每領域榜追蹤深度（FR-005；> 推播呈現，保留竄升／下降偵測空間）。 */
export const MAX_PER_DOMAIN = 15;

const MS_PER_DAY = 86_400_000;

/**
 * 編排器：sources → classify → merge(repoId 去重) → weeklyStarsEstimate → 每領域 top 15。
 * 產出僅記憶體＋log 的 `CurrentBoard`（不寫 state/board.json）；即 F3 `buildCurrentBoard()` 契約。
 *
 * US1（本階段）：Trending-only 路徑。US2 併入 Search、US3 合併去重、US4 容錯告警於後續擴充。
 */
@Injectable()
export class BoardBuilderService {
  constructor(
    private readonly http: GithubHttpService,
    private readonly trending: GithubTrendingService,
    private readonly repos: GithubRepoService,
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

  /** 收集並歸類所有來源候選（US1：Trending 主力；U1 略過缺 repoId 者）。 */
  private async collectCandidates(): Promise<CandidateRepo[]> {
    const trendingRepos = await this.trending.fetchTrending();
    const { metas } = await this.repos.fetchRepoMetas(trendingRepos.map((r) => r.fullName));

    const candidates: CandidateRepo[] = [];
    for (const t of trendingRepos) {
      const meta = metas.get(t.fullName);
      if (!meta) {
        continue; // 缺 repoId（/repos 失敗）→ 略過（U1/FR-004）
      }
      const domain = this.classify.classify({ topics: meta.topics, description: t.description });
      if (!domain) {
        continue; // 無法歸類 → 排除（寧缺勿濫）
      }
      candidates.push(trendingCandidate(t, meta, domain));
    }
    return candidates;
  }
}

/** 由 Trending 候選＋repos meta 組 CandidateRepo。 */
function trendingCandidate(
  t: RawTrendingRepo,
  meta: RepoMeta,
  domain: CandidateRepo['domain'],
): CandidateRepo {
  const ageDays = ageInDays(meta.createdAt);
  return {
    repoId: meta.repoId,
    fullName: t.fullName,
    url: `https://github.com/${t.fullName}`,
    description: t.description,
    language: t.language,
    topics: meta.topics,
    starsThisWeek: t.starsThisWeek,
    totalStars: meta.totalStars,
    ageDays,
    sources: ['trending'],
    domain,
    weeklyStarsEstimate: weeklyStarsEstimate({
      starsThisWeek: t.starsThisWeek,
      totalStars: meta.totalStars,
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
