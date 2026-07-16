import { diffBoard, RANK_JUMP_THRESHOLD } from './board-diff';
import { PushBoard, PushBoardRow } from './diff.types';
import { BoardEntry } from '../state/state.schema';
import { Domain } from '../board/board.types';

function prow(
  rank: number,
  repoId: number,
  opts: { domain?: Domain; weekly?: number; fullName?: string } = {},
): PushBoardRow {
  const { domain = 'ai', weekly = 100, fullName = `o/r${repoId}` } = opts;
  return {
    rank,
    repoId,
    fullName,
    url: `https://github.com/${fullName}`,
    language: null,
    domain,
    weeklyStarsEstimate: weekly,
    totalStars: null,
  };
}

function pentry(rank: number, domain: Domain = 'ai', fullName = 'o/x'): BoardEntry {
  return {
    fullName,
    url: `https://github.com/${fullName}`,
    language: null,
    domain,
    starsThisWeek: 0,
    rank,
    firstSeenAt: '2026-07-01T00:00:00.000Z',
  };
}

function prev(entries: Record<number, BoardEntry>): Record<string, BoardEntry> {
  const out: Record<string, BoardEntry> = {};
  for (const [k, v] of Object.entries(entries)) {
    out[String(k)] = v;
  }
  return out;
}

describe('diffBoard 三類變化偵測（US1）', () => {
  it('常數 RANK_JUMP_THRESHOLD = 1', () => {
    expect(RANK_JUMP_THRESHOLD).toBe(1);
  });

  it('三類互斥且正確；掉出與穩定留榜靜默；順序依 currentRank 升序', () => {
    const p = prev({ 1: pentry(1), 2: pentry(2), 3: pentry(3), 4: pentry(4) });
    const push2: PushBoard = [
      prow(1, 1), // stable → 不出現（FR-012）
      prow(2, 3, { fullName: 'o/r3' }), // repo3：3 → 2 climbed
      prow(3, 5), // repo5 newcomer
      prow(5, 2, { fullName: 'o/r2' }), // repo2：2 → 5 declined
      // repo4 掉出（不在 push）→ 靜默（FR-011）
    ];
    const diff = diffBoard(p, push2);

    const byId = new Map(diff.changes.map((c) => [c.repoId, c]));
    expect(byId.get(1)).toBeUndefined(); // stable 靜默
    expect(byId.get(4)).toBeUndefined(); // 掉出靜默（FR-011）
    expect(byId.get(3)?.kind).toBe('climbed');
    expect(byId.get(5)?.kind).toBe('newcomer');
    expect(byId.get(2)?.kind).toBe('declined');
    // currentRank 升序：repo3(2) → repo5(3) → repo2(5)
    expect(diff.changes.map((c) => c.repoId)).toEqual([3, 5, 2]);
    expect(diff.unchanged).toBe(false);
  });

  it('冷啟動（prev 空）→ 全數新進、0 竄升 0 下降（FR-013/SC-003）', () => {
    const push: PushBoard = [prow(1, 1), prow(2, 2), prow(3, 3)];
    const diff = diffBoard({}, push);
    expect(diff.changes).toHaveLength(3);
    expect(diff.changes.every((c) => c.kind === 'newcomer')).toBe(true);
    expect(diff.changes.every((c) => c.previousRank === null)).toBe(true);
  });

  it('純位移（被新進擠下一名）照實計為下降（FR-010）', () => {
    const p = prev({ 1: pentry(1) });
    const push: PushBoard = [prow(1, 9), prow(2, 1)]; // repo9 新進佔 #1，repo1 由 1 → 2
    const diff = diffBoard(p, push);
    expect(diff.changes.find((c) => c.repoId === 1)?.kind).toBe('declined');
    expect(diff.changes.find((c) => c.repoId === 9)?.kind).toBe('newcomer');
  });

  it('更名／轉移擁有者仍以 repoId 判為同一 repo（FR-006）', () => {
    const p = prev({ 1: pentry(2, 'ai', 'old/name') });
    const push: PushBoard = [prow(1, 1, { fullName: 'new/name' })]; // 同 repoId=1、改名、2 → 1
    const diff = diffBoard(p, push);
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0].kind).toBe('climbed');
    expect(diff.changes[0].fullName).toBe('new/name'); // 呈現本次名稱
  });

  it('三類皆空 → unchanged=true 且 topEntry 為 #1（FR-014）', () => {
    const p = prev({ 1: pentry(1), 2: pentry(2) });
    const push: PushBoard = [prow(1, 1), prow(2, 2)];
    const diff = diffBoard(p, push);
    expect(diff.changes).toHaveLength(0);
    expect(diff.unchanged).toBe(true);
    expect(diff.topEntry.rank).toBe(1);
    expect(diff.topEntry.repoId).toBe(1);
  });

  it('變化總數 ≤10（SC-004）', () => {
    const push: PushBoard = Array.from({ length: 10 }, (_, i) => prow(i + 1, i + 1));
    const diff = diffBoard({}, push); // 全新進
    expect(diff.changes.length).toBeLessThanOrEqual(10);
    expect(diff.changes).toHaveLength(10);
  });

  it('needsIntro：新進/竄升 true、下降 false（FR-016）；previousRank 竄升/下降帶值、新進為 null', () => {
    const p2 = prev({ 10: pentry(1), 1: pentry(3) });
    const push2: PushBoard = [
      prow(1, 5), // repo5 newcomer
      prow(2, 1, { fullName: 'o/r1' }), // repo1：3 → 2 climbed
      prow(3, 10, { fullName: 'o/r10' }), // repo10：1 → 3 declined
    ];
    const diff = diffBoard(p2, push2);
    expect(diff.changes.find((c) => c.repoId === 5)?.needsIntro).toBe(true);
    expect(diff.changes.find((c) => c.repoId === 1)?.needsIntro).toBe(true);
    expect(diff.changes.find((c) => c.repoId === 10)?.needsIntro).toBe(false);
    // previousRank：竄升/下降帶值，新進為 null
    expect(diff.changes.find((c) => c.repoId === 5)?.previousRank).toBeNull();
    expect(diff.changes.find((c) => c.repoId === 1)?.previousRank).toBe(3);
    expect(diff.changes.find((c) => c.repoId === 10)?.previousRank).toBe(1);
  });

  it('跨領域邊界的 repo 其領域取本次（FR-015）', () => {
    const p = prev({ 1: pentry(2, 'ai') });
    const push: PushBoard = [prow(1, 1, { domain: 'frontend-backend' })]; // 同 repo，領域改變、2 → 1
    const diff = diffBoard(p, push);
    expect(diff.changes[0].domain).toBe('frontend-backend');
  });
});
