import { taipeiDateLabel } from './date-label';

describe('taipeiDateLabel（台北 UTC+8 日期標籤）', () => {
  it('UTC 22:07（cron 主排）＝台北隔日 06:07，日期取隔日', () => {
    // 2026-07-19T22:07Z ＝ 台北 2026-07-20T06:07：讀者於 20 日早上收到，標籤應為 20 日。
    expect(taipeiDateLabel(new Date('2026-07-19T22:07:00Z'))).toBe('2026-07-20');
  });

  it('UTC 中午仍在同一台北日內，日期不跨日', () => {
    expect(taipeiDateLabel(new Date('2026-07-20T04:00:00Z'))).toBe('2026-07-20');
  });

  it('台北跨月邊界（UTC 2026-07-31T22:00Z ＝台北 2026-08-01T06:00）', () => {
    expect(taipeiDateLabel(new Date('2026-07-31T22:00:00Z'))).toBe('2026-08-01');
  });

  it('UTC 15:59Z ＝台北 23:59 仍為同日，不提早跨日', () => {
    expect(taipeiDateLabel(new Date('2026-07-20T15:59:00Z'))).toBe('2026-07-20');
  });

  it('UTC 16:00Z ＝台北隔日 00:00，跨入隔日', () => {
    expect(taipeiDateLabel(new Date('2026-07-20T16:00:00Z'))).toBe('2026-07-21');
  });
});
