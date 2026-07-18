import { clampTo250, countCodePoints } from './intro-length';

describe('countCodePoints', () => {
  it('一般文字以字元數計', () => {
    expect(countCodePoints('繁體中文')).toBe(4);
  });

  it('emoji（surrogate pair）計為 1 個 code point', () => {
    expect(countCodePoints('🚀')).toBe(1);
    expect(countCodePoints('a🚀b')).toBe(3);
  });
});

describe('clampTo250', () => {
  it('未超長時原樣回傳', () => {
    const text = '短簡介';
    expect(clampTo250(text)).toBe(text);
  });

  it('剛好 250 字時原樣回傳', () => {
    const text = '中'.repeat(250);
    expect(clampTo250(text)).toBe(text);
    expect(countCodePoints(clampTo250(text))).toBe(250);
  });

  it('超長於自然邊界截斷並加省略號，結果 ≤250', () => {
    // 前 200 字為句子，句號在第 200 位，之後補到 300 字無邊界
    const text = '中'.repeat(199) + '。' + '中'.repeat(100);
    const out = clampTo250(text);
    expect(out).toBe('中'.repeat(199) + '。' + '…');
    expect(countCodePoints(out)).toBeLessThanOrEqual(250);
  });

  it('找不到邊界時硬截至 249 字加省略號', () => {
    const text = '中'.repeat(300);
    const out = clampTo250(text);
    expect(out).toBe('中'.repeat(249) + '…');
    expect(countCodePoints(out)).toBe(250);
  });

  it('emoji 混雜的超長內容也正確截斷（不切斷 surrogate pair）', () => {
    const text = '🚀'.repeat(260);
    const out = clampTo250(text);
    expect(countCodePoints(out)).toBe(250);
    expect(out.endsWith('…')).toBe(true);
  });
});
