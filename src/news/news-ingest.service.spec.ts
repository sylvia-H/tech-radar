import { NewsIngestService } from './news-ingest.service';
import { NewsHttp } from './news-http';
import { NewsRssParser } from './fetchers/fetcher';
import { DiscordWebhookService } from '../discord/discord.webhook.service';
import { StateStore } from '../state/state.store';
import { BoardState, emptyBoardState } from '../state/state.schema';
import { NewsSource } from './news.types';
import { normalizeTargetUrl } from './url-normalize';

const NOW = new Date('2026-07-18T00:00:00Z');
const WEEK_AGO_I = Math.floor(NOW.getTime() / 1000) - 6 * 24 * 3600;

interface Opts {
  json?: (url: string) => unknown;
  parse?: (xml: string) => { items: unknown[] };
  state?: BoardState;
}

function makeService(opts: Opts = {}) {
  const getText = jest.fn(async (url: string) => {
    if (url.includes('boom')) {
      throw new Error('network');
    }
    return { text: url, notModified: false }; // echo url 作為 parseString 的 marker
  });
  const getJson = jest.fn(async (url: string) => opts.json?.(url) ?? { hits: [] });
  const parseString = jest.fn(async (xml: string) => opts.parse?.(xml) ?? { items: [] });
  const postFailureAlert = jest.fn().mockResolvedValue(undefined);
  const load = jest.fn().mockResolvedValue(opts.state ?? emptyBoardState());

  const http = { getText, getJson } as unknown as NewsHttp;
  const parser = { parseString } as unknown as NewsRssParser;
  const discord = { postFailureAlert } as unknown as DiscordWebhookService;
  const stateStore = { load } as unknown as StateStore;

  const svc = new NewsIngestService(http, parser, discord, stateStore);
  return { svc, getText, getJson, postFailureAlert, load };
}

describe('NewsIngestService.ingest — 隔離容錯（US1, FR-025/026, SC-003/004）', () => {
  const sources: NewsSource[] = [
    { id: 'good-rss', type: 'rss', url: 'https://good.example/feed', domain: 'ai', tier: 1 },
    { id: 'empty-t2', type: 'rss', url: 'https://empty.example/feed', domain: 'ai', tier: 2 },
    { id: 'boom', type: 'rss', url: 'https://boom.example/feed', domain: 'ai', tier: 1 },
    { id: 'off', type: 'rss', url: 'https://off.example/feed', domain: 'ai', tier: 1, enabled: false },
  ];

  const parse = (xml: string) =>
    xml.includes('good')
      ? { items: [{ title: 'Good AI post', link: 'https://good.example/a', contentSnippet: 's', isoDate: '2026-07-17T00:00:00Z' }] }
      : { items: [] };

  it('0 筆發帶 id 告警（Tier 2 不例外）、單源失敗跳過不斷全線、停用來源完全略過', async () => {
    const { svc, getText, postFailureAlert } = makeService({ parse });
    const out = await svc.ingest(NOW, new Set(), sources);

    // good-rss 存活；其餘失敗/空/停用不影響它
    expect(out).toHaveLength(1);
    expect(out[0].sources).toEqual(['good-rss']);

    const alerts = postFailureAlert.mock.calls.map((c) => String(c[0]));
    expect(alerts.some((m) => m.includes('empty-t2') && m.includes('0 筆'))).toBe(true); // SC-003
    expect(alerts.some((m) => m.includes('boom'))).toBe(true); // 失敗告警
    expect(alerts.some((m) => m.includes('[off]'))).toBe(false); // 停用不告警

    expect(getText).not.toHaveBeenCalledWith('https://off.example/feed'); // 停用不抓取
  });
});

describe('NewsIngestService.ingest — 跨來源去重（US2, SC-001）', () => {
  const sources: NewsSource[] = [
    { id: 'hn', type: 'hn-algolia', url: 'https://hn.algolia.com/api/v1/search?tags=story', domain: 'cross', tier: 1 },
    { id: 'lob', type: 'rss', url: 'https://lob.example/dup', domain: 'ai', tier: 1 },
  ];

  it('同一目標連結跨來源只留一筆、代表為最高分、sources[] 正確合併、cross 歸類落定', async () => {
    const { svc } = makeService({
      json: (url) =>
        url.includes('hn.algolia')
          ? { hits: [{ objectID: '9', title: 'Dup story about AI', url: 'https://dup.example/x', points: 200, created_at_i: WEEK_AGO_I }] }
          : { hits: [] },
      parse: (xml) =>
        xml.includes('dup')
          ? { items: [{ title: 'Dup story about AI', link: 'https://dup.example/x', isoDate: '2026-07-17T00:00:00Z' }] }
          : { items: [] },
    });

    const out = await svc.ingest(NOW, new Set(), sources);
    expect(out).toHaveLength(1);
    expect(out[0].sources).toEqual(['hn', 'lob']);
    expect(out[0].score).toBe(200); // 最高分為代表
    expect(out[0].domain).toBe('ai'); // cross 經歸類落定
    expect(out[0].normalizedUrl).toBe('https://dup.example/x');
  });
});

describe('NewsIngestService.ingest — 榜單相關性 ＋ 跨天排除（US3/US4, SC-007/008）', () => {
  const sources: NewsSource[] = [{ id: 'good-rss', type: 'rss', url: 'https://good.example/feed', domain: 'ai', tier: 1 }];

  const twoPosts = (xml: string) =>
    xml.includes('good')
      ? {
          items: [
            { title: 'AI post one', link: 'https://good.example/a', isoDate: '2026-07-17T00:00:00Z' },
            { title: 'AI post two', link: 'https://good.example/b', isoDate: '2026-07-17T00:00:00Z' },
          ],
        }
      : { items: [] };

  it('已見（保留期內）排除；逾 7 天已見被修剪、不再排除（SC-007/008）', async () => {
    const state: BoardState = {
      ...emptyBoardState(),
      seenNews: [
        { url: 'https://good.example/a', seenAt: '2026-07-17T00:00:00Z' }, // 保留期內 → 排除 a
        { url: 'https://good.example/b', seenAt: '2026-07-01T00:00:00Z' }, // 逾 7 天 → 修剪 → 不排除 b
      ],
    };
    const { svc } = makeService({ parse: twoPosts, state });
    const out = await svc.ingest(NOW, new Set(), sources);
    expect(out.map((c) => c.normalizedUrl)).toEqual([normalizeTargetUrl('https://good.example/b')]);
  });

  it('提到榜上 repo 的候選經加權排在前（FR-018）', async () => {
    const parse = (xml: string) =>
      xml.includes('good')
        ? {
            items: [
              { title: 'Generic tool update', link: 'https://good.example/a', isoDate: '2026-07-17T00:00:00Z' },
              { title: 'LangChain new release', link: 'https://good.example/b', isoDate: '2026-07-17T00:00:00Z' },
            ],
          }
        : { items: [] };
    const { svc } = makeService({ parse });
    const out = await svc.ingest(NOW, new Set(['langchain']), sources);
    expect(out[0].normalizedUrl).toBe(normalizeTargetUrl('https://good.example/b'));
  });
});
