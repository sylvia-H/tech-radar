import { NewsCandidate } from './news.types';
import { SeenNewsEntry } from '../state/state.schema';
import { excludeSeen, pruneSeenNews } from './seen-news';
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
  it('剔除逾 7 天、保留期內留存', () => {
    const entries: SeenNewsEntry[] = [
      { url: 'https://a.com', seenAt: '2026-07-17T00:00:00Z' }, // 1 天前 → 留
      { url: 'https://b.com', seenAt: '2026-07-01T00:00:00Z' }, // 17 天前 → 剔
      { url: 'https://c.com', seenAt: '2026-07-11T00:00:01Z' }, // 保留期內 → 留
    ];
    expect(pruneSeenNews(entries, now).map((e) => e.url)).toEqual(['https://a.com', 'https://c.com']);
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
