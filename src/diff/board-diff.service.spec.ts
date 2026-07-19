import { Logger } from '@nestjs/common';
import { BoardDiffService } from './board-diff.service';
import { emptyBoardState } from '../state/state.schema';
import { CurrentBoard, Domain, DomainBoard } from '../board/board.types';

/** 以純物件 mock 三個相依（不經 Nest DI 容器）。 */
function makeDeps() {
  const stateStore = { load: jest.fn(), save: jest.fn() };
  const boardBuilder = { build: jest.fn() };
  const discord = { postFailureAlert: jest.fn() };
  return { stateStore, boardBuilder, discord };
}

function service(deps: ReturnType<typeof makeDeps>): BoardDiffService {
  return new BoardDiffService(
    deps.stateStore as never,
    deps.boardBuilder as never,
    deps.discord as never,
  );
}

function currentBoard(rows: { repoId: number; domain: Domain; weekly: number }[]): CurrentBoard {
  const byDomain: Record<Domain, DomainBoard> = {
    ai: { domain: 'ai', entries: [] },
    'frontend-backend': { domain: 'frontend-backend', entries: [] },
  };
  for (const r of rows) {
    byDomain[r.domain].entries.push({
      rank: byDomain[r.domain].entries.length + 1,
      repoId: r.repoId,
      fullName: `o/r${r.repoId}`,
      url: `https://github.com/o/r${r.repoId}`,
      domain: r.domain,
      weeklyStarsEstimate: r.weekly,
      starsThisWeek: null,
      totalStars: null,
      language: null,
      sources: ['trending'],
      description: null,
      topics: [],
    });
  }
  return {
    builtAt: '2026-07-15T00:00:00.000Z',
    boards: [byDomain.ai, byDomain['frontend-backend']],
    apiCalls: { core: 1, search: 1 },
  };
}

const NOW = new Date('2026-07-15T00:00:00.000Z');

describe('BoardDiffService.runBoardSegment — 空榜中止（US1, FR-025/SC-010）', () => {
  let logSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('本次綜合榜為空 → 發告警、回 aborted、不 commit、不擲錯、不中斷', async () => {
    const deps = makeDeps();
    deps.stateStore.load.mockResolvedValue(emptyBoardState()); // lastBoardPushAt=null → 到期
    deps.boardBuilder.build.mockResolvedValue(currentBoard([])); // 兩領域皆空
    deps.discord.postFailureAlert.mockResolvedValue(undefined);

    const result = await service(deps).runBoardSegment(NOW);

    expect(result).toEqual({ status: 'aborted' });
    expect(deps.discord.postFailureAlert).toHaveBeenCalledTimes(1);
    expect(String(deps.discord.postFailureAlert.mock.calls[0][0])).toContain('榜單為空');
    expect(deps.stateStore.save).not.toHaveBeenCalled();
  });

  it('告警送出本身失敗 → 僅記 log、仍回 aborted、不擲錯（憲章 VII）', async () => {
    const deps = makeDeps();
    deps.stateStore.load.mockResolvedValue(emptyBoardState());
    deps.boardBuilder.build.mockResolvedValue(currentBoard([]));
    deps.discord.postFailureAlert.mockRejectedValue(new Error('webhook down'));

    const result = await service(deps).runBoardSegment(NOW);

    expect(result).toEqual({ status: 'aborted' });
    expect(deps.stateStore.save).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
  });
});

describe('BoardDiffService.runBoardSegment — 節奏 guard（US2）', () => {
  let logSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    jest.restoreAllMocks();
  });

  const HOUR_MS = 3_600_000;

  it('未到期 → skipped、不進行任何榜單抓取（build 零呼叫）、狀態不變（FR-018＋憲章 I）', async () => {
    const deps = makeDeps();
    deps.stateStore.load.mockResolvedValue({
      ...emptyBoardState(),
      lastBoardPushAt: new Date(NOW.getTime() - HOUR_MS).toISOString(), // 1 小時前 → 未到期
    });

    const result = await service(deps).runBoardSegment(NOW);

    expect(result).toEqual({ status: 'skipped' });
    expect(deps.boardBuilder.build).not.toHaveBeenCalled();
    expect(deps.stateStore.save).not.toHaveBeenCalled();
  });

  it('clock-anomaly（時間戳晚於當前）→ 發紅色告警後照常執行榜單段（FR-019a）', async () => {
    const deps = makeDeps();
    deps.stateStore.load.mockResolvedValue({
      ...emptyBoardState(),
      lastBoardPushAt: new Date(NOW.getTime() + HOUR_MS).toISOString(), // 未來時間
    });
    deps.boardBuilder.build.mockResolvedValue(
      currentBoard([{ repoId: 1, domain: 'ai', weekly: 500 }]),
    );
    deps.discord.postFailureAlert.mockResolvedValue(undefined);
    deps.stateStore.save.mockResolvedValue(undefined);

    const result = await service(deps).runBoardSegment(NOW);

    expect(result.status).toBe('ok');
    expect(deps.boardBuilder.build).toHaveBeenCalledTimes(1); // 照常抓取
    expect(deps.discord.postFailureAlert).toHaveBeenCalledTimes(1);
    expect(String(deps.discord.postFailureAlert.mock.calls[0][0])).toContain('時鐘');
  });
});

describe('BoardDiffService.runBoardSegment — 交付成功後才寫回（US3）', () => {
  let errSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('交付成功 → commit + save 各一次；快照 ≤10、lastBoardPushAt=now 同次寫入（FR-020/FR-021）', async () => {
    const deps = makeDeps();
    deps.stateStore.load.mockResolvedValue(emptyBoardState()); // null → 到期（no-timestamp）
    deps.boardBuilder.build.mockResolvedValue(
      currentBoard([
        { repoId: 1, domain: 'ai', weekly: 900 },
        { repoId: 2, domain: 'frontend-backend', weekly: 300 },
      ]),
    );
    deps.stateStore.save.mockResolvedValue(undefined);

    const result = await service(deps).runBoardSegment(NOW);

    expect(result.status).toBe('ok');
    expect(deps.stateStore.save).toHaveBeenCalledTimes(1);
    const saved = deps.stateStore.save.mock.calls[0][0];
    expect(saved.lastBoardPushAt).toBe(NOW.toISOString());
    expect(Object.keys(saved.board).sort()).toEqual(['1', '2']);
  });

  it('交付失敗（diff log 輸出擲錯）→ save 零呼叫、狀態不變（SC-006）', async () => {
    const deps = makeDeps();
    deps.stateStore.load.mockResolvedValue(emptyBoardState());
    deps.boardBuilder.build.mockResolvedValue(
      currentBoard([{ repoId: 1, domain: 'ai', weekly: 900 }]),
    );
    // 讓變化結果的 log 輸出擲錯（節奏 log 照常），模擬「交付失敗」。
    jest.spyOn(Logger.prototype, 'log').mockImplementation((msg?: unknown) => {
      if (typeof msg === 'string' && msg.includes('綜合')) {
        throw new Error('log sink down');
      }
    });

    await expect(service(deps).runBoardSegment(NOW)).rejects.toThrow();
    expect(deps.stateStore.save).not.toHaveBeenCalled();
  });

  it('空榜中止 → save 零呼叫（SC-010）', async () => {
    const deps = makeDeps();
    deps.stateStore.load.mockResolvedValue(emptyBoardState());
    deps.boardBuilder.build.mockResolvedValue(currentBoard([]));
    deps.discord.postFailureAlert.mockResolvedValue(undefined);

    await service(deps).runBoardSegment(NOW);
    expect(deps.stateStore.save).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled(); // 告警成功時不記 error
  });

  it('未到期跳過 → save 零呼叫（US2 場景 1）', async () => {
    const deps = makeDeps();
    deps.stateStore.load.mockResolvedValue({
      ...emptyBoardState(),
      lastBoardPushAt: new Date(NOW.getTime() - 3_600_000).toISOString(),
    });

    await service(deps).runBoardSegment(NOW);
    expect(deps.stateStore.save).not.toHaveBeenCalled();
  });
});
