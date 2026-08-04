import { BoardEntry, BoardState } from '../state/state.schema';
import { PushBoard, BoardDiff } from './diff.types';
import { BoardChangeSummary } from '../curation/board-summary.types';
import { makeBoardFeedEntries, trimFeed } from '../publish/feed-entry';
import { taipeiDateLabel } from '../pipeline/layout/date-label';

/**
 * **唯一**的狀態寫回轉換點（純函式，不含 I/O，research D5）。一次回傳完整新 `BoardState`，
 * 使 FR-021「快照與時間戳同次更新、禁止半套」成為型別層面的保證——呼叫端無法只寫一半。
 *
 * - `board` ← 由 `pushBoard` 重建（≤10 筆；不寫入追蹤深度 30 筆，FR-005/SC-009）。
 *   `starsThisWeek` 欄位存入 `weeklyStarsEstimate`（統一尺，見 contracts/board-state.md §3）。
 *   `firstSeenAt`：既有成員沿用 `state.board[id]`；新進者（含掉出後重回者）用 `pushedAt`（research D7）。
 * - `lastBoardPushAt` ← `pushedAt`（與 `board` 同一次回傳）。
 * - `intros` / `seenNews` / `lastNewsPushAt` ← 原樣帶回（FR-023：掉出者的簡介快取不清除）。
 * - `publish.boardSummary` ← `summary`；`publish.feed` ← 併入本次榜單事件（`newcomer`/`climbed`，
 *   `declined` 不產生）並修剪至 50（F8 state-write-contract.md C1）。
 */
export function commitBoardPush(
  state: BoardState,
  pushBoard: PushBoard,
  pushedAt: Date,
  diff: BoardDiff,
  summary: BoardChangeSummary,
): BoardState {
  const pushedAtIso = pushedAt.toISOString();

  const board: Record<string, BoardEntry> = {};
  for (const row of pushBoard) {
    const key = String(row.repoId);
    const existing = state.board[key];
    board[key] = {
      fullName: row.fullName,
      url: row.url,
      language: row.language,
      domain: row.domain,
      starsThisWeek: row.weeklyStarsEstimate,
      rank: row.rank,
      firstSeenAt: existing ? existing.firstSeenAt : pushedAtIso,
    };
  }

  const dateLabel = taipeiDateLabel(pushedAt);

  return {
    ...state, // intros / seenNews / lastNewsPushAt 原樣帶回
    board,
    lastBoardPushAt: pushedAtIso,
    publish: {
      ...state.publish,
      boardSummary: { summary: summary.summary, generatedAt: pushedAtIso },
      feed: trimFeed(
        [...(state.publish?.feed ?? []), ...makeBoardFeedEntries(diff, dateLabel, pushedAt)],
        50,
      ),
    },
  };
}
