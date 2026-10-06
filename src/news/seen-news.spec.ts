import { NewsCandidate } from './news.types';
import { SeenNewsEntry } from '../state/state.schema';
import { DEFAULT_FUNNEL_CONFIG } from './funnel';
import {
  excludeSeen,
  excludeSeenByTitle,
  pruneSeenNews,
  SEEN_NEWS_RETENTION_DAYS,
  SEEN_TITLE_JACCARD_THRESHOLD,
  SEEN_TITLE_WINDOW_DAYS,
} from './seen-news';
import { TITLE_JACCARD_THRESHOLD } from './title-similarity';
import { TITLE_MERGE_MAX_GAP_DAYS } from './dedup';
import { normalizeTargetUrl } from './url-normalize';

const now = new Date('2026-07-18T00:00:00Z');

function candWith(url: string): NewsCandidate {
  return {
    title: 't',
    normalizedUrl: normalizeTargetUrl(url),
    originalUrl: url,
    summary: null,
    sourceId: 's',
    score: null,
    domain: 'ai',
    tier: 1,
    sources: ['s'],
    publishedAt: null,
    weightedScore: 0,
  };
}

describe('pruneSeenNews（FR-023 / SC-008）', () => {
  it('剔除逾保留期（45 天）、保留期內留存（含 45 天邊界）', () => {
    const entries: SeenNewsEntry[] = [
      { url: 'https://a.com', seenAt: '2026-07-17T00:00:00Z' }, // 1 天前 → 留
      { url: 'https://b.com', seenAt: '2026-05-01T00:00:00Z' }, // 78 天前 → 剔
      { url: 'https://c.com', seenAt: '2026-07-01T00:00:00Z' }, // 17 天前 → 舊版 7 天會剔，45 天保留
      { url: 'https://d.com', seenAt: '2026-06-03T00:00:01Z' }, // 45 天內差 1 秒 → 留
      { url: 'https://e.com', seenAt: '2026-06-02T23:59:59Z' }, // 逾 45 天 1 秒 → 剔
    ];
    expect(pruneSeenNews(entries, now).map((e) => e.url)).toEqual(['https://a.com', 'https://c.com', 'https://d.com']);
  });

  it('保留天數必須 ≥ 漏斗新鮮度視窗，否則舊文會在修剪後重新入池被再推一次（2026-09-02 重推缺陷根因）', () => {
    expect(SEEN_NEWS_RETENTION_DAYS).toBeGreaterThanOrEqual(DEFAULT_FUNNEL_CONFIG.freshnessWindowDays);
  });

  it('無法解析的 seenAt 一併剔除', () => {
    expect(pruneSeenNews([{ url: 'https://x', seenAt: 'garbage' }], now)).toHaveLength(0);
  });
});

describe('excludeSeen（FR-022 / SC-007）', () => {
  it('以正規化 URL 排除已見；帶不同追蹤參數/大小寫同連結仍判已見', () => {
    const cands = [candWith('https://x.com/a'), candWith('https://y.com/b')];
    const seen: SeenNewsEntry[] = [{ url: 'https://www.x.com/a/?utm_source=z', seenAt: now.toISOString() }];
    const out = excludeSeen(cands, seen);
    expect(out.map((c) => c.normalizedUrl)).toEqual([normalizeTargetUrl('https://y.com/b')]);
  });
});

describe('excludeSeenByTitle（跨日標題去重，2026-10-06 新增）', () => {
  const DAY = 86_400_000;
  const titled = (title: string, daysAgo: number): SeenNewsEntry => ({
    url: `https://seen.example/${daysAgo}-${title.length}`,
    seenAt: new Date(now.getTime() - daysAgo * DAY).toISOString(),
    title,
  });
  const candTitled = (title: string, url: string): NewsCandidate => ({ ...candWith(url), title });

  it('常數：回看視窗與當日池內標題合併的 14 天同一把尺、門檻沿用 TITLE_JACCARD_THRESHOLD', () => {
    expect(SEEN_TITLE_WINDOW_DAYS).toBe(TITLE_MERGE_MAX_GAP_DAYS);
    expect(SEEN_TITLE_JACCARD_THRESHOLD).toBe(TITLE_JACCARD_THRESHOLD);
  });

  it('近 14 天已推標題與候選標題 Jaccard ≥ 門檻 → 排除，並回報命中的已推標題；不相似者保留', () => {
    const seen = [titled('Introducing Gemini 4 Argon: our next era of frontier intelligence', 1)];
    const dup = candTitled('Gemini 4 Argon: our next era of frontier intelligence', 'https://news.ycombinator.com/item?id=1');
    const other = candTitled('Platform-independent SIMD in Go', 'https://go.dev/blog/simd');

    const out = excludeSeenByTitle([dup, other], seen, now);

    expect(out.kept.map((c) => c.title)).toEqual(['Platform-independent SIMD in Go']);
    expect(out.dropped).toEqual([{ candidate: dup, seenTitle: seen[0].title }]);
  });

  it('已推紀錄超過 14 天 → 不參與比對（同名新版本數週後仍可入池）', () => {
    const seen = [titled('Gemini 4 Argon: our next era of frontier intelligence', 15)];
    const cand = candTitled('Gemini 4 Argon: our next era of frontier intelligence', 'https://x.com/a');
    expect(excludeSeenByTitle([cand], seen, now).kept).toEqual([cand]);
  });

  it('舊條目沒有 title（2026-10-06 前落檔）→ 跳過，不擲錯、不排除', () => {
    const seen: SeenNewsEntry[] = [{ url: 'https://old.example/a', seenAt: now.toISOString() }];
    const cand = candTitled('Anything', 'https://x.com/a');
    expect(excludeSeenByTitle([cand], seen, now)).toEqual({ kept: [cand], dropped: [] });
  });

  it('同主題但措辭差異大的不同報導（Jaccard 低於門檻）不排除——交 LLM 判斷，不在此誤殺新進展', () => {
    const seen = [titled('Dutch governments builds alternative for Microsoft based on NixOS', 3)];
    const cand = candTitled('US sanctions force The Netherlands off Microsoft and toward alternative NixOS', 'https://x.com/b');
    expect(excludeSeenByTitle([cand], seen, now).kept).toEqual([cand]);
  });

  it('無已推紀錄或無帶標題紀錄 → 原樣回傳（淺拷貝）', () => {
    const cand = candTitled('t', 'https://x.com/c');
    const out = excludeSeenByTitle([cand], [], now);
    expect(out.kept).toEqual([cand]);
    expect(out.dropped).toEqual([]);
  });
});
