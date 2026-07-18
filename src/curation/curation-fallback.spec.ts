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

  it('原文標題不套 50 字收斂（原文照實呈現，Edge）', () => {
    const longTitle = '中'.repeat(80);
    const candidates: NewsCandidate[] = [makeCandidate({ title: longTitle })];

    const digest = fallbackDigest(candidates);

    expect(digest.items[0].title).toBe(longTitle);
    expect([...digest.items[0].title].length).toBe(80);
  });

  it('套同一配額：非 AI 合計 ≤2、總數 ≤6（FR-004/012）', () => {
    const candidates: NewsCandidate[] = [
      ...Array.from({ length: 5 }, (_, i) => makeCandidate({ originalUrl: `https://ai${i}.com`, domain: 'ai', weightedScore: 100 - i })),
      makeCandidate({ originalUrl: 'https://devops1.com', domain: 'devops', weightedScore: 50 }),
      makeCandidate({ originalUrl: 'https://devops2.com', domain: 'devops', weightedScore: 40 }),
      makeCandidate({ originalUrl: 'https://devops3.com', domain: 'devops', weightedScore: 30 }),
    ];

    const digest = fallbackDigest(candidates);

    expect(digest.items.length).toBeLessThanOrEqual(6);
    const nonAiCount = digest.items.filter((it) => it.domain !== 'ai').length;
    expect(nonAiCount).toBeLessThanOrEqual(2);
  });

  it('候選不足時照實輸出，不硬湊（FR-005）', () => {
    const candidates: NewsCandidate[] = [makeCandidate()];
    const digest = fallbackDigest(candidates);
    expect(digest.items).toHaveLength(1);
  });
});
