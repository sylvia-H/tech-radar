import { NewsCandidate } from '../news/news.types';
import { fallbackDigest } from './curation-fallback';

function makeCandidate(overrides: Partial<NewsCandidate> = {}): NewsCandidate {
  return {
    title: 'Original Title',
    normalizedUrl: 'example.com/a',
    originalUrl: 'https://example.com/a',
    summary: '一段摘要',
    sourceId: 'hn',
    score: 100,
    domain: 'ai',
    tier: 1,
    sources: ['hn'],
    publishedAt: '2026-07-18T00:00:00.000Z',
    weightedScore: 150,
    ...overrides,
  };
}

describe('fallbackDigest（US2 降級路徑）', () => {
  it('沿用 weightedScore 序取前段套配額，每則原文標題+連結、content:null、degraded:true（FR-012/013）', () => {
    const candidates: NewsCandidate[] = [
      makeCandidate({ originalUrl: 'https://a.com', title: 'Title A', weightedScore: 300, sources: ['hn', 'lobsters'] }),
      makeCandidate({ originalUrl: 'https://b.com', title: 'Title B', weightedScore: 200 }),
    ];

    const digest = fallbackDigest(candidates);

    expect(digest.degraded).toBe(true);
    expect(digest.items).toEqual([
      { title: 'Title A', content: null, url: 'https://a.com', domain: 'ai', sourceId: 'hn', sources: ['hn', 'lobsters'], sourceCount: 2, weightedScore: 300, degraded: true },
      { title: 'Title B', content: null, url: 'https://b.com', domain: 'ai', sourceId: 'hn', sources: ['hn'], sourceCount: 1, weightedScore: 200, degraded: true },
    ]);
  });

  it('sourceId 取自候選代表項、sources 為完整來源清單，與主路徑 validateCuration 一致（2026-09-12 新增）', () => {
    const candidates: NewsCandidate[] = [
      makeCandidate({ originalUrl: 'https://a.com', sourceId: 'openai-blog', sources: ['openai-blog', 'hn'], weightedScore: 300 }),
      makeCandidate({ originalUrl: 'https://b.com', sourceId: 'lobsters', sources: ['lobsters'], weightedScore: 200 }),
    ];

    const digest = fallbackDigest(candidates);

    expect(digest.items.map((it) => it.sourceId)).toEqual(['openai-blog', 'lobsters']);
    expect(digest.items.map((it) => it.sources)).toEqual([['openai-blog', 'hn'], ['lobsters']]);
    expect(digest.items[0].sources).not.toBe(candidates[0].sources); // 淺拷貝，不共用參照
  });

  it('原文標題不套 70 字收斂（原文照實呈現，Edge）', () => {
    const longTitle = '中'.repeat(80);
    const candidates: NewsCandidate[] = [makeCandidate({ title: longTitle })];

    const digest = fallbackDigest(candidates);

    expect(digest.items[0].title).toBe(longTitle);
    expect([...digest.items[0].title].length).toBe(80);
  });

  it('套同一配額：非 AI 合計 ≤5、總數 ≤15（FR-004/012；2026-09-25 v1.7.0 由 3／10 調整）', () => {
    const candidates: NewsCandidate[] = [
      ...Array.from({ length: 12 }, (_, i) => makeCandidate({ originalUrl: `https://ai${i}.com`, domain: 'ai', weightedScore: 100 - i })),
      ...Array.from({ length: 6 }, (_, i) => makeCandidate({ originalUrl: `https://devops${i}.com`, domain: 'devops', weightedScore: 50 - i })),
    ];

    const digest = fallbackDigest(candidates);

    expect(digest.items.length).toBeLessThanOrEqual(15);
    const nonAiCount = digest.items.filter((it) => it.domain !== 'ai').length;
    expect(nonAiCount).toBeLessThanOrEqual(5);
  });

  it('「未歸類」候選（domain cross）即使加權分最高也一律排除：降級路徑沒有 LLM 判斷其是否與開發相關（2026-09-25）', () => {
    const candidates: NewsCandidate[] = [
      makeCandidate({ originalUrl: 'https://birds.com', title: 'E-ink frame that draws birds', domain: 'cross', score: 2390, weightedScore: 2390 }),
      makeCandidate({ originalUrl: 'https://jev.com', title: 'Introducing System One Models and Jev', domain: 'cross', score: 1979, weightedScore: 1979 }),
      makeCandidate({ originalUrl: 'https://ai0.com', domain: 'ai', weightedScore: 300 }),
      makeCandidate({ originalUrl: 'https://devops0.com', domain: 'devops', weightedScore: 100 }),
    ];

    const digest = fallbackDigest(candidates);

    expect(digest.items.map((it) => it.url)).toEqual(['https://ai0.com', 'https://devops0.com']);
  });

  it('AI 候選不足 10 則時，非 AI 上限依 effectiveNonAiCap 動態放寬（2026-08-04 新增，憲章 v1.6.0）', () => {
    const candidates: NewsCandidate[] = [
      makeCandidate({ originalUrl: 'https://ai0.com', domain: 'ai', weightedScore: 100 }),
      ...Array.from({ length: 5 }, (_, i) =>
        makeCandidate({ originalUrl: `https://devops${i}.com`, domain: 'devops', weightedScore: 50 - i }),
      ),
    ];
    // aiCount=1 → effectiveNonAiCap = max(5, 15-1) = 14；非 AI 只有 5 則，遠低於 14，全數保留。
    const digest = fallbackDigest(candidates);

    expect(digest.items).toHaveLength(6);
    const nonAiCount = digest.items.filter((it) => it.domain !== 'ai').length;
    expect(nonAiCount).toBe(5);
  });

  it('候選不足時照實輸出，不硬湊（FR-005）', () => {
    const candidates: NewsCandidate[] = [makeCandidate()];
    const digest = fallbackDigest(candidates);
    expect(digest.items).toHaveLength(1);
  });

  it('降級路徑不做語意去重，殘留語意重複（不同連結、同一事件）可能並存（Edge、SC-006 不適用降級路徑）', () => {
    const candidates: NewsCandidate[] = [
      makeCandidate({ originalUrl: 'https://a.com/same-event', title: 'Same event via A', weightedScore: 200 }),
      makeCandidate({ originalUrl: 'https://b.com/same-event', title: 'Same event via B', weightedScore: 190 }),
    ];

    const digest = fallbackDigest(candidates);

    expect(digest.items).toHaveLength(2);
    expect(digest.items.map((it) => it.url)).toEqual(['https://a.com/same-event', 'https://b.com/same-event']);
  });
});
