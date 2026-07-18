import { Logger } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { LlmError } from '../llm/llm.types';
import { BoardSummaryService } from './board-summary.service';
import { BoardChangeDigest } from './board-summary.types';

function makeDigest(overrides: Partial<BoardChangeDigest> = {}): BoardChangeDigest {
  return {
    newcomers: 3,
    climbed: 2,
    declined: 1,
    domainCounts: { ai: 4, 'frontend-backend': 1 },
    topName: 'owner/repo',
    ...overrides,
  };
}

function makeService(generate: jest.Mock): { service: BoardSummaryService; generate: jest.Mock } {
  const llm = { generate } as unknown as LlmService;
  return { service: new BoardSummaryService(llm), generate };
}

describe('BoardSummaryService.summarize（US4）', () => {
  it('LLM 成功 → degraded:false 一句繁中摘要（FR-015）', async () => {
    const { service } = makeService(jest.fn().mockResolvedValue('本週新進 3 個、竄升 2 個，AI 佔多數。'));

    const result = await service.summarize(makeDigest());

    expect(result).toEqual({ summary: '本週新進 3 個、竄升 2 個，AI 佔多數。', degraded: false });
  });

  it('LLM 擲 LlmError → 回 factSummary、degraded:true、未擲錯、logger.warn 被呼叫（FR-016、SC-007）', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const digest = makeDigest({ newcomers: 3, climbed: 2, declined: 1 });
    const { service } = makeService(jest.fn().mockRejectedValue(new LlmError('exhausted')));

    const result = await service.summarize(digest);

    expect(result).toEqual({ summary: '本週 3 個新進、2 個竄升、1 個下降', degraded: true });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('全 0 diff → 「無變化」摘要（US4-3）', async () => {
    const digest = makeDigest({ newcomers: 0, climbed: 0, declined: 0 });
    const { service } = makeService(jest.fn().mockRejectedValue(new LlmError('empty')));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const result = await service.summarize(digest);

    expect(result).toEqual({ summary: '本週榜單無變化', degraded: true });
  });

  it('只依 digest 事實，不杜撰未提供的數字或名稱：prompt 內容須含 digest 事實（憲章 VI）', async () => {
    const digest = makeDigest({ newcomers: 5, climbed: 0, declined: 2, topName: 'foo/bar' });
    const { service, generate } = makeService(jest.fn().mockResolvedValue('一句摘要'));

    await service.summarize(digest);

    const prompt: string = generate.mock.calls[0][0];
    expect(prompt).toContain('5');
    expect(prompt).toContain('foo/bar');
  });
});
