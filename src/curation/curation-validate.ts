import { NewsCandidate, NewsDomain3 } from '../news/news.types';
import { clampToLimit } from './curation-length';
import { clampNonAi, MAX_ITEMS } from './curation-quota';
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
 * (2) 依領域優先序夾非 AI ≤2（DevOps 優先，AI 不受限）
 * (3) 依 picks 重要性序截總數 ≤6
 * (4) `title`/`content` 收斂至 ≤50/≤300 code points
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

  const clamped = clampNonAi(resolved, domainOf);
  const limited = clamped.slice(0, MAX_ITEMS);

  return limited.map((it) => ({
    title: clampToLimit(it.title, 50),
    content: clampToLimit(it.content, 300),
    url: it.candidate.originalUrl,
    domain: domainOf(it),
    sourceCount: it.candidate.sources.length,
    weightedScore: it.candidate.weightedScore,
    degraded: false,
  }));
}
