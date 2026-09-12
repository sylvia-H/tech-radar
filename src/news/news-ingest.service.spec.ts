import { Logger } from '@nestjs/common';
import { NewsIngestService, boardRepoNameSet } from './news-ingest.service';
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

  it('同時給定 boardRepoNames 與 seenNews → 不呼叫 stateStore.load()（F7 pipeline 已 load，免重複讀盤）', async () => {
    const { svc, load } = makeService({ parse });

    await svc.ingest(NOW, new Set(), sources, []);

    expect(load).not.toHaveBeenCalled();
  });

  it('未給 seenNews → 仍回退 stateStore.load() 取 seenNews（向後相容）', async () => {
    const { svc, load } = makeService({ parse });

    await svc.ingest(NOW, new Set(), sources);

    expect(load).toHaveBeenCalledTimes(1);
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

  it('已見（保留期內）排除；逾保留期（45 天）已見被修剪、不再排除（SC-007/008）', async () => {
    const state: BoardState = {
      ...emptyBoardState(),
      seenNews: [
        { url: 'https://good.example/a', seenAt: '2026-07-17T00:00:00Z' }, // 保留期內 → 排除 a
        { url: 'https://good.example/b', seenAt: '2026-05-01T00:00:00Z' }, // 78 天前，逾 45 天 → 修剪 → 不排除 b
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

describe('boardRepoNameSet — 通用短名不加入比對集（Fix 5）', () => {
  it('保留 fullName 與非通用短名；通用短名（core/cli…）跳過', () => {
    const board = {
      'vuejs/core': {},
      'langchain-ai/langchain': {},
      'some-owner/cli': {},
    } as unknown as BoardState['board'];
    const names = boardRepoNameSet(board);

    expect(names.has('vuejs/core')).toBe(true); // fullName 全名保留
    expect(names.has('langchain')).toBe(true); // 具鑑別度的短名保留
    expect(names.has('core')).toBe(false); // 通用短名跳過（避免誤命中內文一般詞）
    expect(names.has('cli')).toBe(false); // 通用短名跳過
  });
});

describe('NewsIngestService.ingest — 過濾後 0 筆不誤告警（Fix 2）', () => {
  const sources: NewsSource[] = [
    { id: 'gh-allpatch', type: 'github-releases', url: 'https://github.com/x/y/releases.atom', domain: 'frontend-backend', tier: 2 },
  ];
  // 原始解析 2 筆、但全為純 patch／pre-release → 過濾後 0 筆。
  const parse = (xml: string) =>
    xml.includes('releases')
      ? {
          items: [
            { title: 'v1.0.1', link: 'https://github.com/x/y/releases/1' },
            { title: 'v2.0.0-beta', link: 'https://github.com/x/y/releases/2' },
          ],
        }
      : { items: [] };

  it('原始解析>0、過濾後為 0（全 patch/pre-release）→ 不發 0 筆告警、輸出為空', async () => {
    const { svc, postFailureAlert } = makeService({ parse });
    const out = await svc.ingest(NOW, new Set(), sources);

    expect(out).toEqual([]);
    const alerts = postFailureAlert.mock.calls.map((c) => String(c[0]));
    expect(alerts.some((m) => m.includes('gh-allpatch'))).toBe(false); // 過濾歸零屬正常、不告警
  });
});

describe('NewsIngestService.ingest — 排除已見於收斂之前（Fix 1）', () => {
  // 分散在 17 個來源（每源 3 篇），避免觸發同來源上限 maxNullScorePerSource=3（2026-08-04 新增）。
  const sources: NewsSource[] = Array.from({ length: 17 }, (_, i) => ({
    id: `good-rss-${i}`,
    type: 'rss' as const,
    url: `https://good.example/multi-${i}`,
    domain: 'ai' as const,
    tier: 1 as const,
  }));

  // 51 筆（> convergeMax 50），依 normalizedUrl 遞增天然排序；i=0 最新、i=50 最舊（發文時間本身
  // 不影響排序，僅供標題/連結區隔）。
  const fiftyOne = Array.from({ length: 51 }, (_, i) => ({
    title: `Post number ${i}`,
    link: `https://good.example/p${String(i).padStart(2, '0')}`,
    isoDate: new Date(NOW.getTime() - i * 3_600_000).toISOString(),
  }));
  const parse = (xml: string) => {
    const match = xml.match(/multi-(\d+)/);
    if (!match) {
      return { items: [] };
    }
    const idx = Number(match[1]);
    return { items: fiftyOne.slice(idx * 3, idx * 3 + 3) };
  };

  it('最新一筆已見時：先排除再收斂 → 仍輸出 50 筆，且排名其後的新鮮候選不被排擠', async () => {
    const state: BoardState = {
      ...emptyBoardState(),
      seenNews: [{ url: 'https://good.example/p00', seenAt: '2026-07-17T12:00:00Z' }], // 最新一筆已見
    };
    const { svc } = makeService({ parse, state });
    const out = await svc.ingest(NOW, new Set(), sources);

    // 先排除已見 p00（剩 50）→ 收斂上限 50 → 全數保留；最舊的 p50 不因先收斂而被排擠掉。
    expect(out).toHaveLength(50);
    const urls = out.map((c) => c.normalizedUrl);
    expect(urls).not.toContain(normalizeTargetUrl('https://good.example/p00'));
    expect(urls).toContain(normalizeTargetUrl('https://good.example/p50'));
  });
});

describe('NewsIngestService.ingest — 新鮮度視窗提前至標題去重之前、URL 去重之後（2026-09-12，分支 1 T1 / F3）', () => {
  const DAY_MS = 86_400_000;
  const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY_MS).toISOString();

  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    logSpy.mockRestore();
  });
  const logLines = () => logSpy.mock.calls.map((c) => String(c[0]));

  it('(a) 無分數且 publishedAt 逾 30 天的候選於標題去重前即被丟、不出現在最終候選', async () => {
    const sources: NewsSource[] = [{ id: 'arch-rss', type: 'rss', url: 'https://arch.example/feed', domain: 'ai', tier: 2 }];
    const parse = (xml: string) =>
      xml.includes('arch')
        ? {
            items: [
              { title: 'Fresh AI post', link: 'https://arch.example/fresh', isoDate: daysAgo(2) },
              { title: 'Archived AI post', link: 'https://arch.example/stale', isoDate: daysAgo(144) },
            ],
          }
        : { items: [] };
    const { svc } = makeService({ parse });
    const out = await svc.ingest(NOW, new Set(), sources, []);

    expect(out.map((c) => c.normalizedUrl)).toEqual([normalizeTargetUrl('https://arch.example/fresh')]);
    // 觀測 log 證明順序為「URL 去重（-0）→ 新鮮度視窗（-1）→ 標題去重（-0）」：在標題去重前
    // 丟掉、而非等到漏斗末端才丟。
    const lines = logLines();
    expect(lines).toContain('[漏斗 A] URL 去重後：2 則（-0）');
    expect(lines).toContain('[漏斗 A] 新鮮度視窗後：1 則（-1）');
    expect(lines).toContain('[漏斗 A] 標題去重後：1 則（-0）');
  });

  it('(b) 有分數者（HN）即使 publishedAt 缺失／不新鮮也不因此步被丟', async () => {
    // HN fetcher 自有近 7 天 guard，無法餵入「很舊的 created_at_i」；改以缺 `created_at_i`
    // （publishedAt=null，isFreshEnough 同樣判為不新鮮）驗證豁免路徑。
    const sources: NewsSource[] = [
      { id: 'hn', type: 'hn-algolia', url: 'https://hn.algolia.com/api/v1/search?tags=story', domain: 'ai', tier: 1 },
      { id: 'arch-rss', type: 'rss', url: 'https://arch.example/feed', domain: 'ai', tier: 2 },
    ];
    const { svc } = makeService({
      json: (url) =>
        url.includes('hn.algolia')
          ? { hits: [{ objectID: '1', title: 'Scored HN story', url: 'https://hn.example/story', points: 200 }] }
          : { hits: [] },
      parse: (xml) =>
        xml.includes('arch')
          ? { items: [{ title: 'Archived AI post', link: 'https://arch.example/stale', isoDate: daysAgo(144) }] }
          : { items: [] },
    });
    const out = await svc.ingest(NOW, new Set(), sources, []);

    expect(out.map((c) => c.normalizedUrl)).toEqual([normalizeTargetUrl('https://hn.example/story')]);
    expect(out[0].publishedAt).toBeNull();
    expect(out[0].score).toBe(200);
    const lines = logLines();
    expect(lines).toContain('[漏斗 A] URL 去重後：2 則（-0）'); // 兩者 URL 不同、不合併
    expect(lines).toContain('[漏斗 A] 新鮮度視窗後：1 則（-1）'); // 只丟 RSS 舊文，HN 豁免
  });

  it('(c) 新文與封存舊文標題近似（Jaccard ≥ 0.6）：舊文先被視窗丟掉，新文完整存活且 sources 不含舊文來源', async () => {
    // 實證案例：Simon Willison 4 天前「Introducing ChatGPT Images 2.5」曾被 openai-blog 144 天前
    // 「Introducing ChatGPT Images 2.0」以標題合併吞掉——兩者皆無分數，代表項依 sourceId 字典序落在
    // `openai-blog`（舊文），再被漏斗內視窗整則丟掉。視窗提前後舊文根本不參與去重。
    const sources: NewsSource[] = [
      { id: 'openai-blog', type: 'rss', url: 'https://openai.example/feed', domain: 'ai', tier: 2 },
      { id: 'simon', type: 'rss', url: 'https://simon.example/feed', domain: 'ai', tier: 2 },
    ];
    const parse = (xml: string) => {
      if (xml.includes('openai')) {
        return { items: [{ title: 'Introducing ChatGPT Images 2.0', link: 'https://openai.example/images-2-0', isoDate: daysAgo(144) }] };
      }
      if (xml.includes('simon')) {
        return { items: [{ title: 'Introducing ChatGPT Images 2.5', link: 'https://simon.example/images-2-5', isoDate: daysAgo(4) }] };
      }
      return { items: [] };
    };
    const { svc } = makeService({ parse });
    const out = await svc.ingest(NOW, new Set(), sources, []);

    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('Introducing ChatGPT Images 2.5');
    expect(out[0].normalizedUrl).toBe(normalizeTargetUrl('https://simon.example/images-2-5'));
    expect(out[0].sourceId).toBe('simon');
    expect(out[0].sources).toEqual(['simon']); // 不含 openai-blog：舊文未參與標題去重、無不實交叉驗證
    const lines = logLines();
    expect(lines).toContain('[漏斗 A] URL 去重後：2 則（-0）'); // URL 不同、不合併
    expect(lines).toContain('[漏斗 A] 新鮮度視窗後：1 則（-1）'); // 舊文於此被丟
    expect(lines).toContain('[漏斗 A] 標題去重後：1 則（-0）');
  });

  it('(iii) F3 回歸：低分 HN 投稿與同 URL 的 tier 2 官方舊文先以 URL 合併、代表項為 HN，靠交叉驗證豁免門檻入池', async () => {
    // 若新鮮度視窗放在 URL 去重之前：官方舊文（35 天前、無分數）先被丟，HN 單筆（60 < 門檻 100）
    // 再被漏斗門檻丟掉，整則消失。正確順序下 URL 精確合併必為同一篇文章、不可能誤吞：合併後代表項
    // 為有分數的 HN、通過視窗，`sources.length >= 2` 交叉驗證豁免門檻。
    const sources: NewsSource[] = [
      { id: 'hn', type: 'hn-algolia', url: 'https://hn.algolia.com/api/v1/search?tags=story', domain: 'ai', tier: 1 },
      { id: 'official-blog', type: 'rss', url: 'https://official.example/feed', domain: 'ai', tier: 2 },
    ];
    const { svc } = makeService({
      json: (url) =>
        url.includes('hn.algolia')
          ? { hits: [{ objectID: '7', title: 'Official deep dive on AI agents', url: 'https://official.example/deep-dive', points: 60, created_at_i: WEEK_AGO_I }] }
          : { hits: [] },
      parse: (xml) =>
        xml.includes('official')
          ? { items: [{ title: 'Official deep dive on AI agents', link: 'https://official.example/deep-dive', isoDate: daysAgo(35) }] }
          : { items: [] },
    });
    const out = await svc.ingest(NOW, new Set(), sources, []);

    expect(out).toHaveLength(1);
    expect(out[0].normalizedUrl).toBe(normalizeTargetUrl('https://official.example/deep-dive'));
    expect(out[0].sourceId).toBe('hn'); // 代表項＝有分數者
    expect(out[0].score).toBe(60); // 低於 tier 1 門檻 100，但交叉驗證豁免
    expect(out[0].sources).toEqual(['hn', 'official-blog']);
    const lines = logLines();
    expect(lines).toContain('[漏斗 A] URL 去重後：1 則（-1）'); // 先合併
    expect(lines).toContain('[漏斗 A] 新鮮度視窗後：1 則（-0）'); // 代表項有分數 → 豁免
    expect(lines).toContain('[漏斗 A] 漏斗後最終：1 則（-0）'); // 門檻豁免、未被丟
  });
});

describe('NewsIngestService.collect — 0 筆來源仍出現在逐源對帳 log（2026-09-12，F4）', () => {
  const sources: NewsSource[] = [
    { id: 'good-rss', type: 'rss', url: 'https://good.example/feed', domain: 'ai', tier: 1 },
    { id: 'dead-rss', type: 'rss', url: 'https://dead.example/feed', domain: 'ai', tier: 2 },
  ];
  const parse = (xml: string) =>
    xml.includes('good')
      ? { items: [{ title: 'Good AI post', link: 'https://good.example/a', isoDate: '2026-07-17T00:00:00Z' }] }
      : { items: [] };

  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it('parsedCount === 0 的來源：log 含「解析 0 則 → 過濾後 0 則」且仍發帶 id 告警', async () => {
    const { svc, postFailureAlert } = makeService({ parse });
    const out = await svc.ingest(NOW, new Set(), sources, []);

    expect(out).toHaveLength(1);
    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    expect(lines).toContain('[來源 dead-rss] 解析 0 則 → 過濾後 0 則');
    expect(lines).toContain('[來源 good-rss] 解析 1 則 → 過濾後 1 則');
    const alerts = postFailureAlert.mock.calls.map((c) => String(c[0]));
    expect(alerts.some((m) => m.includes('[dead-rss]') && m.includes('0 筆'))).toBe(true); // 仍照舊告警
  });
});
