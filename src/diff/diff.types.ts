import { Domain } from '../board/board.types';

/**
 * F3 記憶體型別（單次執行；不持久化）。持久化的 `BoardState`／`BoardEntry` 屬 F1 schema。
 * 結構全文與欄位語意見 specs/003-board-state-diff/data-model.md §2。
 */

/** 跨領域綜合 top 10 的一列（卡片顯示的名次即此 `rank`）。 */
export interface PushBoardRow {
  rank: number; // 綜合名次 #1..#10（FR-001/FR-010）
  repoId: number;
  fullName: string;
  url: string;
  language: string | null;
  domain: Domain;
  weeklyStarsEstimate: number;
  totalStars: number | null;
}

/** 跨領域綜合 top 10，長度 0..10，`rank` 連續由 1 起。 */
export type PushBoard = PushBoardRow[];

/** 三類互斥的變化（FR-007/008/009）。 */
export type ChangeKind = 'newcomer' | 'climbed' | 'declined';

/** 單一變化項目。 */
export interface BoardChange {
  kind: ChangeKind;
  repoId: number;
  fullName: string;
  url: string;
  domain: Domain; // 供上層分類呈現（FR-015；一律取本次歸類）
  weeklyStarsEstimate: number; // 供上層呈現人氣落差（FR-015）
  currentRank: number; // 本次綜合名次
  previousRank: number | null; // 上次綜合名次；newcomer 恆為 null
  needsIntro: boolean; // newcomer/climbed → true；declined → false（FR-016）
}

/** 榜單變化結果（`changes` 採單一陣列 + `kind` 標籤，見 data-model §2）。 */
export interface BoardDiff {
  changes: BoardChange[]; // 三類合併，長度 ≤10（SC-004）。順序：綜合名次升序
  unchanged: boolean; // 三類皆空 → true（FR-014）
  topEntry: PushBoardRow; // 本次綜合榜 #1，供「無變化」一行摘要（FR-014）
  pushBoard: PushBoard; // 本次綜合 top 10，供 commit 使用
}

/** `CadenceDecision.reason`：`clock-anomaly` 時呼叫端須發告警（FR-019a）。 */
export type CadenceReason = 'no-timestamp' | 'due' | 'not-due' | 'clock-anomaly';

/** 每週節奏判定（時間由參數注入，可脫離真實時間測試）。 */
export interface CadenceDecision {
  due: boolean; // true → 執行榜單段；false → 整段跳過（FR-018）
  reason: CadenceReason;
}

/**
 * 榜單段執行結果（判別聯集，以 `status` 判別）。原為 `BoardDiffService.runBoardSegment(now)`
 * 的回傳型別；F7 US3 由 `BoardSegmentService.run(state, now)` 取代薄編排後沿用不動，另見
 * `BoardSegmentOutcome`（`pipeline/board-segment.service.ts`）疊加 `push-failed` 案例。
 * `status === 'ok'` 時 `diff` 在型別上必定存在，呼叫端不必做非空斷言。
 */
export type BoardSegmentResult =
  | { status: 'skipped' } // 節奏未到期，整段跳過（FR-018）
  | { status: 'aborted' } // 本次綜合榜為空，已發告警並中止（FR-025）
  | { status: 'ok'; diff: BoardDiff }; // 正常產出變化結果
