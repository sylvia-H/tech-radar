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
      { title: 'Title A', content: null, url: 'https://a.com', domain: 'ai', sourceCount: 2, weightedScore: 300, degraded: true },
      { title: 'Title B', content: null, url: 'https://b.com', domain: 'ai', sourceCount: 1, weightedScore: 200, degraded: true },
    ]);
  });

  it('原文標題不套 70 字收斂（原文照實呈現，Edge）', () => {
    const longTitle = '中'.repeat(80);
    const candidates: NewsCandidate[] = [makeCandidate({ title: longTitle })];

    const digest = fallbackDigest(candidates);

    expect(digest.items[0].title).toBe(longTitle);
    expect([...digest.items[0].title].length).toBe(80);
  });

  it('套同一配額：非 AI 合計 ≤3、總數 ≤10（FR-004/012）', () => {
    const candidates: NewsCandidate[] = [
      ...Array.from({ length: 8 }, (_, i) => makeCandidate({ originalUrl: `https://ai${i}.com`, domain: 'ai', weightedScore: 100 - i })),
      makeCandidate({ originalUrl: 'https://devops1.com', domain: 'devops', weightedScore: 50 }),
      makeCandidate({ originalUrl: 'https://devops2.com', domain: 'devops', weightedScore: 40 }),
      makeCandidate({ originalUrl: 'https://devops3.com', domain: 'devops', weightedScore: 30 }),
      makeCandidate({ originalUrl: 'https://devops4.com', domain: 'devops', weightedScore: 20 }),
    ];

    const digest = fallbackDigest(candidates);

    expect(digest.items.length).toBeLessThanOrEqual(10);
    const nonAiCount = digest.items.filter((it) => it.domain !== 'ai').length;
    expect(nonAiCount).toBeLessThanOrEqual(3);
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
