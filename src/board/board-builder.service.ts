import { Injectable, Logger } from '@nestjs/common';
import { GithubHttpService } from '../github/github-http';
import { GithubTrendingService, TRENDING_SOURCE_ID } from '../sources/github-trending.service';
import { GithubRepoService, REPO_SOURCE_ID, RepoFetchFailure } from '../sources/github-repo.service';
import { GithubSearchService } from '../sources/github-search.service';
import { ClassifyService } from '../classify/classify.service';
import { DiscordWebhookService } from '../discord/discord.webhook.service';
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
 * US1 Trending 主力、US2 併入 Search 補位、US3 以 repoId 合併去重＋穩定排序、
 * US4 主力/補位以 try/catch 隔離：任一失敗或主力 0 筆 → 帶來源 id 告警、另一來源續行
 * （憲章 VII 來源隔離容錯，FR-007/FR-009）。
 */
@Injectable()
export class BoardBuilderService {
  private readonly logger = new Logger(BoardBuilderService.name);

  constructor(
    private readonly http: GithubHttpService,
    private readonly trending: GithubTrendingService,
    private readonly repos: GithubRepoService,
    private readonly search: GithubSearchService,
    private readonly classify: ClassifyService,
    private readonly discord: DiscordWebhookService,
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

  /** 收集兩來源（各自隔離容錯）、以 repoId 合併去重、歸類後產出 CandidateRepo[]。 */
  private async collectCandidates(): Promise<CandidateRepo[]> {
    const { repos: trendingRepos, metas } = await this.gatherTrending();
    const searchRepos = await this.gatherSearch();

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

  /**
   * 主力 Trending（含補 repoId/topics）。全部頁失敗或合併後 0 筆（擲錯）→
   * 告警 `github-trending`、回空，讓補位續行（FR-007/FR-009）。
   * 部分語言頁失敗但仍有候選 → 逐頁告警 `github-trending:{page}`、其餘頁照常入榜。
   * `GET /repos` 批次失敗達門檻（憑證型 401/403 或 >50%）→ 告警 `github-repo`。
   */
  private async gatherTrending(): Promise<{ repos: RawTrendingRepo[]; metas: Map<string, RepoMeta> }> {
    let trendingRepos: RawTrendingRepo[];
    let failedPages: string[];
    try {
      ({ repos: trendingRepos, failedPages } = await this.trending.fetchTrending());
    } catch (err) {
      await this.alert(TRENDING_SOURCE_ID, errMsg(err));
      return { repos: [], metas: new Map() };
    }

    for (const page of failedPages) {
      await this.alert(`${TRENDING_SOURCE_ID}:${page}`, '該語言頁抓取或解析失敗');
    }

    const { metas, failures } = await this.repos.fetchRepoMetas(trendingRepos.map((r) => r.fullName));
    if (shouldAlertRepoFailures(failures, trendingRepos.length)) {
      await this.alert(REPO_SOURCE_ID, `${failures.length}/${trendingRepos.length} 筆補 topics 失敗`);
    }
    return { repos: trendingRepos, metas };
  }

  /**
   * 補位 Search。每組查詢失敗 → 告警 `github-search:{domain}`、其餘組續行；
   * 某組 0 筆屬正常（該週無新星），不告警（FR-007，與主力 0 筆明確區分）。
   */
  private async gatherSearch(): Promise<RawSearchRepo[]> {
    const { repos, failures } = await this.search.fetchSearch();
    for (const f of failures) {
      await this.alert(`github-search:${f.domain}`, f.status !== null ? `HTTP ${f.status}` : '查詢失敗');
    }
    return repos;
  }

  /** best-effort 發帶來源 id 的紅色告警；告警本身失敗只記 log，不中斷 pipeline（憲章 VII）。 */
  private async alert(sourceId: string, detail: string): Promise<void> {
    try {
      await this.discord.postFailureAlert(`榜單來源失敗 [${sourceId}]：${detail}`);
    } catch (err) {
      this.logger.error(`送出來源告警失敗 [${sourceId}]`, err instanceof Error ? err.stack : String(err));
    }
  }
}

/**
 * `GET /repos` 批次是否達 `github-repo` 告警門檻（U3）：
 * 出現 401/403（憑證／權限層級）即告警；其餘錯誤於失敗率 > 50% 時告警；
 * 未達門檻的零星失敗僅略過該候選、不告警。
 */
export function shouldAlertRepoFailures(failures: readonly RepoFetchFailure[], total: number): boolean {
  if (failures.some((f) => f.status === 401 || f.status === 403)) {
    return true;
  }
  return total > 0 && failures.length / total > 0.5;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
 * `boards` 恰含兩領域（DOMAINS 順序，F2 移除 DevOps 後）；不足 15 照實呈現、不硬湊。
 * `totalStars`／`language` 為 `CandidateRepo` 既有值的轉遞（F3 決勝與快照所需），不改排序語意。
 */
export function assembleBoards(candidates: readonly CandidateRepo[]): DomainBoard[] {
  return DOMAINS.map((domain) => {
    const entries: BoardRow[] = candidates
      .filter((c) => c.domain === domain)
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
        totalStars: c.totalStars,
        language: c.language,
        sources: c.sources,
      }));
    return { domain, entries };
  });
}

/**
 * `createdAt` → 建立天數；無法解析回 `null` 而非 0——回 0 等於宣稱「今天新建」，
 * 會讓壞日期的候選在 `weeklyStarsEstimate` 拿到最短的建立天數、被外推放大。
 */
function ageInDays(createdAt: string, now: number = Date.now()): number | null {
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) {
    return null;
  }
  return Math.max(0, Math.floor((now - created) / MS_PER_DAY));
}
