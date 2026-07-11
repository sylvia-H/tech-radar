import { Injectable } from '@nestjs/common';
import { DiscordWebhookService } from '../discord/discord.webhook.service';
import { RunEnv } from '../discord/discord.embed';
import { StateStore } from '../state/state.store';

/**
 * F1 最小編排：載入設定 → 載入狀態 → 推測試 embed → 成功後寫回狀態。
 *
 * FR-008：狀態僅在**推播成功後**才寫回，避免半套狀態。
 * F1 無資料來源，狀態內容不變 → workflow 依 git diff 判定不 commit（commit-on-change）。
 */
@Injectable()
export class PipelineService {
  constructor(
    private readonly discord: DiscordWebhookService,
    private readonly state: StateStore,
  ) {}

  async run(): Promise<void> {
    const board = await this.state.load();
    const timestamp = new Date().toISOString();
    await this.discord.postTestEmbed(timestamp, resolveRunEnv());
    // 推播成功後才寫回（FR-008）。F1 不變更狀態內容，交由 workflow diff 決定是否 commit。
    await this.state.save(board);
  }
}

/** 依 GitHub Actions 提供的 CI 環境變數判定執行環境標記。 */
function resolveRunEnv(): RunEnv {
  return process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true'
    ? 'ci'
    : 'local';
}
