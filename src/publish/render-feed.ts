import { Feed } from 'feed';
import { BoardState } from '../state/state.schema';

const PAGES_TITLE = 'Tech Radar';

/**
 * feed 層 `atom:author` 的名稱。RFC 4287 §4.1.2 規定每則 entry MUST 有 author，但 feed 層備有
 * author 時 entry 可省略——故此處填一個固定值即滿足全篇。這是「本 feed 的發行者」，與第三方文章
 * 的原作者無關（我們也沒有那項資料），因此永遠不會缺值。
 */
const FEED_AUTHOR = 'Tech Radar';

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
    // RFC 4287 §4.1.1 SHOULD：feed 應有一個指向自身的 rel="self" link，供閱讀器與驗證器定位。
    // `feed` 套件由 `feedLinks.atom` 產出該 link（見 node_modules/feed/lib/atom1.js）。
    feedLinks: { atom: `${pagesUrl}feed.xml` },
    author: { name: FEED_AUTHOR },
    updated,
    copyright: '',
  });

  for (const entry of newestFirst) {
    feed.addItem({
      id: entry.id,
      title: entry.title,
      link: entry.url,
      // 新聞內文 → `atom:summary`，讓會渲染內文的閱讀器（NetNewsWire／Thunderbird）不再是空白
      // 文章。榜單事件無內文、策展降級項 content 為 null → 傳 undefined，`feed` 套件的
      // `if (item.description)` 即整個略過 summary 元素（不印字面 null，與 C1 的降級處理一致）。
      description: entry.content ?? undefined,
      date: new Date(entry.publishedAt),
    });
  }

  return feed.atom1();
}
