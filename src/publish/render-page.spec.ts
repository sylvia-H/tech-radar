import { renderPage } from './render-page';
import { BoardState, emptyBoardState } from '../state/state.schema';
import { CuratedNewsItem } from '../curation/curation.types';

const NOW = new Date('2026-08-04T22:00:00.000Z');

function curatedItem(overrides: Partial<CuratedNewsItem> = {}): CuratedNewsItem {
  return {
    title: 'AI News',
    content: '內容摘要',
    url: 'https://example.com/a',
    domain: 'ai',
    sourceCount: 1,
    weightedScore: 100,
    degraded: false,
    ...overrides,
  };
}

function fullState(): BoardState {
  return {
    ...emptyBoardState(),
    board: {
      '1': {
        fullName: 'o/ai-repo',
        url: 'https://github.com/o/ai-repo',
        language: 'Python',
        domain: 'ai',
        starsThisWeek: 1200,
        rank: 1,
        firstSeenAt: '2026-08-01T00:00:00.000Z',
      },
      '2': {
        fullName: 'o/fe-repo',
        url: 'https://github.com/o/fe-repo',
        language: 'TypeScript',
        domain: 'frontend-backend',
        starsThisWeek: 300,
        rank: 1,
        firstSeenAt: '2026-08-01T00:00:00.000Z',
      },
    },
    intros: { '1': { intro: '一個 AI repo', introAt: '2026-08-01T00:00:00.000Z' } },
    publish: {
      boardSummary: { summary: '本次新進 1 個 repo', generatedAt: '2026-08-04T22:00:00.000Z' },
      news: { items: [curatedItem()], generatedAt: '2026-08-04T22:00:00.000Z' },
    },
  };
}

describe('renderPage（US1，feed-page-contract.md C1）', () => {
  it('完整資料：三區塊依序呈現榜單（依 domain 分區、依 rank 升冪）、變化摘要、精選新聞', () => {
    const html = renderPage(fullState(), NOW);
    expect(html).toContain('o/ai-repo');
    expect(html).toContain('o/fe-repo');
    expect(html).toContain('一個 AI repo');
    expect(html).toContain('本次新進 1 個 repo');
    expect(html).toContain('AI News');
    expect(html).toContain('內容摘要');
    expect(html.indexOf('今日精選新聞')).toBeLessThan(html.indexOf('本週熱門 Github Repo 榜單'));
    expect(html.indexOf('本週熱門 Github Repo 榜單')).toBeLessThan(html.indexOf('上次榜單變化摘要'));
  });

  it('emptyBoardState 空狀態：三區塊皆顯示「尚無」文案，不擲錯', () => {
    const html = renderPage(emptyBoardState(), NOW);
    expect(html).toContain('尚無榜單資料');
    expect(html).toContain('尚無榜單變化紀錄');
    expect(html).toContain('尚無新聞精選');
  });

  it('HTML escape：標題/簡介含 < & 等字元時不破壞頁面結構', () => {
    const state = fullState();
    state.intros['1'].intro = '<script>alert(1)</script> & "quote"';
    state.publish!.news!.items[0].title = 'Title <b>bold</b> & more';
    const html = renderPage(state, NOW);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('Title &lt;b&gt;bold&lt;/b&gt; &amp; more');
  });

  it('新聞則 content 為 null（策展降級項）：只輸出標題與連結，不印出字面 null，該則仍呈現', () => {
    const state = fullState();
    state.publish!.news!.items = [curatedItem({ title: '降級新聞', content: null })];
    const html = renderPage(state, NOW);
    expect(html).toContain('降級新聞');
    expect(html).not.toMatch(/>null</);
    expect(html).not.toContain('>null<');
  });
});
