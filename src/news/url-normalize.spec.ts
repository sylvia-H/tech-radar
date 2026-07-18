import { normalizeTargetUrl } from './url-normalize';

describe('normalizeTargetUrl（FR-011 / SC-009）', () => {
  it('小寫 scheme/host、去 www.、去尾斜線、去 fragment', () => {
    expect(normalizeTargetUrl('HTTPS://WWW.Example.com/Path/#frag')).toBe('https://example.com/Path');
  });

  it('去追蹤參數（utm_*/ref/fbclid/gclid/mc_*），保留其餘 query 並依鍵排序', () => {
    expect(normalizeTargetUrl('https://a.com/x?utm_source=y&ref=z&id=5&fbclid=q&b=2&mc_cid=1')).toBe(
      'https://a.com/x?b=2&id=5',
    );
  });

  it('指向同一資源者（不同追蹤參數/大小寫/尾斜線）得相同鍵（SC-009）', () => {
    const a = normalizeTargetUrl('https://www.Site.com/a/b/?utm_campaign=x');
    const b = normalizeTargetUrl('https://site.com/a/b?gclid=y');
    expect(a).toBe(b);
    expect(a).toBe('https://site.com/a/b');
  });

  it('root 路徑保留單一斜線', () => {
    expect(normalizeTargetUrl('https://a.com/')).toBe('https://a.com/');
  });

  it('無法解析為絕對 URL 者原樣回傳（不崩潰）', () => {
    expect(normalizeTargetUrl('  not a url  ')).toBe('not a url');
  });
});
