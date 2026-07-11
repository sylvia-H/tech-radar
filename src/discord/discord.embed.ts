/** Discord embed 色值（十進位）。 */
export const COLOR_TEST = 0xf5a623; // 橙：連通測試
export const COLOR_FAILURE = 0xe74c3c; // 紅：失敗告警

/** 送往 Discord webhook 的訊息 payload（F1 使用子集）。 */
export interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  timestamp?: string;
}

export interface DiscordWebhookPayload {
  username: string;
  embeds: DiscordEmbed[];
}

export type RunEnv = 'ci' | 'local';

/**
 * 組出橙色「連通測試」embed（純函式，可單測）。依 contracts/discord-webhook。
 * @param timestamp 執行時間戳（ISO 8601）
 * @param env 執行環境標記
 */
export function buildTestEmbed(timestamp: string, env: RunEnv): DiscordWebhookPayload {
  return {
    username: 'Tech Radar',
    embeds: [
      {
        title: '📡 Tech Radar 連通測試',
        description: `骨架執行成功 · ${timestamp} · env=${env}`,
        color: COLOR_TEST,
        timestamp,
      },
    ],
  };
}

/**
 * 組出紅色「執行失敗」告警 embed（純函式，可單測）。
 * description 帶不含機密的錯誤摘要（截斷過長訊息，避免夾帶敏感內容）。
 * @param summary 不含機密的錯誤摘要
 */
export function buildFailureAlert(summary: string): DiscordWebhookPayload {
  const safe = summary.replace(/\s+/g, ' ').trim().slice(0, 500);
  return {
    username: 'Tech Radar',
    embeds: [
      {
        title: '⚠️ Tech Radar 執行失敗',
        description: `${safe || '未知錯誤'} · 請查 Actions log`,
        color: COLOR_FAILURE,
      },
    ],
  };
}
