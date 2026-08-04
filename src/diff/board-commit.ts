import { BoardEntry, BoardState } from '../state/state.schema';
import { PushBoard } from './diff.types';
import { BoardChangeSummary } from '../curation/board-summary.types';

/**
 * **唯一**的狀態寫回轉換點（純函式，不含 I/O，research D5）。一次回傳完整新 `BoardState`，
 * 使 FR-021「快照與時間戳同次更新、禁止半套」成為型別層面的保證——呼叫端無法只寫一半。
 *
 * - `board` ← 由 `pushBoard` 重建（≤10 筆；不寫入追蹤深度 30 筆，FR-005/SC-009）。
 *   `starsThisWeek` 欄位存入 `weeklyStarsEstimate`（統一尺，見 contracts/board-state.md §3）。
 *   `firstSeenAt`：既有成員沿用 `state.board[id]`；新進者（含掉出後重回者）用 `pushedAt`（research D7）。
 * - `lastBoardPushAt` ← `pushedAt`（與 `board` 同一次回傳）。
 * - `intros` / `seenNews` / `lastNewsPushAt` ← 原樣帶回（FR-023：掉出者的簡介快取不清除）。
 * - `publish.boardSummary` ← `summary`（F8 state-write-contract.md C1；`diff`/`feed` 寫入見 US2）。
 */
export function commitBoardPush(
  state: BoardState,
  pushBoard: PushBoard,
  pushedAt: Date,
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

  return {
    ...state, // intros / seenNews / lastNewsPushAt 原樣帶回
    board,
    lastBoardPushAt: pushedAtIso,
    publish: {
      ...state.publish,
      boardSummary: { summary: summary.summary, generatedAt: pushedAtIso },
    },
  };
}
