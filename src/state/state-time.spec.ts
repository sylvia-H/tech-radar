import { nowIso } from './state-time';
import { boardStateSchema, emptyBoardState } from './state.schema';

describe('nowIso', () => {
  it('回傳注入 Date 的 toISOString()，且通過狀態 schema 的時間戳驗證', () => {
    const at = new Date('2026-10-24T01:02:03.004Z');
    expect(nowIso(at)).toBe('2026-10-24T01:02:03.004Z');
    expect(
      boardStateSchema.safeParse({ ...emptyBoardState(), lastNewsPushAt: nowIso(at) }).success,
    ).toBe(true);
  });

  it('未注入時取當下時間', () => {
    const before = Date.now();
    const value = Date.parse(nowIso());
    expect(value).toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(Date.now());
  });
});
