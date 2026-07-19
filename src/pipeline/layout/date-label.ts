const HOUR_MS = 3_600_000;

/** 台北時區固定偏移（UTC+8，台灣無夏令時；dev-guide §排程）。 */
const TAIPEI_OFFSET_HOURS = 8;

/**
 * 組版標題用的日期標籤，取**台北日期**（`YYYY-MM-DD`）。
 *
 * 晨報／榜單以 UTC cron `:07`/`:37`（22:xx UTC ＝ 台北隔日 06:xx）觸發，是給台灣讀者的「晨報」；
 * 若直接取 `now.toISOString()`（UTC 日期）會比讀者實際收到的日子慢一天。台灣無夏令時，固定 +8h
 * 位移後取 UTC 日期即等於台北當地日期。純函式、`now` 注入。
 */
export function taipeiDateLabel(now: Date): string {
  const shifted = new Date(now.getTime() + TAIPEI_OFFSET_HOURS * HOUR_MS);
  return shifted.toISOString().slice(0, 10);
}
