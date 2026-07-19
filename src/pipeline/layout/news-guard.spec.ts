import { decideNewsGuard, NEWS_PUSH_INTERVAL_HOURS } from './news-guard';

const NOW = new Date('2026-07-19T00:00:00.000Z');
const HOUR_MS = 3_600_000;

function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * HOUR_MS).toISOString();
}

describe('decideNewsGuard（research D5，四種 reason）', () => {
  it('lastNewsPushAt=null（冷啟動）→ due:true, reason:no-timestamp', () => {
    expect(decideNewsGuard(null, NOW)).toEqual({ due: true, reason: 'no-timestamp' });
  });

  it('距今 10h（< 18h）→ due:false, reason:not-due（整段跳過）', () => {
    expect(decideNewsGuard(hoursAgo(10), NOW)).toEqual({ due: false, reason: 'not-due' });
  });

  it(`距今恰 ${NEWS_PUSH_INTERVAL_HOURS}h → due:true, reason:due`, () => {
    expect(decideNewsGuard(hoursAgo(NEWS_PUSH_INTERVAL_HOURS), NOW)).toEqual({
      due: true,
      reason: 'due',
    });
  });

  it('距今 24h（> 18h）→ due:true, reason:due', () => {
    expect(decideNewsGuard(hoursAgo(24), NOW)).toEqual({ due: true, reason: 'due' });
  });

  it('未來時間戳（時鐘異常）→ due:false, reason:clock-anomaly（保守跳過，與榜單相反）', () => {
    const future = new Date(NOW.getTime() + HOUR_MS).toISOString();
    expect(decideNewsGuard(future, NOW)).toEqual({ due: false, reason: 'clock-anomaly' });
  });
});
