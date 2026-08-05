import { NewsCandidate } from './news.types';
import { dedupByTitle, dedupByUrl } from './dedup';
import { TITLE_JACCARD_THRESHOLD } from './title-similarity';

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

describe('dedupByUrl（FR-012 / SC-001）', () => {
  it('同 URL 合併：最高分為代表、sources[] 累積並去重排序', () => {
    const out = dedupByUrl([
      cand({ sourceId: 'hn', score: 200, sources: ['hn'], normalizedUrl: 'u' }),
      cand({ sourceId: 'rd', score: null, sources: ['rd'], normalizedUrl: 'u' }),
      cand({ sourceId: 'lo', score: 50, sources: ['lo'], normalizedUrl: 'u' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].sourceId).toBe('hn');
    expect(out[0].score).toBe(200);
    expect(out[0].sources).toEqual(['hn', 'lo', 'rd']);
  });

  it('同分時代表以 sourceId→originalUrl 字典序確定性決勝，與輸入順序無關（FR-012, SC-011）', () => {
    const a = cand({ sourceId: 'b', score: 100, originalUrl: 'https://z', sources: ['b'], normalizedUrl: 'u' });
    const b = cand({ sourceId: 'a', score: 100, originalUrl: 'https://y', sources: ['a'], normalizedUrl: 'u' });
    expect(dedupByUrl([a, b])[0].sourceId).toBe('a');
    expect(dedupByUrl([b, a])[0].sourceId).toBe('a');
  });

  it('無目標連結以自身連結為鍵、不崩潰（FR-015/Edge）', () => {
    const out = dedupByUrl([
      cand({ normalizedUrl: 'https://news.ycombinator.com/item?id=1', originalUrl: 'https://news.ycombinator.com/item?id=1' }),
    ]);
    expect(out).toHaveLength(1);
  });
});

describe('dedupByTitle（FR-013）', () => {
  it('標題近似合併（最高分代表）；低於門檻不誤合併', () => {
    const c1 = cand({ title: 'OpenAI releases GPT-5 model today', normalizedUrl: 'u1', score: 10, sourceId: 's1', sources: ['s1'] });
    const c2 = cand({ title: 'OpenAI releases GPT-5 model', normalizedUrl: 'u2', score: 20, sourceId: 's2', sources: ['s2'] });
    const c3 = cand({ title: 'Rust compiler performance improvements', normalizedUrl: 'u3', sourceId: 's3', sources: ['s3'] });

    const out = dedupByTitle([c1, c2, c3], TITLE_JACCARD_THRESHOLD);
    expect(out).toHaveLength(2);
    const merged = out.find((o) => o.sources.includes('s1'))!;
    expect(merged.sources).toEqual(['s1', 's2']);
    expect(merged.score).toBe(20);
  });
});
