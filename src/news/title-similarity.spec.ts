import { jaccard, normalizeTitle, TITLE_JACCARD_THRESHOLD } from './title-similarity';

describe('title-similarity（FR-013）', () => {
  it('normalizeTitle：小寫、去標點、去 stop words', () => {
    expect(normalizeTitle('The New AI Model, Released!')).toEqual(['ai', 'model', 'released']);
  });

  it('jaccard：相同集合=1、不相交=0、空集合=0', () => {
    expect(jaccard(['a', 'b'], ['a', 'b'])).toBe(1);
    expect(jaccard(['a'], ['b'])).toBe(0);
    expect(jaccard([], ['a'])).toBe(0);
  });

  it('門檻上下界：近似 ≥ 門檻、差異 < 門檻', () => {
    const t1 = normalizeTitle('OpenAI releases GPT-5 model today');
    const t2 = normalizeTitle('OpenAI releases GPT-5 model');
    expect(jaccard(t1, t2)).toBeGreaterThanOrEqual(TITLE_JACCARD_THRESHOLD);

    const t3 = normalizeTitle('Rust compiler performance improvements');
    expect(jaccard(t1, t3)).toBeLessThan(TITLE_JACCARD_THRESHOLD);
  });
});
