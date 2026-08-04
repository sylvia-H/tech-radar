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

  it('加權同分時不再以 publishedAt 決勝，改依 normalizedUrl 字母序（2026-08-04 變更，原 FR-020）', () => {
    // 'a' 較舊、'z' 較新：若仍依 publishedAt 決勝會是 z 在前；改用 normalizedUrl 後 a 在前，
    // 證明發文頻率高的來源不會單靠「比較新」贏得同分候選的排序位置。
    const out = runFunnel(
      [
        cand({ normalizedUrl: 'z', tier: 2, score: null, publishedAt: '2026-07-17T00:00:00Z' }),
        cand({ normalizedUrl: 'a', tier: 2, score: null, publishedAt: '2026-07-01T00:00:00Z' }),
      ],
      EMPTY,
      DEFAULT_FUNNEL_CONFIG,
    );
    expect(out.map((o) => o.normalizedUrl)).toEqual(['a', 'z']);
  });

  it('相同輸入多次執行成員與排序 100% 一致 ＋ 收斂取前 N（SC-006/011，各來源不同、不觸發同來源上限）', () => {
    const many = Array.from({ length: 35 }, (_, i) =>
      cand({ normalizedUrl: `u${i}`, sourceId: `s${i}`, sources: [`s${i}`], tier: 2, score: null, publishedAt: null }),
    );
    const r1 = runFunnel(many, EMPTY, DEFAULT_FUNNEL_CONFIG);
    const r2 = runFunnel([...many].reverse(), EMPTY, DEFAULT_FUNNEL_CONFIG);
    expect(r1).toHaveLength(30); // convergeMax=30
    expect(r1.map((o) => o.normalizedUrl)).toEqual(r2.map((o) => o.normalizedUrl));
  });

  it('無分數候選同一來源達 maxNullScorePerSource 上限即剔除多餘者、不遞補其他候選', () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      cand({ normalizedUrl: `flood-${i}`, sourceId: 'flood', sources: ['flood'], tier: 2, score: null }),
    );
    const other = cand({ normalizedUrl: 'other', sourceId: 'other-src', sources: ['other-src'], tier: 2, score: null });
    const out = runFunnel([...many, other], EMPTY, DEFAULT_FUNNEL_CONFIG);

    const floodKept = out.filter((o) => o.sourceId === 'flood');
    expect(floodKept).toHaveLength(3); // maxNullScorePerSource=3，其餘 2 則被剔除
    expect(floodKept.map((o) => o.normalizedUrl)).toEqual(['flood-0', 'flood-1', 'flood-2']); // 依排序後順序保留前段
    expect(out.map((o) => o.normalizedUrl)).toContain('other'); // 其他來源不受排擠
  });

  it('有真實分數者（如 HN）不受同來源上限限制', () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      cand({ normalizedUrl: `hn-${i}`, sourceId: 'hn', sources: ['hn'], tier: 1, score: 200 - i }),
    );
    const out = runFunnel(many, EMPTY, DEFAULT_FUNNEL_CONFIG);
    expect(out).toHaveLength(5); // 全數保留，不受 maxNullScorePerSource 影響
  });
});
