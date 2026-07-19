import { pickPushBoard } from './push-board';
import { BoardRow, Domain, DomainBoard } from '../board/board.types';

function brow(
  repoId: number,
  weeklyStarsEstimate: number,
  domain: Domain,
  totalStars: number | null = null,
): BoardRow {
  return {
    rank: 0, // 領域內名次；F3 不使用（自行算綜合名次）
    repoId,
    fullName: `o/r${repoId}`,
    url: `https://github.com/o/r${repoId}`,
    domain,
    weeklyStarsEstimate,
    starsThisWeek: null,
    totalStars,
    language: null,
    sources: ['trending'],
    description: null,
    topics: [],
  };
}

function board(domain: Domain, rows: BoardRow[]): DomainBoard {
  return { domain, entries: rows };
}

const noPrev = new Set<number>();

describe('pickPushBoard 跨領域綜合 top 10（US1）', () => {
  it('保底每領域 2 席：AI 週增星輾壓時，前後端仍保留其最高 2 筆（SC-005）', () => {
    const ai = board(
      'ai',
      Array.from({ length: 10 }, (_, i) => brow(i + 1, 5000 - i, 'ai', 100000)),
    );
    const fb = board('frontend-backend', [
      brow(100, 30, 'frontend-backend', 500),
      brow(101, 20, 'frontend-backend', 400),
      brow(102, 10, 'frontend-backend', 300), // 第 3 名，不該進保底
    ]);
    const result = pickPushBoard([ai, fb], noPrev);

    expect(result).toHaveLength(10);
    const ids = result.map((r) => r.repoId);
    expect(ids).toContain(100);
    expect(ids).toContain(101);
    expect(ids).not.toContain(102);
    // 保底的前後端兩席在最終綜合排序中因週增星低而墊底
    const fbRanks = result.filter((r) => r.domain === 'frontend-backend').map((r) => r.rank);
    expect(fbRanks.sort((a, b) => a - b)).toEqual([9, 10]);
  });

  it('某領域不足 2 筆 → 照實取用，空席由另一領域依同一比較器遞補', () => {
    const ai = board(
      'ai',
      Array.from({ length: 15 }, (_, i) => brow(i + 1, 5000 - i, 'ai', 100000)),
    );
    const fb = board('frontend-backend', [brow(100, 30, 'frontend-backend', 500)]);
    const result = pickPushBoard([ai, fb], noPrev);

    expect(result).toHaveLength(10);
    const ids = result.map((r) => r.repoId);
    expect(ids).toContain(100); // 唯一的前後端候選仍入榜
    expect(result.filter((r) => r.domain === 'frontend-backend')).toHaveLength(1);
    expect(result.filter((r) => r.domain === 'ai')).toHaveLength(9);
  });

  it('候選總數 <10 → 照實 #1..#N，不湊數', () => {
    const ai = board('ai', [brow(1, 300, 'ai'), brow(2, 200, 'ai')]);
    const fb = board('frontend-backend', [brow(100, 100, 'frontend-backend')]);
    const result = pickPushBoard([ai, fb], noPrev);

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('綜合榜恆 ≤10 筆（SC-009），rank 連續由 1 起', () => {
    const ai = board(
      'ai',
      Array.from({ length: 20 }, (_, i) => brow(i + 1, 5000 - i, 'ai')),
    );
    const fb = board(
      'frontend-backend',
      Array.from({ length: 20 }, (_, i) => brow(100 + i, 4000 - i, 'frontend-backend')),
    );
    const result = pickPushBoard([ai, fb], noPrev);

    expect(result).toHaveLength(10);
    expect(result.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('打亂輸入順序重跑 10 次，名次序列一致（SC-008，相同候選＋相同 prevIds）', () => {
    const rows = [
      brow(1, 300, 'ai', 5000),
      brow(2, 300, 'ai', 5000), // 與 repo1 前兩層平手 → 靠 repoId
      brow(3, 900, 'ai', 100),
      brow(100, 250, 'frontend-backend', 800),
      brow(101, 250, 'frontend-backend', 800), // 與 repo100 平手
      brow(102, 150, 'frontend-backend', 200),
    ];
    const prevIds = new Set([2, 101]); // 部分為既有成員 → 觸發第 3 層
    const baseline = pickPushBoard(
      [board('ai', rows.filter((r) => r.domain === 'ai')), board('frontend-backend', rows.filter((r) => r.domain === 'frontend-backend'))],
      prevIds,
    ).map((r) => r.repoId);

    for (let i = 0; i < 10; i++) {
      const shuffled = [...rows].sort(() => Math.random() - 0.5);
      const ai = board('ai', shuffled.filter((r) => r.domain === 'ai'));
      const fb = board('frontend-backend', shuffled.filter((r) => r.domain === 'frontend-backend'));
      const seq = pickPushBoard([ai, fb], prevIds).map((r) => r.repoId);
      expect(seq).toEqual(baseline);
    }
  });

  it('候選 0 筆 → 回傳 []（呼叫端須依 FR-025 中止）', () => {
    expect(pickPushBoard([board('ai', []), board('frontend-backend', [])], noPrev)).toEqual([]);
  });
});
