import { NewsDomain3 } from './news.types';
import { NEWS_DOMAIN_KEYWORDS } from './news-domain-keywords';

/** 三桶固定優先序：AI > DevOps > 前後端（AI 最高，配額 AI ≥ 4；前後端為一般開發的兜底桶）。 */
const DOMAIN_ORDER: readonly NewsDomain3[] = ['ai', 'devops', 'frontend-backend'];

/** 各桶關鍵字 → 單一詞界 regex（模組載入時編一次；增刪只改 `news-domain-keywords`）。 */
const DOMAIN_PATTERNS: Record<NewsDomain3, RegExp> = {
  ai: buildPattern(NEWS_DOMAIN_KEYWORDS.ai),
  devops: buildPattern(NEWS_DOMAIN_KEYWORDS.devops),
  'frontend-backend': buildPattern(NEWS_DOMAIN_KEYWORDS['frontend-backend']),
};

/**
 * `cross` 來源的關鍵字歸類（FR-006/027）：對標題／摘要文字以**小寫詞界**比對三桶關鍵字，
 * 依固定優先序（AI > DevOps > 前後端）擇一。前後端相關項一律歸入單一 `frontend-backend`
 * 桶，不再細分 backend／frontend。無任一命中 → 回 `null`（該候選視為離題、由呼叫端排除，
 * 寧缺勿濫，與榜單 `classify` 同精神）。
 *
 * **非 `cross` 來源不呼叫此函式**，直接沿用設定檔的 `domain`（FR-006）。
 */
export function classifyCross(text: string): NewsDomain3 | null {
  const haystack = text.toLowerCase();
  for (const domain of DOMAIN_ORDER) {
    if (DOMAIN_PATTERNS[domain].test(haystack)) {
      return domain;
    }
  }
  return null;
}

/** 組出「以非英數字元為界，命中任一關鍵字」的 regex（keyword 內部連字號不受影響）。 */
function buildPattern(keywords: readonly string[]): RegExp {
  const alternatives = keywords.map((kw) => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`(?<![a-z0-9])(?:${alternatives})(?![a-z0-9])`);
}
