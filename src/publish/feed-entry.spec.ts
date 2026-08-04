import { newsFeedId, boardFeedId, makeBoardFeedEntries, makeNewsFeedEntries, trimFeed } from './feed-entry';
import { BoardChange, BoardDiff } from '../diff/diff.types';
import { CuratedNewsItem } from '../curation/curation.types';
import { FeedEntry } from '../state/state.schema';

const NOW = new Date('2026-08-04T22:00:00.000Z');

function change(overrides: Partial<BoardChange> = {}): BoardChange {
  return {
    kind: 'newcomer',
    repoId: 1,
    fullName: 'o/r1',
    url: 'https://github.com/o/r1',
    domain: 'ai',
    weeklyStarsEstimate: 100,
    currentRank: 1,
    previousRank: null,
    needsIntro: true,
    ...overrides,
  };
}

function diffOf(changes: BoardChange[]): BoardDiff {
  return {
    changes,
    unchanged: changes.length === 0,
    topEntry: {
      rank: 1,
      repoId: 1,
      fullName: 'o/r1',
      url: 'https://github.com/o/r1',
      language: null,
      domain: 'ai',
      weeklyStarsEstimate: 100,
      totalStars: null,
    },
    pushBoard: [],
  };
}

function curatedItem(overrides: Partial<CuratedNewsItem> = {}): CuratedNewsItem {
  return {
    title: 'News',
    content: 'content',
    url: 'https://example.com/a',
    domain: 'ai',
    sourceCount: 1,
    weightedScore: 100,
    degraded: false,
    ...overrides,
  };
}

describe('newsFeedId / boardFeedId — GUID 命名空間（research D9）', () => {
  it('news:／repo: 前綴不碰撞', () => {
    expect(newsFeedId('https://example.com/a')).toBe('news:https://example.com/a');
    expect(boardFeedId(1, 'new', '2026-08-04')).toBe('repo:1:new:2026-08-04');
    expect(newsFeedId('x')).not.toBe(boardFeedId(1, 'new', 'x'));
  });

  it('榜單 id 字面樣式：repo:{repoId}:new:{dateLabel} / repo:{repoId}:climbed:{dateLabel}（鎖住映射，不得無聲改名）', () => {
    expect(boardFeedId(42, 'new', '2026-08-04')).toBe('repo:42:new:2026-08-04');
    expect(boardFeedId(42, 'climbed', '2026-08-04')).toBe('repo:42:climbed:2026-08-04');
  });
});

describe('makeBoardFeedEntries（FR-003，data-model.md §2.2 映射表）', () => {
  it('newcomer → kind "new"、type "board-new"', () => {
    const diff = diffOf([change({ kind: 'newcomer', repoId: 1 })]);
    const entries = makeBoardFeedEntries(diff, '2026-08-04', NOW);
    expect(entries).toEqual([
      { id: 'repo:1:new:2026-08-04', type: 'board-new', title: 'o/r1 新進榜', url: 'https://github.com/o/r1', publishedAt: NOW.toISOString() },
    ]);
  });

  it('climbed → kind "climbed"、type "board-climbed"', () => {
    const diff = diffOf([change({ kind: 'climbed', repoId: 2, fullName: 'o/r2' })]);
    const entries = makeBoardFeedEntries(diff, '2026-08-04', NOW);
    expect(entries).toEqual([
      { id: 'repo:2:climbed:2026-08-04', type: 'board-climbed', title: 'o/r2 竄升', url: entries[0].url, publishedAt: NOW.toISOString() },
    ]);
  });

  it('declined 不產生 entry（FR-003）', () => {
    const diff = diffOf([
      change({ kind: 'declined', repoId: 3 }),
      change({ kind: 'newcomer', repoId: 4 }),
    ]);
    const entries = makeBoardFeedEntries(diff, '2026-08-04', NOW);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toContain('repo:4:');
  });

  it('同一 repo 不同 dateLabel（跨天重回／再次竄升）→ 不同 id', () => {
    const diff = diffOf([change({ kind: 'newcomer', repoId: 1 })]);
    const first = makeBoardFeedEntries(diff, '2026-08-04', NOW);
    const second = makeBoardFeedEntries(diff, '2026-08-11', NOW);
    expect(first[0].id).not.toBe(second[0].id);
  });
});

describe('makeNewsFeedEntries（FR-004，id 正規化落點）', () => {
  it('id 為 news:normalizeTargetUrl(item.url)，url 欄位保留未正規化原始連結', () => {
    const items = [curatedItem({ url: 'https://example.com/a?utm_source=x' })];
    const entries = makeNewsFeedEntries(items, NOW);
    expect(entries[0].id).toBe('news:https://example.com/a');
    expect(entries[0].url).toBe('https://example.com/a?utm_source=x');
  });

  it('同一則新聞的兩個等價原始 URL（帶/不帶追蹤參數）產生同一個 id', () => {
    const items = [
      curatedItem({ url: 'https://example.com/a?utm_source=x' }),
      curatedItem({ url: 'https://example.com/a' }),
    ];
    const entries = makeNewsFeedEntries(items, NOW);
    expect(entries[0].id).toBe(entries[1].id);
  });
});

describe('trimFeed（research D8）', () => {
  function entries(n: number): FeedEntry[] {
    return Array.from({ length: n }, (_, i) => ({
      id: `news:${i}`,
      type: 'news' as const,
      title: `t${i}`,
      url: `https://example.com/${i}`,
      publishedAt: NOW.toISOString(),
    }));
  }

  it('未超過上限時原樣回傳', () => {
    const e = entries(10);
    expect(trimFeed(e, 50)).toEqual(e);
  });

  it('超過上限時從陣列前端移除最舊者，保留最新 limit 筆', () => {
    const e = entries(55);
    const trimmed = trimFeed(e, 50);
    expect(trimmed).toHaveLength(50);
    expect(trimmed[0].id).toBe('news:5'); // 前 5 筆（最舊）被移除
    expect(trimmed[49].id).toBe('news:54');
  });
});
