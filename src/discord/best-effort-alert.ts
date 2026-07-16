import { Logger } from '@nestjs/common';
import { DiscordWebhookService } from './discord.webhook.service';

/**
 * best-effort 紅色失敗告警的共用包裝（憲章 VII）：送出成功即返回；送出本身失敗只用傳入的
 * `logger` 記一筆 error、**不擲錯**，讓來源／流程容錯不被「告警自身故障」中斷。
 *
 * 供 pipeline 各段（`BoardBuilderService`／`BoardDiffService`…）共用；`summary` 須為不含機密的
 * 錯誤摘要。傳入呼叫端自己的 `logger` 而非另建，是為了讓 log 來源名稱仍指向該段服務。
 *
 * CLI 頂層 catch 的告警另見 `failure-alert.ts` 的 `tryPostFailureAlert`——語意不同（成功後寫
 * `.radar-alert-sent` marker 供 workflow 去重），刻意不併入此包裝。
 */
export async function bestEffortFailureAlert(
  discord: DiscordWebhookService,
  logger: Logger,
  summary: string,
): Promise<void> {
  try {
    await discord.postFailureAlert(summary);
  } catch (err) {
    logger.error(`送出失敗告警失敗：${summary}`, err instanceof Error ? err.stack : String(err));
  }
}
