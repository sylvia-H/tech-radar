import { buildCoverEmbed, buildRepoCard, domainColor } from './board-embeds';
import { BoardChange, BoardDiff, PushBoardRow } from '../../diff/diff.types';
import { BoardRow } from '../../board/board.types';
import { IntroResult } from '../../intro/intro.types';
import { COLOR_AI, COLOR_BOARD_COVER, COLOR_FRONTEND_BACKEND } from '../../discord/discord.embed';

function topEntry(): PushBoardRow {
  return {
    rank: 1,
    repoId: 1,
    fullName: 'o/top',
    url: 'https://github.com/o/top',
    language: null,
    domain: 'ai',
    weeklyStarsEstimate: 9999,
    totalStars: null,
  };
}

function change(overrides: Partial<BoardChange> = {}): BoardChange {
  return {
    kind: 'newcomer',
    repoId: 42,
    fullName: 'acme/agent-sandbox',
    url: 'https://github.com/acme/agent-sandbox',
    domain: 'ai',
    weeklyStarsEstimate: 8600,
    currentRank: 1,
    previousRank: null,
    needsIntro: true,
    ...overrides,
  };
}

function row(overrides: Partial<BoardRow> = {}): BoardRow {
  return {
    rank: 1,
    repoId: 42,
    fullName: 'acme/agent-sandbox',
    url: 'https://github.com/acme/agent-sandbox',
    domain: 'ai',
    weeklyStarsEstimate: 8600,
    starsThisWeek: 8600,
    totalStars: 20000,
    language: 'Rust',
    sources: ['trending'],
    description: null,
    topics: [],
    ...overrides,
  };
}

describe('buildCoverEmbed（contract discord-layout.md L2）', () => {
  it('組出封面：title/color 正確、description 含 TL;DR', () => {
    const diff: BoardDiff = { changes: [], unchanged: true, topEntry: topEntry(), pushBoard: [] };
    const embed = buildCoverEmbed({ summary: '本週榜單無變化', degraded: true }, diff, '2026-07-19');
    expect(embed.title).toBe('📊 榜單變化 · 2026-07-19');
    expect(embed.color).toBe(COLOR_BOARD_COVER);
    expect(embed.description).toContain('本週榜單無變化');
    expect(embed.description).not.toContain('🔻 下降');
  });

  it('diff.unchanged 時仍推封面（FR-012），description 帶「本次無變化」語意（由 F6 summary 提供）', () => {
    const diff: BoardDiff = { changes: [], unchanged: true, topEntry: topEntry(), pushBoard: [] };
    const embed = buildCoverEmbed({ summary: '本次無變化', degraded: true }, diff, '2026-07-19');
    expect(embed).toBeDefined();
    expect(embed.description).toContain('本次無變化');
  });

  it('有下降項 → 附加「🔻 下降」一行式列表 `[fullName](url) #prev → #curr`', () => {
    const declined = change({
      kind: 'declined',
      fullName: 'owner/vue-thing',
      url: 'https://github.com/owner/vue-thing',
      previousRank: 3,
      currentRank: 8,
      needsIntro: false,
    });
    const diff: BoardDiff = {
      changes: [declined],
      unchanged: false,
      topEntry: topEntry(),
      pushBoard: [],
    };
    const embed = buildCoverEmbed({ summary: 'AI 沙箱工具爆紅進榜', degraded: false }, diff, '2026-07-09');
    expect(embed.description).toContain('🔻 下降');
    expect(embed.description).toContain('[owner/vue-thing](https://github.com/owner/vue-thing) #3 → #8');
  });
});

describe('buildRepoCard（contract discord-layout.md L3）', () => {
  it('新進卡：🆕 標題、url 可點、領域配色、fields 含本週增星/語言/領域', () => {
    const c = change();
    const intro: IntroResult = { status: 'cached', intro: '一段簡介' };
    const embed = buildRepoCard(c, intro, row());

    expect(embed.title).toBe('🆕 acme/agent-sandbox');
    expect(embed.url).toBe('https://github.com/acme/agent-sandbox');
    expect(embed.color).toBe(COLOR_AI);
    expect(embed.description).toBe('一段簡介');
    expect(embed.fields).toEqual([
      { name: '本週增星', value: '⭐ +8.6k', inline: true },
      { name: '語言', value: '`Rust`', inline: true },
      { name: '領域', value: 'AI', inline: true },
    ]);
  });

  it('竄升卡：🔺 標題、fields 帶名次變化（非領域）', () => {
    const c = change({
      kind: 'climbed',
      fullName: 'acme/gitops-x',
      url: 'https://github.com/acme/gitops-x',
      domain: 'frontend-backend',
      previousRank: 9,
      currentRank: 3,
      weeklyStarsEstimate: 11000,
    });
    const intro: IntroResult = { status: 'generated', intro: '宣告式部署工具', introAt: '2026-07-19T00:00:00.000Z' };
    const embed = buildRepoCard(c, intro, row({ domain: 'frontend-backend', language: 'Go', starsThisWeek: 11000 }));

    expect(embed.title).toBe('🔺 acme/gitops-x');
    expect(embed.color).toBe(COLOR_FRONTEND_BACKEND);
    expect(embed.fields).toEqual([
      { name: '本週增星', value: '⭐ +11k', inline: true },
      { name: '語言', value: '`Go`', inline: true },
      { name: '名次', value: '#9 → #3', inline: true },
    ]);
  });

  it('簡介降級（status=degraded）→ 以「（簡介暫缺）」前綴呈現、與正常簡介卡可區分', () => {
    const c = change();
    const intro: IntroResult = { status: 'degraded', description: '一段原始 description' };
    const embed = buildRepoCard(c, intro, row());
    expect(embed.description).toBe('（簡介暫缺）一段原始 description');
    expect(embed.description).not.toBe('一段原始 description');
  });

  it('row.starsThisWeek 為 null → fallback 至 change.weeklyStarsEstimate', () => {
    const c = change({ weeklyStarsEstimate: 5000 });
    const intro: IntroResult = { status: 'cached', intro: 'x' };
    const embed = buildRepoCard(c, intro, row({ starsThisWeek: null }));
    expect(embed.fields![0].value).toBe('⭐ +5.0k'); // compact()：<10k 帶一位小數，與 8.6k/11k 同慣例
  });

  it('row.language 為 null → 語言欄顯示 —', () => {
    const c = change();
    const intro: IntroResult = { status: 'cached', intro: 'x' };
    const embed = buildRepoCard(c, intro, row({ language: null }));
    expect(embed.fields![1].value).toBe('`—`');
  });
});

describe('domainColor', () => {
  it('ai → COLOR_AI；frontend-backend → COLOR_FRONTEND_BACKEND', () => {
    expect(domainColor('ai')).toBe(COLOR_AI);
    expect(domainColor('frontend-backend')).toBe(COLOR_FRONTEND_BACKEND);
  });
});
