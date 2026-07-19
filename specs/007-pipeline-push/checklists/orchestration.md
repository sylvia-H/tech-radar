# Orchestration Requirements Quality Checklist: Pipeline 端到端編排與 Discord 組版推播

**Purpose**: 在進入 `/speckit-tasks` 前，把關 F7 需求本身的品質——聚焦「狀態正確性與冪等」「段間隔離
與容錯」「Discord 組版與上限」「跨 Feature 契約邊界」四面向的**完整性／明確性／一致性／可測性／
覆蓋度**。此為需求的「單元測試」，檢驗的是規格寫得夠不夠好，**不是**實作行為是否正確。
**Created**: 2026-07-19
**Feature**: [spec.md](../spec.md)
**Audience / Depth**: PR Reviewer · Standard（實作前品質閘門）

## 狀態正確性與冪等（Requirement Quality）

- [x] CHK001 「推播成功後才寫回」是否對**兩段各自**明確界定觸發點與寫回欄位集，而非泛稱？[Clarity, Spec §FR-005/FR-011]
- [x] CHK002 「原子寫入」「禁止半套」是否有可客觀驗證的判準（如「推播失敗時對應狀態逐位元組不變」）？[Measurability, Spec §SC-003]
- [x] CHK003 一次執行的 `load()`/`save()` 次數上限是否明確規定（load ≤1、每段 save ≤1）？[Completeness, Spec §FR-019]
- [x] CHK004 晨報 guard 門檻是否以量化值表述（<~18h）並與榜單 162h **明示為獨立**、無混用？[Clarity, Spec §FR-002/FR-020]
- [x] CHK005 `lastNewsPushAt` 前進的**唯一條件**（僅推播成功、空精選不前進）是否無歧義地寫明？[Clarity, Spec §FR-006]
- [x] CHK006 榜單段「同一次原子 save 寫回 `board`＋`lastBoardPushAt`＋`intros`」的欄位集是否完整列舉、無遺漏？[Completeness, Spec §FR-011]
- [x] CHK007 兩段皆到期時「至多兩次原子 save、互不半套」是否明確定義先後與各自帶回未變欄位的規則？[Consistency, Spec §Edge Cases「同一次執行兩段皆到期」] — spec Edge Case 定先後與失敗互不影響；「各自帶回未變欄位」的具體機制由 `data-model.md` §3 與 `contracts/pipeline-orchestration.md` C1 步驟 4 補足（同一 `state` 物件累積、各段 save 帶回既有變更），Phase 1 已解消。
- [x] CHK008 冪等成功判準（同輸入重跑「重複推播數為 0、狀態不再變動」）是否可客觀量測？[Measurability, Spec §SC-007]
- [x] CHK009 `seenNews` 寫回鍵的正規化口徑是否明確（與 F4 `excludeSeen` 對齊的 normalized URL）？[Ambiguity, Spec §FR-005 / research D7] — research D7 已載明對齊點與 implement 期核對步驟（`curation-validate.ts`／`normalizeTargetUrl`），非規格模糊。

## 段間隔離與容錯（Requirement Quality）

- [x] CHK010 「任一段失敗不阻斷另一段」是否對**榜單→晨報**與**晨報→榜單（不回滾）**兩向都明確界定？[Completeness, Spec §FR-013]
- [x] CHK011 「每段失敗必發紅色告警」是否量化為可驗證判準（無聲失敗數為 0、每段失敗 100% 伴隨告警）？[Measurability, Spec §SC-004]
- [x] CHK012 best-effort 告警自身失敗的行為（只記 error log、不再擲錯）是否明確規定、不留模糊？[Clarity, Spec §FR-014 / US4]
- [x] CHK013 告警摘要「不含機密」的範圍是否具體列舉（webhook URL／token／prompt／LLM 回應全文）？[Completeness, Spec §FR-014]
- [x] CHK014 段層 best-effort 告警與 CLI 頂層 `.radar-alert-sent` marker 告警「並存不互擾」的分工是否清楚界定（段告警不寫 marker）？[Consistency, Spec §FR-016]
- [x] CHK015 「單一來源／單次 LLM 失敗沿用 F4/F5/F6 既有容錯、F7 不重複實作」的邊界是否明確劃定？[Clarity, Spec §FR-015]
- [x] CHK016 空榜（`aborted`）被界定為「異常而非本週無變化」的處置（告警＋中止榜單段、晨報照常）是否無歧義？[Coverage, Spec §Edge Cases「榜單到期但綜合 top10 為空」]

## Discord 組版與上限（Requirement Quality）

- [x] CHK017 「單則訊息 ≤10 embeds」是否量化，且冷啟動 >10（封面＋10 卡＋晨報）情境是否明確要求跨訊息切分？[Completeness, Spec §FR-017/SC-005]
- [x] CHK018 embed 各欄位上限是否具體列出數值（`title`≤256／`description`≤4096／`fields`≤25）？[Clarity, Spec §FR-018]
- [x] CHK019 晨報「逼近 4096 拆兩張」的觸發條件是否可客觀判定（字數口徑＝Unicode code point）？[Measurability, Spec §FR-018 / Assumptions]
- [x] CHK020 切分後保證（每則 ≤10、順序不亂、無遺漏無重複）是否以可量測方式表述？[Measurability, Spec §SC-005]
- [x] CHK021 各區塊與領域配色是否以確定色值定義（封面 `0x5865F2`／晨報 `0xF5A623`／AI `0x10A37F`／前後端 `0xF7DF1E`）？[Clarity, Spec §FR-010/US5-4]
- [x] CHK022 卡片「事實欄位由程式、敘事欄位由 LLM」的分工是否明確，避免 LLM 產生連結/增星/名次？[Consistency, Spec §FR-004/FR-010]
- [x] CHK023 簡介降級卡「與正常簡介卡可區分」的判準是否明確定義（而非僅描述性用語）？[Clarity, Spec §FR-010 / US3-4]
- [x] CHK024 「掉出 top10 者當次靜默」是否明確界定為不推卡、不列封面、不提示？[Completeness, Spec §FR-010/SC-006]
- [x] CHK025 顯示順序（榜單封面 → 卡片 → 晨報）是否唯一且無歧義地固定？[Clarity, Spec §FR-017 / dev-guide §7.2]
- [x] CHK026 dev-guide §7.2「晨報改送第二則」特例與 F7「通用 chunk-by-10」是否已明示對齊、無殘留矛盾？[Conflict, Spec Assumptions「embed ≤10 通用切分涵蓋 §7.2 特例」] — **本次審查發現**：spec/plan 已論證涵蓋，但 dev-guide §7.1/§7.2 文字與虛擬碼（含 `embeds.slice(0, 10)` 會靜默丟棄超額 embed 的舊敘述）尚未同步，實作後將與行為不符；**已於本次審查同步修訂** `docs/tech-radar-dev-guide.md` §7.1/§7.2 為通用 chunk-by-10 敘述，矛盾已消除。

## 跨 Feature 契約邊界（Requirement Quality）

- [x] CHK027 「F7 不重寫上游邏輯、不改對外契約」的範圍是否具體列舉（簡介/策展/建榜/diff/去重/節奏門檻）？[Completeness, Spec §FR-020]
- [x] CHK028 `IntroInput` metadata 來源「以 `repoId` join 當次榜單抓取結果、不從 state 讀回、不另打 API」是否無歧義？[Clarity, Spec §FR-008 / Assumptions]
- [x] CHK029 spec Assumptions 對「build 產物尚未 surface `description/topics`」的資料管線預設，與 FR-020「不改契約」之間是否已明確協調、不衝突？[Conflict, Spec §Assumptions / plan Complexity Tracking] — research D1 與 plan Constitution Check／Complexity Tracking 已定案：`BoardRow` 加法擴充兩欄位、不動持久化 `BoardEntry`，非契約破壞。
- [x] CHK030 「取代 F3 現行 log-success→commit」的接縫是否明確界定為只換觸發點、保留 `commitBoardPush` 純函式與其測試？[Clarity, Spec §FR-011 / US3 / Assumptions]
- [x] CHK031 「不新增第二個 LLM 客戶端、不擴大 GitHub/LLM 配額」是否以可驗證方式表述？[Measurability, Spec §FR-020 / 憲章 I/V]
- [x] CHK032 榜單每週節奏與晨報每日 guard「相互獨立、不因新增晨報段而改變 F3 節奏或反之」是否明確聲明？[Consistency, Spec §FR-020/SC-002]

## 場景與邊界覆蓋 · 假設與模糊（Requirement Quality）

- [x] CHK033 主要流程（US1 晨報／US3 榜單日）之外，替代與例外場景（空精選、全已見、榜成功晨報失敗、未來時間戳）是否皆有對應需求？[Coverage, Spec §Edge Cases]
- [x] CHK034 冷啟動（雙時間戳皆 null）跨榜單/晨報/embed 切分三面向的行為是否一致且完整定義？[Coverage, Spec §Edge Cases「冷啟動」]
- [x] CHK035 「榜單 diff 無任何變化仍推封面並更新 `lastBoardPushAt`」的決策是否明確落定（避免節奏漂移），而非留待實作臆測？[Clarity, Spec §FR-012 / Edge Cases]
- [x] CHK036 全部關鍵假設（段序固定、字數口徑、guard/cadence 沿用、空精選不前進、`NEWS_INGEST_OBSERVE` 去留）是否皆記於 Assumptions 且無彼此矛盾？[Assumption, Spec §Assumptions]

## Notes

- 勾選規則：完成以 `[x]`；發現需求缺口/模糊/矛盾時就地標註並回饋至 `spec.md`（而非在此處補實作細節）。
- 本表檢驗「需求寫得好不好」；「實作對不對」屬 `quickstart.md` 驗證情境與單元測試（憲章 VIII）範疇。
- 與同目錄 [requirements.md](./requirements.md)（spec 通用品質）互補：該表管「規格模板是否完備」，本表管「四大面向需求是否可實作、可驗收」。

### 2026-07-19 `/speckit-tasks` 前複查結論

- 對照 `spec.md`／`plan.md`／`research.md`（D1～D7）／`data-model.md`／`contracts/*` 逐項核對，36 項全數
  `[x]`；多數 FR/SC/Assumptions 已足夠明確、可量測。
- 唯一發現的落差是 **CHK026**：`docs/tech-radar-dev-guide.md` §7.1/§7.2 原文仍描述舊的「冷啟動晨報改送
  第二則」特例（含會靜默丟棄超額 embed 的 `embeds.slice(0, 10)` 虛擬碼），與 F7 實際採用的「依序
  chunk-by-10」通用切分不一致。**已於本次複查同步修訂** dev-guide §7.1/§7.2 文字與虛擬碼，消除此矛盾，
  無需再帶著落差進入 `/speckit-tasks`。
- 結論：規格品質達標，可進入 `/speckit-tasks`。
