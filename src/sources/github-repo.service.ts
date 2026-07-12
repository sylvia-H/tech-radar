import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { GithubHttpError, GithubHttpService } from '../github/github-http';
import { RepoMeta } from '../board/board.types';

/** repos 來源識別（告警用）。 */
export const REPO_SOURCE_ID = 'github-repo';

/** 單筆 `GET /repos` 失敗紀錄（status 供 board-builder 套用告警門檻）。 */
export interface RepoFetchFailure {
  fullName: string;
  status: number | null; // GithubHttpError 的狀態碼；解析/網路錯誤為 null
}

export interface RepoMetasResult {
  /** 成功取得者（key = fullName）。取不到者不在此 → 呼叫端略過（U1/FR-004）。 */
  metas: Map<string, RepoMeta>;
  failures: RepoFetchFailure[];
}

const repoResponseSchema = z.object({
  id: z.number(),
  topics: z.array(z.string()).optional().default([]),
  stargazers_count: z.number(),
  created_at: z.string(),
});

/**
 * 對 Trending 唯一候選補 `repoId`/`topics`（contracts §3）。
 * 有限並發 ≤6；**單筆失敗（重試耗盡）→ 該候選無 `repoId`，略過、不中斷全線**（U1）。
 * 失敗連同 status 一併回報，由 board-builder 依門檻（401/403 即告警、其餘 >50%）決定告警。
 */
@Injectable()
export class GithubRepoService {
  constructor(private readonly http: GithubHttpService) {}

  async fetchRepoMetas(fullNames: readonly string[]): Promise<RepoMetasResult> {
    const settled = await this.http.mapLimited(fullNames, async (fullName) => {
      try {
        const raw = await this.http.getJson<unknown>(`https://api.github.com/repos/${fullName}`, 'core');
        return { fullName, meta: parseRepoMeta(raw), status: null as number | null };
      } catch (err) {
        const status = err instanceof GithubHttpError ? err.status : null;
        return { fullName, meta: null as RepoMeta | null, status };
      }
    });

    const metas = new Map<string, RepoMeta>();
    const failures: RepoFetchFailure[] = [];
    for (const r of settled) {
      if (r.meta) {
        metas.set(r.fullName, r.meta);
      } else {
        failures.push({ fullName: r.fullName, status: r.status });
      }
    }
    return { metas, failures };
  }
}

/** 解析 `GET /repos` 回應 → RepoMeta（zod 邊界驗證；不合法擲錯，視為該筆失敗）。 */
export function parseRepoMeta(raw: unknown): RepoMeta {
  const r = repoResponseSchema.parse(raw);
  return {
    repoId: r.id,
    topics: r.topics,
    totalStars: r.stargazers_count,
    createdAt: r.created_at,
  };
}
