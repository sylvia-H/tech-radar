import { clampToLimit, countCodePoints } from './curation-length';

describe('countCodePoints', () => {
  it('一般文字以字元數計', () => {
    expect(countCodePoints('繁體中文')).toBe(4);
  });

  it('emoji（surrogate pair）計為 1 個 code point', () => {
    expect(countCodePoints('🚀')).toBe(1);
    expect(countCodePoints('a🚀b')).toBe(3);
  });
});

describe('clampToLimit', () => {
  it('未超長時原樣回傳', () => {
    const text = '短標題';
    expect(clampToLimit(text, 50)).toBe(text);
  });

  it('剛好上限時原樣回傳', () => {
    const text = '中'.repeat(50);
    expect(clampToLimit(text, 50)).toBe(text);
    expect(countCodePoints(clampToLimit(text, 50))).toBe(50);
  });

  it('超長於自然邊界截斷並加省略號，結果 ≤max（title 50）', () => {
    const text = '中'.repeat(40) + '。' + '中'.repeat(20);
    const out = clampToLimit(text, 50);
    expect(out).toBe('中'.repeat(40) + '。' + '…');
    expect(countCodePoints(out)).toBeLessThanOrEqual(50);
  });

  it('找不到邊界時硬截至 max-1 字加省略號（content 300）', () => {
    const text = '中'.repeat(400);
    const out = clampToLimit(text, 300);
    expect(out).toBe('中'.repeat(299) + '…');
    expect(countCodePoints(out)).toBe(300);
  });

  it('emoji 混雜的超長內容也正確截斷（不切斷 surrogate pair）', () => {
    const text = '🚀'.repeat(310);
    const out = clampToLimit(text, 300);
    expect(countCodePoints(out)).toBe(300);
    expect(out.endsWith('…')).toBe(true);
  });

  it('上限參數化：同一函式可分別套用 50 與 300（不重寫兩份邏輯）', () => {
    const text = '中'.repeat(60);
    expect(countCodePoints(clampToLimit(text, 50))).toBe(50);
    expect(clampToLimit(text, 300)).toBe(text);
  });
});
