import { NewsCandidate, NewsTier } from './news.types';

const DAY_MS = 86_400_000;

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
  /**
   * 無社群分數候選（`score === null`）單一來源最多可貢獻的候選則數（2026-08-04 新增）。
   * 有真實分數者（目前僅 HN）不受限——它們是靠社群投票個別分出高下，非同分綁在一起，本就該
   * 憑分數多寡自然決定則數。無分數者全綁在 `nullScoreBaseline` 同分，若不設此上限，量體大或
   * `normalizedUrl` 字母序占優的單一來源會在 `convergeMax` 截斷前吃光候選池、擠掉其他一手來源
   * （實測 `blog.cloudflare.com` 字母序偏前，曾單一來源佔候選集 9/25 則，其餘多個一手來源
   * 完全消失於候選集）。
   */
  maxNullScorePerSource: number;
  /**
   * 無社群分數候選（`score === null`）的新鮮度視窗（天數，2026-08-04 新增）。`publishedAt`
   * 缺失或早於 `now - 此值` 即不入池。有真實分數者（目前僅 HN）不受限——HN 的 `publishedAt`
   * 是「提交到 HN 的時間」而非原文發表時間，且 fetcher 本身已有近 7 天口徑，不需要再套一層；
   * RSS／github-releases 類來源的 `publishedAt` 才是原文真實發表日期，舊文（如封存文章被
   * 討論區重新提及）可能藉此混入候選池，須另行把關。30 天對照現有來源常態發文節奏（如
   * CPython alpha 版約 4~6 週一次）留有餘裕，避免誤傷發文較不頻繁的一手來源。
   */
  freshnessWindowDays: number;
}

/** 起始設定（dev-guide §4.4：HN points>100、Lobste.rs>20；Tier 3 更高門檻更低權重）。 */
export const DEFAULT_FUNNEL_CONFIG: FunnelConfig = {
  scoreThresholds: { 1: 100, 2: null, 3: 150 },
  crossValidationBoost: 100,
  boardRelevanceBoost: 50,
  tierWeight: { 1: 1, 2: 1, 3: 0.5 },
  nullScoreBaseline: 100,
  convergeMax: 35,
  maxNullScorePerSource: 3,
  freshnessWindowDays: 30,
};

/**
 * 階段 A 過濾＋加權＋全序決勝排序＋同來源上限＋收斂（FR-016~021）。純函式。
 *
 * 過濾：(1) `score` 存在且低於該 tier 門檻 → 丟；門檻為 `null`（Tier 2）或 `score === null`
 * （無社群分數）→ **不因門檻丟**（SC-005）。(2) `score === null` 者另須通過新鮮度視窗
 * （`freshnessWindowDays`，2026-08-04 新增）：`publishedAt` 缺失或超出視窗 → 丟；有真實分數者
 * （HN）不受此步限制。
 * 加權：base（分數或無分數基準）× tierWeight ＋ 交叉驗證 ＋ 榜單相關（`boardRepoNames` 空集合
 * 時整段略過，FR-018 Edge）。
 * 排序（全序，SC-011）：`weightedScore ↓ → normalizedUrl ↑`（末鍵在去重後唯一）。**不再以
 * `publishedAt` 決勝**（2026-08-04 變更，原 FR-020）：改以與來源身份無關的 `normalizedUrl`
 * 決勝，避免「誰發得比較新」系統性決定候選去留。
 * 同來源上限（2026-08-04 新增）：在依序排序後的名單上，`score === null` 的候選逐一計數，
 * 同一來源（`sources[]` 任一命中）累計達 `maxNullScorePerSource` 即剔除，不遞補其他候選——
 * 防止單一來源單靠量體或 `normalizedUrl` 字母序天生占優、擠滿候選池；有真實分數者不受限。
 * 收斂：取前 `convergeMax`；不足照實輸出（FR-021）。
 */
export function runFunnel(
  cands: readonly NewsCandidate[],
  boardRepoNames: ReadonlySet<string>,
  cfg: FunnelConfig,
  now: Date,
): NewsCandidate[] {
  const weighted = cands
    .filter((c) => !belowThreshold(c, cfg))
    .filter((c) => c.score !== null || isFreshEnough(c, now, cfg.freshnessWindowDays))
    .map((c) => ({ ...c, weightedScore: weightOf(c, boardRepoNames, cfg) }));
  weighted.sort(compareCandidates);
  const capped = capNullScorePerSource(weighted, cfg.maxNullScorePerSource);
  return capped.slice(0, cfg.convergeMax);
}

/** 新鮮度判定：`publishedAt` 缺失／無法解析，或早於 `now − windowDays` → 不新鮮。 */
function isFreshEnough(c: NewsCandidate, now: Date, windowDays: number): boolean {
  if (c.publishedAt === null) {
    return false;
  }
  const published = Date.parse(c.publishedAt);
  if (Number.isNaN(published)) {
    return false;
  }
  return now.getTime() - published <= windowDays * DAY_MS;
}

/**
 * 無分數候選同來源上限（依排序後的順序逐一計數，保留每來源最靠前的 `max` 則）。
 * 有真實分數者（`score !== null`）不受限、原樣保留。
 */
function capNullScorePerSource(sorted: readonly NewsCandidate[], max: number): NewsCandidate[] {
  const countBySource = new Map<string, number>();
  const kept: NewsCandidate[] = [];
  for (const c of sorted) {
    if (c.score !== null) {
      kept.push(c);
      continue;
    }
    if (c.sources.some((s) => (countBySource.get(s) ?? 0) >= max)) {
      continue;
    }
    for (const s of c.sources) {
      countBySource.set(s, (countBySource.get(s) ?? 0) + 1);
    }
    kept.push(c);
  }
  return kept;
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
