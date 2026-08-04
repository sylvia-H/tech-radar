import { NewsCandidate, NewsTier } from './news.types';

/**
 * 階段 A 漏斗設定（可調常數表，spec Assumptions「起始值、實測再校」）。門檻與權重集中於此。
 */
export interface FunnelConfig {
  /** 各 tier 的分數門檻；`null` = 不套門檻（Tier 2 一手來源）。有分數才比（SC-005）。 */
  scoreThresholds: Record<NewsTier, number | null>;
  /** 交叉驗證加權（`sources.length >= 2`，FR-017）。 */
  crossValidationBoost: number;
  /** 榜單相關性加權（命中榜上 repo，FR-018）。 */
  boardRelevanceBoost: number;
  /** tier 差異化權重（Tier 3 更低，FR-019）。 */
  tierWeight: Record<NewsTier, number>;
  /** 無社群分數者（Tier 2／Reddit RSS）的基準分，使其天然視為強訊號、可與有分數者競爭。 */
  nullScoreBaseline: number;
  /** 收斂上限（目標區間上限；候選稀少照實輸出，FR-021）。 */
  convergeMax: number;
}

/** 起始設定（dev-guide §4.4：HN points>100、Lobste.rs>20；Tier 3 更高門檻更低權重）。 */
export const DEFAULT_FUNNEL_CONFIG: FunnelConfig = {
  scoreThresholds: { 1: 100, 2: null, 3: 150 },
  crossValidationBoost: 100,
  boardRelevanceBoost: 50,
  tierWeight: { 1: 1, 2: 1, 3: 0.5 },
  nullScoreBaseline: 100,
  convergeMax: 25,
};

/**
 * 階段 A 過濾＋加權＋全序決勝排序＋收斂（FR-016~021）。純函式。
 *
 * 過濾：`score` 存在且低於該 tier 門檻 → 丟；門檻為 `null`（Tier 2）或 `score === null`
 * （無社群分數）→ **不因門檻丟**（SC-005）。
 * 加權：base（分數或無分數基準）× tierWeight ＋ 交叉驗證 ＋ 榜單相關（`boardRepoNames` 空集合
 * 時整段略過，FR-018 Edge）。
 * 排序（全序，SC-011）：`weightedScore ↓ → normalizedUrl ↑`（末鍵在去重後唯一）。**不再以
 * `publishedAt` 決勝**（2026-08-04 變更，原 FR-020）：Tier 2 一手來源全數無社群分數、統一
 * `nullScoreBaseline` 同分，若以 `publishedAt` 決勝，發文頻率高的來源（如單日多篇的官方部落格）
 * 會系統性贏得同分候選在 `convergeMax` 截斷前的排序位置，擠壓發文頻率低但同樣重要的一手來源
 * （如僅日更一次的官方公告）——非本意的「發文頻率偏誤」。改以與來源身份無關的 `normalizedUrl`
 * 決勝，同分候選截斷時不再偏袒發文勤的來源。
 * 收斂：取前 `convergeMax`；不足照實輸出（FR-021）。
 */
export function runFunnel(
  cands: readonly NewsCandidate[],
  boardRepoNames: ReadonlySet<string>,
  cfg: FunnelConfig,
): NewsCandidate[] {
  const weighted = cands
    .filter((c) => !belowThreshold(c, cfg))
    .map((c) => ({ ...c, weightedScore: weightOf(c, boardRepoNames, cfg) }));
  weighted.sort(compareCandidates);
  return weighted.slice(0, cfg.convergeMax);
}

/** 分數門檻判定（SC-005）：只有「有分數且該 tier 有門檻」才可能被丟。 */
function belowThreshold(c: NewsCandidate, cfg: FunnelConfig): boolean {
  const threshold = cfg.scoreThresholds[c.tier];
  if (threshold === null || c.score === null) {
    return false;
  }
  return c.score < threshold;
}

function weightOf(c: NewsCandidate, board: ReadonlySet<string>, cfg: FunnelConfig): number {
  const base = c.score !== null ? c.score : cfg.nullScoreBaseline;
  let w = base * cfg.tierWeight[c.tier];
  if (c.sources.length >= 2) {
    w += cfg.crossValidationBoost;
  }
  if (mentionsBoardRepo(c, board)) {
    w += cfg.boardRelevanceBoost;
  }
  return w;
}

/**
 * 候選是否提到當前榜上 repo（FR-018）。以小寫詞界 token 比對（避免子字串誤命中，沿用
 * `classify` 的教訓）。`board` 空集合時直接回 `false`——榜單無資料時安全略過、不加權、不報錯。
 */
export function mentionsBoardRepo(c: NewsCandidate, board: ReadonlySet<string>): boolean {
  if (board.size === 0) {
    return false;
  }
  const text = `${c.title} ${c.summary ?? ''}`.toLowerCase();
  const tokens = new Set(text.split(/[^a-z0-9]+/).filter((t) => t.length > 0));
  for (const name of board) {
    if (tokens.has(name)) {
      return true;
    }
  }
  return false;
}

/**
 * 兩層全序決勝比較器（SC-011）：`weightedScore ↓ → normalizedUrl ↑`。不再以 `publishedAt`
 * 決勝（2026-08-04 變更，見 `runFunnel` docstring 的發文頻率偏誤說明）。
 */
function compareCandidates(a: NewsCandidate, b: NewsCandidate): number {
  if (b.weightedScore !== a.weightedScore) {
    return b.weightedScore - a.weightedScore;
  }
  return a.normalizedUrl < b.normalizedUrl ? -1 : a.normalizedUrl > b.normalizedUrl ? 1 : 0;
}
