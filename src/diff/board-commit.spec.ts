import { commitBoardPush } from './board-commit';
import { PushBoard, PushBoardRow, BoardDiff } from './diff.types';
import { BoardEntry, BoardState, emptyBoardState } from '../state/state.schema';
import { Domain } from '../board/board.types';
import { BoardChangeSummary } from '../curation/board-summary.types';

const SUMMARY: BoardChangeSummary = { summary: '本次無明顯變化', degraded: false };

/** 不涉及 feed 併入的既有測試共用一份空 diff（changes 為空 → makeBoardFeedEntries 回傳 []）。 */
const EMPTY_DIFF: BoardDiff = {
  changes: [],
  unchanged: true,
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

function prow(
  rank: number,
  repoId: number,
  opts: { domain?: Domain; weekly?: number; language?: string | null } = {},
): PushBoardRow {
  const { domain = 'ai', weekly = 100, language = 'TypeScript' } = opts;
  return {
    rank,
    repoId,
    fullName: `o/r${repoId}`,
    url: `https://github.com/o/r${repoId}`,
    language,
    domain,
    weeklyStarsEstimate: weekly,
    totalStars: 5000,
  };
}

function entry(rank: number, firstSeenAt: string): BoardEntry {
  return {
    fullName: 'o/prev',
    url: 'https://github.com/o/prev',
    language: null,
    domain: 'ai',
    starsThisWeek: 1,
    rank,
    firstSeenAt,
  };
}

const PUSHED_AT = new Date('2026-07-15T22:00:00.000Z');
const OLD_SEEN = '2026-07-01T00:00:00.000Z';

describe('commitBoardPush 單一狀態提交點（US3）', () => {
  it('board 由 pushBoard 重建、≤10 筆、不含追蹤深度 30 筆（FR-005/SC-009）', () => {
    const push: PushBoard = Array.from({ length: 10 }, (_, i) => prow(i + 1, i + 1));
    const next = commitBoardPush(emptyBoardState(), push, PUSHED_AT, EMPTY_DIFF, SUMMARY);
    expect(Object.keys(next.board)).toHaveLength(10);
    expect(Object.keys(next.board).sort()).toEqual(
      Array.from({ length: 10 }, (_, i) => String(i + 1)).sort(),
    );
  });

  it('rank 存綜合名次；starsThisWeek 欄位存入 weeklyStarsEstimate（統一尺）', () => {
    const push: PushBoard = [prow(1, 42, { weekly: 8600 })];
    const next = commitBoardPush(emptyBoardState(), push, PUSHED_AT, EMPTY_DIFF, SUMMARY);
    expect(next.board['42'].rank).toBe(1);
    expect(next.board['42'].starsThisWeek).toBe(8600);
    expect(next.board['42'].language).toBe('TypeScript');
    expect(next.board['42'].domain).toBe('ai');
  });

  it('lastBoardPushAt 與 board 同一次回傳（FR-021 禁止半套）', () => {
    const push: PushBoard = [prow(1, 1)];
    const next = commitBoardPush(emptyBoardState(), push, PUSHED_AT, EMPTY_DIFF, SUMMARY);
    expect(next.lastBoardPushAt).toBe(PUSHED_AT.toISOString());
    expect(Object.keys(next.board)).toHaveLength(1);
  });

  it('firstSeenAt：既有成員沿用 prev、新進者用 pushedAt', () => {
    const state: BoardState = {
      ...emptyBoardState(),
      board: { '1': entry(3, OLD_SEEN) }, // repo1 既有
    };
    const push: PushBoard = [prow(1, 1), prow(2, 2)]; // repo1 留榜、repo2 新進
    const next = commitBoardPush(state, push, PUSHED_AT, EMPTY_DIFF, SUMMARY);
    expect(next.board['1'].firstSeenAt).toBe(OLD_SEEN); // 沿用
    expect(next.board['2'].firstSeenAt).toBe(PUSHED_AT.toISOString()); // 新進
  });

  it('掉出後重回者 firstSeenAt 重設（prev 已無該條目 → 視為新進）', () => {
    const state: BoardState = { ...emptyBoardState(), board: {} }; // repo1 上輪已掉出
    const push: PushBoard = [prow(1, 1)];
    const next = commitBoardPush(state, push, PUSHED_AT, EMPTY_DIFF, SUMMARY);
    expect(next.board['1'].firstSeenAt).toBe(PUSHED_AT.toISOString());
  });

  it('intros/seenNews/lastNewsPushAt 原樣帶回；掉出 top 10 者的簡介快取不清除（FR-023/SC-007）', () => {
    const state: BoardState = {
      ...emptyBoardState(),
      lastNewsPushAt: '2026-07-14T00:00:00.000Z',
      board: { '999': entry(1, OLD_SEEN) }, // repo999 本次將掉出
      intros: { '999': { intro: '掉出者的簡介', introAt: OLD_SEEN } },
      seenNews: [{ url: 'https://example.com/a', seenAt: OLD_SEEN }],
    };
    const push: PushBoard = [prow(1, 1)]; // 只有 repo1，repo999 掉出
    const next = commitBoardPush(state, push, PUSHED_AT, EMPTY_DIFF, SUMMARY);

    expect(next.board['999']).toBeUndefined(); // 自 board 移除
    expect(next.intros['999']).toEqual({ intro: '掉出者的簡介', introAt: OLD_SEEN }); // 簡介不清除
    expect(next.seenNews).toEqual(state.seenNews);
    expect(next.lastNewsPushAt).toBe('2026-07-14T00:00:00.000Z');
  });

  it('純函式：不修改傳入的 state', () => {
    const state = emptyBoardState();
    const snapshot = JSON.stringify(state);
    commitBoardPush(state, [prow(1, 1)], PUSHED_AT, EMPTY_DIFF, SUMMARY);
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

describe('commitBoardPush — publish.boardSummary（F8, state-write-contract.md C1）', () => {
  it('state.publish 原本為 undefined → 寫入 publish.boardSummary，其餘 publish 欄位不存在', () => {
    const next = commitBoardPush(emptyBoardState(), [prow(1, 1)], PUSHED_AT, EMPTY_DIFF, SUMMARY);
    expect(next.publish?.boardSummary).toEqual({
      summary: SUMMARY.summary,
      generatedAt: PUSHED_AT.toISOString(),
    });
  });

  it('state.publish 已有既存值 → boardSummary 更新，其餘既有 publish 欄位保留', () => {
    const state: BoardState = {
      ...emptyBoardState(),
      publish: {
        news: { items: [], generatedAt: OLD_SEEN },
        boardSummary: { summary: '舊摘要', generatedAt: OLD_SEEN },
      },
    };
    const next = commitBoardPush(state, [prow(1, 1)], PUSHED_AT, EMPTY_DIFF, SUMMARY);
    expect(next.publish?.boardSummary).toEqual({
      summary: SUMMARY.summary,
      generatedAt: PUSHED_AT.toISOString(),
    });
    expect(next.publish?.news).toEqual(state.publish!.news); // 既有欄位保留
  });
});

describe('commitBoardPush — publish.feed（US2，state-write-contract.md C1）', () => {
  function boardChange(overrides: Partial<import('./diff.types').BoardChange> = {}) {
    return {
      kind: 'newcomer' as const,
      repoId: 1,
      fullName: 'o/r1',
      url: 'https://github.com/o/r1',
      domain: 'ai' as const,
      weeklyStarsEstimate: 100,
      currentRank: 1,
      previousRank: null,
      needsIntro: true,
      ...overrides,
    };
  }

  it('併入本次榜單事件（newcomer/climbed），declined 排除', () => {
    const diff: BoardDiff = {
      ...EMPTY_DIFF,
      changes: [
        boardChange({ kind: 'newcomer', repoId: 1 }),
        boardChange({ kind: 'climbed', repoId: 2, fullName: 'o/r2' }),
        boardChange({ kind: 'declined', repoId: 3, fullName: 'o/r3' }),
      ],
    };
    const next = commitBoardPush(emptyBoardState(), [prow(1, 1)], PUSHED_AT, diff, SUMMARY);
    const ids = next.publish?.feed?.map((e) => e.id) ?? [];
    expect(ids).toEqual(
      expect.arrayContaining(['repo:1:new:2026-07-16', 'repo:2:climbed:2026-07-16']),
    );
    expect(ids.some((id) => id.startsWith('repo:3:'))).toBe(false);
  });

  it('併入既有 publish.feed 之後修剪至 50 筆', () => {
    const existing = Array.from({ length: 49 }, (_, i) => ({
      id: `news:${i}`,
      type: 'news' as const,
      title: `t${i}`,
      url: `https://example.com/${i}`,
      publishedAt: OLD_SEEN,
    }));
    const state: BoardState = { ...emptyBoardState(), publish: { feed: existing } };
    const diff: BoardDiff = {
      ...EMPTY_DIFF,
      changes: [
        boardChange({ kind: 'newcomer', repoId: 1 }),
        boardChange({ kind: 'climbed', repoId: 2, fullName: 'o/r2' }),
      ],
    };
    const next = commitBoardPush(state, [prow(1, 1)], PUSHED_AT, diff, SUMMARY);
    expect(next.publish?.feed).toHaveLength(50);
  });
});
