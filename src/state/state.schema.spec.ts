import {
  boardStateSchema,
  boardEntrySchema,
  introCacheSchema,
  seenNewsEntrySchema,
  emptyBoardState,
} from './state.schema';

describe('boardStateSchema', () => {
  it('空骨架含五個頂層欄位且通過驗證', () => {
    const skeleton = emptyBoardState();
    expect(Object.keys(skeleton).sort()).toEqual(
      ['board', 'intros', 'lastBoardPushAt', 'lastNewsPushAt', 'seenNews'].sort(),
    );
    expect(() => boardStateSchema.parse(skeleton)).not.toThrow();
  });

  it('缺任一頂層欄位即不合法', () => {
    const bad = emptyBoardState() as Record<string, unknown>;
    delete bad.seenNews;
    expect(boardStateSchema.safeParse(bad).success).toBe(false);
  });

  it('時間戳接受 null 或合法 ISO，拒絕非法字串', () => {
    expect(
      boardStateSchema.safeParse({
        ...emptyBoardState(),
        lastBoardPushAt: '2026-07-11T22:07:00.000Z',
      }).success,
    ).toBe(true);
    expect(
      boardStateSchema.safeParse({ ...emptyBoardState(), lastBoardPushAt: 'not-a-date' })
        .success,
    ).toBe(false);
  });
});

describe('子實體 schema 型別', () => {
  it('BoardEntry 完整欄位通過', () => {
    expect(
      boardEntrySchema.safeParse({
        fullName: 'owner/name',
        url: 'https://github.com/owner/name',
        language: 'TypeScript',
        domain: 'frontend',
        starsThisWeek: 10,
        rank: 1,
        firstSeenAt: '2026-07-11T22:07:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('BoardEntry domain 限四個 enum 值', () => {
    expect(
      boardEntrySchema.safeParse({
        fullName: 'o/n',
        url: 'https://github.com/o/n',
        language: null,
        domain: 'mobile',
        starsThisWeek: 0,
        rank: 1,
        firstSeenAt: '2026-07-11T22:07:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('IntroCache 與 SeenNewsEntry 型別', () => {
    expect(
      introCacheSchema.safeParse({ intro: '簡介', introAt: '2026-07-11T22:07:00.000Z' })
        .success,
    ).toBe(true);
    expect(
      seenNewsEntrySchema.safeParse({
        url: 'https://example.com/a',
        seenAt: '2026-07-11T22:07:00.000Z',
      }).success,
    ).toBe(true);
  });
});
