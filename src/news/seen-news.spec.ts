import { NewsCandidate } from './news.types';
import { SeenNewsEntry } from '../state/state.schema';
import { DEFAULT_FUNNEL_CONFIG } from './funnel';
import { excludeSeen, pruneSeenNews, SEEN_NEWS_RETENTION_DAYS } from './seen-news';
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
