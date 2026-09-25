import { NewsCandidate } from '../news/news.types';
import { CurationDrop, validateCuration } from './curation-validate';
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
  it('以 ref 對回候選附上程式提供的 url/domain/sourceId/sources/sourceCount/weightedScore（FR-006/009）', () => {
    const candidates = [makeCandidate({ originalUrl: 'https://a.com', sources: ['hn', 'reddit'], weightedScore: 200 })];
    const officialPicks: CurationLlmPick[] = [{ ref: 0, title: '標題', content: '內容' }];

    const result = validateCuration(officialPicks, [], candidates);

    expect(result).toEqual([
      {
        title: '標題',
        content: '內容',
        url: 'https://a.com',
        domain: 'ai',
        sourceId: 'hn',
        sources: ['hn', 'reddit'],
        sourceCount: 2,
        weightedScore: 200,
        degraded: false,
      },
    ]);
  });

  it('多來源合併時 sourceId 只記代表項、sources 為完整來源清單、sourceCount === sources.length（2026-09-12 新增）', () => {
    const candidates = [
      makeCandidate({ originalUrl: 'https://a.com', sourceId: 'openai-blog', sources: ['openai-blog', 'hn'] }),
      makeCandidate({ originalUrl: 'https://b.com', sourceId: 'cncf-blog', sources: ['cncf-blog'], domain: 'devops' }),
    ];
    const officialPicks: CurationLlmPick[] = [
      { ref: 1, title: 'B', content: '內容 B' },
      { ref: 0, title: 'A', content: '內容 A' },
    ];

    const result = validateCuration(officialPicks, [], candidates);

    expect(result.map((it) => it.sourceId)).toEqual(['cncf-blog', 'openai-blog']);
    expect(result.map((it) => it.sources)).toEqual([['cncf-blog'], ['openai-blog', 'hn']]);
    expect(result[1].sourceCount).toBe(2);
    expect(result[1].sourceCount).toBe(result[1].sources.length);
  });

  it('sources 為候選陣列的淺拷貝，不與候選共用參照（2026-09-12 新增）', () => {
    const candidate = makeCandidate({ sourceId: 'openai-blog', sources: ['openai-blog', 'hn'] });
    const officialPicks: CurationLlmPick[] = [{ ref: 0, title: 'A', content: '內容 A' }];

    const result = validateCuration(officialPicks, [], [candidate]);

    expect(result[0].sources).toEqual(candidate.sources);
    expect(result[0].sources).not.toBe(candidate.sources);
  });

  it('重複參照同一候選者去重為一則（保留第一次出現）', () => {
    const candidates = [makeCandidate()];
    const officialPicks: CurationLlmPick[] = [
      { ref: 0, title: '第一次', content: '內容1' },
      { ref: 0, title: '第二次', content: '內容2' },
    ];

    const result = validateCuration(officialPicks, [], candidates);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('第一次');
  });

  it('officialPicks 內部順序（重要性序）保留', () => {
    const candidates = [
      makeCandidate({ originalUrl: 'https://a.com' }),
      makeCandidate({ originalUrl: 'https://b.com' }),
      makeCandidate({ originalUrl: 'https://c.com' }),
    ];
    const officialPicks: CurationLlmPick[] = [
      { ref: 2, title: 'C', content: 'c' },
      { ref: 0, title: 'A', content: 'a' },
      { ref: 1, title: 'B', content: 'b' },
    ];

    const result = validateCuration(officialPicks, [], candidates);

    expect(result.map((it) => it.url)).toEqual(['https://c.com', 'https://a.com', 'https://b.com']);
  });

  it('兩陣列皆空 → 空輸出', () => {
    expect(validateCuration([], [], [makeCandidate()])).toEqual([]);
  });
});

describe('validateCuration（officialPicks 優先於 communityPicks，2026-08-04 新增）', () => {
  it('合併順序固定為 officialPicks 全部在前、communityPicks 在後（結構性優先保證）', () => {
    const candidates = [
      makeCandidate({ originalUrl: 'https://official0.com' }),
      makeCandidate({ originalUrl: 'https://community0.com' }),
      makeCandidate({ originalUrl: 'https://official1.com' }),
    ];
    const officialPicks: CurationLlmPick[] = [
      { ref: 0, title: 'official0', content: 'c' },
      { ref: 2, title: 'official1', content: 'c' },
    ];
    const communityPicks: CurationLlmPick[] = [{ ref: 1, title: 'community0', content: 'c' }];

    const result = validateCuration(officialPicks, communityPicks, candidates);

    // 即使 communityPicks 對應的候選（ref=1）在候選清單裡排在 officialPicks 的 ref=2 之前，
    // 合併輸出仍固定 officialPicks 全部在前。
    expect(result.map((it) => it.url)).toEqual([
      'https://official0.com',
      'https://official1.com',
      'https://community0.com',
    ]);
  });

  it('officialPicks 已達 15 則時，communityPicks 在總數截斷步驟被完全排除（社群熱度讓位）', () => {
    const officialCandidates = Array.from({ length: 15 }, (_, i) =>
      makeCandidate({ originalUrl: `https://official${i}.com` }),
    );
    const communityCandidate = makeCandidate({ originalUrl: 'https://community.com' });
    const candidates = [...officialCandidates, communityCandidate];

    const officialPicks: CurationLlmPick[] = officialCandidates.map((_, i) => ({
      ref: i,
      title: `official${i}`,
      content: 'c',
    }));
    const communityPicks: CurationLlmPick[] = [{ ref: 15, title: 'community', content: 'c' }];

    const result = validateCuration(officialPicks, communityPicks, candidates);

    expect(result).toHaveLength(15);
    expect(result.map((it) => it.url)).not.toContain('https://community.com');
  });

  it('officialPicks 未滿載時，communityPicks 依序補上剩餘名額', () => {
    const candidates = [
      makeCandidate({ originalUrl: 'https://official0.com' }),
      makeCandidate({ originalUrl: 'https://community0.com' }),
      makeCandidate({ originalUrl: 'https://community1.com' }),
    ];
    const officialPicks: CurationLlmPick[] = [{ ref: 0, title: 'official0', content: 'c' }];
    const communityPicks: CurationLlmPick[] = [
      { ref: 1, title: 'community0', content: 'c' },
      { ref: 2, title: 'community1', content: 'c' },
    ];

    const result = validateCuration(officialPicks, communityPicks, candidates);

    expect(result.map((it) => it.url)).toEqual([
      'https://official0.com',
      'https://community0.com',
      'https://community1.com',
    ]);
  });
});

describe('validateCuration（US3 對抗性違規回應）', () => {
  it('16 則（跨兩陣列）→ 依合併順序截前 15、其餘截去（FR-008、SC-003；2026-09-25 上限 10 → 15）', () => {
    const candidates = Array.from({ length: 16 }, (_, i) => makeCandidate({ originalUrl: `https://c${i}.com` }));
    const officialPicks: CurationLlmPick[] = candidates
      .slice(0, 8)
      .map((_, i) => ({ ref: i, title: `標題${i}`, content: `內容${i}` }));
    const communityPicks: CurationLlmPick[] = candidates
      .slice(8)
      .map((_, i) => ({ ref: i + 8, title: `標題${i + 8}`, content: `內容${i + 8}` }));

    const result = validateCuration(officialPicks, communityPicks, candidates);

    expect(result).toHaveLength(15);
    expect(result.map((it) => it.url)).toEqual(Array.from({ length: 15 }, (_, i) => `https://c${i}.com`));
  });

  it('標題 80 字/內容 600 字 → 收斂至 ≤70/≤500（code point 計，FR-008、SC-002）', () => {
    const candidates = [makeCandidate()];
    const longTitle = '中'.repeat(80);
    const longContent = '中'.repeat(600);
    const officialPicks: CurationLlmPick[] = [{ ref: 0, title: longTitle, content: longContent }];

    const result = validateCuration(officialPicks, [], candidates);

    expect([...result[0].title].length).toBeLessThanOrEqual(70);
    expect([...(result[0].content ?? '')].length).toBeLessThanOrEqual(500);
  });

  it('越界 ref（如 99）→ 剔除，不進入輸出（FR-009、SC-005）', () => {
    const candidates = [makeCandidate()];
    const officialPicks: CurationLlmPick[] = [
      { ref: 99, title: '幻覺項', content: '不存在的候選' },
      { ref: 0, title: '真實項', content: '真實內容' },
    ];

    const result = validateCuration(officialPicks, [], candidates);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('真實項');
  });

  it('非整數 ref → 剔除（幻覺防護，FR-009）', () => {
    const candidates = [makeCandidate()];
    const officialPicks: CurationLlmPick[] = [{ ref: 0.5, title: '非整數項', content: '內容' }];

    expect(validateCuration(officialPicks, [], candidates)).toEqual([]);
  });

  it('重複 ref 橫跨兩陣列（communityPicks 也選了 officialPicks 已選的 ref）→ 保留第一次出現（officialPicks 優先）', () => {
    const candidates = [makeCandidate({ originalUrl: 'https://dup.com' })];
    const officialPicks: CurationLlmPick[] = [{ ref: 0, title: '官方版標題', content: 'c' }];
    const communityPicks: CurationLlmPick[] = [{ ref: 0, title: '社群版標題', content: 'c' }];

    const result = validateCuration(officialPicks, communityPicks, candidates);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('官方版標題');
  });

  it('AI 供給充足（≥10 則）時，非 AI 依領域優先序夾至靜態上限 ≤5（FR-010、SC-003；動態上限在 AI≥10 時等同固定 ≤5，2026-09-25 v1.7.0）', () => {
    const candidates = [
      ...Array.from({ length: 10 }, (_, i) => makeCandidate({ originalUrl: `https://ai${i}.com`, domain: 'ai' })),
      makeCandidate({ originalUrl: 'https://devops0.com', domain: 'devops', sourceId: 's-devops0', sources: ['s-devops0'] }),
      ...Array.from({ length: 5 }, (_, i) =>
        makeCandidate({ originalUrl: `https://fe${i}.com`, domain: 'frontend-backend', sourceId: `s-fe${i}`, sources: [`s-fe${i}`] }),
      ),
    ];
    const officialPicks: CurationLlmPick[] = candidates.map((_, i) => ({ ref: i, title: `t${i}`, content: `c${i}` }));

    const result = validateCuration(officialPicks, [], candidates);

    const nonAi = result.filter((it) => it.domain !== 'ai');
    expect(nonAi.length).toBeLessThanOrEqual(5);
    expect(nonAi.map((it) => it.url)).toEqual([
      'https://devops0.com',
      'https://fe0.com',
      'https://fe1.com',
      'https://fe2.com',
      'https://fe3.com',
    ]);
  });

  it('AI 供給不足（<10 則）時，非 AI 上限放寬至 15−AI 則數，把 AI 未用滿的名額讓給非 AI（2026-08-04 新增，憲章 v1.6.0；v1.7.0 數字調整）', () => {
    const candidates = [
      makeCandidate({ originalUrl: 'https://ai0.com', domain: 'ai' }),
      makeCandidate({ originalUrl: 'https://ai1.com', domain: 'ai' }),
      makeCandidate({ originalUrl: 'https://ai2.com', domain: 'ai' }),
      makeCandidate({ originalUrl: 'https://ai3.com', domain: 'ai' }),
      makeCandidate({ originalUrl: 'https://devops0.com', domain: 'devops', sourceId: 's-devops0', sources: ['s-devops0'] }),
      makeCandidate({ originalUrl: 'https://devops1.com', domain: 'devops', sourceId: 's-devops1', sources: ['s-devops1'] }),
      makeCandidate({ originalUrl: 'https://devops2.com', domain: 'devops', sourceId: 's-devops2', sources: ['s-devops2'] }),
      makeCandidate({ originalUrl: 'https://devops3.com', domain: 'devops', sourceId: 's-devops3', sources: ['s-devops3'] }),
      makeCandidate({ originalUrl: 'https://devops4.com', domain: 'devops', sourceId: 's-devops4', sources: ['s-devops4'] }),
      makeCandidate({ originalUrl: 'https://devops5.com', domain: 'devops', sourceId: 's-devops5', sources: ['s-devops5'] }),
    ];
    // AI=4 則 → effectiveNonAiCap = max(5, 15−4) = 11；非 AI 候選 6 則，全數保留、總數 10。
    const officialPicks: CurationLlmPick[] = candidates.map((_, i) => ({ ref: i, title: `t${i}`, content: `c${i}` }));

    const result = validateCuration(officialPicks, [], candidates);

    expect(result).toHaveLength(10);
    const nonAi = result.filter((it) => it.domain !== 'ai');
    expect(nonAi).toHaveLength(6); // 靜態上限本會夾到 5，動態放寬後 6 則全數保留
  });

  it('非 AI 候選池 >5 時，同來源最多 2 則入選，第 3 則同來源直接剔除、不遞補（2026-08-04 決策）', () => {
    const candidates = [
      makeCandidate({ originalUrl: 'https://ai0.com', domain: 'ai' }),
      makeCandidate({ originalUrl: 'https://cf0.com', domain: 'devops', sourceId: 'cloudflare-blog', sources: ['cloudflare-blog'] }),
      makeCandidate({ originalUrl: 'https://cf1.com', domain: 'devops', sourceId: 'cloudflare-blog', sources: ['cloudflare-blog'] }),
      makeCandidate({ originalUrl: 'https://cf2.com', domain: 'devops', sourceId: 'cloudflare-blog', sources: ['cloudflare-blog'] }),
      makeCandidate({ originalUrl: 'https://cncf0.com', domain: 'devops', sourceId: 'cncf-blog', sources: ['cncf-blog'] }),
      makeCandidate({ originalUrl: 'https://cncf1.com', domain: 'devops', sourceId: 'cncf-blog', sources: ['cncf-blog'] }),
      makeCandidate({ originalUrl: 'https://cncf2.com', domain: 'devops', sourceId: 'cncf-blog', sources: ['cncf-blog'] }),
    ];
    // 非 AI 候選池 = 6（cf0/cf1/cf2/cncf0/cncf1/cncf2）> MAX_NON_AI(5) → 同來源上限生效
    const officialPicks: CurationLlmPick[] = [
      { ref: 0, title: 'ai', content: 'c' },
      { ref: 1, title: 'cf0', content: 'c' },
      { ref: 2, title: 'cf1', content: 'c' },
      { ref: 3, title: 'cf2', content: 'c' },
    ];

    const result = validateCuration(officialPicks, [], candidates);

    // cf2 因 cloudflare-blog 已達上限 2 被剔除；cncf0 未入選（LLM 沒選），依規則不遞補
    expect(result.map((it) => it.url)).toEqual(['https://ai0.com', 'https://cf0.com', 'https://cf1.com']);
  });

  it('非 AI 候選池 ≤5 時，同來源上限不生效（候選本就不足，不特別限制）', () => {
    const candidates = [
      makeCandidate({ originalUrl: 'https://ai0.com', domain: 'ai' }),
      makeCandidate({ originalUrl: 'https://cf0.com', domain: 'devops', sourceId: 'cloudflare-blog', sources: ['cloudflare-blog'] }),
      makeCandidate({ originalUrl: 'https://cf1.com', domain: 'devops', sourceId: 'cloudflare-blog', sources: ['cloudflare-blog'] }),
      makeCandidate({ originalUrl: 'https://cf2.com', domain: 'devops', sourceId: 'cloudflare-blog', sources: ['cloudflare-blog'] }),
    ];
    // 非 AI 候選池 = 3（cf0/cf1/cf2）≤ MAX_NON_AI(5)，未超過門檻 → 不觸發同來源上限
    const officialPicks: CurationLlmPick[] = [
      { ref: 0, title: 'ai', content: 'c' },
      { ref: 1, title: 'cf0', content: 'c' },
      { ref: 2, title: 'cf1', content: 'c' },
      { ref: 3, title: 'cf2', content: 'c' },
    ];

    const result = validateCuration(officialPicks, [], candidates);

    expect(result.map((it) => it.url)).toEqual(['https://ai0.com', 'https://cf0.com', 'https://cf1.com', 'https://cf2.com']);
  });

  it('動態上限放寬後仍不從 LLM 未選中的候選遞補（FR-010、SC-002/003；2026-08-04：即使上限有餘裕也不無中生有）', () => {
    const candidates = [
      makeCandidate({ originalUrl: 'https://ai0.com', domain: 'ai' }),
      makeCandidate({ originalUrl: 'https://devops0.com', domain: 'devops', sourceId: 's-devops0', sources: ['s-devops0'] }),
      makeCandidate({ originalUrl: 'https://devops1.com', domain: 'devops', sourceId: 's-devops1', sources: ['s-devops1'] }),
      // 以下 3 則存在於候選集，但 LLM 未選入 picks——即使動態上限（AI=1 → max(5,14)=14）遠有餘裕，
      // 也不得遞補這些未經 LLM 改寫的候選來湊滿總數。
      makeCandidate({ originalUrl: 'https://devops2.com', domain: 'devops', sourceId: 's-devops2', sources: ['s-devops2'] }),
      makeCandidate({ originalUrl: 'https://devops3.com', domain: 'devops', sourceId: 's-devops3', sources: ['s-devops3'] }),
      makeCandidate({ originalUrl: 'https://devops4.com', domain: 'devops', sourceId: 's-devops4', sources: ['s-devops4'] }),
    ];
    const officialPicks: CurationLlmPick[] = [
      { ref: 0, title: 'ai0', content: 'c' },
      { ref: 1, title: 'devops0', content: 'c' },
      { ref: 2, title: 'devops1', content: 'c' },
    ];

    const result = validateCuration(officialPicks, [], candidates);

    expect(result).toHaveLength(3);
    expect(result.map((it) => it.url)).toEqual(['https://ai0.com', 'https://devops0.com', 'https://devops1.com']);
  });
});

describe('validateCuration（onDrop 剔除回呼，2026-09-14 新增）', () => {
  function collect(): { drops: CurationDrop[]; onDrop: (d: CurationDrop) => void } {
    const drops: CurationDrop[] = [];
    return { drops, onDrop: (d) => drops.push(d) };
  }

  it('ref 越界／非整數 → invalid-ref（帶 LLM 標題、無來源）；重複 ref → duplicate-ref（帶來源）', () => {
    const candidates = [makeCandidate({ sourceId: 'hn', domain: 'ai' })];
    const officialPicks: CurationLlmPick[] = [
      { ref: 0, title: '正常', content: 'c' },
      { ref: 7, title: '幻覺', content: 'c' },
      { ref: 1.5, title: '非整數', content: 'c' },
    ];
    const communityPicks: CurationLlmPick[] = [{ ref: 0, title: '重複', content: 'c' }];
    const { drops, onDrop } = collect();

    const result = validateCuration(officialPicks, communityPicks, candidates, onDrop);

    expect(result).toHaveLength(1);
    expect(drops).toEqual([
      { stage: 'invalid-ref', ref: 7, title: '幻覺' },
      { stage: 'invalid-ref', ref: 1.5, title: '非整數' },
      { stage: 'duplicate-ref', ref: 0, sourceId: 'hn', domain: 'ai', title: '重複' },
    ]);
  });

  it('非 AI 同來源第 3 則 → source-diversity（非 AI 候選池 6 > 5）', () => {
    // 5 則 AI（上限 = max(5, 15−5) = 10）＋ 3 則同來源 devops ＋ 3 則不同來源 devops → 共 11 則
    const ai = Array.from({ length: 5 }, (_, i) =>
      makeCandidate({ originalUrl: `https://ai${i}.com`, domain: 'ai', sourceId: 'hn', sources: ['hn'] }),
    );
    const k8s = Array.from({ length: 3 }, (_, i) =>
      makeCandidate({ originalUrl: `https://k8s${i}.com`, domain: 'devops', sourceId: 'kubernetes-blog', sources: ['kubernetes-blog'] }),
    );
    const others = ['cncf-blog', 'lobsters-devops', 'thenewstack'].map((s, i) =>
      makeCandidate({ originalUrl: `https://o${i}.com`, domain: 'devops', sourceId: s, sources: [s] }),
    );
    const candidates = [...ai, ...k8s, ...others];
    const officialPicks: CurationLlmPick[] = candidates.map((_, i) => ({ ref: i, title: `t${i}`, content: 'c' }));
    const { drops, onDrop } = collect();

    const result = validateCuration(officialPicks, [], candidates, onDrop);

    expect(result).toHaveLength(10);
    expect(drops.map((d) => d.stage)).toEqual(['source-diversity']);
    expect(drops[0]).toEqual({ stage: 'source-diversity', ref: 7, sourceId: 'kubernetes-blog', domain: 'devops', title: 't7' });
  });

  it('AI 只有 2 則、非 AI 14 則 → 上限 13，第 14 則非 AI → non-ai-cap（總數恰 15、無 max-items）', () => {
    const ai = Array.from({ length: 2 }, (_, i) =>
      makeCandidate({ originalUrl: `https://ai${i}.com`, domain: 'ai', sourceId: 'hn', sources: ['hn'] }),
    );
    const nonAi = Array.from({ length: 14 }, (_, i) =>
      makeCandidate({ originalUrl: `https://d${i}.com`, domain: 'devops', sourceId: `src${i}`, sources: [`src${i}`] }),
    );
    const candidates = [...ai, ...nonAi];
    const officialPicks: CurationLlmPick[] = candidates.map((_, i) => ({ ref: i, title: `t${i}`, content: 'c' }));
    const { drops, onDrop } = collect();

    const result = validateCuration(officialPicks, [], candidates, onDrop);

    expect(result).toHaveLength(15);
    expect(drops.map((d) => [d.stage, d.ref])).toEqual([['non-ai-cap', 15]]);
  });

  it('16 則全 AI → 第 16 則 max-items', () => {
    const candidates = Array.from({ length: 16 }, (_, i) => makeCandidate({ originalUrl: `https://c${i}.com` }));
    const officialPicks: CurationLlmPick[] = candidates.map((_, i) => ({ ref: i, title: `t${i}`, content: 'c' }));
    const { drops, onDrop } = collect();

    validateCuration(officialPicks, [], candidates, onDrop);

    expect(drops.map((d) => [d.stage, d.ref])).toEqual([['max-items', 15]]);
  });

  it('未傳 onDrop 時行為不變、不擲錯', () => {
    const officialPicks: CurationLlmPick[] = [{ ref: 5, title: '幻覺', content: 'c' }];
    expect(validateCuration(officialPicks, [], [makeCandidate()])).toEqual([]);
  });
});

describe('validateCuration（「未歸類」候選的領域落定，2026-09-25）', () => {
  it('cross 候選採 LLM 回填的 domain（devops → 計入非 AI 配額與來源多樣性）', () => {
    const candidates = [
      makeCandidate({ originalUrl: 'https://jev.com', domain: 'cross', score: 1979, weightedScore: 1979 }),
      makeCandidate({ originalUrl: 'https://k8s.com', domain: 'cross', score: 700, weightedScore: 700 }),
    ];
    const officialPicks: CurationLlmPick[] = [
      { ref: 0, title: 'Jev', content: 'c', domain: 'ai' },
      { ref: 1, title: 'k8s thing', content: 'c', domain: 'devops' },
    ];

    const result = validateCuration(officialPicks, [], candidates);

    expect(result.map((it) => it.domain)).toEqual(['ai', 'devops']);
  });

  it('cross 候選未回填 domain → 預設 ai，並回呼 onDomainDefaulted(ref, title)', () => {
    const candidates = [makeCandidate({ originalUrl: 'https://jev.com', domain: 'cross', score: 1979 })];
    const officialPicks: CurationLlmPick[] = [{ ref: 0, title: 'Jev', content: 'c' }];
    const defaulted: [number, string][] = [];

    const result = validateCuration(officialPicks, [], candidates, undefined, (ref, title) => defaulted.push([ref, title]));

    expect(result[0].domain).toBe('ai');
    expect(defaulted).toEqual([[0, 'Jev']]);
  });

  it('非 cross 候選的 domain 由程式歸類決定，LLM 帶的 domain 一律忽略、不觸發 onDomainDefaulted', () => {
    const candidates = [makeCandidate({ originalUrl: 'https://a.com', domain: 'ai' })];
    const officialPicks: CurationLlmPick[] = [{ ref: 0, title: 'A', content: 'c', domain: 'devops' }];
    const defaulted: number[] = [];

    const result = validateCuration(officialPicks, [], candidates, undefined, (ref) => defaulted.push(ref));

    expect(result[0].domain).toBe('ai');
    expect(defaulted).toEqual([]);
  });

  it('cross 候選回填 devops 後受非 AI 上限約束（AI 10 則 + cross→devops 6 則 → 非 AI 夾至 5）', () => {
    const ai = Array.from({ length: 10 }, (_, i) => makeCandidate({ originalUrl: `https://ai${i}.com`, domain: 'ai' }));
    const cross = Array.from({ length: 6 }, (_, i) =>
      makeCandidate({ originalUrl: `https://x${i}.com`, domain: 'cross', score: 500, sourceId: `s${i}`, sources: [`s${i}`] }),
    );
    const candidates = [...ai, ...cross];
    const officialPicks: CurationLlmPick[] = candidates.map((c, i) => ({
      ref: i,
      title: `t${i}`,
      content: 'c',
      ...(c.domain === 'cross' ? { domain: 'devops' as const } : {}),
    }));

    const result = validateCuration(officialPicks, [], candidates);

    expect(result.filter((it) => it.domain === 'devops')).toHaveLength(5);
    expect(result).toHaveLength(15);
  });
});
