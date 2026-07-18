import { Logger } from '@nestjs/common';
import { GithubHttpService } from '../github/github-http';
import { LlmService } from '../llm/llm.service';
import { LlmError } from '../llm/llm.types';
import { emptyBoardState } from '../state/state.schema';
import { IntroService } from './intro.service';
import { IntroInput } from './intro.types';

function makeInput(overrides: Partial<IntroInput> = {}): IntroInput {
  return {
    repoId: 123,
    fullName: 'owner/repo',
    description: 'A sample repo for testing',
    language: 'TypeScript',
    topics: ['cli', 'tooling'],
    starsThisWeek: 42,
    ...overrides,
  };
}

function base64Readme(md: string): { content: string; encoding: string } {
  return { content: Buffer.from(md, 'utf-8').toString('base64'), encoding: 'base64' };
}

function makeService(opts: { generate?: jest.Mock; getJson?: jest.Mock }): {
  service: IntroService;
  llm: { generate: jest.Mock };
  http: { getJson: jest.Mock };
} {
  const llm = { generate: opts.generate ?? jest.fn() };
  const http = { getJson: opts.getJson ?? jest.fn() };
  const service = new IntroService(llm as unknown as LlmService, http as unknown as GithubHttpService);
  return { service, llm, http };
}

const FIXED_NOW = () => new Date('2026-07-18T00:00:00.000Z');

describe('IntroService.ensureIntro', () => {
  it('快取未命中 + README 可取 → 回 generated、寫入 state.intros（US1、FR-004）', async () => {
    const readme = '# Repo\n' + 'x'.repeat(300);
    const { service } = makeService({
      generate: jest.fn().mockResolvedValue('一段忠於素材的繁中簡介。'),
      getJson: jest.fn().mockResolvedValue(base64Readme(readme)),
    });
    const state = emptyBoardState();

    const result = await service.ensureIntro(makeInput(), state, FIXED_NOW);

    expect(result.status).toBe('generated');
    if (result.status !== 'generated') throw new Error('unreachable');
    expect([...result.intro].length).toBeLessThanOrEqual(250);
    expect(result.introAt).toBe('2026-07-18T00:00:00.000Z');
    expect(state.intros['123']).toEqual({ intro: result.intro, introAt: result.introAt });
  });

  it('快取命中 → 回 cached，LLM/README 呼叫次數 = 0（SC-001、FR-002）', async () => {
    const { service, llm, http } = makeService({});
    const state = emptyBoardState();
    state.intros['123'] = { intro: '既有快取簡介', introAt: '2026-07-01T00:00:00.000Z' };

    const result = await service.ensureIntro(makeInput(), state, FIXED_NOW);

    expect(result).toEqual({ status: 'cached', intro: '既有快取簡介' });
    expect(llm.generate).not.toHaveBeenCalled();
    expect(http.getJson).not.toHaveBeenCalled();
  });

  it('掉出後重新進榜仍命中既有快取、不重生成（SC-006、FR-005）', async () => {
    const { service, llm } = makeService({});
    const state = emptyBoardState();
    state.intros['123'] = { intro: '曾生成的簡介', introAt: '2026-06-01T00:00:00.000Z' };

    const result = await service.ensureIntro(makeInput(), state, FIXED_NOW);

    expect(result).toEqual({ status: 'cached', intro: '曾生成的簡介' });
    expect(llm.generate).not.toHaveBeenCalled();
  });

  it('快取為空字串視為未命中，重新生成（Edge Case）', async () => {
    const { service, llm } = makeService({
      generate: jest.fn().mockResolvedValue('新生成的簡介'),
      getJson: jest.fn().mockResolvedValue(base64Readme('x'.repeat(300))),
    });
    const state = emptyBoardState();
    state.intros['123'] = { intro: '', introAt: '2026-06-01T00:00:00.000Z' };

    const result = await service.ensureIntro(makeInput(), state, FIXED_NOW);

    expect(result.status).toBe('generated');
    expect(llm.generate).toHaveBeenCalledTimes(1);
  });

  it('同一 repo 於同次執行被請求多次仍只生成一次（Edge Case）', async () => {
    const { service, llm } = makeService({
      generate: jest.fn().mockResolvedValue('生成一次的簡介'),
      getJson: jest.fn().mockResolvedValue(base64Readme('x'.repeat(300))),
    });
    const state = emptyBoardState();

    await service.ensureIntro(makeInput(), state, FIXED_NOW);
    const second = await service.ensureIntro(makeInput(), state, FIXED_NOW);

    expect(llm.generate).toHaveBeenCalledTimes(1);
    expect(second.status).toBe('cached');
  });

  it('README 取不到 → 仍走退回素材生成 ≤250 繁中簡介（US3、SC-002）', async () => {
    const { service } = makeService({
      generate: jest.fn().mockResolvedValue('依 description/topics 生成的簡介'),
      getJson: jest.fn().mockRejectedValue(new Error('404')),
    });
    const state = emptyBoardState();

    const result = await service.ensureIntro(makeInput(), state, FIXED_NOW);

    expect(result.status).toBe('generated');
    if (result.status !== 'generated') throw new Error('unreachable');
    expect([...result.intro].length).toBeLessThanOrEqual(250);
  });

  it('README 極短 → 走退回素材生成', async () => {
    const { service } = makeService({
      generate: jest.fn().mockResolvedValue('依退回素材生成的簡介'),
      getJson: jest.fn().mockResolvedValue(base64Readme('太短了')),
    });
    const state = emptyBoardState();

    const result = await service.ensureIntro(makeInput(), state, FIXED_NOW);
    expect(result.status).toBe('generated');
  });

  it('LLM 持續失敗 → 降級為 degraded＋description、未寫快取、warn 記錄，不擲錯（SC-004、FR-014/015/016）', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service } = makeService({
      generate: jest.fn().mockRejectedValue(new LlmError('exhausted')),
      getJson: jest.fn().mockResolvedValue(base64Readme('x'.repeat(300))),
    });
    const state = emptyBoardState();

    const result = await service.ensureIntro(makeInput(), state, FIXED_NOW);

    expect(result).toEqual({ status: 'degraded', description: 'A sample repo for testing' });
    expect(state.intros['123']).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('降級不影響批次中其餘 repo（呼叫端可續跑，FR-014）', async () => {
    const generate = jest
      .fn()
      .mockRejectedValueOnce(new LlmError('exhausted'))
      .mockResolvedValueOnce('第二個 repo 的簡介');
    const { service } = makeService({
      generate,
      getJson: jest.fn().mockResolvedValue(base64Readme('x'.repeat(300))),
    });
    const state = emptyBoardState();

    const first = await service.ensureIntro(makeInput({ repoId: 1, fullName: 'owner/repo1' }), state, FIXED_NOW);
    const second = await service.ensureIntro(makeInput({ repoId: 2, fullName: 'owner/repo2' }), state, FIXED_NOW);

    expect(first.status).toBe('degraded');
    expect(second.status).toBe('generated');
  });
});
