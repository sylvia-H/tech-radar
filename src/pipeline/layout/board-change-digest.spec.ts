import { toBoardChangeDigest } from './board-change-digest';
import { BoardChange, BoardDiff, PushBoardRow } from '../../diff/diff.types';
import { Domain } from '../../board/board.types';

function change(kind: BoardChange['kind'], domain: Domain, repoId: number): BoardChange {
  return {
    kind,
    repoId,
    fullName: `o/r${repoId}`,
    url: `https://github.com/o/r${repoId}`,
    domain,
    weeklyStarsEstimate: 100,
    currentRank: repoId,
    previousRank: kind === 'newcomer' ? null : repoId + 1,
    needsIntro: kind !== 'declined',
  };
}

function topEntry(fullName = 'o/top'): PushBoardRow {
  return {
    rank: 1,
    repoId: 999,
    fullName,
    url: `https://github.com/${fullName}`,
    language: null,
    domain: 'ai',
    weeklyStarsEstimate: 9999,
    totalStars: null,
  };
}

describe('toBoardChangeDigest（research D6）', () => {
  it('依 kind 計數 newcomers/climbed/declined；domainCounts 只計新進+竄升（不含下降）', () => {
    const diff: BoardDiff = {
      changes: [
        change('newcomer', 'ai', 1),
        change('newcomer', 'frontend-backend', 2),
        change('climbed', 'ai', 3),
        change('declined', 'frontend-backend', 4),
      ],
      unchanged: false,
      topEntry: topEntry(),
      pushBoard: [],
    };

    const digest = toBoardChangeDigest(diff);

    expect(digest.newcomers).toBe(2);
    expect(digest.climbed).toBe(1);
    expect(digest.declined).toBe(1);
    expect(digest.domainCounts).toEqual({ ai: 2, 'frontend-backend': 1 }); // declined 的 fe 不計入
  });

  it('topName 取 diff.topEntry.fullName', () => {
    const diff: BoardDiff = {
      changes: [],
      unchanged: true,
      topEntry: topEntry('acme/leader'),
      pushBoard: [],
    };
    expect(toBoardChangeDigest(diff).topName).toBe('acme/leader');
  });

  it('無變化（changes 空）→ 三計數皆 0、domainCounts 皆 0', () => {
    const diff: BoardDiff = { changes: [], unchanged: true, topEntry: topEntry(), pushBoard: [] };
    const digest = toBoardChangeDigest(diff);
    expect(digest.newcomers).toBe(0);
    expect(digest.climbed).toBe(0);
    expect(digest.declined).toBe(0);
    expect(digest.domainCounts).toEqual({ ai: 0, 'frontend-backend': 0 });
  });
});
