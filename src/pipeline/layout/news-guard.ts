/** 晨報 idempotency guard 門檻（研究 D5；24h 週期留 6h → <~18h 跳過）。 */
export const NEWS_PUSH_INTERVAL_HOURS = 18;

const HOUR_MS = 3_600_000;

export type NewsGuardReason = 'no-timestamp' | 'due' | 'not-due' | 'clock-anomaly';

export interface NewsGuardDecision {
  due: boolean;
  reason: NewsGuardReason;
}

/**
 * 純函式晨報 guard 判定（時間由參數注入，SC-001/007 可測）。判定順序：
 *   1. `null`（從未推播）→ `{ due: true, reason: 'no-timestamp' }`
 *   2. 晚於 `now`（時鐘異常）→ `{ due: false, reason: 'clock-anomaly' }`（**保守跳過**——
 *      與榜單 `decideCadence` 的 `clock-anomaly`（照常執行）刻意相反，兩者獨立，spec Edge Case）
 *   3. `now − t >= 18h` → `{ due: true, reason: 'due' }`
 *   4. 否則 → `{ due: false, reason: 'not-due' }`（整段跳過：不 ingest、不呼叫 LLM、不推播、不寫狀態）
 */
export function decideNewsGuard(lastNewsPushAt: string | null, now: Date): NewsGuardDecision {
  if (lastNewsPushAt === null) {
    return { due: true, reason: 'no-timestamp' };
  }

  const last = new Date(lastNewsPushAt).getTime();
  const elapsedMs = now.getTime() - last;

  if (elapsedMs < 0) {
    return { due: false, reason: 'clock-anomaly' };
  }
  if (elapsedMs >= NEWS_PUSH_INTERVAL_HOURS * HOUR_MS) {
    return { due: true, reason: 'due' };
  }
  return { due: false, reason: 'not-due' };
}
