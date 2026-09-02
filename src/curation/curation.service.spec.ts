import { Logger } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { LlmError } from '../llm/llm.types';
import { NewsCandidate } from '../news/news.types';
import { NewsCurationService } from './curation.service';

function makeCandidate(overrides: Partial<NewsCandidate> = {}): NewsCandidate {
  return {
    title: 'Original Title',
    normalizedUrl: 'example.com/a',
    originalUrl: 'https://example.com/a',
    summary: '一段公開摘要節錄',
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

function makeService(generate: jest.Mock): { service: NewsCurationService; generate: jest.Mock } {
  const llm = { generate } as unknown as LlmService;
  return { service: new NewsCurationService(llm), generate };
}

describe('NewsCurationService.curate（US1 成功路徑）', () => {
  it('代表性候選＋合規 mock 回應 → ≤10 則、繁中字數/配額合規、對回候選、只呼叫 LLM 一次（SC-001~005）', async () => {
    const candidates: NewsCandidate[] = [
      makeCandidate({ originalUrl: 'https://a.com/ai1', domain: 'ai', title: 'AI news 1' }),
      makeCandidate({ originalUrl: 'https://b.com/ai2', domain: 'ai', title: 'AI news 2' }),
      makeCandidate({ originalUrl: 'https://c.com/ai3', domain: 'ai', title: 'AI news 3' }),
      makeCandidate({ originalUrl: 'https://d.com/ai4', domain: 'ai', title: 'AI news 4' }),
      makeCandidate({ originalUrl: 'https://e.com/devops1', domain: 'devops', title: 'DevOps news' }),
    ];
    const raw = JSON.stringify({
      officialPicks: [
        { ref: 0, title: '繁中標題一', content: '繁中內容一' },
        { ref: 1, title: '繁中標題二', content: '繁中內容二' },
        { ref: 2, title: '繁中標題三', content: '繁中內容三' },
        { ref: 3, title: '繁中標題四', content: '繁中內容四' },
      ],
      communityPicks: [{ ref: 4, title: '繁中標題五', content: '繁中內容五' }],
    });
    const generate = jest.fn().mockResolvedValue(raw);
    const { service } = makeService(generate);

    const result = await service.curate(candidates, new Set());

    expect(result.degraded).toBe(false);
    expect(result.items.length).toBeLessThanOrEqual(10);
    for (const item of result.items) {
      expect([...item.title].length).toBeLessThanOrEqual(70);
      expect(item.content && [...item.content].length).toBeLessThanOrEqual(500);
    }
    const nonAiCount = result.items.filter((it) => it.domain !== 'ai').length;
    expect(nonAiCount).toBeLessThanOrEqual(3);
    for (const item of result.items) {
      expect(candidates.some((c) => c.originalUrl === item.url)).toBe(true);
    }
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('殘留語意重複輸入＋mock 只選一次 → 最終該事件 ≤1（SC-006）', async () => {
    const candidates: NewsCandidate[] = [
      makeCandidate({ originalUrl: 'https://a.com/event', domain: 'ai', title: 'Same event via source A' }),
      makeCandidate({ originalUrl: 'https://b.com/event', domain: 'ai', title: 'Same event via source B' }),
    ];
    const raw = JSON.stringify({ officialPicks: [{ ref: 0, title: '同一事件', content: '內容' }], communityPicks: [] });
    const { service } = makeService(jest.fn().mockResolvedValue(raw));

    const result = await service.curate(candidates, new Set());

    expect(result.items).toHaveLength(1);
  });

  it('空候選 → 空 items、degraded:false、呼叫次數 = 0（FR-020/SC-001）', async () => {
    const { service, generate } = makeService(jest.fn());

    const result = await service.curate([], new Set());

    expect(result).toEqual({ items: [], degraded: false });
    expect(generate).not.toHaveBeenCalled();
  });

  it('送交 LLM 的 prompt 僅由公開欄位組成、不含機密（C1、FR-007）', async () => {
    const candidates: NewsCandidate[] = [makeCandidate()];
    const raw = JSON.stringify({ officialPicks: [], communityPicks: [] });
    const { service, generate } = makeService(jest.fn().mockResolvedValue(raw));

    await service.curate(candidates, new Set());

    expect(generate).toHaveBeenCalledTimes(1);
    const prompt: string = generate.mock.calls[0][0];
    expect(typeof prompt).toBe('string');
    expect(prompt).not.toMatch(
      /GEMINI_API_KEY|DISCORD_(NEWS|BOARD|ALERT)_WEBHOOK_URL|GH_API_TOKEN/i,
    );
    expect(prompt).toContain(candidates[0].title);
  });

  it('prompt 為每則候選標示發表天齡（依注入的 now 計算；缺 publishedAt 標「日期不明」，2026-09-02）', async () => {
    const candidates: NewsCandidate[] = [
      makeCandidate({ normalizedUrl: 'example.com/aged', publishedAt: '2026-07-18T06:00:00.000Z' }), // 3 天又 18 小時前 → 3 天
      makeCandidate({ normalizedUrl: 'example.com/undated', publishedAt: null }),
      makeCandidate({ normalizedUrl: 'example.com/future', publishedAt: '2026-07-30T00:00:00.000Z' }), // 未來 → 夾 0
    ];
    const raw = JSON.stringify({ officialPicks: [], communityPicks: [] });
    const { service, generate } = makeService(jest.fn().mockResolvedValue(raw));

    await service.curate(candidates, new Set(), new Date('2026-07-22T00:00:00.000Z'));

    const prompt: string = generate.mock.calls[0][0];
    expect(prompt).toContain('/3 天前)');
    expect(prompt).toContain('/日期不明)');
    expect(prompt).toContain('/0 天前)');
    expect(prompt).toContain('重要性相當時優先較新者');
  });

  it('候選全為非 AI → 照實輸出非 AI（受 ≤3 約束），不因湊不到 5 則 AI 而失敗（Edge）', async () => {
    const candidates: NewsCandidate[] = [
      makeCandidate({ originalUrl: 'https://devops.com', domain: 'devops', title: 'DevOps only' }),
      makeCandidate({ originalUrl: 'https://fe.com', domain: 'frontend-backend', title: 'Frontend only' }),
    ];
    const raw = JSON.stringify({
      officialPicks: [
        { ref: 0, title: '繁中 DevOps', content: '內容' },
        { ref: 1, title: '繁中前端', content: '內容' },
      ],
      communityPicks: [],
    });
    const { service } = makeService(jest.fn().mockResolvedValue(raw));

    const result = await service.curate(candidates, new Set());

    expect(result.degraded).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(result.items.every((it) => it.domain !== 'ai')).toBe(true);
  });
});

describe('NewsCurationService.curate（US2 降級路徑）', () => {
  const cases: Array<[string, () => Promise<string>]> = [
    ['LlmError(exhausted)', () => Promise.reject(new LlmError('exhausted'))],
    ['LlmError(empty)', () => Promise.reject(new LlmError('empty'))],
    ['不可解析內容', () => Promise.resolve('這不是 JSON')],
  ];

  it.each(cases)('%s → 回 degraded:true digest、未擲錯、logger.warn 被呼叫（FR-011/014、SC-004）', async (_label, mockImpl) => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const candidates: NewsCandidate[] = [makeCandidate({ originalUrl: 'https://a.com', weightedScore: 200 })];
    const { service } = makeService(jest.fn().mockImplementation(mockImpl));

    const result = await service.curate(candidates, new Set());

    expect(result.degraded).toBe(true);
    expect(result.items).toEqual([
      { title: 'Original Title', content: null, url: 'https://a.com', domain: 'ai', sourceCount: 1, weightedScore: 200, degraded: true },
    ]);
    expect(warnSpy).toHaveBeenCalled();
    const warnMessage = warnSpy.mock.calls[0][0] as string;
    expect(warnMessage).not.toMatch(/這不是 JSON|prompt/i);
    warnSpy.mockRestore();
  });
});
