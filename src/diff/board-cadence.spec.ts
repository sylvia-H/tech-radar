import { decideCadence, BOARD_PUSH_INTERVAL_HOURS } from './board-cadence';

const HOUR_MS = 3_600_000;
const NOW = new Date('2026-07-15T12:00:00.000Z');

/** now 之前 h 小時的 ISO 字串。 */
function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * HOUR_MS).toISOString();
}

describe('decideCadence 每週節奏（US2, 162h 門檻）', () => {
  it('常數 BOARD_PUSH_INTERVAL_HOURS = 162', () => {
    expect(BOARD_PUSH_INTERVAL_HOURS).toBe(162);
  });

  it('<162h → 未到期跳過（FR-018/SC-002）', () => {
    expect(decideCadence(hoursAgo(161), NOW)).toEqual({ due: false, reason: 'not-due' });
    expect(decideCadence(hoursAgo(1), NOW)).toEqual({ due: false, reason: 'not-due' });
  });

  it('恰好 162h → 執行（≥ 邊界，SC-002「已滿 162 小時或更久」）', () => {
    expect(decideCadence(hoursAgo(162), NOW)).toEqual({ due: true, reason: 'due' });
  });

  it('163h（未滿七天整）→ 執行（6h 寬限生效，US2 場景 5）', () => {
    expect(decideCadence(hoursAgo(163), NOW)).toEqual({ due: true, reason: 'due' });
  });

  it('null（從未推播）→ 執行（FR-019）', () => {
    expect(decideCadence(null, NOW)).toEqual({ due: true, reason: 'no-timestamp' });
  });

  it('晚於當前時間 → 執行 + clock-anomaly（FR-019a/US2 場景 6）', () => {
    const future = new Date(NOW.getTime() + HOUR_MS).toISOString();
    expect(decideCadence(future, NOW)).toEqual({ due: true, reason: 'clock-anomaly' });
  });
});
