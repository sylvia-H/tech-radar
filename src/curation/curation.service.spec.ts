import { LlmService } from '../llm/llm.service';
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
  it('代表性候選＋合規 mock 回應 → ≤6 則、繁中字數/配額合規、對回候選、只呼叫 LLM 一次（SC-001~005）', async () => {
    const candidates: NewsCandidate[] = [
      makeCandidate({ originalUrl: 'https://a.com/ai1', domain: 'ai', title: 'AI news 1' }),
      makeCandidate({ originalUrl: 'https://b.com/ai2', domain: 'ai', title: 'AI news 2' }),
      makeCandidate({ originalUrl: 'https://c.com/ai3', domain: 'ai', title: 'AI news 3' }),
      makeCandidate({ originalUrl: 'https://d.com/ai4', domain: 'ai', title: 'AI news 4' }),
      makeCandidate({ originalUrl: 'https://e.com/devops1', domain: 'devops', title: 'DevOps news' }),
    ];
    const raw = JSON.stringify({
      picks: [
        { ref: 0, title: '繁中標題一', content: '繁中內容一' },
        { ref: 1, title: '繁中標題二', content: '繁中內容二' },
        { ref: 2, title: '繁中標題三', content: '繁中內容三' },
        { ref: 3, title: '繁中標題四', content: '繁中內容四' },
        { ref: 4, title: '繁中標題五', content: '繁中內容五' },
      ],
    });
    const generate = jest.fn().mockResolvedValue(raw);
    const { service } = makeService(generate);

    const result = await service.curate(candidates, new Set());

    expect(result.degraded).toBe(false);
    expect(result.items.length).toBeLessThanOrEqual(6);
    for (const item of result.items) {
      expect([...item.title].length).toBeLessThanOrEqual(50);
      expect(item.content && [...item.content].length).toBeLessThanOrEqual(300);
    }
    const nonAiCount = result.items.filter((it) => it.domain !== 'ai').length;
    expect(nonAiCount).toBeLessThanOrEqual(2);
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
    const raw = JSON.stringify({ picks: [{ ref: 0, title: '同一事件', content: '內容' }] });
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
    const raw = JSON.stringify({ picks: [] });
    const { service, generate } = makeService(jest.fn().mockResolvedValue(raw));

    await service.curate(candidates, new Set());

    expect(generate).toHaveBeenCalledTimes(1);
    const prompt: string = generate.mock.calls[0][0];
    expect(typeof prompt).toBe('string');
    expect(prompt).not.toMatch(/GEMINI_API_KEY|DISCORD_WEBHOOK_URL|GH_API_TOKEN/i);
    expect(prompt).toContain(candidates[0].title);
  });
});
