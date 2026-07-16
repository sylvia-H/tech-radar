import { compareForPushBoard, RankInput } from './rank-compare';

function row(repoId: number, weeklyStarsEstimate: number, totalStars: number | null = null): RankInput {
  return { repoId, weeklyStarsEstimate, totalStars };
}

describe('compareForPushBoard 四層全序（FR-004/SC-008）', () => {
  const noPrev = new Set<number>();

  it('第 1 層：weeklyStarsEstimate 降序', () => {
    const cmp = compareForPushBoard(noPrev);
    expect(cmp(row(1, 100), row(2, 50))).toBeLessThan(0);
    expect(cmp(row(1, 50), row(2, 100))).toBeGreaterThan(0);
  });

  it('第 2 層：週增星相同時以 totalStars ?? 0 降序', () => {
    const cmp = compareForPushBoard(noPrev);
    expect(cmp(row(1, 100, 9000), row(2, 100, 100))).toBeLessThan(0);
    expect(cmp(row(1, 100, 100), row(2, 100, 9000))).toBeGreaterThan(0);
  });

  it('totalStars 為 null 視為最低（排在有值者之後）', () => {
    const cmp = compareForPushBoard(noPrev);
    expect(cmp(row(1, 100, null), row(2, 100, 1))).toBeGreaterThan(0);
    expect(cmp(row(1, 100, 1), row(2, 100, null))).toBeLessThan(0);
  });

  it('第 3 層：前兩層平手時，新進者（不在 prevIds）排在既有成員之前', () => {
    const cmp = compareForPushBoard(new Set([2])); // repo 2 為既有成員、repo 1 為新進
    expect(cmp(row(1, 100, 500), row(2, 100, 500))).toBeLessThan(0);
    expect(cmp(row(2, 100, 500), row(1, 100, 500))).toBeGreaterThan(0);
  });

  it('第 4 層：前三層全平手（同為新進、同週增星、同總星）→ 僅靠 repoId 升序分出、永不回傳 0', () => {
    const cmp = compareForPushBoard(noPrev);
    expect(cmp(row(3, 100, 500), row(7, 100, 500))).toBeLessThan(0);
    expect(cmp(row(7, 100, 500), row(3, 100, 500))).toBeGreaterThan(0);
  });

  it('兩個既有成員前兩層平手 → 第 3 層同為既有、由第 4 層 repoId 決勝', () => {
    const cmp = compareForPushBoard(new Set([3, 7]));
    expect(cmp(row(3, 100, 500), row(7, 100, 500))).toBeLessThan(0);
    expect(cmp(row(7, 100, 500), row(3, 100, 500))).toBeGreaterThan(0);
  });
});
