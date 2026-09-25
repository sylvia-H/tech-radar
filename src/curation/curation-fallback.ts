import { isUnresolved } from '../news/funnel';
import { NewsCandidate, NewsDomain3 } from '../news/news.types';
import { clampNonAi, effectiveNonAiCap, isAi, MAX_ITEMS } from './curation-quota';
import { CuratedDigest, CuratedNewsItem } from './curation.types';

/** 降級路徑只處理已落定三桶的候選（「未歸類」者於 `fallbackDigest` 開頭先排除，見該函式 docstring）。 */
function domainOf(c: NewsCandidate): NewsDomain3 {
  return c.domain as NewsDomain3;
}

/**
 * 策展失敗的降級精選：沿用候選既有 `weightedScore` 序（`CandidateSet` 已排序，**不重寫排序
 * 公式**，FR-012）套同一配額（`clampNonAi`＋截 `MAX_ITEMS`），每則呈現原文標題＋連結，
 * `content:null`、`degraded:true`；原文標題 **不套** 70 字收斂（原文照實呈現，FR-013）。非 AI
 * 上限與主路徑同套 `effectiveNonAiCap`（憲章 v1.6.0）：以候選池內 AI 則數計算，AI 供給不足時
 * 同樣把名額讓給非 AI，降級模式與正常模式的配額邏輯保持一致。
 *
 * 「未歸類高熱度」候選（`domain === 'cross'`，2026-09-25 起）**一律排除**：它們的入池理由是「交 LLM
 * 判定是否與開發者相關」，降級路徑沒有這個判斷，且它們帶真實高分、會以 `weightedScore` 序排在最前
 * ——若不排除，降級日的晨報會被政治／消費硬體／趣聞類高分 HN 投稿佔滿。
 */
export function fallbackDigest(candidates: readonly NewsCandidate[]): CuratedDigest {
  const eligible = candidates.filter((c) => !isUnresolved(c));
  const aiCount = eligible.filter((c) => isAi(domainOf(c))).length;
  const clamped = clampNonAi(eligible, domainOf, effectiveNonAiCap(aiCount));
  const limited = clamped.slice(0, MAX_ITEMS);
  const items: CuratedNewsItem[] = limited.map((c) => ({
    title: c.title,
    content: null,
    url: c.originalUrl,
    domain: domainOf(c),
    sourceId: c.sourceId,
    sources: [...c.sources], // 與主路徑 validateCuration 一致（2026-09-12 新增）
    sourceCount: c.sources.length,
    weightedScore: c.weightedScore,
    degraded: true,
  }));
  return { items, degraded: true };
}
