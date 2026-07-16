import { CadenceDecision } from './diff.types';

/**
 * 榜單推播間隔門檻（FR-017，research D3）。**162h 而非 168h**：`lastBoardPushAt` 記的是推播
 * 完成時間、必晚於當次 cron 觸發；取精確 168h 會使間隔恆略小於門檻而跳過、節奏由 7 天單向滑向
 * 8 天。6h 寬限吸收 Actions cron 延遲與 `:07`/`:37` 雙班抖動。
 */
export const BOARD_PUSH_INTERVAL_HOURS = 162;

const HOUR_MS = 3_600_000;

/**
 * 純函式節奏判定（時間由參數注入，不讀時鐘；SC-002 可測）。判定順序：
 *   1. `null`（從未推播）→ `{ due: true, reason: 'no-timestamp' }`（FR-019）
 *   2. 晚於 `now`（時鐘異常）→ `{ due: true, reason: 'clock-anomaly' }`（FR-019a，呼叫端須告警）
 *   3. `now − t >= 162h` → `{ due: true, reason: 'due' }`
 *   4. 否則 → `{ due: false, reason: 'not-due' }`（FR-018，呼叫端整段跳過）
 *
 * 回傳 `reason` 而非裸 boolean——`clock-anomaly` 與 `due` 都要執行，但前者**額外需告警**；
 * 回 boolean 會逼編排層重算一次是否為未來時間。
 */
export function decideCadence(lastBoardPushAt: string | null, now: Date): CadenceDecision {
  if (lastBoardPushAt === null) {
    return { due: true, reason: 'no-timestamp' };
  }

  const last = new Date(lastBoardPushAt).getTime();
  const elapsedMs = now.getTime() - last;

  if (elapsedMs < 0) {
    return { due: true, reason: 'clock-anomaly' };
  }
  if (elapsedMs >= BOARD_PUSH_INTERVAL_HOURS * HOUR_MS) {
    return { due: true, reason: 'due' };
  }
  return { due: false, reason: 'not-due' };
}
