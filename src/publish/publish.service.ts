import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { StateStore } from '../state/state.store';
import { DiscordWebhookService } from '../discord/discord.webhook.service';
import { bestEffortFailureAlert } from '../discord/best-effort-alert';
import { RepoVisibilityService } from './repo-visibility.service';
import { renderPage } from './render-page';
import { renderFeed } from './render-feed';

const PUBLIC_DIR = path.resolve(process.cwd(), 'public');

/**
 * 發佈段編排（contracts/publish-orchestration.md C2）：可見性查詢 → private 靜默跳過 /
 * unknown 告警跳過 → 讀 state → 純函式渲染 → 全有或全無寫檔（C3）。永不 throw——CLI
 * `PUBLISH_MODE=1` 分支一律以 exit 0 結束（research D10），唯一的失敗訊號管道是 Discord 告警。
 */
@Injectable()
export class PublishService {
  private readonly logger = new Logger(PublishService.name);

  constructor(
    private readonly visibility: RepoVisibilityService,
    private readonly stateStore: StateStore,
    private readonly discord: DiscordWebhookService,
    private readonly config: ConfigService,
  ) {}

  async run(): Promise<void> {
    const visibility = await this.visibility.check();

    if (visibility === 'private') {
      this.logger.log('repo 為 private，本次跳過發佈');
      return;
    }

    if (visibility === 'unknown') {
      await bestEffortFailureAlert(this.discord, this.logger, '可見性查詢失敗，本次跳過發佈');
      return;
    }

    try {
      // MUST 在 try 內：StateStore.load() 遇壞檔會擲錯，留在 try 外會讓 run() 違反「永不 throw」
      // 且漏掉下方的 FR-017 告警（見 contracts/publish-orchestration.md C2）。
      const state = await this.stateStore.load();

      // 能走到這一步表示可見性查詢已成功解析出 owner/repo，故此處不會再缺值（research D3）。
      const repo = this.config.get<string>('GITHUB_REPOSITORY')!;
      const [owner, name] = repo.split('/');
      const pagesUrl = `https://${owner}.github.io/${name}/`;

      const html = renderPage(state, new Date());
      const xml = renderFeed(state, pagesUrl);

      // 全有或全無（C3）：兩份字串皆已成功產出後才寫檔。**`index.html` MUST 最後寫**——workflow
      // 的部署 gate 是 `hashFiles('public/index.html') != ''`，把 gate 檔留到最後，等於讓它兼任
      // 提交點：任一次 writeFile 失敗都不會留下「有 index.html 卻缺 feed.xml」的半套 public/，
      // 因此不可能部署出一個既有訂閱者全部 404 的站（改順序即可，不需另做 tmp+rename）。
      await fs.mkdir(PUBLIC_DIR, { recursive: true });
      await fs.writeFile(path.join(PUBLIC_DIR, 'feed.xml'), xml, 'utf-8');
      await fs.writeFile(path.join(PUBLIC_DIR, 'index.html'), html, 'utf-8');
    } catch (err) {
      await bestEffortFailureAlert(this.discord, this.logger, `發佈失敗：${errMsg(err)}`);
    }
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
