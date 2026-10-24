import { SeenNewsEntry } from '../state/state.schema';
import {
  RECENT_PUSHED_MAX,
  RECENT_PUSHED_TITLE_MAX,
  RECENT_PUSHED_WINDOW_DAYS,
  recentPushedTitles,
} from './recent-pushed';

const NOW = new Date('2026-10-17T20:30:00.000Z');
const daysAgo = (d: number): string => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const entry = (title: string | undefined, seenAt: string): SeenNewsEntry => ({
  url: `https://x.com/${title ?? 'none'}/${seenAt}`,
  seenAt,
  ...(title !== undefined ? { title } : {}),
});

describe('recentPushedTitles（近期已推標題投影，2026-10-17，ADR 0007）', () => {
  it('回看 5 天（使用者決策）、標題截 60 字、上限 100 則', () => {
    expect(RECENT_PUSHED_WINDOW_DAYS).toBe(5);
    expect(RECENT_PUSHED_TITLE_MAX).toBe(60);
    expect(RECENT_PUSHED_MAX).toBe(100);
  });

  it('只取視窗內帶標題者，新到舊排序；視窗外、無標題、壞時間、未來時間略過', () => {
    const seen = [
      entry('Old', daysAgo(6)),
      entry('Day4', daysAgo(4)),
      entry(undefined, daysAgo(1)),
      entry('   ', daysAgo(1)),
      entry('Day1', daysAgo(1)),
      { url: 'u', seenAt: 'not-a-date', title: 'Bad' },
      entry('Future', new Date(NOW.getTime() + 3_600_000).toISOString()),
    ];
    expect(recentPushedTitles(seen, NOW)).toEqual(['Day1', 'Day4']);
  });

  it('同標題去重；超過 60 code points 截斷加「…」', () => {
    const long = 'é'.repeat(70);
    const titles = recentPushedTitles([entry('Same', daysAgo(1)), entry('Same', daysAgo(2)), entry(long, daysAgo(3))], NOW);
    expect(titles).toEqual(['Same', `${'é'.repeat(60)}…`]);
  });

  it('超過上限只取最新的 maxTitles 則', () => {
    const seen = Array.from({ length: 5 }, (_, i) => entry(`T${i}`, daysAgo(i * 0.5)));
    expect(recentPushedTitles(seen, NOW, 5, 3)).toEqual(['T0', 'T1', 'T2']);
  });

  it('windowDays 為 0 → 空陣列（退場開關）', () => {
    expect(recentPushedTitles([entry('A', daysAgo(0.1))], NOW, 0)).toEqual([]);
  });
});
