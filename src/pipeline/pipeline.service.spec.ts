import { PipelineService } from './pipeline.service';
import { StateStore } from '../state/state.store';
import { DiscordWebhookService } from '../discord/discord.webhook.service';
import { BoardSegmentService } from './board-segment.service';
import { NewsSegmentService } from './news-segment.service';
import { BoardState, emptyBoardState } from '../state/state.schema';
import { BoardBuilderService } from '../board/board-builder.service';
import { IntroService } from '../intro/intro.service';
import { BoardSummaryService } from '../curation/board-summary.service';
import { NewsIngestService } from '../news/news-ingest.service';
import { NewsCurationService } from '../curation/curation.service';
import { CurrentBoard } from '../board/board.types';
import { NewsCandidate } from '../news/news.types';
import { CuratedDigest } from '../curation/curation.types';

interface Mocks {
  service: PipelineService;
  load: jest.Mock;
  postFailureAlert: jest.Mock;
  boardRun: jest.Mock;
  newsRun: jest.Mock;
}

function makeMocks(): Mocks {
  const load = jest.fn().mockResolvedValue(emptyBoardState());
  const save = jest.fn().mockResolvedValue(undefined);
  const postFailureAlert = jest.fn().mockResolvedValue(undefined);
  const boardRun = jest.fn().mockResolvedValue({ status: 'skipped' });
  const newsRun = jest.fn().mockResolvedValue({ status: 'skipped' });

  const stateStore = { load, save } as unknown as StateStore;
  const discord = { postFailureAlert } as unknown as DiscordWebhookService;
  const boardSegment = { run: boardRun } as unknown as BoardSegmentService;
  const newsSegment = { run: newsRun } as unknown as NewsSegmentService;

  const service = new PipelineService(stateStore, discord, boardSegment, newsSegment);
  return { service, load, postFailureAlert, boardRun, newsRun };
}

describe('PipelineService.run — US4 段間與來源隔離容錯', () => {
  it('Acceptance 1：榜單段擲出未預期錯誤 → 晨報段仍照常執行，榜單段發一則紅色告警', async () => {
    const { service, postFailureAlert, boardRun, newsRun } = makeMocks();
    boardRun.mockRejectedValue(new Error('board build unexpected bug'));

    await service.run();

    expect(newsRun).toHaveBeenCalledTimes(1); // 晨報段仍執行
    expect(postFailureAlert).toHaveBeenCalledWith(expect.stringContaining('榜單段'));
    expect(postFailureAlert).toHaveBeenCalledWith(expect.stringContaining('board build unexpected bug'));
  });

  it('Acceptance 2：晨報段擲出未預期錯誤 → 已完成的榜單段不受影響（不回滾），晨報段發一則紅色告警', async () => {
    const { service, postFailureAlert, boardRun, newsRun } = makeMocks();
    boardRun.mockResolvedValue({ status: 'ok', diff: { changes: [], unchanged: true, topEntry: {}, pushBoard: [] } });
    newsRun.mockRejectedValue(new Error('news ingest unexpected bug'));

    await service.run();

    expect(boardRun).toHaveBeenCalledTimes(1); // 已執行完成，未被晨報段錯誤波及
    expect(postFailureAlert).toHaveBeenCalledWith(expect.stringContaining('晨報段'));
    expect(postFailureAlert).not.toHaveBeenCalledWith(expect.stringContaining('榜單段'));
  });

  it('Acceptance 3：best-effort 告警自身送不出去 → 只記 log、不再擲錯，run() 正常完成且另一段仍執行', async () => {
    const { service, postFailureAlert, boardRun, newsRun } = makeMocks();
    boardRun.mockRejectedValue(new Error('board bug'));
    postFailureAlert.mockRejectedValue(new Error('discord down'));

    await expect(service.run()).resolves.toBeUndefined(); // 不擲錯
    expect(newsRun).toHaveBeenCalledTimes(1); // 另一段仍執行
  });

  it('Acceptance 4：兩段皆正常完成（含其內部已降級處理的單源/LLM 失敗）→ pipeline 不因此額外告警、不整條失敗', async () => {
    const { service, postFailureAlert, boardRun, newsRun } = makeMocks();
    boardRun.mockResolvedValue({ status: 'skipped' });
    newsRun.mockResolvedValue({ status: 'ok' }); // 內部已依 F4/F6 既有容錯降級完成，非本層職責

    await expect(service.run()).resolves.toBeUndefined();
    expect(postFailureAlert).not.toHaveBeenCalled();
  });

  it('一次 load，先榜單段後晨報段，兩段皆執行', async () => {
    const { service, load, boardRun, newsRun } = makeMocks();
    await service.run();
    expect(load).toHaveBeenCalledTimes(1);
    expect(boardRun).toHaveBeenCalledTimes(1);
    expect(newsRun).toHaveBeenCalledTimes(1);
  });
});

describe('PipelineService.run — 整合：榜單段推播失敗＋同 run 晨報段推播成功（C1/FR-011/SC-003）', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('晨報段 save 後，board/lastBoardPushAt/intros 仍為榜單推播前狀態；seenNews/lastNewsPushAt 正常前進', async () => {
    const before: BoardState = {
      ...emptyBoardState(),
      lastBoardPushAt: new Date('2026-07-01T00:00:00.000Z').toISOString(), // >162h 前，到期
      lastNewsPushAt: new Date('2026-07-18T00:00:00.000Z').toISOString(), // ≥18h 前，到期
    };
    const state: BoardState = JSON.parse(JSON.stringify(before));
    const now = new Date('2026-07-19T00:00:00.000Z');
    jest.useFakeTimers({ doNotFake: ['nextTick'] }).setSystemTime(now); // PipelineService.run() 內部用 new Date()，固定時鐘供斷言

    const currentBoard: CurrentBoard = {
      builtAt: now.toISOString(),
      boards: [
        {
          domain: 'ai',
          entries: [
            {
              rank: 1,
              repoId: 1,
              fullName: 'acme/newai',
              url: 'https://github.com/acme/newai',
              domain: 'ai',
              weeklyStarsEstimate: 5000,
              starsThisWeek: 5000,
              totalStars: 1000,
              language: 'Rust',
              sources: ['trending'],
              description: 'desc',
              topics: [],
            },
          ],
        },
        { domain: 'frontend-backend', entries: [] },
      ],
      apiCalls: { core: 1, search: 0 },
    };

    // 真實 send：board 相關 embed（封面📊／卡片🆕🔺）擲錯；晨報 embed（📡）成功。
    const send = jest.fn().mockImplementation(async (payload: { embeds: { title: string }[] }) => {
      const isBoardEmbed = payload.embeds.some((e) => /^(📊|🆕|🔺)/.test(e.title));
      if (isBoardEmbed) {
        throw new Error('Discord webhook 推播失敗，HTTP 500');
      }
    });
    const postFailureAlert = jest.fn().mockResolvedValue(undefined);
    const discord = { send, postFailureAlert } as unknown as DiscordWebhookService;

    const load = jest.fn().mockResolvedValue(state);
    const save = jest.fn().mockResolvedValue(undefined);
    const stateStore = { load, save } as unknown as StateStore;

    const boardBuilder = { build: jest.fn().mockResolvedValue(currentBoard) } as unknown as BoardBuilderService;
    const introService = {
      ensureIntro: jest.fn().mockResolvedValue({ status: 'generated', intro: 'x', introAt: now.toISOString() }),
    } as unknown as IntroService;
    const boardSummary = {
      summarize: jest.fn().mockResolvedValue({ summary: 'x', degraded: false }),
    } as unknown as BoardSummaryService;

    const candidates: NewsCandidate[] = [
      {
        title: 'News A',
        normalizedUrl: 'https://example.com/a',
        originalUrl: 'https://example.com/a',
        summary: null,
        sourceId: 'src1',
        score: 10,
        domain: 'ai',
        tier: 1,
        sources: ['src1'],
        publishedAt: now.toISOString(),
        weightedScore: 100,
      },
    ];
    const digest: CuratedDigest = {
      items: [
        {
          title: 'News A',
          content: '內容',
          url: 'https://example.com/a',
          domain: 'ai',
          sourceCount: 1,
          weightedScore: 100,
          degraded: false,
        },
      ],
      degraded: false,
    };
    const newsIngest = { ingest: jest.fn().mockResolvedValue(candidates) } as unknown as NewsIngestService;
    const newsCuration = { curate: jest.fn().mockResolvedValue(digest) } as unknown as NewsCurationService;

    const boardSegment = new BoardSegmentService(boardBuilder, discord, introService, boardSummary, stateStore);
    const newsSegment = new NewsSegmentService(stateStore, discord, newsIngest, newsCuration);
    const service = new PipelineService(stateStore, discord, boardSegment, newsSegment);

    await service.run();

    // 榜單段推播失敗：board/lastBoardPushAt/intros 逐位元組不變。
    expect(state.board).toEqual(before.board);
    expect(state.lastBoardPushAt).toBe(before.lastBoardPushAt);
    expect(state.intros).toEqual(before.intros);
    // 晨報段推播成功：seenNews/lastNewsPushAt 正常前進。
    expect(state.lastNewsPushAt).toBe(now.toISOString());
    expect(state.seenNews).toEqual([{ url: 'https://example.com/a', seenAt: now.toISOString() }]);
    // save 只被呼叫一次（晨報段），且帶著同一個累積 state（未被榜單段的失敗污染 seenNews 欄位）。
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(state);
    expect(postFailureAlert).toHaveBeenCalledWith(expect.stringContaining('榜單推播失敗'));
  });
});
