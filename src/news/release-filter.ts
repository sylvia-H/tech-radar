/**
 * GitHub releases 版本噪音過濾（純函式，FR-008 / SC-010）。
 *
 * **drop**：pre-release 標記（`-alpha`／`-beta`／`-rc`／`-pre`／`-preview`／`-dev`／`-canary`／
 * `-nightly`，或 CPython/PEP 440 風格無連字號版號如 `3.15.0b4`／`3.15.0rc1`／`3.15.0a1`，
 * 2026-08-04 新增）與**純 patch**（semver `x.y.z` 之 `z > 0` 且非安全修補）。
 * **keep**：major/minor（`z === 0`）、帶安全字樣者（`security`／`CVE`／`advisory`）、
 * 以及**無法解析版本號**者（保守保留，不誤殺）。
 *
 * 安全修補常伴 patch 號但屬第一順位重要性，故安全字樣優先於「純 patch」判定豁免。安全字樣多半只
 * 出現在 release **內文**（body）而非標題，故 `body` 併入安全掃描；但版號／pre-release 判定仍**只看
 * 標題**（避免內文 changelog 內的版號／`beta` 字樣誤判整筆）。
 *
 * **CPython 命名缺口**（2026-08-04 修正）：原本的 pre-release 正則式只認帶連字號的寫法
 * （`-beta`），但 CPython 官方 release tag 依 PEP 440 慣例**不帶連字號**、直接把 `a`/`b`/`rc`
 * 接在 patch 號後面（如 `v3.15.0b4` = beta 4）。這種寫法既沒被 pre-release 正則式抓到，
 * `patch` 又解析為 `0`（`z===0` 判定為 keep），導致測試版持續誤入候選池——實測連續多輪同一個
 * `v3.15.0b4` 反覆出現在候選池裡。另加一條 PEP 440 專用正則式堵住這個缺口。
 */
export function isNoisyRelease(title: string, body?: string | null): boolean {
  const t = title.toLowerCase();

  // 安全字樣優先豁免（即使是 patch 號也保留）；掃描範圍含標題＋內文。
  const securityHaystack = `${title} ${body ?? ''}`.toLowerCase();
  if (/security|cve-\d|advisory/.test(securityHaystack)) {
    return false;
  }

  // pre-release 標記 → 噪音（只看標題）。
  if (/-(alpha|beta|rc|pre|preview|dev|canary|nightly)\b/.test(t) || /-rc\d/.test(t)) {
    return true;
  }
  // CPython／PEP 440 風格無連字號 pre-release 版號（如 3.15.0b4／3.15.0rc1／3.15.0a1）。
  if (/\d+\.\d+\.\d+(a|b|rc)\d+/.test(t)) {
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
