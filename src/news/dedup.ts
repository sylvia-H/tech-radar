import { NewsCandidate } from './news.types';
import { jaccard, normalizeTitle } from './title-similarity';

/**
 * 去重（零 LLM，憲章 V）：先以正規化 target-URL 合併（`dedupByUrl`），再以標題 Jaccard 補漏
 * （`dedupByTitle`）。合併不變式：代表項＝分數最高者（FR-012）；`sources[]` 累積並去重；
 * `length >= 2` 即交叉驗證強訊號（FR-017，供漏斗加權）。
 */

/**
 * 同 `normalizedUrl` 合併：只留一筆、取最高分為代表、併 `sources[]`（FR-012 / SC-001）。
 * 輸出依 `normalizedUrl` 排序，確保確定性（SC-011，不依賴輸入順序）。
 */
export function dedupByUrl(cands: readonly NewsCandidate[]): NewsCandidate[] {
  const byUrl = new Map<string, NewsCandidate>();
  for (const c of cands) {
    const existing = byUrl.get(c.normalizedUrl);
    if (!existing) {
      byUrl.set(c.normalizedUrl, { ...c, sources: dedupeSorted(c.sources) });
      continue;
    }
    const rep = preferRepresentative(existing, c);
    byUrl.set(c.normalizedUrl, { ...rep, sources: mergeSources(existing.sources, c.sources) });
  }
  return [...byUrl.values()].sort((a, b) => cmp(a.normalizedUrl, b.normalizedUrl));
}

/**
 * 標題合併的發表日期差上限（天，2026-09-12 新增）。
 *
 * 證據：標題 Jaccard 把版本號當普通 token，「Introducing ChatGPT Images 2.0」（144 天前）與
 * 「Introducing ChatGPT Images 2.5」（4 天前）相似度 0.67 ≥ 0.6 被合併，較新一則整則消失；HN
 * 「OpenAI Agents API」（2 天前）也被 2020 年的「OpenAI API」吞掉並得到不實的交叉驗證加分。
 * 理由：同一件事的多篇報導不會相差數個月——各來源對同一發布的轉載／討論通常落在數日內，取
 * 14 天為寬鬆上限，足以涵蓋週報型來源的延遲，又能擋住跨版本、跨年度的舊文誤吞。
 */
export const TITLE_MERGE_MAX_GAP_DAYS = 14;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 標題 Jaccard 補漏合併（FR-013）：對**無共同 target-URL**者（已過 `dedupByUrl`，故彼此
 * `normalizedUrl` 皆異）兩兩比對，超過 `threshold` 即視為同一則並合併（保留最高分為代表）。
 * 以排序後輸入貪婪合併，確保確定性。
 *
 * 日期差上限（2026-09-12 新增）：合併條件為 Jaccard ≥ `threshold` **且**發表日期相容。每組追蹤
 * 「群組日期範圍」`[minTime, maxTime]`，只由**可解析** `publishedAt` 的成員維護；`null` 或無法
 * `Date.parse` 者不參與、也不清空已知範圍。候選可併入的條件：候選無可解析日期、或群組尚無範圍、
 * 或候選與範圍兩端相距皆 ≤ `maxPublishedGapDays` 天；併入後以候選日期擴張範圍。缺日期者維持可
 * 合併（向後相容；目前僅極少數 feed 缺日期）。
 *
 * 為何不拿當前代表項的 `publishedAt` 比對：代表項會隨 `preferRepresentative` 換人（分數高者、同分
 * 依 `sourceId` 字典序，與日期無關），若只跟代表項比會有兩個漏洞——(1) 有分數但缺日期的 HN 候選
 * 必成代表項，群組日期被抹成 `null`，之後任何日期的候選都能併入；(2) 鏈式合併：day0、day14、
 * day28 三則相似標題逐一併入，代表項一路換成較新者，day0 那則整則消失。以範圍兩端同時約束，
 * 群組內任兩成員的日期差必 ≤ 上限，且範圍只增不減，不受代表項換人影響。
 */
export function dedupByTitle(
  cands: readonly NewsCandidate[],
  threshold: number,
  maxPublishedGapDays: number = TITLE_MERGE_MAX_GAP_DAYS,
): NewsCandidate[] {
  const sorted = [...cands].sort((a, b) => cmp(a.normalizedUrl, b.normalizedUrl));
  const kept: TitleGroup[] = [];
  const maxGapMs = maxPublishedGapDays * MS_PER_DAY;
  for (const c of sorted) {
    const tokens = normalizeTitle(c.title);
    const t = parseTime(c.publishedAt);
    const hit = kept.find(
      (k) => jaccard(tokens, k.tokens) >= threshold && isWithinGroupRange(k.range, t, maxGapMs),
    );
    if (hit) {
      const rep = preferRepresentative(hit.cand, c);
      hit.cand = { ...rep, sources: mergeSources(hit.cand.sources, c.sources) };
      hit.tokens = normalizeTitle(hit.cand.title);
      hit.range = expandRange(hit.range, t);
      continue;
    }
    kept.push({ cand: c, tokens, range: expandRange(null, t) });
  }
  return kept.map((k) => k.cand);
}

/** 群組已知的發表日期範圍（epoch ms）；`null` 表示尚無成員帶可解析日期。 */
interface TimeRange {
  readonly min: number;
  readonly max: number;
}

interface TitleGroup {
  cand: NewsCandidate;
  tokens: string[];
  range: TimeRange | null;
}

/**
 * 代表項決勝（FR-012、SC-011）：分數高者為代表（`null` 視為最低）；**同分（含皆為 `null`）**
 * 時以 `sourceId` 字典序、再 `originalUrl` 字典序取最小者——使相同輸入下代表項唯一。
 */
function preferRepresentative(a: NewsCandidate, b: NewsCandidate): NewsCandidate {
  const sa = a.score ?? -Infinity;
  const sb = b.score ?? -Infinity;
  if (sa !== sb) {
    return sa > sb ? a : b;
  }
  if (a.sourceId !== b.sourceId) {
    return a.sourceId < b.sourceId ? a : b;
  }
  return cmp(a.originalUrl, b.originalUrl) <= 0 ? a : b;
}

/**
 * 候選日期 `t` 是否可併入群組範圍：候選缺日期或群組尚無範圍 → `true`（向後相容）；否則須與範圍
 * 兩端相距皆 ≤ `maxGapMs`，確保併入後群組內任兩成員的日期差仍 ≤ 上限。
 */
function isWithinGroupRange(range: TimeRange | null, t: number | null, maxGapMs: number): boolean {
  if (t === null || range === null) {
    return true;
  }
  return Math.abs(t - range.min) <= maxGapMs && Math.abs(t - range.max) <= maxGapMs;
}

/** 以候選日期擴張群組範圍；候選缺日期時範圍不變（不清空已知範圍）。 */
function expandRange(range: TimeRange | null, t: number | null): TimeRange | null {
  if (t === null) {
    return range;
  }
  if (range === null) {
    return { min: t, max: t };
  }
  return { min: Math.min(range.min, t), max: Math.max(range.max, t) };
}

function parseTime(iso: string | null): number | null {
  if (iso === null) {
    return null;
  }
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

function mergeSources(a: readonly string[], b: readonly string[]): string[] {
  return dedupeSorted([...a, ...b]);
}

function dedupeSorted(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort(cmp);
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
