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
 * 標題 Jaccard 補漏合併（FR-013）：對**無共同 target-URL**者（已過 `dedupByUrl`，故彼此
 * `normalizedUrl` 皆異）兩兩比對，超過 `threshold` 即視為同一則並合併（保留最高分為代表）。
 * 以排序後輸入貪婪合併，確保確定性。
 */
export function dedupByTitle(cands: readonly NewsCandidate[], threshold: number): NewsCandidate[] {
  const sorted = [...cands].sort((a, b) => cmp(a.normalizedUrl, b.normalizedUrl));
  const kept: { cand: NewsCandidate; tokens: string[] }[] = [];
  for (const c of sorted) {
    const tokens = normalizeTitle(c.title);
    const hit = kept.find((k) => jaccard(tokens, k.tokens) >= threshold);
    if (hit) {
      const rep = preferRepresentative(hit.cand, c);
      hit.cand = { ...rep, sources: mergeSources(hit.cand.sources, c.sources) };
      hit.tokens = normalizeTitle(hit.cand.title);
      continue;
    }
    kept.push({ cand: c, tokens });
  }
  return kept.map((k) => k.cand);
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

function mergeSources(a: readonly string[], b: readonly string[]): string[] {
  return dedupeSorted([...a, ...b]);
}

function dedupeSorted(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort(cmp);
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
