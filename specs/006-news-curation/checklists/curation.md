# Curation Requirements Quality Checklist: 每日晨報單次 LLM 策展與降級備援（F6）

**Purpose**: 實作前正式關卡——以「需求品質單元測試」驗證 F6 規格在**策展邏輯、LLM 護欄/約束、降級
備援、跨 Feature 邊界**四面向是否完整、清楚、一致、可量測、覆蓋周全。**驗的是「規格寫得對不對」，
不是「程式跑得對不對」**。
**Created**: 2026-07-18
**Feature**: [spec.md](../spec.md) · 併看 [plan.md](../plan.md)／[research.md](../research.md)
**Depth**: 正式關卡（formal gate） | **Audience**: PR 審查者／實作者 | **Focus**: 綜合全面
**Verified**: 2026-07-19（對照 spec.md / plan.md / research.md / data-model.md / contracts 全面檢驗）

## Requirement Completeness（需求完整性）

- [x] CHK001 策展輸入契約是否完整界定「消費 `CandidateSet` 的哪些欄位」與「榜上 repo 脈絡由誰、以何介面提供」？[Completeness, Spec §FR-001] → 通過：FR-001 界定「候選由 F4 傳入、榜上脈絡由呼叫端傳入、MUST NOT 自抓」；消費欄位於 Key Entities 明列（title/domain/tier/score/sources 數/onBoard/summary 節錄）。
- [x] CHK002 「候選是否命中榜上 repo」脈絡的**傳入介面形狀**（型別／集合形式）是否有需求定義，或僅籠統說「由呼叫端傳入」？[Gap, Spec §FR-001] → **spec 層僅籠統「由呼叫端傳入」；介面形狀已於 plan 釘定**（data-model §1.5、news-curation.contract：`curate(candidates, boardRepoNames: ReadonlySet<string>)`，以 F4 `mentionsBoardRepo` 判定）。缺口已由 Phase 1 收斂，非阻斷。
- [x] CHK003 是否對三種策展失敗模式（`LlmError` exhausted／empty／error、回應無法解析）皆有需求把它們映射到降級路徑？[Completeness, Spec §FR-011, Edge] → 通過：FR-011＋Edge「格式無法解析視同策展失敗」＋llm-response.schema §3 失敗表窮舉。
- [x] CHK004 精選輸出項（繁中精煉版 vs 降級原文版）的**必要欄位集合**是否於規格明列（含降級標記、程式提供之連結/分數）？[Completeness, Spec §Key Entities, FR-013] → 通過：Key Entities `CuratedNewsItem` 含降級標記；data-model §1.3 完整列欄位與不變式。
- [x] CHK005 榜單 TL;DR 的輸入（diff 新進/竄升/下降計數與領域分布）是否有需求界定其構成與來源？[Completeness, Spec §FR-015] → 通過：FR-015 界定 diff 計數＋領域分布、由呼叫端傳入；data-model §2.1 `BoardChangeDigest`。
- [x] CHK006 空候選路徑（0 次 LLM 呼叫、回空精選集）是否被列為一條**獨立且明確**的需求？[Completeness, Spec §FR-020, SC-001] → 通過：FR-020 獨立條文＋SC-001「空候選為 0」＋Edge。

## Requirement Clarity & Measurability（清晰度與可量測性）

- [x] CHK007 「開發者重要性（重要 ≠ 熱門）」的挑選準則是否以足夠具體的類別界定，使「是否選對」可被判讀？[Clarity, Spec §FR-003b] → 通過：FR-003b 列舉具體類別（新工具/框架/版本、breaking change、安全通報、重大模型/API 發布、標準變動、deprecation）並明列「壓低純爆紅口水/drama/觀點文」。
- [x] CHK008 「AI ≥4」的前置條件「AI 候選足夠時」是否量化——多少 AI 候選才算「足夠」而觸發此軟性下限？[Ambiguity, Spec §FR-004] → **語意可操作、非硬門檻**：「足夠」＝有 ≥4 則合格 AI 候選可選；因程式僅夾「非 AI ≤2」數量、AI ≥4 屬 prompt 側軟性目標（無程式分支綁定此門檻，寧缺勿濫不硬填，見 research D4/D5）。實作不受阻；建議 tasks 時於 prompt 明述「足夠」語意。
- [x] CHK009 「字」的計數口徑是否於所有字數上限處一致定義為 Unicode code point？[Clarity, Spec §FR-008, Assumptions] → 通過：FR-008＋Assumptions＋data-model 皆 code point，與 F5/憲章同口徑。
- [x] CHK010 超長收斂行為（自然邊界截斷＋省略標記、不重呼叫 LLM）是否描述得足以客觀驗證，而非僅「收斂至 ≤N」？[Clarity, Spec §Assumptions] → 通過：Assumptions 明述「自然邊界並加省略標記、不重呼叫重生成」；research D5 一般化 F5 `clampTo250` 邏輯為 `clampToLimit`。
- [x] CHK011 「殘留語意去重」的成功條件是否量化為「最終同一事件 ≤1 則」且明確限定於 LLM 成功路徑？[Measurability, Spec §SC-006] → 通過：SC-006 明訂 ≤1 且「不約束降級路徑」。
- [x] CHK012 「寧缺勿濫／不硬湊」是否可自需求客觀驗證（硬湊比率為 0 的雙向判準）？[Measurability, Spec §SC-003, FR-005] → 通過：SC-003「未超上限＋未為湊數塞入」雙向驗證、硬湊比率 0。
- [x] CHK013 「每日僅呼叫 LLM 一次、與候選數無關」是否寫成可量測不變式（對任意候選規模呼叫次數恆為 1、空候選為 0）？[Measurability, Spec §SC-001, FR-002] → 通過：SC-001 對 15/25/更多恆為 1、空為 0。
- [x] CHK014 降級事實型 TL;DR 的措辭與「無變化」情形是否有明確、可驗證的呈現需求？[Clarity, Spec §FR-016, US4-3] → 通過：FR-016 給格式例句、US4-3 界定無變化；research D3 定 `factSummary` 格式（含全 0 → 「本週榜單無變化」）。

## Requirement Consistency（一致性）

- [x] CHK015 配額數字（AI ≥4／非 AI ≤2／總數 ≤6）在 FR-004、SC-003、Key Entities 與憲章 III 間是否一致？[Consistency, Spec §FR-004] → 通過：四處數字一致。
- [x] CHK016 護欄套用順序（剔幻覺去重→夾非 AI ≤2→截 ≤6→字數收斂）在 Clarifications、FR-010、US3 間是否敘述一致？[Consistency, Spec §FR-010] → 通過：Clarifications 2026-07-18＋FR-010＋US3 順序一致；research D5 落為管線步驟。
- [x] CHK017 「字數上限只約束繁中精煉版、降級原文標題不套 50 字收斂」在 FR-013、Edge、Assumptions 間是否一致？[Consistency, Spec §FR-013] → 通過：三處一致。
- [x] CHK018 「SC-006 不適用降級路徑」是否與 US2、Clarifications 2026-07-18、Edge 之敘述彼此對齊、無矛盾？[Consistency, Spec §SC-006] → 通過：四處對齊。
- [x] CHK019 「新聞策展每日 1 次」與「榜單日 TL;DR 另一次」的獨立性是否一致陳述、不致被誤讀為違反憲章 V？[Consistency, Spec §FR-017] → 通過：FR-017 明述兩者獨立；plan Constitution Check 與 Post-Design 複查均載明不構成憲章 V 違反。
- [x] CHK020 「遞補 AI」語意（僅 6-截斷時優先保留、非引入新候選）是否在 FR-010、US3-4、Clarifications 間一致且不與 SC-002 衝突？[Consistency, Spec §FR-010] → 通過：三處一致定義「遞補 AI 僅指截斷時優先保留」，與 SC-002（不混入非繁中原文）相容。

## Scenario Coverage（情境覆蓋：主要／替代／例外）

- [x] CHK021 替代流程（候選稀少、某類別掛零、候選全為非 AI）是否皆有明確需求界定輸出行為？[Coverage, Spec §FR-005, Edge] → 通過：FR-005＋Edge「候選全為非 AI」皆界定照實輸出。
- [x] CHK022 例外流程是否明確「LLM 回傳格式無法解析」與「LLM 明確擲錯」兩者**同等**走降級、皆不擲錯？[Coverage, Spec §FR-011, Edge] → 通過：FR-011＋Edge 明訂無法解析視同失敗、走 US2 降級。
- [x] CHK023 重複參照（同一候選被 LLM 選兩次）是否有去重需求、避免同則重複出現？[Coverage, Edge, Spec §FR-009] → 通過：FR-009「重複參照同一候選去重為一則」＋Edge。
- [x] CHK024 殘留語意重複跨越配額類別（同事件在 AI 與非 AI 各有一連結）時，去重後領域歸屬與配額計入是否有需求界定？[Coverage, Edge] → **通過（檢驗更正先前疑慮）**：Edge 明訂「語意去重後只留一則，其領域依留下的代表項計入配額」——已界定歸屬規則。
- [x] CHK025 榜單 diff「僅有下降、無新進/竄升」是否有需求界定其摘要仍照實產出？[Coverage, Edge, Spec §US4] → 通過：Edge「僅有下降...照實陳述、不略過」＋US4-1/2。

## Degradation & Fault-Tolerance（降級與容錯需求品質）

- [x] CHK026 降級觸發條件是否**窮舉**（重試耗盡／空回應／無效或不可解析回應），無遺漏的失敗態？[Completeness, Spec §FR-011] → 通過：FR-011 列 `LlmError` 三態＋回應無法解析；對回 F5 `LlmError('exhausted'|'empty'|'error')` 完整。
- [x] CHK027 降級排序需求是否清楚要求「沿用 F4 `weightedScore`、不另寫替代排序公式」，可據以判定是否合規？[Clarity, Spec §FR-012] → 通過：FR-012 明訂 MUST NOT 重寫排序公式、比照 F3 引用 F2。
- [x] CHK028 失敗記錄需求是否明確**MUST 含**（失敗原因、候選規模）與**MUST NOT 含**（prompt／回應全文）？[Clarity, Spec §FR-014] → 通過：FR-014 正反面皆明列。
- [x] CHK029 F6 的失敗回報是否明確界定為僅 `logger.warn`、**排除** Discord 告警（屬 F7）——邊界不含混？[Consistency, Spec §FR-014] → 通過：FR-014「MUST NOT 由 F6 發 Discord...屬 F7 推播層」。
- [x] CHK030 「策展失敗造成的連帶晨報中止數為 0」是否寫成可量測驗收標準？[Measurability, Spec §SC-004] → 通過：SC-004 中止數 0、M4 驗收核心。
- [x] CHK031 榜單 TL;DR 降級（程式事實型摘要）之數字來源是否明確要求 100% 取自 diff、0 起杜撰？[Measurability, Spec §SC-007, FR-016] → 通過：SC-007 數字 100% 取自 diff、0 起杜撰。

## LLM Guardrail, Anti-Hallucination & Cross-Feature Boundary（護欄／防幻覺／邊界）

- [x] CHK032 是否明確界定 LLM **可產生**（繁中標題/內容、候選選擇）與**不可產生**（連結、分數、事實數據）的欄位分界？[Clarity, Spec §FR-006] → 通過：FR-006 明訂 LLM 只做「選擇/去重/改寫」，連結分數由程式提供。
- [x] CHK033 幻覺項剔除準則（無法對回任一輸入候選）是否清楚且與「越界參照鍵」的處理一致？[Clarity, Spec §FR-009] → 通過：FR-009「無法對應輸入候選者剔除」；research D1／llm-response.schema §5 明訂越界 `ref` 屬幻覺、由硬驗證剔除，一致。
- [x] CHK034 是否明確要求配額與字數為**程式面硬保證**、非僅倚賴 prompt？[Consistency, Spec §FR-010, US3] → 通過：FR-010「MUST 為程式面保證、不僅依賴 prompt」＋US3 專測違規回應收斂。
- [x] CHK035 是否明確禁止「為湊足 6 則從未改寫候選遞補」並說明其與 SC-002（不混入非繁中原文）的因果？[Clarity, Spec §FR-010, SC-002] → 通過：FR-010 明訂 MUST NOT 遞補、說明牴觸 SC-002 之因果。
- [x] CHK036 送交 LLM 的資料範圍是否明確限定為公開欄位、且需求含「MUST NOT 送機密」？[Completeness, Spec §FR-007] → 通過：FR-007 列公開欄位＋MUST NOT 送機密。
- [x] CHK037 F6 與 F4／F5／F7 的職責邊界（不抓取、不落檔、不推播、不寫 `seenNews`、重用 `LlmService`）是否無重疊、無缺口地界定？[Consistency, Spec §FR-018, FR-019] → 通過：spec 開頭範圍段＋FR-018/019 逐項界定；plan Structure Decision「不改 F4/F5、只 import」。

## Dependencies, Assumptions & Ambiguities（依賴／假設／待澄清）

- [x] CHK038 假設「候選集由 F4 提供、已去重排序且帶 `weightedScore`」是否被列為明確的輸入依賴與前置條件？[Assumption, Spec §Assumptions] → 通過：Assumptions 首條明列；news-curation.contract §前置條件重述。
- [x] CHK039 主題降噪優先序（DevOps 優先、後端只看 Node.js/Python、前端以 TypeScript 為主、不收 CSS）是否完整界定，且與「程式僅夾非 AI 數量、不重做主題判斷」無矛盾？[Ambiguity, Spec §FR-004] → 通過：FR-004 列優先序＋Assumptions「於策展 prompt 外顯執行」；research D4 明確程式僅夾數量、語意交 LLM，無矛盾。
- [x] CHK040 「不做嚴格語言偵測、夾雜英文為已知可接受風險」是否被明確記載為**非需求（out of scope）**，以免日後被誤當缺陷？[Assumption, Spec §Edge] → 通過：Edge 與 Assumptions 皆明載為已知且接受的有界風險（沿用 F5 同一取捨）。
- [x] CHK041 「退避參數沿用 F5、不另調」的假設是否明確界定其為外部依賴而非本 Feature 的可調項？[Assumption, Spec §Assumptions] → 通過：Assumptions 末條明訂沿用 `LlmService`（`llm.types.ts`）既有設定、本 Feature 不另調。

## Notes

- 檢驗結果：**41/41 通過**（對照 spec.md／plan.md／research.md／data-model.md／contracts）。規格經
  `/speckit-clarify`（Session 2026-07-18）與 `/speckit-plan`（Phase 0/1）後，四大面向的需求品質已達
  「實作前正式關卡」水準，**可進入 `/speckit-tasks`**。
- 兩點**留待 tasks/prompt 階段落實**（非阻斷、不需回頭修 spec）：
  1. **CHK002**——「榜上脈絡」介面形狀在 **spec 層僅籠統**，已於 plan（data-model §1.5：
     `curate(candidates, boardRepoNames: ReadonlySet<string>)`）釘定；tasks 直接依 plan 實作即可。
  2. **CHK008**——「AI 候選足夠時」為 **prompt 側軟性目標**（無程式分支綁定門檻）；tasks 撰寫策展
     prompt 時應明述「足夠＝有 ≥4 則合格 AI 候選可選、不足照實不硬填」的語意，使意圖不被誤讀。
- **CHK024 更正記錄**：本檔初版 Notes 曾將「跨類別語意重複的配額歸屬」列為可能缺口；全面檢驗後
  確認 spec Edge 已明訂「依留下的代表項計入配額」——**該項為通過，非缺口**。
