/**
 * 榜單日「本次變化」TL;DR 的輸入投影，由呼叫端（F7）自 F3 `BoardDiff` 投影出的計數與領域
 * 分布（research D3）。F6 不吃整個 `BoardDiff`、不碰 F3 服務。
 */
export interface BoardChangeDigest {
  newcomers: number;
  climbed: number;
  declined: number;
  domainCounts: { ai: number; 'frontend-backend': number };
  topName: string | null;
}

/** `BoardSummaryService.summarize()` 的回傳：一句繁中封面 TL;DR（FR-015/016）。 */
export interface BoardChangeSummary {
  summary: string;
  degraded: boolean;
}
