import { NewsCandidate } from './news.types';
import { DEFAULT_FUNNEL_CONFIG, runFunnel } from './funnel';

function cand(over: Partial<NewsCandidate>): NewsCandidate {
  return {
    title: 't',
    normalizedUrl: 'https://a.com/x',
    originalUrl: 'https://a.com/x',
    summary: null,
    sourceId: 's1',
    score: null,
    domain: 'ai',
    tier: 1,
    sources: ['s1'],
    publishedAt: null,
    weightedScore: 0,
    ...over,
  };
}

const EMPTY = new Set<string>();

describe('runFunnel（FR-016~021, SC-005/006/011）', () => {
  it('分數門檻只作用有分數來源；Tier2／null 分數不被丟（SC-005）', () => {
    const out = runFunnel(
      [
        cand({ normalizedUrl: 'a', tier: 1, score: 50 }), // < 100 → 丟
        cand({ normalizedUrl: 'b', tier: 1, score: 150 }), // ≥ 100 → 留
        cand({ normalizedUrl: 'c', tier: 2, score: null }), // Tier2 → 留
        cand({ normalizedUrl: 'd', tier: 1, score: null }), // 無分數 → 留
      ],
      EMPTY,
      DEFAULT_FUNNEL_CONFIG,
    );
    expect(out.map((o) => o.normalizedUrl).sort()).toEqual(['b', 'c', 'd']);
  });

  it('交叉驗證（sources ≥ 2）加權高於同分單一來源（FR-017）', () => {
    const out = runFunnel(
      [
        cand({ normalizedUrl: 'single', tier: 1, score: 100, sources: ['x'] }),
        cand({ normalizedUrl: 'multi', tier: 1, score: 100, sources: ['x', 'y'] }),
      ],
      EMPTY,
      DEFAULT_FUNNEL_CONFIG,
    );
    expect(out[0].normalizedUrl).toBe('multi');
  });

  it('榜單相關性加權；空榜單安全略過、不報錯（FR-018）', () => {
    const cands = [
      cand({ normalizedUrl: 'plain', tier: 1, score: 100, title: 'Some tool released' }),
      cand({ normalizedUrl: 'rel', tier: 1, score: 100, title: 'LangChain adds feature' }),
    ];
    const withBoard = runFunnel(cands, new Set(['langchain']), DEFAULT_FUNNEL_CONFIG);
    expect(withBoard[0].normalizedUrl).toBe('rel');

    const noBoard = runFunnel(cands, new Set(), DEFAULT_FUNNEL_CONFIG);
    expect(noBoard.map((o) => o.normalizedUrl)).toEqual(['plain', 'rel']);
  });

  it('tier 差異化權重：Tier3 權重較低（FR-019）', () => {
    const out = runFunnel(
      [
        cand({ normalizedUrl: 't1', tier: 1, score: 200 }), // 200 × 1
        cand({ normalizedUrl: 't3', tier: 3, score: 200 }), // 200 × 0.5 = 100
      ],
      EMPTY,
      DEFAULT_FUNNEL_CONFIG,
    );
    expect(out[0].normalizedUrl).toBe('t1');
  });

  it('加權同分時較新者在前（FR-020）', () => {
    const out = runFunnel(
      [
        cand({ normalizedUrl: 'old', tier: 2, score: null, publishedAt: '2026-07-01T00:00:00Z' }),
        cand({ normalizedUrl: 'new', tier: 2, score: null, publishedAt: '2026-07-17T00:00:00Z' }),
      ],
      EMPTY,
      DEFAULT_FUNNEL_CONFIG,
    );
    expect(out[0].normalizedUrl).toBe('new');
  });

  it('相同輸入多次執行成員與排序 100% 一致 ＋ 收斂取前 N（SC-006/011）', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      cand({ normalizedUrl: `u${i}`, tier: 2, score: null, publishedAt: null }),
    );
    const r1 = runFunnel(many, EMPTY, DEFAULT_FUNNEL_CONFIG);
    const r2 = runFunnel([...many].reverse(), EMPTY, DEFAULT_FUNNEL_CONFIG);
    expect(r1).toHaveLength(25);
    expect(r1.map((o) => o.normalizedUrl)).toEqual(r2.map((o) => o.normalizedUrl));
  });
});
