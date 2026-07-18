/**
 * GitHub releases 版本噪音過濾（純函式，FR-008 / SC-010）。
 *
 * **drop**：pre-release 標記（`-alpha`／`-beta`／`-rc`／`-pre`／`-dev`／`-canary`／`-nightly`）
 * 與**純 patch**（semver `x.y.z` 之 `z > 0` 且非安全修補）。
 * **keep**：major/minor（`z === 0`）、帶安全字樣者（`security`／`CVE`／`advisory`）、
 * 以及**無法解析版本號**者（保守保留，不誤殺）。
 *
 * 安全修補常伴 patch 號但屬第一順位重要性，故安全字樣優先於「純 patch」判定豁免。
 */
export function isNoisyRelease(tagOrTitle: string): boolean {
  const t = tagOrTitle.toLowerCase();

  // 安全字樣優先豁免（即使是 patch 號也保留）。
  if (/security|cve-\d|advisory/.test(t)) {
    return false;
  }

  // pre-release 標記 → 噪音。
  if (/-(alpha|beta|rc|pre|dev|canary|nightly)\b/.test(t) || /-rc\d/.test(t)) {
    return true;
  }

  // 解析 semver x.y.z；無法解析 → 保守保留。
  const m = t.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) {
    return false;
  }
  const patch = Number(m[3]);
  // 純 patch（z > 0）→ 噪音；major/minor（z === 0）→ 保留。
  return patch > 0;
}
