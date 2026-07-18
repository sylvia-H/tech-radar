import { factSummary } from './board-summary-fallback';
import { BoardChangeDigest } from './board-summary.types';

function makeDigest(overrides: Partial<BoardChangeDigest> = {}): BoardChangeDigest {
  return {
    newcomers: 0,
    climbed: 0,
    declined: 0,
    domainCounts: { ai: 0, 'frontend-backend': 0 },
    topName: null,
    ...overrides,
  };
}

describe('factSummary', () => {
  it('三者皆有 → 「本週 N 個新進、M 個竄升、K 個下降」（FR-016）', () => {
    const digest = makeDigest({ newcomers: 3, climbed: 2, declined: 1 });
    expect(factSummary(digest)).toBe('本週 3 個新進、2 個竄升、1 個下降');
  });

  it('計數為 0 的子句省略', () => {
    const digest = makeDigest({ newcomers: 2, climbed: 0, declined: 1 });
    expect(factSummary(digest)).toBe('本週 2 個新進、1 個下降');
  });

  it('三者皆 0 → 「本週榜單無變化」（US4-3）', () => {
    expect(factSummary(makeDigest())).toBe('本週榜單無變化');
  });

  it('僅下降 → 照實陳述計數（Edge）', () => {
    const digest = makeDigest({ declined: 4 });
    expect(factSummary(digest)).toBe('本週 4 個下降');
  });

  it('數字 100% 取自 digest（SC-007）', () => {
    const digest = makeDigest({ newcomers: 7, climbed: 5, declined: 9 });
    const summary = factSummary(digest);
    expect(summary).toContain('7');
    expect(summary).toContain('5');
    expect(summary).toContain('9');
  });
});
