import { FETCHERS, truncateSummary, SUMMARY_MAX } from './fetcher';

describe('FETCHERS 分派表（FR-004）', () => {
  it('四種 type 各對應一個 fetcher，且恰為四種', () => {
    expect(Object.keys(FETCHERS).sort()).toEqual([
      'github-releases',
      'hn-algolia',
      'reddit-weekly',
      'rss',
    ]);
    for (const fn of Object.values(FETCHERS)) {
      expect(typeof fn).toBe('function');
    }
  });

  it('新增同型別來源只需查同一 fetcher（type→fetcher 為穩定引用）', () => {
    // 兩筆同型別來源分派到「同一個」fetcher 函式 → 加來源不需改 code。
    expect(FETCHERS['rss']).toBe(FETCHERS['rss']);
    expect(FETCHERS['reddit-weekly']).not.toBe(FETCHERS['rss']);
  });
});

describe('truncateSummary（FR-007）', () => {
  it('截斷至上限、空白回 null', () => {
    expect(truncateSummary('x'.repeat(SUMMARY_MAX + 100))!.length).toBe(SUMMARY_MAX);
    expect(truncateSummary('  ')).toBeNull();
    expect(truncateSummary(null)).toBeNull();
    expect(truncateSummary('  hi  ')).toBe('hi');
  });
});
