import { stripMarkdownNoise } from './markdown-noise';

describe('stripMarkdownNoise', () => {
  it('移除 HTML 註解', () => {
    expect(stripMarkdownNoise('前<!-- hidden note -->後')).toBe('前後');
  });

  it('移除 HTML 標籤（含 badge img/a/div）', () => {
    const input = '<div align="center"><img src="badge.svg" /></div>\n內文';
    expect(stripMarkdownNoise(input)).toBe('內文');
  });

  it('移除圖片與 badge markdown 語法', () => {
    expect(stripMarkdownNoise('![CI Status](https://ci.example/badge.svg)\n內文')).toBe('內文');
  });

  it('連結收斂為顯示文字', () => {
    expect(stripMarkdownNoise('請見[官方文件](https://example.com/docs)了解更多')).toBe(
      '請見官方文件了解更多',
    );
  });

  it('移除程式碼圍欄區塊', () => {
    const input = '說明文字\n```ts\nconst x = 1;\n```\n後續文字';
    expect(stripMarkdownNoise(input)).toBe('說明文字\n\n後續文字');
  });

  it('收斂多餘空白與空行，保留標題與內文', () => {
    const input = '# 標題\n\n\n\n這是   內容    段落。';
    expect(stripMarkdownNoise(input)).toBe('# 標題\n\n這是 內容 段落。');
  });
});
