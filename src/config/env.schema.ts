import { z } from 'zod';

/**
 * Discord webhook URL 樣式：容許 discord.com / discordapp.com 及 ptb/canary 子域名變體。
 * 例：https://discord.com/api/webhooks/{id}/{token}
 */
const DISCORD_WEBHOOK_PATTERN =
  /^https:\/\/(ptb\.|canary\.)?discord(app)?\.com\/api\/webhooks\//;

/**
 * 環境變數 schema（EnvConfig）。三項機密皆必填，缺失即 fail-fast（憲章 VII）。
 * F1 僅驗證 GH_API_TOKEN / GEMINI_API_KEY 存在（F2+ / F5+ 使用）。
 */
export const envSchema = z.object({
  DISCORD_WEBHOOK_URL: z
    .string()
    .trim()
    .min(1, 'DISCORD_WEBHOOK_URL 必填')
    .regex(DISCORD_WEBHOOK_PATTERN, 'DISCORD_WEBHOOK_URL 格式不符 Discord webhook URL'),
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
