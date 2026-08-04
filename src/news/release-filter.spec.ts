import { isNoisyRelease } from './release-filter';

describe('isNoisyRelease（FR-008 / SC-010）', () => {
  it('drop pre-release（alpha/beta/rc/pre/preview/dev/canary/nightly）', () => {
    for (const t of ['v2.0.0-alpha.1', 'v2.0.0-beta', 'v3.1.0-rc.2', '1.0.0-pre', 'v2.0.0-preview.1', 'x-dev.3', 'app-canary', 'v1.0.0-nightly.2']) {
      expect(isNoisyRelease(t)).toBe(true);
    }
  });

  it('drop 純 patch（z > 0）', () => {
    expect(isNoisyRelease('v20.11.1')).toBe(true);
    expect(isNoisyRelease('1.2.3')).toBe(true);
  });

  it('drop CPython／PEP 440 風格無連字號 pre-release 版號（2026-08-04 新增）', () => {
    for (const t of ['v3.15.0b4', 'v3.15.0rc1', 'v3.15.0a1', '3.15.0b1']) {
      expect(isNoisyRelease(t)).toBe(true);
    }
  });

  it('keep major/minor（z === 0）', () => {
    expect(isNoisyRelease('v20.11.0')).toBe(false);
    expect(isNoisyRelease('v21.0.0')).toBe(false);
  });

  it('keep 安全字樣（即使是 patch 號）', () => {
    expect(isNoisyRelease('v18.19.1 (Security)')).toBe(false);
    expect(isNoisyRelease('Release 1.2.3 CVE-2026-1234')).toBe(false);
  });

  it('keep 安全字樣僅在內文(body)、標題只有純 patch 版號', () => {
    expect(isNoisyRelease('v18.19.1', 'This release addresses CVE-2026-9999.')).toBe(false);
    expect(isNoisyRelease('v18.19.1', 'Includes an important security advisory fix.')).toBe(false);
    // 內文無安全字樣的純 patch 仍為噪音。
    expect(isNoisyRelease('v18.19.1', 'Minor bugfixes and doc updates.')).toBe(true);
  });

  it('內文的版號／beta 字樣不影響版號/pre-release 判定（只看標題）', () => {
    // 標題為 major（z===0）→ keep，即使內文 changelog 提到舊 patch 或 beta。
    expect(isNoisyRelease('v21.0.0', 'Changelog: upgraded from 20.11.3, dropped 21.0.0-beta.2.')).toBe(false);
  });

  it('無法解析版本 → 保守保留', () => {
    expect(isNoisyRelease('Latest stable release')).toBe(false);
  });
});
