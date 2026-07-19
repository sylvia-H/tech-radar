import { z } from 'zod';

/**
 * Discord webhook URL 樣式：容許 discord.com / discordapp.com 及 ptb/canary 子域名變體。
 * 例：https://discord.com/api/webhooks/{id}/{token}
 */
const DISCORD_WEBHOOK_PATTERN =
  /^https:\/\/(ptb\.|canary\.)?discord(app)?\.com\/api\/webhooks\//;

function discordWebhookField(name: string) {
  return z
    .string()
    .trim()
    .min(1, `${name} 必填`)
    .regex(DISCORD_WEBHOOK_PATTERN, `${name} 格式不符 Discord webhook URL`);
}

/**
 * 環境變數 schema（EnvConfig）。五項機密皆必填，缺失即 fail-fast（憲章 VII）。
 * 三個 Discord webhook 分頻道（晨報／榜單／告警），互不共用。
 */
export const envSchema = z.object({
  DISCORD_NEWS_WEBHOOK_URL: discordWebhookField('DISCORD_NEWS_WEBHOOK_URL'),
  DISCORD_BOARD_WEBHOOK_URL: discordWebhookField('DISCORD_BOARD_WEBHOOK_URL'),
  DISCORD_ALERT_WEBHOOK_URL: discordWebhookField('DISCORD_ALERT_WEBHOOK_URL'),
  GH_API_TOKEN: z.string().trim().min(1, 'GH_API_TOKEN 必填'),
  GEMINI_API_KEY: z.string().trim().min(1, 'GEMINI_API_KEY 必填'),
});

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * 供 @nestjs/config 的 validate 使用；驗證失敗擲錯（訊息不含機密值）。
 */
export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`環境變數驗證失敗：${issues}`);
  }
  return result.data;
}
