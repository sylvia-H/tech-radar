import { NewsCandidate } from '../news/news.types';
import { validateCuration } from './curation-validate';
import { CurationLlmPick } from './curation.types';

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

describe('validateCuration（US1 合規路徑）', () => {
  it('以 ref 對回候選附上程式提供的 url/domain/sourceCount/weightedScore（FR-006/009）', () => {
    const candidates = [makeCandidate({ originalUrl: 'https://a.com', sources: ['hn', 'reddit'], weightedScore: 200 })];
    const picks: CurationLlmPick[] = [{ ref: 0, title: '標題', content: '內容' }];

    const result = validateCuration(picks, candidates);

    expect(result).toEqual([
      {
        title: '標題',
        content: '內容',
        url: 'https://a.com',
        domain: 'ai',
        sourceCount: 2,
        weightedScore: 200,
        degraded: false,
      },
    ]);
  });

  it('重複參照同一候選者去重為一則（保留第一次出現）', () => {
    const candidates = [makeCandidate()];
    const picks: CurationLlmPick[] = [
      { ref: 0, title: '第一次', content: '內容1' },
      { ref: 0, title: '第二次', content: '內容2' },
    ];

    const result = validateCuration(picks, candidates);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('第一次');
  });

  it('picks 順序（重要性序）保留', () => {
    const candidates = [
      makeCandidate({ originalUrl: 'https://a.com' }),
      makeCandidate({ originalUrl: 'https://b.com' }),
      makeCandidate({ originalUrl: 'https://c.com' }),
    ];
    const picks: CurationLlmPick[] = [
      { ref: 2, title: 'C', content: 'c' },
      { ref: 0, title: 'A', content: 'a' },
      { ref: 1, title: 'B', content: 'b' },
    ];

    const result = validateCuration(picks, candidates);

    expect(result.map((it) => it.url)).toEqual(['https://c.com', 'https://a.com', 'https://b.com']);
  });

  it('空 picks → 空輸出', () => {
    expect(validateCuration([], [makeCandidate()])).toEqual([]);
  });
});
