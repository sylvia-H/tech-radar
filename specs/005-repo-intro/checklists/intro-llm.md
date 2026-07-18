# Requirements Quality Checklist: LLM 封裝與 repo 250 字簡介

**Purpose**: 以「需求的單元測試」檢驗 F5 spec 的需求**寫得好不好**（完整、明確、一致、可量測、涵蓋
周全），而非驗證程式是否正確。聚焦四大面向：LLM 節制與快取正確性、容錯與降級邊界、防幻覺與輸出
約束、接縫與相依契約。
**Created**: 2026-07-18
**Feature**: [spec.md](../spec.md)（plan.md / research.md / data-model.md / contracts/ 為輔）

**Note**: 每項問「需求是否清楚寫下」；`[Gap]` 表疑似缺漏、`[Ambiguity]`／`[Conflict]`／`[Assumption]`
為需求品質問題標記。勾選代表該需求品質面向已確認過關。

## LLM 節制與快取正確性

- [x] CHK001 「同一 repo 一生只生成一次」是否以可量測方式定義（快取命中路徑 LLM／README 呼叫次數 = 0）？ [Measurability, Spec §FR-002/FR-005, §SC-001]
- [x] CHK002 快取「命中」的判定條件是否明確（存在該 repoId 紀錄**且** `intro` 非空字串）？ [Clarity, Spec §FR-002, Edge Cases]
- [x] CHK003 「掉出榜後重新進榜仍讀快取、不重生成」是否有獨立可驗證的需求，而非僅隱含於敘述？ [Coverage, Spec §FR-005, §SC-006]
- [x] CHK004 「快取獨立於榜單快照、掉出榜不清除」是否明確定義為需求，且指明清除的排除條件？ [Completeness, Spec §FR-004, US2-3]（快取永不清除，無排除條件可指明，非缺漏）
- [x] CHK005 LLM 呼叫次數的上限與穩定態預估是否量化（冷啟動 ≤10、穩定態 0～數次）且可對照？ [Measurability, Spec §SC-003]
- [x] CHK006 「禁止 embeddings／向量檢索」是否作為明確的排除性需求寫下（而非僅出現在憲章）？ [Completeness, Constitution §V]（[Gap]→已補：FR-013 新增 MUST NOT embeddings/向量檢索）
- [x] CHK007 README 素材上限（截斷長度）是否有明確數值與計數口徑，避免「控制 token」淪為模糊詞？ [Ambiguity→Clarity, Spec Assumptions, plan §D2]

## 容錯與降級邊界

- [x] CHK008 「單一 repo 簡介失敗不阻斷其餘 repo／整條 pipeline」是否可量測（連帶失敗數 = 0）？ [Measurability, Spec §FR-014, §SC-004]
- [x] CHK009 「降級」的觸發條件是否窮舉且明確（429 重試耗盡、空回應、無效回應、README 取不到後 LLM 仍失敗）？ [Completeness, Spec §FR-014/FR-015, Edge Cases]
- [x] CHK010 降級後的回傳形態是否明確定義為可區別的結果（真簡介 vs 降級），使呼叫端不致誤把 description 當簡介？ [Clarity, Spec §FR-015, Clarifications Q2]
- [x] CHK011 「失敗不寫入快取」是否明確規範，並說明理由（避免永久快取失敗、保留重試機會）？ [Completeness, Spec §FR-016, Edge Cases]
- [x] CHK012 「失敗不得無聲」是否量測化到具體可觀測行為（warn 記錄且帶 repoId），而非僅口號？ [Measurability, Spec §FR-015, Constitution §VII]（[Gap]→已補：FR-015 明列 warn MUST 含 repoId/fullName、MUST NOT 含 prompt 全文）
- [x] CHK013 429 退避策略的參數（指數退避 + jitter、重試上限）是否有明確需求，且「上限次數」是否量化或指明於 plan 釘定？ [Clarity, Spec §FR-012, plan §D6]
- [x] CHK014 429 重試「成功」與「耗盡」兩條路徑是否都有對應的可驗證需求，而非只描述 happy path？ [Coverage, Spec §SC-007, Exception Flow]
- [x] CHK015 F5 的失敗「只記錄不推播」與「紅色告警屬 F7」的責任分界是否明確，避免跨 Feature 職責含糊？ [Consistency, Spec Assumptions, plan §D8]（[Gap]→已補：FR-015 新增「MUST NOT 發送 Discord 告警；紅色告警屬 F7」）

## 防幻覺與輸出約束

- [x] CHK016 「不得杜撰事實」是否明確界定範圍（素材未出現的星數／名次／連結），而非籠統的「不造假」？ [Clarity, Spec §FR-007, §SC-005]
- [x] CHK017 「事實數據一律由程式提供、不經 LLM」與「metadata（含 starsThisWeek）作 prompt 語境」兩者是否一致、無矛盾？ [Conflict, Spec §FR-007, Key Entities]
- [x] CHK018 250 字上限的「字」計數口徑是否明確定義（Unicode code point）且與新聞 50/300 一致？ [Clarity, Spec Assumptions, §SC-002]
- [x] CHK019 「輸出超長」的收斂手段是否明確（截斷至 ≤250、自然邊界、不重呼叫 LLM），避免「收斂」語意含糊？ [Ambiguity→Clarity, Spec §FR-006, Assumptions]
- [x] CHK020 「100% 繁體中文」是否可客觀量測，或已說明僅以 prompt 約束＋長度硬驗證（有界風險已載明）？ [Measurability, Spec §SC-002, plan §D11]（[Conflict]→已修：Edge Cases 原文暗示「語言驗證確保輸出符合繁中要求」與 research D11 不做嚴格語言驗證矛盾，已改寫為「不做嚴格語言偵測、有界風險已知接受」）
- [x] CHK021 「只送公開資料給 LLM」是否作為明確需求，並界定何謂公開素材（README／metadata）？ [Completeness, Spec §FR-013, Constitution §VII]
- [x] CHK022 簡介的內容結構要求（解決什麼→特色→適合誰）是否寫入需求或明確標為非強制？ [Clarity, Spec US1, dev-guide §6.2]（[Ambiguity]→已補：FR-007 註記此為 prompt 層 SHOULD 指引、非程式硬性驗證項）

## 接縫與相依契約

- [x] CHK023 IntroService 的**輸入契約**是否明列必備 metadata 欄位及其**來源**（呼叫端傳入 vs 自取）？ [Completeness, Spec §FR-001, Clarifications Q1]
- [x] CHK024 「description/topics 由呼叫端 join 補齊」是否與「持久化 state.board 不存 description/topics」的事實一致、無隱含矛盾？ [Consistency, Spec Assumptions, Clarifications Q1]
- [x] CHK025 快取鍵（repoId）的形態是否明確（數字 id 字串、抗改名），且與 F3 榜單鍵一致？ [Clarity, Spec Key Entities, data-model §D9]
- [x] CHK026 快取「寫入時機／由誰持久化」是否明確（IntroService 就地寫 in-memory、F7 推播成功後 save），避免半套狀態爭議？ [Consistency, Spec §FR-004, Constitution §VI]（[Gap]→已補：FR-004 新增「僅寫 in-memory、MUST NOT 呼叫 StateStore.save()／commit，持久化由 F7 負責」）
- [x] CHK027 「LLM 封裝為單一入口、F6 重用」是否作為明確需求，且界定其對外介面邊界？ [Completeness, Spec §FR-011]
- [x] CHK028 README 取得「沿用 F1 GitHub HTTP 基座、不另建平行請求層」是否明確規範？ [Clarity, Spec §FR-010]
- [x] CHK029 F5 的範圍邊界（不做榜單 diff／不組版／不推播／不 commit）是否明確排除，避免與 F3/F7 職責重疊？ [Coverage, Spec 範圍界定, Assumptions]（[Gap]→已補：Assumptions「簡介觸發由呼叫端決定」新增「不落檔、不 commit」）

## 涵蓋度、邊界與一致性

- [x] CHK030 README 「極短」退回的門檻是否量化且指明計數基準（去雜訊後 code points < 門檻）？ [Clarity, Spec §FR-008, Clarifications Q3]
- [x] CHK031 「連 description 與 topics 都幾乎沒有」的最小可用簡介情境是否有明確需求（不留白、不杜撰）？ [Coverage, Spec US3-3, Edge Cases]
- [x] CHK032 素材前處理（去 badge／HTML／目錄雜訊）是否作為需求寫下，且說明目的（省 token／防誤導）？ [Completeness, Spec §FR-003, Edge Cases]
- [x] CHK033 「（資訊有限）」標註為 MAY（非強制）是否明確，避免實作端誤解為必附？ [Clarity, Spec §FR-009]（[Assumption]→已隨 /speckit-analyze A1 收斂為「sparse 時 MUST 標註、否則不標註」，較原 MAY 更明確，無歧義殘留）
- [x] CHK034 「同一 repo 於同一次執行被請求多次仍只生成一次」是否有對應需求或已由快取命中隱含覆蓋且可驗證？ [Coverage, Spec Edge Cases, §SC-001]
- [x] CHK035 各 SC（SC-001…SC-007）是否皆能對應到至少一條可驗證需求／測試面，無孤立的成功指標？ [Traceability, Spec §Success Criteria]
- [x] CHK036 Assumptions 中「plan 釘定」的待定數值（README 上限、429 重試上限、極短門檻）是否已在 plan/research 全數收斂、無殘留 NEEDS CLARIFICATION？ [Assumption, Spec Assumptions, research §對照表]

## Notes

- 勾選：`[x]`；發現的需求缺漏／模糊請就地標註並回頭修 spec。
- 本清單為 F5 spec 的「需求品質單元測試」；與 `requirements.md`（spec 通用品質）互補，聚焦四大領域深度。
- ≥80% 項目含 spec 章節或 `[Gap/Ambiguity/Conflict/Assumption]` 追溯標記。
