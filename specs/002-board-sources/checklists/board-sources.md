# Board Sources Requirements-Quality Checklist: 榜單來源與三領域歸類

**Purpose**: 以「需求的單元測試」檢驗 F2 規格的**完整性、明確性、一致性、可量測性與覆蓋度**——檢的是規格寫得夠不夠好、能否安全進入實作，而非程式是否正確。嚴格度對齊 PR merge 品質閘門。
**Created**: 2026-07-12
**Feature**: [spec.md](../spec.md)（並參照 [plan.md](../plan.md) / [research.md](../research.md) / [data-model.md](../data-model.md) / [contracts/](../contracts/)）

**Note**: 本清單由 `/speckit-checklist` 依聚焦面向（資料來源與抓取韌性、分類規則正確/明確性、容錯與可觀測性、合併去重與排序決定性）產生。逐項為「規格品質」提問，非測試實作。

## 需求完整性 — 資料來源與抓取韌性

- [ ] CHK001 主力 Trending 要涵蓋的語言頁範圍是否在需求中明確列舉且無遺漏？[Completeness, Spec §FR-010]
- [ ] CHK002 「stars this week」作為主力排序來源的解析目標是否被明確要求（而非泛指「熱度」）？[Clarity, Spec §FR-001]
- [ ] CHK003 補位 Search 的三組領域查詢、星數門檻與 `created` 時間窗是否逐項量化？[Completeness, Spec §FR-002/§FR-010]
- [ ] CHK004 「解析到 0 筆」與「頁面改版/解析失敗」的偵測判準是否以可量測方式定義（何謂「失敗」）？[Measurability, Spec §FR-009, Edge Case]
- [ ] CHK005 主力頁面改版時「不得靜默視為本週無熱門」的要求是否明確且可驗證？[Clarity, Spec §FR-009]
- [ ] CHK006 抓取禮貌（User-Agent、失敗退避、條件式請求）是否以具體可驗證的需求陳述，而非泛稱「表現抓取禮貌」？[Ambiguity, Spec §FR-008]
- [ ] CHK007 Trending（HTML、不計 API 限額）與 Search/`GET /repos`（計 API 限額）在用量需求上的區別是否被明確界定？[Completeness, Gap]

## 需求明確性 — 分類規則

- [ ] CHK008 三領域歸類的訊號優先序（topics → description → language）是否在需求中明確排定？[Clarity, Spec §FR-003]
- [ ] CHK009 「language 僅作加權輔助、不單獨決定領域」中的「加權」是否量化或給出可判定規則？[Ambiguity, Spec §FR-003]
- [ ] CHK010 跨領域 repo「擇一主領域」的固定優先序（AI > DevOps > 前後端）是否無歧義？[Clarity, Spec §FR-011]
- [ ] CHK011 三領域關鍵字種子集是否完整列舉，且「命中」的比對語意（大小寫、子字串或整詞）是否明確定義？[Completeness, Spec §FR-010, Gap]
- [ ] CHK012 「歸類採寬鬆傾向」是否有可操作定義，或屬未量化的模糊形容詞？[Ambiguity, Spec Clarifications]
- [ ] CHK013 無 topics 時改用 description 比對，是否明確要求使用「同一套」領域關鍵字集？[Clarity, Spec §FR-003]
- [ ] CHK014 SC-002「≥90% 歸類合理」中的「合理」是否定義判定方法/抽查樣本，使其可客觀驗證？[Measurability, Spec §SC-002]

## 需求一致性與衝突

- [ ] CHK015 榜單「三領域（前後端合併）」與 F1 既有 4-way `domain` 佔位之間的對齊，是否在需求層被指明（避免實作時分歧）？[Consistency, Spec Clarifications, Gap]
- [ ] CHK016 FR-005（主力用週增星、補位用「總星數 ÷ 建立天數」）與 Assumptions「各領域內排序不需換算成同一標度」是否存在張力——一個混合兩來源的領域榜要如何以單一順序排列，是否有明確需求？[Conflict, Spec §FR-005 / Assumptions]
- [ ] CHK017 對「前後端」的稱呼是否在 spec/clarify/Key Entities 各處一致，且未與新聞側 backend/frontend 分類混淆？[Consistency]
- [ ] CHK018 「追蹤深度 15」與「推播綜合 top 10」的分工是否清楚標明屬不同 Feature（F2 只到 15、不決定推播張數）？[Consistency, Spec Assumptions]

## 覆蓋度 — 合併去重與排序決定性

- [ ] CHK019 以 GitHub 數字 `repoId` 作為同一性依據（抗改名）的去重要求是否明確且可驗證？[Clarity, Spec §FR-004/§SC-003]
- [ ] CHK020 同一 repo 同時來自兩來源時，最終保留哪一筆的欄位（如 `starsThisWeek`）是否有明確規則？[Completeness, Gap]
- [ ] CHK021 混合兩來源的單一領域榜，其**統一排序鍵**是否在需求中定義（而非只分別給兩來源各自的鍵）？[Completeness, Spec §FR-005, Gap]
- [ ] CHK022 排序的 tie-break 規則是否明確，使「相同輸入必得相同順序」可被客觀驗證？[Measurability, Spec §SC-005, Gap]
- [ ] CHK023 「每領域取 top 15」與「候選不足 15 照實呈現、不硬湊」是否皆有明確需求？[Completeness, Spec §FR-005, Edge Case]
- [ ] CHK024 SC-005「排序可重現、不因來源處理順序改變名次」是否給出可客觀驗證的判準？[Measurability, Spec §SC-005]

## 覆蓋度 — 容錯與可觀測性

- [ ] CHK025 FR-007「帶來源識別的告警」中，來源識別的粒度（整個 Search vs 各領域查詢、Trending vs repos）是否明確定義？[Clarity, Spec §FR-007, Gap]
- [ ] CHK026 「Trending 解析 0 筆須告警」與「Search 某組 0 筆屬正常（本週無新星）」的區別是否在需求中明確且一致？[Consistency, Spec §FR-009 / Edge Case]
- [ ] CHK027 任一來源失敗時「另一來源仍須產出」的要求，是否對主力/補位雙向都明確（US4 兩情境）？[Coverage, Spec §FR-007]
- [ ] CHK028 可觀測輸出（log）要包含的欄位（repo 識別、本週增星、領域、名次）是否完整且明確指定？[Completeness, Spec §SC-001/§FR-006]
- [ ] CHK029 SC-006「API 呼叫維持在免費上限安全範圍」是否量化門檻，並要求把用量以可觀測方式呈現？[Measurability, Spec §SC-006, Gap]
- [ ] CHK030 「兩來源皆正常則不發任何來源告警」是否有明確需求（避免誤報）？[Clarity, Spec §SC-004]

## 邊界情況覆蓋

- [ ] CHK031 建立天數為 0（今日新建）時排序鍵避免除以零的處理，是否有明確需求（而非僅點出風險）？[Coverage, Spec Edge Case, Gap]
- [ ] CHK032 repo 改名/轉移擁有者仍視為同一筆的要求，是否與 `repoId` 去重需求一致銜接？[Consistency, Spec Edge Case/§FR-004]
- [ ] CHK033 「同時符合多領域」與「完全無法歸類而排除」兩個相對邊界，是否都有明確需求？[Coverage, Spec §FR-003/§FR-011]
- [ ] CHK034 API 限額逼近時的行為（退避/降載）是否有需求層陳述，或僅停留在實作細節？[Coverage, Spec Edge Case, Gap]

## 依賴與假設

- [ ] CHK035 對 F1 既有基礎（`GH_API_TOKEN` 驗證、失敗告警通道）的依賴是否在需求中明列並確認可用？[Assumption, Spec Assumptions]
- [ ] CHK036 「Trending HTML 結構穩定」「GitHub API 可用」等外部假設是否被記錄，並有對應的風險緩解需求？[Assumption, Spec Edge Case/§FR-009]
- [ ] CHK037 F2 的範圍排除項（不寫狀態、不 diff、不推播、不簡介、不新聞）是否清楚界定、無滲漏？[Coverage, Spec §FR-006 / Assumptions]

## 可追溯性與驗收品質

- [ ] CHK038 每條 FR 是否都有對應且可測的驗收訊號（SC 或 Acceptance Scenario）？[Traceability, Spec §FR/§SC]
- [ ] CHK039 M1 驗收「log 印出正確三領域榜」是否給出「正確」的可判定條件（欄位齊備＋抽查標準）？[Measurability, Spec §SC-001/§SC-002]

## Notes

- 完成的項目標記為 `[x]`；發現問題可在項目下方以縮排補註（引用 spec 段落）。
- `[Gap]` 表示需求可能缺漏；`[Ambiguity]`/`[Conflict]` 表示措辭需釐清或段落間需對齊。多為本 Feature 已於 clarify/plan 解決、但 **spec 本文尚未回填**之處——過關準則是「spec 本文可獨立讀懂該需求」，不倚賴 plan/research。
- 建議在進入 `/speckit-tasks` 前先跑 `/speckit-analyze` 對照 spec ↔ plan ↔（後續）tasks，把本清單標出的 Gap/Conflict 一併收斂。
