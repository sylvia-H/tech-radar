import { NewsCandidate, NewsDomain3 } from '../news/news.types';
import { clampToLimit } from './curation-length';
import { clampNonAi, clampSourceDiversity, effectiveNonAiCap, isAi, MAX_ITEMS } from './curation-quota';
import { CuratedNewsItem, CurationLlmPick } from './curation.types';

interface ResolvedPick {
  ref: number;
  title: string;
  content: string;
  candidate: NewsCandidate;
}

/** F4 `CandidateSet` 輸出不變式：`domain !== 'cross'`（I1 決策 B，信任已驗收上游契約、不另加執行期防衛過濾）。 */
function domainOf(it: ResolvedPick): NewsDomain3 {
  return it.candidate.domain as NewsDomain3;
}

/**
 * 硬驗證管線（FR-008~010，固定順序，research D5）：只在「LLM 已選且已繁中改寫」的集合內
 * 剔除／重排，永不遞補新候選（FR-005/010）。
 *
 * (1) 剔除幻覺項（`ref` 越界／非整數）＋重複 `ref` 去重（保留第一次出現，即較高重要性者）
 * (2) 非 AI 候選池夠大時，夾非 AI 同來源 ≤2（`clampSourceDiversity`，2026-08-04 新增）
 * (3) 依領域優先序夾非 AI ≤`effectiveNonAiCap`（DevOps 優先，AI 不受限；預設 ≤3，AI 則數不足 7
 *     時放寬至 `10 − AI 則數`，2026-08-04 新增，憲章 v1.6.0）
 * (4) 依 picks 重要性序截總數 ≤10
 * (5) `title`/`content` 收斂至 ≤70/≤500 code points
 *
 * 每則以 `ref` 對回候選附上程式提供的事實（`url`/`domain`/`sourceCount`/`weightedScore`），
 * `degraded:false`（憲章 VI 防幻覺，FR-006/009）。
 */
export function validateCuration(
  picks: readonly CurationLlmPick[],
  candidates: readonly NewsCandidate[],
): CuratedNewsItem[] {
  const seenRefs = new Set<number>();
  const resolved: ResolvedPick[] = [];
  for (const pick of picks) {
    if (!Number.isInteger(pick.ref) || pick.ref < 0 || pick.ref >= candidates.length) {
      continue;
    }
    if (seenRefs.has(pick.ref)) {
      continue;
    }
    seenRefs.add(pick.ref);
    resolved.push({ ref: pick.ref, title: pick.title, content: pick.content, candidate: candidates[pick.ref] });
  }

  const nonAiPoolSize = candidates.filter((c) => !isAi(c.domain as NewsDomain3)).length;
  const diversified = clampSourceDiversity(resolved, domainOf, (it) => it.candidate.sources, nonAiPoolSize);
  const aiCount = diversified.filter((it) => isAi(domainOf(it))).length;
  const clamped = clampNonAi(diversified, domainOf, effectiveNonAiCap(aiCount));
  const limited = clamped.slice(0, MAX_ITEMS);

  return limited.map((it) => ({
    title: clampToLimit(it.title, 70),
    content: clampToLimit(it.content, 500),
    url: it.candidate.originalUrl,
    domain: domainOf(it),
    sourceCount: it.candidate.sources.length,
    weightedScore: it.candidate.weightedScore,
    degraded: false,
  }));
}
