/**
 * 一般化 F5 `clampTo250`（`src/intro/intro-length.ts`）的自然邊界收斂邏輯，把上限參數化
 * （50／300 共用）。**不改 F5**：邊界字元集合與 `countCodePoints` 於本檔各自定義，接受與 F5
 * 的小邏輯重複，換取不擴大本 Feature 對 F5 的改動面（research D5）。
 */

/** 自然邊界字元：句號／問號／驚嘆號（全形＋半形）與換行（沿用 F5 同一語意）。 */
const BOUNDARY_CHARS = new Set(['。', '？', '！', '.', '?', '!', '\n']);

/** Unicode code point 計數（正確處理 surrogate pair／emoji，與 F5／憲章 50/300 同口徑）。 */
export function countCodePoints(text: string): number {
  return [...text].length;
}

/**
 * 超過 `max` 時截斷收斂：於 ≤max 範圍內（含省略號）找最後一個自然邊界截斷；找不到邊界則
 * 硬截至 `max-1` code points 再加「…」。不重呼叫 LLM 重生成（research D5、FR-008）。
 */
export function clampToLimit(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) {
    return text;
  }
  for (let i = max - 2; i >= 0; i--) {
    if (BOUNDARY_CHARS.has(chars[i])) {
      return chars.slice(0, i + 1).join('') + '…';
    }
  }
  return chars.slice(0, max - 1).join('') + '…';
}
