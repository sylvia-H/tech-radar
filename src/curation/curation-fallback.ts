import { NewsCandidate, NewsDomain3 } from '../news/news.types';
import { clampNonAi, MAX_ITEMS } from './curation-quota';
import { CuratedDigest, CuratedNewsItem } from './curation.types';

/** F4 `CandidateSet` 輸出不變式：`domain !== 'cross'`（I1 決策 B，同 curation.service.ts）。 */
function domainOf(c: NewsCandidate): NewsDomain3 {
  return c.domain as NewsDomain3;
}

/**
 * 策展失敗的降級精選：沿用候選既有 `weightedScore` 序（`CandidateSet` 已排序，**不重寫排序
 * 公式**，FR-012）套同一配額（`clampNonAi`＋截 `MAX_ITEMS`），每則呈現原文標題＋連結，
 * `content:null`、`degraded:true`；原文標題 **不套** 50 字收斂（原文照實呈現，FR-013）。
 */
export function fallbackDigest(candidates: readonly NewsCandidate[]): CuratedDigest {
  const clamped = clampNonAi(candidates, domainOf);
  const limited = clamped.slice(0, MAX_ITEMS);
  const items: CuratedNewsItem[] = limited.map((c) => ({
    title: c.title,
    content: null,
    url: c.originalUrl,
    domain: domainOf(c),
    sourceCount: c.sources.length,
    weightedScore: c.weightedScore,
    degraded: true,
  }));
  return { items, degraded: true };
}
