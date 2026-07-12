import { weeklyStarsEstimate } from './weekly-stars';

describe('weeklyStarsEstimate', () => {
  it('Trending 候選（有 starsThisWeek）直接用官方週增星', () => {
    expect(weeklyStarsEstimate({ starsThisWeek: 8600, totalStars: 12500, ageDays: 400 })).toBe(8600);
  });

  it('純 Search 候選以 (總星數 / 建立天數) × 7 估算', () => {
    expect(weeklyStarsEstimate({ starsThisWeek: null, totalStars: 700, ageDays: 7 })).toBe(700);
    expect(weeklyStarsEstimate({ starsThisWeek: null, totalStars: 300, ageDays: 3 })).toBe(700);
  });

  it('ageDays=0（今日新建）不除以零，結果有限非 NaN/Infinity', () => {
    const est = weeklyStarsEstimate({ starsThisWeek: null, totalStars: 100, ageDays: 0 });
    expect(Number.isFinite(est)).toBe(true);
    expect(est).toBe(700); // max(0,1)=1 → 100/1×7
  });

  it('缺總星數時安全回 0（不應發生，防禦性）', () => {
    expect(weeklyStarsEstimate({ starsThisWeek: null, totalStars: null, ageDays: null })).toBe(0);
  });
});
