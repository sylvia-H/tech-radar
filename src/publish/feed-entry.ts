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

/** CuratedNewsItem[] → 新聞類 feed entries（一則新聞一筆）。 */
export function makeNewsFeedEntries(items: CuratedNewsItem[], now: Date): FeedEntry[] {
  return items.map((item) => ({
    id: newsFeedId(normalizeTargetUrl(item.url)),
    type: 'news',
    title: item.title,
    url: item.url,
    publishedAt: now.toISOString(),
  }));
}

/** 上限 50、超出移除最舊（陣列前端），純函式（research D8）。 */
export function trimFeed(entries: readonly FeedEntry[], limit = 50): FeedEntry[] {
  if (entries.length <= limit) {
    return [...entries];
  }
  return entries.slice(entries.length - limit);
}
