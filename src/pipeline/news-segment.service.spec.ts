import { NewsSegmentService } from './news-segment.service';
import { NewsIngestService } from '../news/news-ingest.service';
import { NewsCurationService } from '../curation/curation.service';
import { DiscordWebhookService } from '../discord/discord.webhook.service';
import { StateStore } from '../state/state.store';
import { BoardState, emptyBoardState } from '../state/state.schema';
import { CuratedDigest, CuratedNewsItem } from '../curation/curation.types';
import { NewsCandidate } from '../news/news.types';

const NOW = new Date('2026-07-19T00:00:00.000Z');
const HOUR_MS = 3_600_000;

function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * HOUR_MS).toISOString();
}

function makeState(overrides: Partial<BoardState> = {}): BoardState {
  return { ...emptyBoardState(), ...overrides };
}

function candidate(overrides: Partial<NewsCandidate> = {}): NewsCandidate {
  return {
    title: 'Some title',
    normalizedUrl: 'https://example.com/a',
    originalUrl: 'https://example.com/a?utm_source=x',
    summary: null,
    sourceId: 'src1',
    score: 10,
    domain: 'ai',
    tier: 1,
    sources: ['src1'],
    publishedAt: NOW.toISOString(),
    weightedScore: 100,
    ...overrides,
  };
}

function curatedItem(overrides: Partial<CuratedNewsItem> = {}): CuratedNewsItem {
  return {
    title: 'AI News',
    content: '內容摘要',
    url: 'https://example.com/a?utm_source=x',
    domain: 'ai',
    sourceCount: 1,
    weightedScore: 100,
    degraded: false,
    ...overrides,
  };
}

interface Mocks {
  service: NewsSegmentService;
  ingest: jest.Mock;
  curate: jest.Mock;
  send: jest.Mock;
  postFailureAlert: jest.Mock;
  save: jest.Mock;
}

function build(): Mocks {
  const ingest = jest.fn().mockResolvedValue([candidate()]);
  const curate = jest.fn().mockResolvedValue({ items: [curatedItem()], degraded: false } as CuratedDigest);
  const send = jest.fn().mockResolvedValue(undefined);
  const postFailureAlert = jest.fn().mockResolvedValue(undefined);
  const save = jest.fn().mockResolvedValue(undefined);

  const newsIngest = { ingest } as unknown as NewsIngestService;
  const newsCuration = { curate } as unknown as NewsCurationService;
  const discord = { send, postFailureAlert } as unknown as DiscordWebhookService;
  const stateStore = { save } as unknown as StateStore;

  const service = new NewsSegmentService(stateStore, discord, newsIngest, newsCuration);
  return { service, ingest, curate, send, postFailureAlert, save };
}

describe('NewsSegmentService.run — US1 Acceptance（每日晨報端到端）', () => {
  it('Acceptance 1：正常路徑 → 一則橙色晨報 embed 並 send 一次；推播成功後 seenNews/lastNewsPushAt 前進、save 一次；推播成功前 state 未寫回', async () => {
    const { service, ingest, curate, send, save } = build();
    const state = makeState({ lastNewsPushAt: hoursAgo(24) });

    let stateAtSendTime: BoardState | undefined;
    send.mockImplementationOnce(async () => {
      // 推播當下快照 state，斷言此刻尚未寫回（seenNews 仍空、lastNewsPushAt 仍是舊值）。
      stateAtSendTime = JSON.parse(JSON.stringify(state));
    });

    const result = await service.run(state, NOW);

    expect(result).toEqual({ status: 'ok' });
    // ingest 收共享 state 的 seenNews（第 4 參），免其重複 stateStore.load()。
    expect(ingest).toHaveBeenCalledWith(NOW, expect.any(Set), undefined, expect.any(Array));
    expect(curate).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0][0];
    expect(payload.embeds).toHaveLength(1);
    expect(payload.embeds[0].description).toContain('https://example.com/a?utm_source=x');
    expect(send.mock.calls[0][1]).toBe('news'); // 晨報段固定送 news 頻道

    expect(stateAtSendTime!.seenNews).toEqual([]);
    expect(stateAtSendTime!.lastNewsPushAt).toBe(hoursAgo(24));

    expect(state.seenNews).toEqual([{ url: 'https://example.com/a', seenAt: NOW.toISOString() }]);
    expect(state.lastNewsPushAt).toBe(NOW.toISOString());
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(state);
  });

  it('推播成功後 state.publish.news.items 與 digest.items 為同一參照（feed-page-contract.md C3，FR-002/009）', async () => {
    const { service, curate } = build();
    const items = [curatedItem()];
    const digest: CuratedDigest = { items, degraded: false };
    curate.mockResolvedValue(digest);
    const state = makeState({ lastNewsPushAt: hoursAgo(24) });

    const result = await service.run(state, NOW);

    expect(result).toEqual({ status: 'ok' });
    expect(state.publish?.news?.items).toBe(items);
    expect(state.publish?.news?.generatedAt).toBe(NOW.toISOString());
  });

  it('落檔前修剪逾 7 天的舊 seenNews：舊紀錄被剔除、本次新項寫入，持久化不無限膨脹（FR-023/SC-008）', async () => {
    const { service, save } = build();
    const stale = { url: 'https://old.example.com/x', seenAt: hoursAgo(24 * 8) }; // 8 天前 → 應被剔除
    const fresh = { url: 'https://recent.example.com/y', seenAt: hoursAgo(24 * 2) }; // 2 天內 → 保留
    const state = makeState({ lastNewsPushAt: hoursAgo(24), seenNews: [stale, fresh] });

    const result = await service.run(state, NOW);

    expect(result).toEqual({ status: 'ok' });
    const urls = state.seenNews.map((e) => e.url);
    expect(urls).not.toContain(stale.url); // 逾保留期被修剪
    expect(urls).toContain(fresh.url); // 仍在保留期
    expect(urls).toContain('https://example.com/a'); // 本次推播的 normalized url
    expect(save).toHaveBeenCalledWith(state);
  });

  it('Acceptance 2：降級（degraded=true, content=null）→ 照樣組版推播、晨報不中斷；各則仍寫回 seenNews', async () => {
    const { service, curate, send, save } = build();
    curate.mockResolvedValue({
      items: [curatedItem({ content: null, degraded: true })],
      degraded: true,
    } as CuratedDigest);
    const state = makeState({ lastNewsPushAt: null });

    const result = await service.run(state, NOW);

    expect(result).toEqual({ status: 'ok' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(state.seenNews).toHaveLength(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('Acceptance 3：推播失敗 → seenNews/lastNewsPushAt 逐位元組不變、不 save、發紅色告警', async () => {
    const { service, send, postFailureAlert, save } = build();
    send.mockRejectedValue(new Error('Discord webhook 推播失敗，HTTP 500'));
    const before = makeState({ lastNewsPushAt: hoursAgo(24) });
    const state = JSON.parse(JSON.stringify(before)) as BoardState;

    const result = await service.run(state, NOW);

    expect(result).toEqual({ status: 'push-failed' });
    expect(state).toEqual(before); // 逐位元組不變
    expect(save).not.toHaveBeenCalled();
    expect(postFailureAlert).toHaveBeenCalledTimes(1);
    expect(postFailureAlert.mock.calls[0][0]).toContain('晨報推播失敗');
  });

  it('Acceptance 4：F6 回傳空精選集 → 不推空晨報、不前進 lastNewsPushAt、不 save', async () => {
    const { service, curate, send, save } = build();
    curate.mockResolvedValue({ items: [], degraded: false } as CuratedDigest);
    const before = hoursAgo(24);
    const state = makeState({ lastNewsPushAt: before });

    const result = await service.run(state, NOW);

    expect(result).toEqual({ status: 'no-content' });
    expect(send).not.toHaveBeenCalled();
    expect(state.lastNewsPushAt).toBe(before);
    expect(save).not.toHaveBeenCalled();
  });
});

describe('NewsSegmentService.run — US2 idempotency guard（雙 cron 去重＋漏跑補推）', () => {
  it('lastNewsPushAt 距今 10h（<18h）→ 整段跳過：不 ingest/curate/send/save，推播數 0', async () => {
    const { service, ingest, curate, send, save } = build();
    const state = makeState({ lastNewsPushAt: hoursAgo(10) });

    const result = await service.run(state, NOW);

    expect(result).toEqual({ status: 'skipped' });
    expect(ingest).not.toHaveBeenCalled();
    expect(curate).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('lastNewsPushAt 距今 24h（≥18h）→ 執行並推播一次', async () => {
    const { service, send } = build();
    const state = makeState({ lastNewsPushAt: hoursAgo(24) });

    const result = await service.run(state, NOW);

    expect(result).toEqual({ status: 'ok' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('lastNewsPushAt=null（冷啟動）→ 視為到期並執行', async () => {
    const { service, send } = build();
    const state = makeState({ lastNewsPushAt: null });

    const result = await service.run(state, NOW);

    expect(result).toEqual({ status: 'ok' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('雙 cron 去重：主排推完後、補跑於約 30 分鐘後觸發 → 因 <18h 跳過，當日總推播維持 1', async () => {
    const { service, send } = build();
    const state = makeState({ lastNewsPushAt: hoursAgo(24) });

    const mainRun = await service.run(state, NOW); // 主排：due，推播並前進 lastNewsPushAt
    expect(mainRun).toEqual({ status: 'ok' });
    expect(send).toHaveBeenCalledTimes(1);

    const backupNow = new Date(NOW.getTime() + 30 * 60 * 1000); // 30 分鐘後補跑
    const backupRun = await service.run(state, backupNow); // 補跑：距上次 <18h → 跳過
    expect(backupRun).toEqual({ status: 'skipped' });
    expect(send).toHaveBeenCalledTimes(1); // 當日總推播維持 1
  });

  it('漏跑補推：主排被跳過、補跑距上次已 ~24h → 正常補推一則，當日總推播為 1', async () => {
    const { service, send } = build();
    const state = makeState({ lastNewsPushAt: hoursAgo(24) }); // 模擬主排未執行（Actions 跳過）

    const backupRun = await service.run(state, NOW); // 補跑：距上次 ~24h → due，正常補推
    expect(backupRun).toEqual({ status: 'ok' });
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('NewsSegmentService.run — US5 版面整合（T020：晨報逼近 4096 拆分，仍段內獨立切分）', () => {
  it('晨報 6 則逼近 4096 → buildDigestEmbeds 拆兩張橙 embed，仍在晨報段自己的 chunkEmbeds 批次內（一次 send、payload 含 2 個 embeds）', async () => {
    const { service, curate, send } = build();
    const longContent = 'x'.repeat(750); // 6 則 × 750+ 字（含連結 markdown）必超過 4096
    curate.mockResolvedValue({
      items: Array.from({ length: 6 }, (_, i) =>
        curatedItem({ title: `News ${i}`, content: longContent, url: `https://example.com/${i}` }),
      ),
      degraded: false,
    } as CuratedDigest);
    const state = makeState({ lastNewsPushAt: null });

    const result = await service.run(state, NOW);

    expect(result).toEqual({ status: 'ok' });
    expect(send).toHaveBeenCalledTimes(1); // 2 個晨報 embed 仍 ≤10，一批送出（不與榜單段合併）
    const payload = send.mock.calls[0][0];
    expect(payload.embeds.length).toBeGreaterThanOrEqual(2);
    for (const e of payload.embeds) {
      expect([...e.description as string].length).toBeLessThanOrEqual(4096);
    }
  });
});
