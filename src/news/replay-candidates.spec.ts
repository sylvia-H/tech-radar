import { SeenNewsEntry } from '../state/state.schema';
import { NewsSource } from './news.types';
import {
  candidatesFromSeen,
  parseReplayDate,
  seenEntriesOnTaipeiDate,
  taipeiDayRange,
} from './replay-candidates';

const SOURCES: NewsSource[] = [
  { id: 'hn', type: 'hn-algolia', url: 'https://hn.example', domain: 'cross', tier: 1 },
  { id: 'gh-nodejs', type: 'github-releases', url: 'https://gh.example/node', domain: 'frontend-backend', tier: 2 },
  { id: 'gh-vue', type: 'github-releases', url: 'https://gh.example/vue', domain: 'frontend-backend', tier: 3 },
];

function entry(overrides: Partial<SeenNewsEntry> = {}): SeenNewsEntry {
  return {
    url: 'https://example.com/a',
    seenAt: '2026-10-07T20:07:00.000Z', // 台北 2026-10-08 04:07
    sourceId: 'hn',
    sources: ['hn'],
    domain: 'ai',
    title: 'Original Title',
    ...overrides,
  };
}

describe('parseReplayDate — 補發日期驗證', () => {
  it('合法 YYYY-MM-DD 原樣回傳（前後空白修剪）', () => {
    expect(parseReplayDate('2026-10-08')).toBe('2026-10-08');
    expect(parseReplayDate(' 2026-10-08 ')).toBe('2026-10-08');
  });

  it.each(['2026/10/08', '2026-10-8', '20261008', '', 'abc', '2026-02-30', '2026-13-01'])(
    '不合法「%s」→ 擲錯',
    (raw) => {
      expect(() => parseReplayDate(raw)).toThrow('NEWS_REPLAY_DATE');
    },
  );
});

describe('taipeiDayRange／seenEntriesOnTaipeiDate — UTC+8 日期邊界', () => {
  it('台北 10/08 ＝ UTC 10/07 16:00 起（含）至 10/08 16:00（不含）', () => {
    const { start, end } = taipeiDayRange('2026-10-08');
    expect(new Date(start).toISOString()).toBe('2026-10-07T16:00:00.000Z');
    expect(new Date(end).toISOString()).toBe('2026-10-08T16:00:00.000Z');
  });

  it('邊界：起點含、終點不含；前一刻屬前一日', () => {
    const entries = [
      entry({ url: 'u-before', seenAt: '2026-10-07T15:59:59.999Z' }),
      entry({ url: 'u-start', seenAt: '2026-10-07T16:00:00.000Z' }),
      entry({ url: 'u-last', seenAt: '2026-10-08T15:59:59.999Z' }),
      entry({ url: 'u-end', seenAt: '2026-10-08T16:00:00.000Z' }),
    ];
    expect(seenEntriesOnTaipeiDate(entries, '2026-10-08').map((e) => e.url)).toEqual(['u-start', 'u-last']);
  });

  it('無 title 的舊條目略過；保持陣列（推播）順序', () => {
    const entries = [
      entry({ url: 'u1', title: 'B' }),
      entry({ url: 'u2', title: undefined }),
      entry({ url: 'u3', title: '' }),
      entry({ url: 'u4', title: 'A' }),
    ];
    expect(seenEntriesOnTaipeiDate(entries, '2026-10-08').map((e) => e.url)).toEqual(['u1', 'u4']);
  });
});

describe('candidatesFromSeen — seenNews 條目重建為策展候選', () => {
  it('欄位對映：標題／URL 沿用、summary/score/publishedAt 為 null、weightedScore 依原順序遞減', () => {
    const entries = [
      entry({ url: 'https://a.com/1', title: 'First', sourceId: 'hn', sources: ['hn', 'gh-nodejs'] }),
      entry({ url: 'https://a.com/2', title: 'Second', sourceId: 'gh-nodejs', sources: ['gh-nodejs'], domain: 'frontend-backend' }),
      entry({ url: 'https://a.com/3', title: 'Third', sourceId: 'gh-vue', sources: ['gh-vue'], domain: 'devops' }),
    ];

    const cands = candidatesFromSeen(entries, '2026-10-08', SOURCES);

    expect(cands).toEqual([
      {
        title: 'First',
        normalizedUrl: 'https://a.com/1',
        originalUrl: 'https://a.com/1',
        summary: null,
        sourceId: 'hn',
        score: null,
        domain: 'ai',
        tier: 1,
        sources: ['hn', 'gh-nodejs'],
        publishedAt: null,
        weightedScore: 3,
      },
      expect.objectContaining({ title: 'Second', domain: 'frontend-backend', tier: 2, weightedScore: 2 }),
      expect.objectContaining({ title: 'Third', domain: 'devops', tier: 3, weightedScore: 1 }),
    ]);
  });

  it('domain：三桶沿用；general 與缺席 → cross（未歸類，交 LLM 判定）', () => {
    const entries = [
      entry({ url: 'u1', domain: 'general' }),
      entry({ url: 'u2', domain: undefined }),
      entry({ url: 'u3', domain: 'devops' }),
    ];
    expect(candidatesFromSeen(entries, '2026-10-08', SOURCES).map((c) => c.domain)).toEqual([
      'cross',
      'cross',
      'devops',
    ]);
  });

  it('tier 查不到來源（已移除／改名）→ 預設 2；sources 缺席或空 → [sourceId]', () => {
    const entries = [
      entry({ url: 'u1', sourceId: 'removed-source', sources: undefined }),
      entry({ url: 'u2', sourceId: 'gh-vue', sources: [] }),
    ];
    const cands = candidatesFromSeen(entries, '2026-10-08', SOURCES);
    expect(cands[0]).toEqual(expect.objectContaining({ tier: 2, sources: ['removed-source'] }));
    expect(cands[1]).toEqual(expect.objectContaining({ tier: 3, sources: ['gh-vue'] }));
  });

  it('只取該台北日的條目；其他日期與無標題者不入候選', () => {
    const entries = [
      entry({ url: 'other-day', seenAt: '2026-10-08T20:07:00.000Z' }), // 台北 10/09
      entry({ url: 'no-title', title: undefined }),
      entry({ url: 'keep' }),
    ];
    expect(candidatesFromSeen(entries, '2026-10-08', SOURCES).map((c) => c.normalizedUrl)).toEqual(['keep']);
  });

  it('預設來源表為 NEWS_SOURCES：hn 為 Tier 1', () => {
    expect(candidatesFromSeen([entry()], '2026-10-08')[0].tier).toBe(1);
  });

  it('不改動輸入陣列（只讀 seenNews）', () => {
    const entries = [entry()];
    const before = JSON.stringify(entries);
    candidatesFromSeen(entries, '2026-10-08', SOURCES)[0].sources.push('mutated');
    expect(JSON.stringify(entries)).toBe(before);
  });
});
