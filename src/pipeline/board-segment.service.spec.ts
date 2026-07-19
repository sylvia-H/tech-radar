import { BoardSegmentService } from './board-segment.service';
import { BoardBuilderService } from '../board/board-builder.service';
import { DiscordWebhookService } from '../discord/discord.webhook.service';
import { IntroService } from '../intro/intro.service';
import { BoardSummaryService } from '../curation/board-summary.service';
import { StateStore } from '../state/state.store';
import { BoardState, emptyBoardState, BoardEntry } from '../state/state.schema';
import { BoardRow, CurrentBoard, Domain } from '../board/board.types';
import { IntroResult } from '../intro/intro.types';

const NOW = new Date('2026-07-19T00:00:00.000Z');
const HOUR_MS = 3_600_000;

function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * HOUR_MS).toISOString();
}

function row(overrides: Partial<BoardRow> & { repoId: number }): BoardRow {
  return {
    rank: 1,
    fullName: `acme/r${overrides.repoId}`,
    url: `https://github.com/acme/r${overrides.repoId}`,
    domain: 'ai',
    weeklyStarsEstimate: 100,
    starsThisWeek: 100,
    totalStars: 1000,
    language: null,
    sources: ['trending'],
    description: null,
    topics: [],
    ...overrides,
  };
}

function entry(overrides: Partial<BoardEntry> & { rank: number }): BoardEntry {
  return {
    fullName: 'acme/prev',
    url: 'https://github.com/acme/prev',
    language: null,
    domain: 'ai',
    starsThisWeek: 100,
    firstSeenAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

/** 建構「新進 id1、竄升 id2、下降 id3、掉出 id4（不出現於本次 boards）」的固定情境。 */
function makeCurrentBoard(): CurrentBoard {
  const ai: BoardRow[] = [
    row({ repoId: 1, fullName: 'acme/newai', weeklyStarsEstimate: 9000, starsThisWeek: 9000, totalStars: 5000, domain: 'ai', description: 'new ai thing', topics: ['llm'], language: 'Python' }),
    row({ repoId: 2, fullName: 'acme/climber', weeklyStarsEstimate: 8000, starsThisWeek: 8000, totalStars: 3000, domain: 'ai', description: 'climb thing', topics: ['rag'], language: 'Go' }),
  ];
  const fe: BoardRow[] = [
    row({ repoId: 3, fullName: 'acme/decliner', weeklyStarsEstimate: 100, starsThisWeek: 100, totalStars: 1000, domain: 'frontend-backend', description: 'decline thing', topics: [], language: 'TypeScript' }),
  ];
  return {
    builtAt: NOW.toISOString(),
    boards: [
      { domain: 'ai' as Domain, entries: ai },
      { domain: 'frontend-backend' as Domain, entries: fe },
    ],
    apiCalls: { core: 1, search: 1 },
  };
}

function makePrevBoardState(): BoardState {
  return {
    ...emptyBoardState(),
    lastBoardPushAt: hoursAgo(200), // >162h，到期
    board: {
      '2': entry({ fullName: 'acme/climber', domain: 'ai', rank: 5 }),
      '3': entry({ fullName: 'acme/decliner', domain: 'frontend-backend', rank: 1 }),
      '4': entry({ fullName: 'acme/dropped', domain: 'ai', rank: 2 }), // 本次不在 boards → 掉出
    },
  };
}

interface Mocks {
  service: BoardSegmentService;
  build: jest.Mock;
  send: jest.Mock;
  postFailureAlert: jest.Mock;
  ensureIntro: jest.Mock;
  summarize: jest.Mock;
  save: jest.Mock;
}

function makeMocks(currentBoard: CurrentBoard = makeCurrentBoard()): Mocks {
  const build = jest.fn().mockResolvedValue(currentBoard);
  const send = jest.fn().mockResolvedValue(undefined);
  const postFailureAlert = jest.fn().mockResolvedValue(undefined);
  const ensureIntro = jest.fn().mockImplementation(async (input): Promise<IntroResult> => {
    if (input.repoId === 1) {
      return { status: 'degraded', description: input.description };
    }
    return { status: 'cached', intro: `intro-for-${input.repoId}` };
  });
  const summarize = jest.fn().mockResolvedValue({ summary: 'AI 沙箱工具爆紅進榜', degraded: false });
  const save = jest.fn().mockResolvedValue(undefined);

  const boardBuilder = { build } as unknown as BoardBuilderService;
  const discord = { send, postFailureAlert } as unknown as DiscordWebhookService;
  const introService = { ensureIntro } as unknown as IntroService;
  const boardSummary = { summarize } as unknown as BoardSummaryService;
  const stateStore = { save } as unknown as StateStore;

  const service = new BoardSegmentService(boardBuilder, discord, introService, boardSummary, stateStore);
  return { service, build, send, postFailureAlert, ensureIntro, summarize, save };
}

describe('BoardSegmentService.run — cadence（沿用 F3 decideCadence）', () => {
  it('未到期（<162h）→ 早退 skipped，不 build/送/存', async () => {
    const { service, build, send, save } = makeMocks();
    const state = { ...emptyBoardState(), lastBoardPushAt: hoursAgo(10) };

    const result = await service.run(state, NOW);

    expect(result).toEqual({ status: 'skipped' });
    expect(build).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('clock-anomaly（未來時間戳）→ 告警但照常執行', async () => {
    const { service, build, postFailureAlert } = makeMocks();
    const futureTs = new Date(NOW.getTime() + HOUR_MS).toISOString();
    const state = { ...emptyBoardState(), lastBoardPushAt: futureTs };

    await service.run(state, NOW);

    expect(build).toHaveBeenCalledTimes(1); // 照常執行
    expect(postFailureAlert).toHaveBeenCalledWith(expect.stringContaining('時鐘異常'));
  });

  it('空榜（pushBoard 為空）→ 告警並中止 aborted，不 diff/commit', async () => {
    const emptyBoard: CurrentBoard = {
      builtAt: NOW.toISOString(),
      boards: [
        { domain: 'ai', entries: [] },
        { domain: 'frontend-backend', entries: [] },
      ],
      apiCalls: { core: 0, search: 0 },
    };
    const { service, send, postFailureAlert, save } = makeMocks(emptyBoard);
    const state = { ...emptyBoardState(), lastBoardPushAt: hoursAgo(200) };

    const result = await service.run(state, NOW);

    expect(result).toEqual({ status: 'aborted' });
    expect(postFailureAlert).toHaveBeenCalledWith(expect.stringContaining('榜單為空'));
    expect(send).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});

describe('BoardSegmentService.run — US3 Acceptance（榜單日疊加、push-then-commit）', () => {
  it('Acceptance 1：新進/竄升取得簡介、F6 封面 TL;DR、組出封面＋每項一張卡並推播', async () => {
    const { service, send, ensureIntro, summarize } = makeMocks();
    const state = makePrevBoardState();

    const result = await service.run(state, NOW);

    expect(result.status).toBe('ok');
    expect(ensureIntro).toHaveBeenCalledTimes(2); // 僅 newcomer(1) + climbed(2)，declined(3) 不取
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1); // 3 個 embeds ≤10，一批送出

    const payload = send.mock.calls[0][0];
    expect(payload.embeds).toHaveLength(3); // 封面 + 2 張卡（新進+竄升）
    expect(payload.embeds[0].title).toContain('📊 榜單變化');
  });

  it('Acceptance 4：簡介降級（repoId 1）以可區分的 description 卡呈現，榜單仍照常推播', async () => {
    const { service, send } = makeMocks();
    const state = makePrevBoardState();

    await service.run(state, NOW);

    const payload = send.mock.calls[0][0];
    const newcomerCard = payload.embeds.find((e: { title: string }) => e.title.includes('acme/newai'));
    expect(newcomerCard.description).toBe('（簡介暫缺）new ai thing');
    const climbedCard = payload.embeds.find((e: { title: string }) => e.title.includes('acme/climber'));
    expect(climbedCard.description).toBe('intro-for-2'); // 正常簡介卡，無「（簡介暫缺）」前綴
  });

  it('Acceptance 5：下降以一行式列封面；掉出 top10 者（id4）當次靜默不列、不出卡', async () => {
    const { service, send } = makeMocks();
    const state = makePrevBoardState();

    await service.run(state, NOW);

    const payload = send.mock.calls[0][0];
    const cover = payload.embeds[0];
    expect(cover.description).toContain('🔻 下降');
    expect(cover.description).toContain('acme/decliner');
    expect(cover.description).toContain('#1 → #3');
    expect(cover.description).not.toContain('acme/dropped');
    expect(payload.embeds.some((e: { title: string }) => e.title.includes('acme/dropped'))).toBe(false);
    expect(payload.embeds).toHaveLength(3); // 無下降卡（declined 不需簡介，不出卡）
  });

  it('Acceptance 2：推播成功 → board+lastBoardPushAt+intros 同一次原子 save', async () => {
    const { service, save } = makeMocks();
    const state = makePrevBoardState();

    const result = await service.run(state, NOW);

    expect(result.status).toBe('ok');
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(state); // Object.assign 回寫同一物件
    expect(state.lastBoardPushAt).toBe(NOW.toISOString());
    expect(Object.keys(state.board).sort()).toEqual(['1', '2', '3']); // 掉出的 "4" 不在新快照
  });

  it('Acceptance 3：推播失敗 → board/lastBoardPushAt/intros 逐位元組不變、不 save、發紅色告警；本次已生成的簡介不落檔', async () => {
    const before = makePrevBoardState();
    const state = JSON.parse(JSON.stringify(before)) as BoardState;

    const build = jest.fn().mockResolvedValue(makeCurrentBoard());
    const send = jest.fn().mockRejectedValue(new Error('Discord webhook 推播失敗，HTTP 500'));
    const postFailureAlert = jest.fn().mockResolvedValue(undefined);
    const ensureIntro = jest.fn().mockImplementation(async (input, s: BoardState): Promise<IntroResult> => {
      // 模擬 IntroService 真實行為：'generated' 案例會就地寫入 state.intros（本測試故意製造需還原的副作用）。
      if (input.repoId === 1) {
        s.intros[String(input.repoId)] = { intro: '剛生成但尚未推出', introAt: NOW.toISOString() };
        return { status: 'generated', intro: '剛生成但尚未推出', introAt: NOW.toISOString() };
      }
      return { status: 'cached', intro: `intro-for-${input.repoId}` };
    });
    const summarize = jest.fn().mockResolvedValue({ summary: 'x', degraded: false });
    const save = jest.fn().mockResolvedValue(undefined);

    const service = new BoardSegmentService(
      { build } as unknown as BoardBuilderService,
      { send, postFailureAlert } as unknown as DiscordWebhookService,
      { ensureIntro } as unknown as IntroService,
      { summarize } as unknown as BoardSummaryService,
      { save } as unknown as StateStore,
    );

    const result = await service.run(state, NOW);

    expect(result).toEqual({ status: 'push-failed' });
    expect(state).toEqual(before); // 逐位元組不變（含 intros 已還原，不含剛生成的簡介）
    expect(save).not.toHaveBeenCalled();
    expect(postFailureAlert).toHaveBeenCalledWith(expect.stringContaining('榜單推播失敗'));
  });

  it('Acceptance 3b：send 成功但 save 擲錯 → 共享 state 逐位元組還原（board/lastBoardPushAt 未外溢、intros 還原），不外溢至晨報段 save', async () => {
    const before = makePrevBoardState();
    const state = JSON.parse(JSON.stringify(before)) as BoardState;

    const build = jest.fn().mockResolvedValue(makeCurrentBoard());
    const send = jest.fn().mockResolvedValue(undefined); // 推播成功
    const postFailureAlert = jest.fn().mockResolvedValue(undefined);
    const ensureIntro = jest.fn().mockImplementation(async (input, s: BoardState): Promise<IntroResult> => {
      if (input.repoId === 1) {
        s.intros[String(input.repoId)] = { intro: '已推出但落檔失敗', introAt: NOW.toISOString() };
        return { status: 'generated', intro: '已推出但落檔失敗', introAt: NOW.toISOString() };
      }
      return { status: 'cached', intro: `intro-for-${input.repoId}` };
    });
    const summarize = jest.fn().mockResolvedValue({ summary: 'x', degraded: false });
    const save = jest.fn().mockRejectedValue(new Error('disk full')); // 落檔失敗

    const service = new BoardSegmentService(
      { build } as unknown as BoardBuilderService,
      { send, postFailureAlert } as unknown as DiscordWebhookService,
      { ensureIntro } as unknown as IntroService,
      { summarize } as unknown as BoardSummaryService,
      { save } as unknown as StateStore,
    );

    const result = await service.run(state, NOW);

    expect(result).toEqual({ status: 'push-failed' });
    // 關鍵：save 擲錯後，共享 state 不得殘留已 commit 的 board/lastBoardPushAt（否則晨報段 save 會把
    // 這個「未成功落檔的榜單推播」外溢寫入）；intros 亦還原。逐位元組等於 before。
    expect(state).toEqual(before);
    expect(state.lastBoardPushAt).toBe(before.lastBoardPushAt);
    expect(Object.keys(state.board).sort()).toEqual(['2', '3', '4']); // 仍是舊快照，未變成新 ['1','2','3']
    expect(postFailureAlert).toHaveBeenCalledWith(expect.stringContaining('榜單推播失敗'));
  });
});

describe('BoardSegmentService.run — US5 版面整合（T020：冷啟動拆分，段內獨立切分）', () => {
  it('冷啟動（全數新進，10 張卡）→ 封面＋10 卡＝11 個 embeds → send 呼叫 2 次（10+1），順序保持、無遺漏無重複', async () => {
    const ai: BoardRow[] = Array.from({ length: 10 }, (_, i) =>
      row({
        repoId: i + 1,
        fullName: `acme/newcomer-${i + 1}`,
        weeklyStarsEstimate: 10000 - i * 100, // 遞減，決定唯一順序
        starsThisWeek: 10000 - i * 100,
        domain: 'ai',
        description: `desc-${i + 1}`,
        topics: [],
        language: 'Rust',
      }),
    );
    const currentBoard: CurrentBoard = {
      builtAt: NOW.toISOString(),
      boards: [
        { domain: 'ai' as Domain, entries: ai },
        { domain: 'frontend-backend' as Domain, entries: [] },
      ],
      apiCalls: { core: 1, search: 0 },
    };
    const { service, send } = makeMocks(currentBoard);
    const state = { ...emptyBoardState(), lastBoardPushAt: null }; // 冷啟動：無時間戳、無 prev board → 全數新進

    const result = await service.run(state, NOW);

    expect(result.status).toBe('ok');
    expect(send).toHaveBeenCalledTimes(2); // 11 個 embeds → 2 批（10+1）

    const batch1 = send.mock.calls[0][0].embeds;
    const batch2 = send.mock.calls[1][0].embeds;
    expect(batch1).toHaveLength(10);
    expect(batch2).toHaveLength(1);

    // 顯示順序保持：封面在最前，卡片依序（新進以 weeklyStarsEstimate 降序排入 pushBoard）。
    expect(batch1[0].title).toContain('📊 榜單變化');
    const allCardTitles = [...batch1.slice(1), ...batch2].map((e: { title: string }) => e.title);
    expect(allCardTitles).toHaveLength(10); // 10 張卡、無遺漏無重複
    expect(new Set(allCardTitles).size).toBe(10); // 無重複
  });
});
