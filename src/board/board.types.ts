/**
 * F2 榜單建置的記憶體型別（不持久化，spec Assumptions「不引入新狀態」）。
 * 這些型別即 F3 `buildCurrentBoard()` 的契約來源（contracts/board-output.md）。
 * 持久化的 `BoardState`／`BoardEntry` 屬 F1/F3，本 Feature 不寫入。
 */

/**
 * 榜單三領域（3-way；`frontend-backend` = 前端＋後端合併，顯示「前後端」）。
 * 與 F1 `BoardEntry.domain`（4-way 佔位）的對齊屬持久化層、留待 F3（research D7）。
 */
export type Domain = 'ai' | 'devops' | 'frontend-backend';

/** 三領域固定順序（輸出／log 與跨領域主領域決勝優先序：AI > DevOps > 前後端，FR-011）。 */
export const DOMAINS: readonly Domain[] = ['ai', 'devops', 'frontend-backend'];

/** 領域顯示標籤（log 標題用中文；資料列 `domain` 仍用 enum 值）。 */
export const DOMAIN_LABELS: Record<Domain, string> = {
  ai: 'AI',
  devops: 'DevOps',
  'frontend-backend': '前後端',
};

/** 候選來源標記（可兼具兩者）。 */
export type SourceTag = 'trending' | 'search';

/** Trending 解析輸出（主力）。HTML 不含數字 id，`repoId` 由 `GET /repos` 補取。 */
export interface RawTrendingRepo {
  fullName: string; // owner/name
  description: string | null;
  language: string | null;
  starsThisWeek: number; // 本週增星（排序主鍵來源）
}

/**
 * Search 解析輸出（補位）。回應本身含 topics，免再打 /repos。
 * 不攜帶「來自哪組領域查詢」——FR-003 要求一律以 topics／description 歸類，
 * 皆無命中即排除（寧缺勿濫），故查詢領域不得作為歸類依據。
 */
export interface RawSearchRepo {
  repoId: number;
  fullName: string;
  description: string | null;
  language: string | null;
  topics: string[];
  totalStars: number; // 當前總星數
  createdAt: string; // ISO 8601
}

/** `GET /repos/{o}/{r}` 輸出：補 Trending 候選的 repoId/topics。 */
export interface RepoMeta {
  repoId: number;
  topics: string[];
  totalStars: number;
  createdAt: string; // ISO 8601
}

/** 合併後的統一候選。`repoId` 必填——取不到者於合併前即略過（U1/FR-004）。 */
export interface CandidateRepo {
  repoId: number;
  fullName: string;
  url: string; // https://github.com/owner/name
  description: string | null;
  language: string | null;
  topics: string[];
  starsThisWeek: number | null; // 僅 Trending 來源有
  totalStars: number | null; // Search / repos 有
  ageDays: number | null; // 今天 − createdAt（天）
  sources: SourceTag[];
  domain: Domain | null; // null 表無法歸類 → 排除
  weeklyStarsEstimate: number; // 統一排序鍵（board/weekly-stars.ts）
}

/** 榜單一列（領域內名次）。 */
export interface BoardRow {
  rank: number; // 1..15
  repoId: number;
  fullName: string;
  url: string;
  domain: Domain;
  weeklyStarsEstimate: number;
  starsThisWeek: number | null;
  sources: SourceTag[];
}

/** 單一領域榜（已排序、≤15）。 */
export interface DomainBoard {
  domain: Domain;
  entries: BoardRow[];
}

/** 本次 core／search 呼叫數（供 SC-006 觀測）。 */
export interface ApiCallCounts {
  core: number;
  search: number;
}

/** F2 最終產出：三領域當前榜（僅記憶體＋log，不寫 state/board.json）。 */
export interface CurrentBoard {
  builtAt: string; // ISO 8601（本次執行時間）
  boards: DomainBoard[]; // 恰三領域（不足 15 照實呈現）
  apiCalls: ApiCallCounts;
}
