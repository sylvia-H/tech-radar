import { escapeHtml } from './html-escape';

describe('escapeHtml', () => {
  it('轉義 & < > " 五個字元', () => {
    expect(escapeHtml(`<a href="x">R&D's</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;R&amp;D&#39;s&lt;/a&gt;',
    );
  });

  it('不含特殊字元的文字原樣回傳', () => {
    expect(escapeHtml('plain text 123')).toBe('plain text 123');
  });

  it('空字串回傳空字串', () => {
    expect(escapeHtml('')).toBe('');
  });
});
