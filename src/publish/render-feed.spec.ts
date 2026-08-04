import { renderFeed } from './render-feed';
import { BoardState, emptyBoardState, FeedEntry } from '../state/state.schema';

const PAGES_URL = 'https://owner.github.io/repo/';

describe('renderFeed（US1，feed-page-contract.md C2）', () => {
  it('0 entries 時仍輸出合法 Atom XML，不擲錯', () => {
    const xml = renderFeed(emptyBoardState(), PAGES_URL);
    expect(xml).toContain('<?xml');
    expect(xml).toContain('<feed');
    expect(xml).toContain('Tech Radar');
    expect(xml).not.toContain('<entry>');
  });

  it('state.publish 存在但 feed 缺席時同樣輸出 0 entries 的合法 feed', () => {
    const state: BoardState = { ...emptyBoardState(), publish: {} };
    const xml = renderFeed(state, PAGES_URL);
    expect(xml).toContain('<feed');
    expect(xml).not.toContain('<entry>');
  });
});

describe('renderFeed — 榜單＋新聞混合 entries（US2，feed-page-contract.md C2）', () => {
  it('新到舊排序；三種 title 樣式（新聞原文／新進榜／竄升）皆正確；link 用 FeedEntry.url', () => {
    const entries: FeedEntry[] = [
      {
        id: 'news:https://example.com/a',
        type: 'news',
        title: 'AI 新聞標題',
        url: 'https://example.com/a',
        publishedAt: '2026-08-01T00:00:00.000Z',
      },
      {
        id: 'repo:1:new:2026-08-02',
        type: 'board-new',
        title: 'o/r1 新進榜',
        url: 'https://github.com/o/r1',
        publishedAt: '2026-08-02T00:00:00.000Z',
      },
      {
        id: 'repo:2:climbed:2026-08-03',
        type: 'board-climbed',
        title: 'o/r2 竄升',
        url: 'https://github.com/o/r2',
        publishedAt: '2026-08-03T00:00:00.000Z',
      },
    ];
    const state: BoardState = { ...emptyBoardState(), publish: { feed: entries } };
    const xml = renderFeed(state, PAGES_URL);

    expect(xml).toContain('AI 新聞標題');
    expect(xml).toContain('o/r1 新進榜');
    expect(xml).toContain('o/r2 竄升');
    expect(xml).toContain('https://github.com/o/r2');
    // 新到舊：最新（竄升，08-03）出現在最舊（新聞，08-01）之前。
    expect(xml.indexOf('o/r2 竄升')).toBeLessThan(xml.indexOf('AI 新聞標題'));
    // MUST NOT 帶星數等數值欄位。
    expect(xml).not.toMatch(/star|⭐/i);
  });
});
