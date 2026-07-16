import { Logger } from '@nestjs/common';
import {
  boardStateSchema,
  boardEntrySchema,
  introCacheSchema,
  seenNewsEntrySchema,
  emptyBoardState,
} from './state.schema';

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fullName: 'owner/name',
    url: 'https://github.com/owner/name',
    language: 'TypeScript',
    domain: 'ai',
    starsThisWeek: 10,
    rank: 1,
    firstSeenAt: '2026-07-11T22:07:00.000Z',
    ...overrides,
  };
}

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

describe('board 條目層寬鬆載入（FR-024）', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('含 domain:"devops" 的舊條目 → 剔除該條目 + 記錄警告、其餘條目照常載入、整份狀態不失效', () => {
    const parsed = boardStateSchema.parse({
      ...emptyBoardState(),
      board: {
        '111': entry({ domain: 'devops' }), // 舊 4-way 分類，已廢止
        '222': entry({ domain: 'ai' }),
        '333': entry({ domain: 'frontend-backend' }),
      },
    });
    expect(Object.keys(parsed.board).sort()).toEqual(['222', '333']);
    expect(parsed.board['111']).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('111');
  });

  it('條目缺欄位／型別錯 → 同樣剔除 + warn，不使整份狀態失效', () => {
    const parsed = boardStateSchema.parse({
      ...emptyBoardState(),
      board: {
        '111': { fullName: 'o/n' }, // 缺多數欄位
        '222': entry({ domain: 'ai' }),
      },
    });
    expect(Object.keys(parsed.board)).toEqual(['222']);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('全部條目合法 → 不 warn、原樣載入', () => {
    const parsed = boardStateSchema.parse({
      ...emptyBoardState(),
      board: { '222': entry({ domain: 'ai' }), '333': entry({ domain: 'frontend-backend' }) },
    });
    expect(Object.keys(parsed.board).sort()).toEqual(['222', '333']);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('根結構壞檔仍擲錯、不覆寫：board 非物件 → 擲錯（憲章 VI）', () => {
    expect(
      boardStateSchema.safeParse({ ...emptyBoardState(), board: 'not-object' }).success,
    ).toBe(false);
    expect(
      boardStateSchema.safeParse({ ...emptyBoardState(), board: null }).success,
    ).toBe(false);
  });
});

describe('子實體 schema 型別', () => {
  it('BoardEntry 完整欄位通過（2-way domain）', () => {
    expect(boardEntrySchema.safeParse(entry({ domain: 'frontend-backend' })).success).toBe(true);
    expect(boardEntrySchema.safeParse(entry({ domain: 'ai' })).success).toBe(true);
  });

  it('BoardEntry domain 僅限 2-way enum 值（舊 devops/frontend/backend 皆不合法）', () => {
    for (const domain of ['devops', 'frontend', 'backend', 'mobile']) {
      expect(boardEntrySchema.safeParse(entry({ domain })).success).toBe(false);
    }
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
