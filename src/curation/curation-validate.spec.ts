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

describe('validateCuration（US3 對抗性違規回應）', () => {
  it('11 則 → 依重要性序（picks 順序）截前 10、其餘截去（FR-008、SC-003）', () => {
    const candidates = Array.from({ length: 11 }, (_, i) => makeCandidate({ originalUrl: `https://c${i}.com` }));
    const picks: CurationLlmPick[] = candidates.map((_, i) => ({ ref: i, title: `標題${i}`, content: `內容${i}` }));

    const result = validateCuration(picks, candidates);

    expect(result).toHaveLength(10);
    expect(result.map((it) => it.url)).toEqual([
      'https://c0.com',
      'https://c1.com',
      'https://c2.com',
      'https://c3.com',
      'https://c4.com',
      'https://c5.com',
      'https://c6.com',
      'https://c7.com',
      'https://c8.com',
      'https://c9.com',
    ]);
  });

  it('標題 80 字/內容 600 字 → 收斂至 ≤70/≤500（code point 計，FR-008、SC-002）', () => {
    const candidates = [makeCandidate()];
    const longTitle = '中'.repeat(80);
    const longContent = '中'.repeat(600);
    const picks: CurationLlmPick[] = [{ ref: 0, title: longTitle, content: longContent }];

    const result = validateCuration(picks, candidates);

    expect([...result[0].title].length).toBeLessThanOrEqual(70);
    expect([...(result[0].content ?? '')].length).toBeLessThanOrEqual(500);
  });

  it('越界 ref（如 99）→ 剔除，不進入輸出（FR-009、SC-005）', () => {
    const candidates = [makeCandidate()];
    const picks: CurationLlmPick[] = [
      { ref: 99, title: '幻覺項', content: '不存在的候選' },
      { ref: 0, title: '真實項', content: '真實內容' },
    ];

    const result = validateCuration(picks, candidates);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('真實項');
  });

  it('非整數 ref → 剔除（幻覺防護，FR-009）', () => {
    const candidates = [makeCandidate()];
    const picks: CurationLlmPick[] = [{ ref: 0.5, title: '非整數項', content: '內容' }];

    expect(validateCuration(picks, candidates)).toEqual([]);
  });

  it('AI 僅 3 則但塞了 4 則非 AI → 依領域優先序夾至 ≤3（FR-010、SC-003）', () => {
    const candidates = [
      makeCandidate({ originalUrl: 'https://ai0.com', domain: 'ai' }),
      makeCandidate({ originalUrl: 'https://ai1.com', domain: 'ai' }),
      makeCandidate({ originalUrl: 'https://ai2.com', domain: 'ai' }),
      makeCandidate({ originalUrl: 'https://devops0.com', domain: 'devops' }),
      makeCandidate({ originalUrl: 'https://fe0.com', domain: 'frontend-backend' }),
      makeCandidate({ originalUrl: 'https://fe1.com', domain: 'frontend-backend' }),
      makeCandidate({ originalUrl: 'https://fe2.com', domain: 'frontend-backend' }),
    ];
    const picks: CurationLlmPick[] = candidates.map((_, i) => ({ ref: i, title: `t${i}`, content: `c${i}` }));

    const result = validateCuration(picks, candidates);

    const nonAi = result.filter((it) => it.domain !== 'ai');
    expect(nonAi.length).toBeLessThanOrEqual(3);
    expect(nonAi.map((it) => it.url)).toEqual(['https://devops0.com', 'https://fe0.com', 'https://fe1.com']);
  });

  it('夾制後總數不足 10 時照實輸出較少則數，不從未改寫候選遞補（FR-010、SC-002/003）', () => {
    const candidates = [
      makeCandidate({ originalUrl: 'https://ai0.com', domain: 'ai' }),
      makeCandidate({ originalUrl: 'https://devops0.com', domain: 'devops' }),
      makeCandidate({ originalUrl: 'https://devops1.com', domain: 'devops' }),
      makeCandidate({ originalUrl: 'https://devops2.com', domain: 'devops' }),
      makeCandidate({ originalUrl: 'https://devops3.com', domain: 'devops' }),
      makeCandidate({ originalUrl: 'https://devops4.com', domain: 'devops' }),
    ];
    const picks: CurationLlmPick[] = candidates.map((_, i) => ({ ref: i, title: `t${i}`, content: `c${i}` }));

    const result = validateCuration(picks, candidates);

    expect(result).toHaveLength(4);
    expect(result.map((it) => it.url)).toEqual([
      'https://ai0.com',
      'https://devops0.com',
      'https://devops1.com',
      'https://devops2.com',
    ]);
  });
});
