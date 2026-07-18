import { isNoisyRelease } from './release-filter';

describe('isNoisyRelease（FR-008 / SC-010）', () => {
  it('drop pre-release（alpha/beta/rc/pre/dev/canary/nightly）', () => {
    for (const t of ['v2.0.0-alpha.1', 'v2.0.0-beta', 'v3.1.0-rc.2', '1.0.0-pre', 'x-dev.3', 'app-canary', 'v1.0.0-nightly.2']) {
      expect(isNoisyRelease(t)).toBe(true);
    }
  });

  it('drop 純 patch（z > 0）', () => {
    expect(isNoisyRelease('v20.11.1')).toBe(true);
    expect(isNoisyRelease('1.2.3')).toBe(true);
  });

  it('keep major/minor（z === 0）', () => {
    expect(isNoisyRelease('v20.11.0')).toBe(false);
    expect(isNoisyRelease('v21.0.0')).toBe(false);
  });

  it('keep 安全字樣（即使是 patch 號）', () => {
    expect(isNoisyRelease('v18.19.1 (Security)')).toBe(false);
    expect(isNoisyRelease('Release 1.2.3 CVE-2026-1234')).toBe(false);
  });

  it('無法解析版本 → 保守保留', () => {
    expect(isNoisyRelease('Latest stable release')).toBe(false);
  });
});
