import {
  isSocialPlatformUrl,
  SOCIAL_PLATFORM_HOST_PATTERNS,
  SOCIAL_PLATFORM_HOSTS,
} from './social-hosts';

describe('isSocialPlatformUrl — 社群平台 host 過濾（2026-09-12，分支 3）', () => {
  it('清單內 host → true', () => {
    expect(isSocialPlatformUrl('https://twitter.com/user/status/123')).toBe(true);
    expect(isSocialPlatformUrl('https://x.com/user/status/123')).toBe(true);
    expect(isSocialPlatformUrl('https://bsky.app/profile/a.b/post/xyz')).toBe(true);
    expect(isSocialPlatformUrl('https://www.threads.com/@user/post/abc')).toBe(true); // 主域（2025 起）
    expect(isSocialPlatformUrl('https://threads.net/@user/post/abc')).toBe(true); // 舊域，僅導流
    expect(isSocialPlatformUrl('https://mathstodon.xyz/@tao/1')).toBe(true);
    expect(isSocialPlatformUrl('https://fosstodon.org/@x/1')).toBe(true);
    expect(isSocialPlatformUrl('https://hachyderm.io/@x/1')).toBe(true);
    expect(isSocialPlatformUrl('https://infosec.exchange/@x/1')).toBe(true);
    expect(isSocialPlatformUrl('https://mas.to/@x/1')).toBe(true);
    expect(isSocialPlatformUrl('https://toot.community/@x/1')).toBe(true);
    expect(isSocialPlatformUrl('https://ioc.exchange/@x/1')).toBe(true);
  });

  it('子網域與 www. 前綴：mobile.twitter.com／www.x.com → true', () => {
    expect(isSocialPlatformUrl('https://mobile.twitter.com/user/status/123')).toBe(true);
    expect(isSocialPlatformUrl('https://www.x.com/user/status/123')).toBe(true);
    expect(isSocialPlatformUrl('HTTPS://WWW.Twitter.COM/u/status/1')).toBe(true); // 大小寫不敏感
  });

  it('pattern 命中未列入的 Mastodon 實例：mastodon.gamedev.place → true', () => {
    expect(isSocialPlatformUrl('https://mastodon.gamedev.place/@x/1')).toBe(true);
    expect(isSocialPlatformUrl('https://mstdn.jp/@x/1')).toBe(true);
  });

  it('mastodon.social／mstdn.social 不在精確清單、僅由 pattern 層命中（兩層職責不重疊）', () => {
    expect(SOCIAL_PLATFORM_HOSTS).not.toContain('mastodon.social');
    expect(SOCIAL_PLATFORM_HOSTS).not.toContain('mstdn.social');
    expect(SOCIAL_PLATFORM_HOST_PATTERNS.some((re) => re.test('mastodon.social'))).toBe(true);
    expect(SOCIAL_PLATFORM_HOST_PATTERNS.some((re) => re.test('mstdn.social'))).toBe(true);
    expect(isSocialPlatformUrl('https://mastodon.social/@x/1')).toBe(true);
    expect(isSocialPlatformUrl('https://mstdn.social/@x/1')).toBe(true);
  });

  it('非社群 host → false（github.com／simonwillison.net）', () => {
    expect(isSocialPlatformUrl('https://github.com/owner/repo')).toBe(false);
    expect(isSocialPlatformUrl('https://simonwillison.net/2026/Sep/12/post/')).toBe(false);
  });

  it('不可誤殺：僅 host 尾綴相似而非子網域（notx.com）→ false', () => {
    expect(isSocialPlatformUrl('https://notx.com/a')).toBe(false);
    expect(isSocialPlatformUrl('https://example.com/x.com/mirror')).toBe(false); // path 含 host 字樣不算
  });

  it('非法 URL → false（交由後段照常處理）', () => {
    expect(isSocialPlatformUrl('not a url')).toBe(false);
    expect(isSocialPlatformUrl('')).toBe(false);
  });

  it('短網址 t.co 不在清單、無法不解址判定 → false', () => {
    expect(SOCIAL_PLATFORM_HOSTS).not.toContain('t.co');
    expect(isSocialPlatformUrl('https://t.co/abc123')).toBe(false);
  });
});
