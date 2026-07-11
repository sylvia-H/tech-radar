import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  buildFailureAlert,
  buildTestEmbed,
  DiscordWebhookPayload,
  RunEnv,
} from './discord.embed';

const MAX_RETRIES = 3;
const MAX_BACKOFF_MS = 5000;

/**
 * 對 Discord webhook 的唯一出口。只推播、不收訊息。
 * - 204 判定成功
 * - 429 依 retry_after 有限次退避（逾次數視為失敗）
 * - 失敗擲錯；log／錯誤訊息絕不含 webhook URL 或任何機密（憲章 VII）
 */
@Injectable()
export class DiscordWebhookService {
  private readonly logger = new Logger(DiscordWebhookService.name);

  constructor(private readonly config: ConfigService) {}

  private get webhookUrl(): string {
    const url = this.config.get<string>('DISCORD_WEBHOOK_URL');
    if (!url) {
      throw new Error('DISCORD_WEBHOOK_URL 未設定');
    }
    return url;
  }

  /** 推一則橙色連通測試 embed。 */
  async postTestEmbed(timestamp: string, env: RunEnv): Promise<void> {
    await this.post(buildTestEmbed(timestamp, env));
  }

  /** 推一則紅色失敗告警 embed（summary 須為不含機密的錯誤摘要）。 */
  async postFailureAlert(summary: string): Promise<void> {
    await this.post(buildFailureAlert(summary));
  }

  /**
   * 送出 payload。204 成功；429 有限退避重試；其餘失敗擲錯（不含機密）。
   */
  private async post(payload: DiscordWebhookPayload): Promise<void> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      let res: Response;
      try {
        res = await fetch(this.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch {
        // 網路層錯誤（DNS/連線）：消毒後重擲，絕不夾帶含 token 的 webhook URL（憲章 VII）。
        throw new Error('Discord webhook 推播失敗：網路錯誤');
      }

      if (res.status === 204) {
        return;
      }

      if (res.status === 429 && attempt < MAX_RETRIES) {
        const retryAfterMs = await this.parseRetryAfter(res);
        this.logger.warn(
          `Discord 回應 429，第 ${attempt}/${MAX_RETRIES} 次退避 ${retryAfterMs}ms`,
        );
        await this.delay(retryAfterMs);
        continue;
      }

      // 其餘狀態碼或退避耗盡：擲錯，訊息只含狀態碼（不含 URL / body）。
      throw new Error(`Discord webhook 推播失敗，HTTP ${res.status}`);
    }
  }

  private async parseRetryAfter(res: Response): Promise<number> {
    try {
      const body = (await res.clone().json()) as { retry_after?: number };
      if (typeof body.retry_after === 'number') {
        // Discord 的 retry_after 以秒為單位。
        return Math.min(Math.ceil(body.retry_after * 1000), MAX_BACKOFF_MS);
      }
    } catch {
      // 忽略解析錯誤，退回 header / 預設。
    }
    const header = res.headers.get('retry-after');
    const seconds = header ? Number(header) : NaN;
    if (Number.isFinite(seconds)) {
      return Math.min(Math.ceil(seconds * 1000), MAX_BACKOFF_MS);
    }
    return 1000;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
