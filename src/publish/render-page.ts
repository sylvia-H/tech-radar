import { BoardState } from '../state/state.schema';
import { DOMAINS, DOMAIN_LABELS } from '../board/board.types';
import { escapeHtml } from './html-escape';
import { taipeiDateLabel } from '../pipeline/layout/date-label';

/** `generatedAt`（ISO）→ 台北時間「XX 月 XX 日」標示（research D5、feed-page-contract.md C1）。 */
function formatGeneratedAt(iso: string): string {
  const [, month, day] = taipeiDateLabel(new Date(iso)).split('-');
  return `${month} 月 ${day} 日`;
}

function renderBoardSection(state: BoardState): string {
  const entries = Object.entries(state.board);
  if (entries.length === 0) {
    return '<section><h2>本週熱門 Github Repo 榜單</h2><p class="empty">尚無榜單資料</p></section>';
  }

  const groups = DOMAINS.map((domain) => {
    const rows = entries
      .filter(([, entry]) => entry.domain === domain)
      .sort(([, a], [, b]) => a.rank - b.rank);
    if (rows.length === 0) {
      return '';
    }
    const items = rows
      .map(([repoId, entry]) => {
        const intro = state.intros[repoId]?.intro;
        const introHtml = intro ? `<p class="intro">${escapeHtml(intro)}</p>` : '';
        return `<li>
          <a href="${escapeHtml(entry.url)}">#${entry.rank} ${escapeHtml(entry.fullName)}</a>
          <span class="meta">${entry.language ? escapeHtml(entry.language) + ' · ' : ''}⭐ +${entry.starsThisWeek}</span>
          ${introHtml}
        </li>`;
      })
      .join('\n');
    return `<h3>${escapeHtml(DOMAIN_LABELS[domain])}</h3><ul>${items}</ul>`;
  }).join('\n');

  return `<section><h2>本週熱門 Github Repo 榜單</h2>${groups}</section>`;
}

function renderBoardSummarySection(state: BoardState): string {
  const boardSummary = state.publish?.boardSummary;
  if (!boardSummary) {
    return '<section><h2>上次榜單變化摘要</h2><p class="empty">尚無榜單變化紀錄</p></section>';
  }
  return `<section>
    <h2>上次榜單變化摘要 <span class="generated-at">（${formatGeneratedAt(boardSummary.generatedAt)}）</span></h2>
    <p>${escapeHtml(boardSummary.summary)}</p>
  </section>`;
}

function renderNewsSection(state: BoardState): string {
  const news = state.publish?.news;
  if (!news) {
    return '<section><h2>今日精選新聞</h2><p class="empty">尚無新聞精選</p></section>';
  }
  const items = news.items
    .map((item) => {
      const title = `<a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a>`;
      if (item.content === null) {
        // 策展降級項：只輸出標題與連結，不印出字面 null（feed-page-contract.md C1）。
        return `<li>${title}</li>`;
      }
      return `<li>${title}<p>${escapeHtml(item.content)}</p></li>`;
    })
    .join('\n');
  return `<section>
    <h2>今日精選新聞 <span class="generated-at">（${formatGeneratedAt(news.generatedAt)}）</span></h2>
    <ul>${items}</ul>
  </section>`;
}

const STYLE = `
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; }
  h1 { font-size: 1.5rem; }
  h2 { font-size: 1.2rem; border-bottom: 1px solid #ccc; padding-bottom: 0.3rem; }
  .generated-at { font-weight: normal; font-size: 0.85rem; color: #666; }
  .meta { font-size: 0.85rem; color: #666; }
  .intro { margin: 0.2rem 0 0.8rem; font-size: 0.9rem; }
  .empty { color: #888; }
  ul { list-style: none; padding: 0; }
  li { margin-bottom: 0.8rem; }
  hr { margin: 0 0 5rem 0; border: none; }
`;

/** state → 儀表板 HTML（research D5）。state.publish 為 undefined 時渲染空狀態，不擲錯。 */
export function renderPage(state: BoardState, now: Date): string {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tech Radar</title>
<link rel="alternate" type="application/atom+xml" title="Tech Radar" href="./feed.xml">
<style>${STYLE}</style>
</head>
<body>
<h1>Tech Radar</h1>
${renderNewsSection(state)}
<hr />
${renderBoardSection(state)}
${renderBoardSummarySection(state)}
<footer><p class="meta">最後更新：${escapeHtml(now.toISOString())}</p></footer>
</body>
</html>`;
}
