import { INestApplicationContext } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { DiscordWebhookService } from './discord.webhook.service';

/**
 * CLI 成功送出失敗告警後寫入的 marker 檔（repo 根目錄；job 由此執行）。
 * workflow 的補送步驟見此檔即跳過，去重依據是「CLI 明確回報已送出」，
 * 而非猜測 run-app 的 outcome。
 */
export const ALERT_SENT_MARKER_PATH = path.resolve(process.cwd(), '.radar-alert-sent');

/**
 * best-effort 送出失敗告警；成功後寫 marker 供 workflow 去重（FR-010 / FR-014）。
 * - 告警送出失敗：只記 log、不寫 marker → workflow 會補送。
 * - marker 寫入失敗：只記 log → 最壞情況是 workflow 重複補送一則，寧可重複也不沉默。
 * 兩種失敗都不擲錯，避免遮蔽原始錯誤。
 */
export async function tryPostFailureAlert(
  app: INestApplicationContext,
  err: unknown,
  markerPath: string = ALERT_SENT_MARKER_PATH,
): Promise<void> {
  const summary = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  try {
    await app.get(DiscordWebhookService).postFailureAlert(summary);
  } catch (alertErr) {
    console.error('送出失敗告警時再度失敗：', alertErr);
    return;
  }
  try {
    await fs.writeFile(markerPath, `${new Date().toISOString()}\n`, 'utf-8');
  } catch (markerErr) {
    console.error('寫入告警 marker 失敗：', markerErr);
  }
}
