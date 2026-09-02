import { FeedEntry } from '../state/state.schema';
import { BoardDiff } from '../diff/diff.types';
import { CuratedNewsItem } from '../curation/curation.types';
import { normalizeTargetUrl } from '../news/url-normalize';

/** 新聞 feed entry 的 id（research D9）。傳入值 MUST 已經過 `normalizeTargetUrl`。 */
export function newsFeedId(normalizedUrl: string): string {
  return `news:${normalizedUrl}`;
}

/**
 * 榜單事件 feed entry 的 id（research D9）：repoId + 事件型別 + 事件日期。
 * `kind` 為 GUID 片段（`ChangeKind.newcomer → 'new'`、`climbed → 'climbed'`，data-model.md §2.2
 * 對照表，字串屬對外契約、日後不得更名）。
 */
export function boardFeedId(repoId: number, kind: 'new' | 'climbed', dateLabel: string): string {
  return `repo:${repoId}:${kind}:${dateLabel}`;
}

/** `ChangeKind` → GUID `kind` 片段／`FeedEntry.type` 的映射（data-model.md §2.2，對外契約）。 */
const KIND_MAP = {
  newcomer: { guidKind: 'new', entryType: 'board-new' },
  climbed: { guidKind: 'climbed', entryType: 'board-climbed' },
} as const;

/** BoardDiff → 榜單類 feed entries（僅 newcomer/climbed，declined 不產生，FR-003）。 */
export function makeBoardFeedEntries(diff: BoardDiff, dateLabel: string, now: Date): FeedEntry[] {
  const entries: FeedEntry[] = [];
  for (const change of diff.changes) {
    if (change.kind === 'declined') {
      continue;
    }
    const mapping = KIND_MAP[change.kind];
    const verb = change.kind === 'newcomer' ? '新進榜' : '竄升';
    entries.push({
      id: boardFeedId(change.repoId, mapping.guidKind, dateLabel),
      type: mapping.entryType,
      title: `${change.fullName} ${verb}`,
      url: change.url,
      publishedAt: now.toISOString(),
    });
  }
  return entries;
}

/**
 * CuratedNewsItem[] → 新聞類 feed entries（一則新聞一筆）。`content` 直接沿用
 * `CuratedNewsItem.content`（含降級時的 `null`），供 feed 輸出 `atom:summary`。
 */
export function makeNewsFeedEntries(items: CuratedNewsItem[], now: Date): FeedEntry[] {
  return items.map((item) => ({
    id: newsFeedId(normalizeTargetUrl(item.url)),
    type: 'news',
    title: item.title,
    url: item.url,
    content: item.content,
    publishedAt: now.toISOString(),
  }));
}

/**
 * 併入新 entries 並修剪：**同 `id` 者以新的取代**（先移除既有同 id，再 append），最後套 `trimFeed`。
 *
 * 同 id 取代的由來：`seenNews` 原只保留 7 天而 feed 保留 50 筆，低量日 50 筆的時間跨度會超過 7 天，
 * 同一則新聞得以再次入選並產生**重複的 `atom:id`**（訂閱端行為未定義）。2026-09-02 保留期改為
 * 45 天後，此情況在正常量體下不再發生（50 筆約 7 天），此處退居防呆：若仍有同 id 重現，取新
 * 棄舊使其以最新 `publishedAt` 冒到 feed 頂端而非留下兩筆。
 */
export function appendFeedEntries(
  existing: readonly FeedEntry[],
  incoming: readonly FeedEntry[],
  limit = 50,
): FeedEntry[] {
  // incoming 內部也可能自帶重複 id（等價 URL 正規化後同鍵），一併取最後一筆。
  const deduped = [...new Map(incoming.map((e) => [e.id, e])).values()];
  const incomingIds = new Set(deduped.map((e) => e.id));
  const kept = existing.filter((e) => !incomingIds.has(e.id));
  return trimFeed([...kept, ...deduped], limit);
}

/** 上限 50、超出移除最舊（陣列前端），純函式（research D8）。 */
export function trimFeed(entries: readonly FeedEntry[], limit = 50): FeedEntry[] {
  if (entries.length <= limit) {
    return [...entries];
  }
  return entries.slice(entries.length - limit);
}
