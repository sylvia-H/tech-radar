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
   * 憑分數多寡自然決定則數。無分數者全綁在 `nullScoreBaseline` 同分，靠跨來源輪流分配
   * （`computeInterleaveRanks`，2026-08-04 新增）逐輪各發 1 則來實現，取代原本「全域排序
   * 後從頭截斷」的做法——後者即使設了此上限，仍可能讓 `normalizedUrl` 字母序偏後的來源在
   * `convergeMax` 截斷時整批出局、連 1 則都拿不到（實測 `blog.cloudflare.com` 字母序偏前，
   * 曾單一來源佔候選集 9/25 則，其餘多個一手來源完全消失於候選集）。
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
  convergeMax: 50,
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
 * 排序（全序，SC-011）：`weightedScore ↓ → 跨來源輪流分配序 ↓ → normalizedUrl ↑`。**不再單純以
 * `publishedAt` 或 `normalizedUrl` 決勝**（2026-08-04 兩度變更，原 FR-020）：
 * (a) 移除 `publishedAt` 決勝，避免「誰發得比較新」系統性決定候選去留；
 * (b) 同分候選（`score === null`，全綁在 `nullScoreBaseline`）之間，改插入**跨來源輪流分配序**
 *     作為次要決勝鍵（見 `computeInterleaveRanks`）：依來源分組、逐輪各來源依序各發 1 則、最多
 *     `maxNullScorePerSource` 輪，輪數即優先序（第 1 輪 < 第 2 輪 < …）。這保證只要
 *     「`convergeMax` − 有分數候選數」≥ 當日活躍無分數來源數，每個來源至少有 1 則排在
 *     `convergeMax` 截斷線之前，不會因 `normalizedUrl` 字母序偏後就整批出局——此鍵**必須在
 *     `slice(convergeMax)` 之前生效**，否則退化為純字母序、前功盡棄（曾誤植：先重排回
 *     `normalizedUrl` 序才截斷，等於沒修）。同輪內 / 有真實分數者之間，才落回 `normalizedUrl`
 *     決勝。
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
  const interleaveRank = computeInterleaveRanks(weighted, cfg.maxNullScorePerSource);
  // 硬性同來源上限：無分數候選若不在 interleaveRank 裡（超出 maxNullScorePerSource 輪），直接
  // 剔除，不只是排序墊底——否則候選稀少、convergeMax 有餘裕時，超額候選仍會原樣存活。
  const capped = weighted.filter((c) => c.score !== null || interleaveRank.has(c.normalizedUrl));
  capped.sort((a, b) => compareWithInterleave(a, b, interleaveRank));
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
 * 無分數候選跨來源輪流分配序：依 `sourceId` 分組（組內順序＝傳入時已排序的相對順序，即各來源
 * 內最佳候選在前），逐輪（0..max-1）各來源依序各取 1 則，回傳 `normalizedUrl → 輪次` 的對照表
 * （輪次即優先序，越小越優先）。有真實分數者（`score !== null`）不分組、不產生輪次。
 */
function computeInterleaveRanks(sorted: readonly NewsCandidate[], max: number): Map<string, number> {
  const groups: NewsCandidate[][] = [];
  const groupIndex = new Map<string, number>();
  for (const c of sorted) {
    if (c.score !== null) {
      continue;
    }
    let idx = groupIndex.get(c.sourceId);
    if (idx === undefined) {
      idx = groups.length;
      groupIndex.set(c.sourceId, idx);
      groups.push([]);
    }
    groups[idx].push(c);
  }

  const rankByUrl = new Map<string, number>();
  for (let round = 0; round < max; round++) {
    for (const group of groups) {
      const candidate = group[round];
      if (candidate !== undefined) {
        rankByUrl.set(candidate.normalizedUrl, round);
      }
    }
  }
  return rankByUrl;
}

/**
 * 三層決勝比較器：`weightedScore ↓ → 跨來源輪流分配序 ↑（僅同分無分數候選之間）→ normalizedUrl ↑`。
 */
function compareWithInterleave(a: NewsCandidate, b: NewsCandidate, rankByUrl: ReadonlyMap<string, number>): number {
  if (b.weightedScore !== a.weightedScore) {
    return b.weightedScore - a.weightedScore;
  }
  const ra = rankByUrl.get(a.normalizedUrl);
  const rb = rankByUrl.get(b.normalizedUrl);
  if (ra !== undefined && rb !== undefined && ra !== rb) {
    return ra - rb;
  }
  return a.normalizedUrl < b.normalizedUrl ? -1 : a.normalizedUrl > b.normalizedUrl ? 1 : 0;
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
