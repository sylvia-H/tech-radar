import { Feed } from 'feed';
import { BoardState } from '../state/state.schema';

const PAGES_TITLE = 'Tech Radar';

/**
 * state → Atom XML 字串（research D4；`feed` 套件包裝）。`state.publish?.feed` 為空時回傳
 * 空 feed（0 entries），不擲錯（feed-page-contract.md C2）。
 */
export function renderFeed(state: BoardState, pagesUrl: string): string {
  const entries = state.publish?.feed ?? [];
  // 已依寫入順序由舊到新（trimFeed 修剪語意），輸出時反轉為新到舊（Atom/RSS 慣例）。
  const newestFirst = [...entries].reverse();

  const updated = newestFirst.length > 0 ? new Date(newestFirst[0].publishedAt) : new Date();

  const feed = new Feed({
    title: PAGES_TITLE,
    id: pagesUrl,
    link: pagesUrl,
    updated,
    copyright: '',
  });

  for (const entry of newestFirst) {
    feed.addItem({
      id: entry.id,
      title: entry.title,
      link: entry.url,
      date: new Date(entry.publishedAt),
    });
  }

  return feed.atom1();
}
