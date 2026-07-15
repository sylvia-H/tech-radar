import { weeklyStarsEstimate } from './weekly-stars';

describe('weeklyStarsEstimate', () => {
  it('Trending 候選（有 starsThisWeek）直接用官方週增星', () => {
    expect(weeklyStarsEstimate({ starsThisWeek: 8600, totalStars: 12500, ageDays: 400 })).toBe(8600);
  });

  it('純 Search 候選以 (總星數 / 建立天數) × 7 估算', () => {
    expect(weeklyStarsEstimate({ starsThisWeek: null, totalStars: 700, ageDays: 7 })).toBe(700);
    // 建立 3 天、300 星 → 300/3×7 = 700，但上限為總星數 300（見下）
    expect(weeklyStarsEstimate({ starsThisWeek: null, totalStars: 300, ageDays: 3 })).toBe(300);
  });

  it('估算不得超過總星數（7 天內建立者，本週增星的真值上界即總星數）', () => {
    // 今日新建 300 星：max(0,1)=1 → 300/1×7 = 2100，若無上限會壓過 1800 星的 Trending 龍頭
    expect(weeklyStarsEstimate({ starsThisWeek: null, totalStars: 300, ageDays: 0 })).toBe(300);
    expect(weeklyStarsEstimate({ starsThisWeek: null, totalStars: 50, ageDays: 1 })).toBe(50);
  });

  it('ageDays=0（今日新建）不除以零，結果有限非 NaN/Infinity', () => {
    const est = weeklyStarsEstimate({ starsThisWeek: null, totalStars: 100, ageDays: 0 });
    expect(Number.isFinite(est)).toBe(true);
    expect(est).toBe(100);
  });

  it('建立超過 7 天者仍走換算公式（上限不生效）', () => {
    // 建立 70 天、1000 星 → 1000/70×7 = 100，遠低於總星數 → 上限不介入
    expect(weeklyStarsEstimate({ starsThisWeek: null, totalStars: 1000, ageDays: 70 })).toBe(100);
  });

  it('ageDays 無法判定時不得因預設值而被放大', () => {
    // ageDays=null（createdAt 壞掉）→ 預設 1 天會外推成 ×7，上限把它壓回總星數
    expect(weeklyStarsEstimate({ starsThisWeek: null, totalStars: 300, ageDays: null })).toBe(300);
  });

  it('缺總星數時安全回 0（不應發生，防禦性）', () => {
    expect(weeklyStarsEstimate({ starsThisWeek: null, totalStars: null, ageDays: null })).toBe(0);
  });
});
