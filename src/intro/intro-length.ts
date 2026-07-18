import { MAX_INTRO_CHARS } from './intro.types';

/** 自然邊界字元：句號／問號／驚嘆號（全形＋半形）與換行（research D4）。 */
const BOUNDARY_CHARS = new Set(['。', '？', '！', '.', '?', '!', '\n']);

/** Unicode code point 計數（正確處理 surrogate pair／emoji，與新聞 50/300 同口徑）。 */
export function countCodePoints(text: string): number {
  return [...text].length;
}

/**
 * 超過 `MAX_INTRO_CHARS` 時截斷收斂：於 ≤250 範圍內（含省略號）找最後一個自然邊界截斷；
 * 找不到邊界則硬截至 249 code points 再加「…」。不重呼叫 LLM 重生成（research D4、FR-006）。
 */
export function clampTo250(text: string): string {
  const chars = [...text];
  if (chars.length <= MAX_INTRO_CHARS) {
    return text;
  }
  // 邊界須落在 MAX_INTRO_CHARS - 2 以內，讓「邊界內容 + …」總長度仍 ≤ MAX_INTRO_CHARS。
  for (let i = MAX_INTRO_CHARS - 2; i >= 0; i--) {
    if (BOUNDARY_CHARS.has(chars[i])) {
      return chars.slice(0, i + 1).join('') + '…';
    }
  }
  return chars.slice(0, MAX_INTRO_CHARS - 1).join('') + '…';
}
