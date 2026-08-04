import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GithubHttpService } from '../github/github-http';
import { RepoVisibility } from './publish.types';

/**
 * repo 可見性查詢（research D3）。重用既有 `GithubHttpService`（共享節流狀態，憲章 I），
 * 查不到/格式不符/請求本身擲錯一律回 `'unknown'`——與「無法確認為 public」同一出口，
 * 不另立靜默分支（見 research D3「輸入層級缺失」）。
 */
@Injectable()
export class RepoVisibilityService {
  constructor(
    private readonly github: GithubHttpService,
    private readonly config: ConfigService,
  ) {}

  async check(): Promise<RepoVisibility> {
    const repo = this.config.get<string>('GITHUB_REPOSITORY');
    if (!repo || !repo.includes('/')) {
      return 'unknown';
    }

    try {
      const data = await this.github.getJson<{ private?: boolean }>(
        `https://api.github.com/repos/${repo}`,
      );
      if (data.private === false) {
        return 'public';
      }
      if (data.private === true) {
        return 'private';
      }
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }
}
