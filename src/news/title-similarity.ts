/**
 * 標題近似度（零 LLM 補漏去重，FR-013 / SC-001）。純函式。
 */

/** 常見英文 stop words（去除後讓 Jaccard 聚焦實詞；起始集，可調）。 */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'with', 'is', 'are', 'was', 'were',
  'how', 'why', 'what', 'when', 'your', 'you', 'it', 'this', 'that', 'these', 'those', 'at', 'by',
  'from', 'as', 'be', 'we', 'i', 'my', 'our', 'its', 'has', 'have', 'new',
]);

/** 標題正規化：小寫、去標點（以非英數字元切分）、去 stop words → token 陣列。 */
export function normalizeTitle(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !STOP_WORDS.has(t));
}

/** token 集合 Jaccard 相似度 `|∩| / |∪|`；任一為空或聯集為空 → 0（避免誤判為同一則）。 */
export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) {
    return 0;
  }
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const x of sa) {
    if (sb.has(x)) {
      inter += 1;
    }
  }
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** 標題近似合併門檻（起始 0.6，可調；research D9）。偏保守起步避免誤合併（Edge Case）。 */
export const TITLE_JACCARD_THRESHOLD = 0.6;
