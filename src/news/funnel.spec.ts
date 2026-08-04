import { NewsCandidate } from './news.types';
import { DEFAULT_FUNNEL_CONFIG, runFunnel } from './funnel';

const NOW = new Date('2026-08-04T00:00:00Z');
const DAY_MS = 86_400_000;

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
    publishedAt: new Date(NOW.getTime() - DAY_MS).toISOString(), // 預設 1 天前，落在新鮮度視窗內
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
      NOW,
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
      NOW,
    );
    expect(out[0].normalizedUrl).toBe('multi');
  });

  it('榜單相關性加權；空榜單安全略過、不報錯（FR-018）', () => {
    const cands = [
      cand({ normalizedUrl: 'plain', tier: 1, score: 100, title: 'Some tool released' }),
      cand({ normalizedUrl: 'rel', tier: 1, score: 100, title: 'LangChain adds feature' }),
    ];
    const withBoard = runFunnel(cands, new Set(['langchain']), DEFAULT_FUNNEL_CONFIG, NOW);
    expect(withBoard[0].normalizedUrl).toBe('rel');

    const noBoard = runFunnel(cands, new Set(), DEFAULT_FUNNEL_CONFIG, NOW);
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
      NOW,
    );
    expect(out[0].normalizedUrl).toBe('t1');
  });

  it('加權同分時不再以 publishedAt 決勝，改依 normalizedUrl 字母序（2026-08-04 變更，原 FR-020）', () => {
    // 'a' 較舊、'z' 較新：若仍依 publishedAt 決勝會是 z 在前；改用 normalizedUrl 後 a 在前，
    // 證明發文頻率高的來源不會單靠「比較新」贏得同分候選的排序位置。兩則日期皆在新鮮度視窗內。
    const out = runFunnel(
      [
        cand({ normalizedUrl: 'z', tier: 2, score: null, publishedAt: new Date(NOW.getTime() - 1 * DAY_MS).toISOString() }),
        cand({ normalizedUrl: 'a', tier: 2, score: null, publishedAt: new Date(NOW.getTime() - 2 * DAY_MS).toISOString() }),
      ],
      EMPTY,
      DEFAULT_FUNNEL_CONFIG,
      NOW,
    );
    expect(out.map((o) => o.normalizedUrl)).toEqual(['a', 'z']);
  });

  it('相同輸入多次執行成員與排序 100% 一致 ＋ 收斂取前 N（SC-006/011，各來源不同、不觸發同來源上限）', () => {
    const many = Array.from({ length: 55 }, (_, i) =>
      cand({ normalizedUrl: `u${i}`, sourceId: `s${i}`, sources: [`s${i}`], tier: 2, score: null }),
    );
    const r1 = runFunnel(many, EMPTY, DEFAULT_FUNNEL_CONFIG, NOW);
    const r2 = runFunnel([...many].reverse(), EMPTY, DEFAULT_FUNNEL_CONFIG, NOW);
    expect(r1).toHaveLength(50); // convergeMax=50
    expect(r1.map((o) => o.normalizedUrl)).toEqual(r2.map((o) => o.normalizedUrl));
  });

  it('無分數候選同一來源達 maxNullScorePerSource 上限即剔除多餘者、不遞補其他候選', () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      cand({ normalizedUrl: `flood-${i}`, sourceId: 'flood', sources: ['flood'], tier: 2, score: null }),
    );
    const other = cand({ normalizedUrl: 'other', sourceId: 'other-src', sources: ['other-src'], tier: 2, score: null });
    const out = runFunnel([...many, other], EMPTY, DEFAULT_FUNNEL_CONFIG, NOW);

    const floodKept = out.filter((o) => o.sourceId === 'flood');
    expect(floodKept).toHaveLength(3); // maxNullScorePerSource=3，其餘 2 則被剔除
    expect(floodKept.map((o) => o.normalizedUrl)).toEqual(['flood-0', 'flood-1', 'flood-2']); // 依排序後順序保留前段
    expect(out.map((o) => o.normalizedUrl)).toContain('other'); // 其他來源不受排擠
  });

  it('有真實分數者（如 HN）不受同來源上限限制', () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      cand({ normalizedUrl: `hn-${i}`, sourceId: 'hn', sources: ['hn'], tier: 1, score: 200 - i }),
    );
    const out = runFunnel(many, EMPTY, DEFAULT_FUNNEL_CONFIG, NOW);
    expect(out).toHaveLength(5); // 全數保留，不受 maxNullScorePerSource 影響
  });

  it('跨來源輪流分配：候選池吃緊時，字母序偏後的來源仍至少保有 1 則（2026-08-04 新增，取代舊版全域截斷的字母序偏誤）', () => {
    // 10 個來源、每源 3 則（共 30 則），convergeMax 刻意調低至 15 製造名額吃緊；若仍是舊版
    // 「全域排序後截斷」，字母序最後面的來源會被完全擠出候選池。
    const sourceIds = ['a-src', 'b-src', 'c-src', 'd-src', 'e-src', 'f-src', 'g-src', 'h-src', 'i-src', 'z-src'];
    const many = sourceIds.flatMap((sourceId) =>
      Array.from({ length: 3 }, (_, i) => cand({ normalizedUrl: `${sourceId}-${i}`, sourceId, sources: [sourceId], tier: 2, score: null })),
    );
    const cfg = { ...DEFAULT_FUNNEL_CONFIG, convergeMax: 15 };
    const out = runFunnel(many, EMPTY, cfg, NOW);

    expect(out).toHaveLength(15); // 10 來源 × 第 1 輪保底 = 10，剩 5 名額給第 2 輪
    for (const sourceId of sourceIds) {
      expect(out.some((o) => o.sourceId === sourceId)).toBe(true); // 每個來源都至少 1 則，含字母序最後的 z-src
    }
  });
});

describe('runFunnel — 無分數候選新鮮度視窗（2026-08-04 新增，freshnessWindowDays=30）', () => {
  it('publishedAt 缺失（null）→ 不入池', () => {
    const out = runFunnel([cand({ normalizedUrl: 'no-date', score: null, publishedAt: null })], EMPTY, DEFAULT_FUNNEL_CONFIG, NOW);
    expect(out).toHaveLength(0);
  });

  it('publishedAt 超出 30 天視窗（如封存舊文被重新提及）→ 不入池', () => {
    const stale = new Date(NOW.getTime() - 400 * DAY_MS).toISOString(); // 逾一年
    const out = runFunnel([cand({ normalizedUrl: 'stale', score: null, publishedAt: stale })], EMPTY, DEFAULT_FUNNEL_CONFIG, NOW);
    expect(out).toHaveLength(0);
  });

  it('剛好 30 天前 → 仍入池（邊界含）；31 天前 → 不入池', () => {
    const exactly30 = new Date(NOW.getTime() - 30 * DAY_MS).toISOString();
    const over31 = new Date(NOW.getTime() - 31 * DAY_MS).toISOString();
    const out = runFunnel(
      [
        cand({ normalizedUrl: 'edge30', score: null, publishedAt: exactly30 }),
        cand({ normalizedUrl: 'edge31', score: null, publishedAt: over31 }),
      ],
      EMPTY,
      DEFAULT_FUNNEL_CONFIG,
      NOW,
    );
    expect(out.map((o) => o.normalizedUrl)).toEqual(['edge30']);
  });

  it('有真實分數者（如 HN）不受新鮮度視窗限制，發表已久也保留', () => {
    const veryOld = '2023-01-01T00:00:00Z'; // HN 的 publishedAt 是提交時間、非原文發表日，此處僅測試「即使很舊也不濾」
    const out = runFunnel(
      [cand({ normalizedUrl: 'hn-old', sourceId: 'hn', sources: ['hn'], tier: 1, score: 200, publishedAt: veryOld })],
      EMPTY,
      DEFAULT_FUNNEL_CONFIG,
      NOW,
    );
    expect(out.map((o) => o.normalizedUrl)).toEqual(['hn-old']);
  });
});
