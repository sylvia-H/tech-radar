# Test-Coverage Requirements Quality Checklist: Pipeline 端到端編排與 Discord 組版推播

**Purpose**: 作為 merge 回 `develop` 前的**正式需求閘門**，把關 F7 規格對「**該測什麼**」（憲章 VIII
關鍵邏輯必測 ＋ 降級/失敗路徑）是否**完整、明確、可量測地界定為需求**——而非驗證測試是否通過。
本表是需求的「單元測試」：檢驗 spec / plan / tasks / quickstart 把「必測覆蓋」寫得夠不夠好、可否據以
客觀驗收，**不是**檢查程式或 `*.spec.ts` 的實作行為。
**Created**: 2026-07-19
**Feature**: [spec.md](../spec.md)
**Audience / Depth**: PR Reviewer · 正式閘門（merge 前，較嚴謹、含 gating 語氣）

> 與同目錄 [orchestration.md](./orchestration.md)（四大面向需求可實作/可驗收）、[requirements.md](./requirements.md)
> （spec 模板完備）互補：本表只管「**必測邏輯是否被完整、可量測地界定為需求**」，不重複前二者已覆蓋的面向。

## 必測邏輯覆蓋完整性（憲章 VIII → F7 範圍）

- [x] CHK001 憲章 VIII 的必測邏輯中，屬 F7 新增/落點者（晨報 guard、組版切分、簡介快取命中、idempotency、push-then-commit）是否**皆有對應的測試需求明列**，且「沿用上游」者（榜單每週節奏、去重、字數/配額、diff）是否明確界定為**回歸**而非重測？[Completeness, tasks Notes / 憲章 VIII]
- [x] CHK002 F7 新增純函式（`decideNewsGuard`、`chunkEmbeds`、`buildDigestEmbeds` 4096 拆分、`toBoardChangeDigest`、board/digest embeds 組版）是否**每一個**都有「須單測」的需求，而非只以編排層 mock 測概括？[Completeness, plan Constitution Check §VIII / tasks T004/T006/T007/T012/T013]
- [x] CHK003 「外部呼叫（Discord push、Gemini via F5/F6）以 mock 測」的測試需求是否明確劃定 mock 邊界——哪些以 mock、哪些為純函式無 mock？[Clarity, plan Testing / 憲章 VIII]
- [x] CHK004 憲章 VIII「降級備援路徑須另測」是否對 F7 兩處降級（F6 `curate` `degraded` 晨報、F5 `ensureIntro` `degraded` 卡）**各自**明列為測試需求？[Coverage, Spec §US1-2/§US3-4 / 憲章 VIII]

## 純函式測試需求的明確性與可量測性

- [x] CHK005 晨報 guard 測試需求是否**量化列舉**須覆蓋的判定結果（`no-timestamp`/`due`/`not-due`/`clock-anomaly` 四種 reason、~18h 門檻、`null` 視為到期）？[Measurability, Spec §FR-002 / tasks T006]
- [x] CHK006 `chunkEmbeds` 切分的測試需求是否以**可客觀驗收的案例集**表述（空、穩定態、恰滿 10、冷啟動 >10、邊界 11、順序 `flat`===輸入）？[Measurability, Spec §SC-005 / tasks T004]
- [x] CHK007 「晨報逼近 4096 拆兩張」的測試需求觸發條件是否可客觀判定（字數口徑＝Unicode code point、拆後仍納入 ≤10 批次規則）？[Clarity, Spec §FR-018 / Assumptions]
- [x] CHK008 `toBoardChangeDigest` 投影的測試需求是否明列須斷言的欄位（`newcomers`/`climbed`/`declined` 計數、`domainCounts` 兩領域、`topName`）？[Completeness, Spec §FR-009 / tasks T012]
- [x] CHK009 榜單組版測試需求是否涵蓋確定色值、標題 `url` 可點、`fields` 內容、以及簡介降級卡與正常卡「**可區分**」的可驗收判準（而非描述性用語）？[Measurability, Spec §FR-010 / §US3-4]

## 狀態正確性的可測性（push-then-commit）

- [x] CHK010 「推播成功後才寫回」對**兩段各自**是否有可客觀斷言的測試需求（推播失敗時對應狀態**逐位元組不變**）？[Measurability, Spec §SC-003]
- [x] CHK011 榜單段「`intros` 進入時快照、推播失敗還原」的防外溢行為是否明列為**可斷言的跨段測試需求**（含「經後跑晨報段成功 `save` 也不外溢」）？[Coverage, Spec §FR-011/§SC-003 / tasks T016/T018]
- [x] CHK012 「同一次原子 `save` 寫回 `board`＋`lastBoardPushAt`＋`intros`」與「晨報段 `save` 一併帶回榜單段 `Object.assign` 回寫欄位」是否有明確、可斷言 `save` 次數與內容的測試需求？[Completeness, Spec §FR-011/§FR-019]
- [x] CHK013 冪等測試需求（同輸入重跑「重複推播數為 0、狀態不再變動」）是否可客觀量測且有對應測試落點？[Measurability, Spec §SC-007]

## 段間隔離的測試可斷言性

- [x] CHK014 段間隔離的測試需求是否對「榜單失敗→晨報照推」與「晨報失敗→不回滾榜單」**兩向**都明列可斷言案例？[Completeness, Spec §FR-013/§SC-004 / tasks T018]
- [x] CHK015 「每段失敗 100% 伴隨紅色告警、無聲失敗數為 0」是否為可量測的測試需求，且涵蓋 best-effort 告警**自身失敗**「只記 log、不再擲錯」的斷言？[Measurability, Spec §SC-004/§FR-014]
- [x] CHK016 「單段失敗不再上拋（避免誤觸 `main.cli.ts` 頂層 catch）」與「段告警不寫 `.radar-alert-sent` marker」是否明列為可斷言的測試需求？[Coverage, Spec §FR-016 / tasks T017/T018]
- [x] CHK017 告警摘要「不含機密（webhook URL／token／prompt／LLM 回應全文）」是否有**可驗收的測試需求**，而非僅停在需求聲明？[Measurability, Spec §FR-014]

## guard 冪等場景覆蓋（US2）

- [x] CHK018 US2 雙 cron 場景的測試需求是否枚舉四種情形（10h 跳過整段、24h/`null` 執行、主排推完＋補跑 <18h 跳過、漏跑＋補跑 ~24h 補推）？[Coverage, Spec §US2 / tasks T011]
- [x] CHK019 「跳過整段」的測試需求是否可斷言**副作用為零**（`ingest`/`curate`/`send`/`save` 皆未呼叫、推播數 0）？[Measurability, Spec §FR-002 / tasks T011]
- [x] CHK020 SC-001「任一日總晨報推播次數 ∈ {0,1}」是否被明列為可量測的測試斷言？[Measurability, Spec §SC-001]

## 場景與邊界測試覆蓋

- [x] CHK021 冷啟動（雙時間戳皆 `null`）跨榜單/晨報/embed 切分**三面向**是否皆有對應測試需求（含榜單段封面＋10 卡＝11 embeds → 2 則）？[Coverage, Spec §Edge Cases「冷啟動」 / tasks T020]
- [x] CHK022 空精選（0 則）「不推、不前進 `lastNewsPushAt`」與空榜 `aborted`「告警＋中止榜單段、晨報照常」是否**各有**可斷言的測試需求？[Coverage, Spec §FR-006/§Edge Cases]
- [x] CHK023 「榜單 diff 無任何變化仍推封面並更新 `lastBoardPushAt`」是否明列為測試需求（避免只在需求聲明卻無測試覆蓋）？[Coverage, Spec §FR-012]
- [x] CHK024 「掉出 top10 者當次靜默（不推卡、不列封面）」是否有可斷言「出現在推播次數為 0」的測試需求？[Measurability, Spec §SC-006]

## 測試邊界與假設

- [x] CHK025 「F7 不重測上游判定邏輯、既有 `board-cadence`/`board-diff`/`push-board`/`board-commit` 測試須全綠回歸」是否明確界定為**回歸需求**而非新測？[Consistency, Spec §FR-020 / tasks T023]
- [x] CHK026 `seenNews` 寫回鍵「與 F4 `excludeSeen` 對齊的 normalized URL」是否有測試需求驗證對齊口徑（`normalizeTargetUrl`），而非僅假設對齊？[Clarity, Spec §FR-005 / research D7]
- [x] CHK027 「基線綠燈」作為測試前提是否明確界定——變更前既有 spec 全綠，避免把既有失敗誤記到 F7？[Assumption, tasks T001]
- [x] CHK028 quickstart.md 的端到端驗證情境與各 User Story 的 **Independent Test** 是否互相一致、無彼此矛盾的測試期望？[Consistency, Spec §US1~US5 Independent Test / quickstart.md]

## Notes

- 勾選規則：完成以 `[x]`；發現「必測邏輯未被界定為需求／判準不可量測／測試期望自相矛盾」時就地標註並回饋至 `spec.md`／`plan.md`／`tasks.md`（而非在此補實作或 `*.spec.ts` 細節）。
- 本表管「**該測什麼是否被寫成好需求**」；「測試實際是否通過」屬 `quickstart.md` 驗證情境與 Jest `*.spec.ts` 執行結果範疇，不在本表。
- 作為 **merge 前正式閘門**：任一項為 `[ ]`（未達標）即代表對應必測面向的需求品質不足，應於合回 `develop` 前補齊；`[x]` 表該面向已在真實來源被完整、可量測地界定。

### 2026-07-19 驗收結論（merge 前閘門通過）

- **硬證據**：`npm run build`（tsc strict）**零 error**；`npm test` **55 suites / 391 tests 全綠**（基線 48 檔 → 本 Feature 新增 7 個測試檔；`0 failed`）。測試輸出頂端的 stack trace 為錯誤路徑測試（best-effort 告警自身失敗）刻意觸發並被捕捉的 console 輸出，非測試失敗。
- **逐項核對**：28 項全數 `[x]`——每一必測面向除了在 spec/plan/tasks 被界定為需求，亦已抽查對應測試落點確認可斷言：
  - guard 四種 reason（`news-guard.spec.ts`）、`chunkEmbeds` 六案例（`embed-split.spec.ts`）、4096 拆分（`digest-embeds.spec.ts`）、投影（`board-change-digest.spec.ts`）、組版（`board-embeds.spec.ts`）——純函式各自單測。
  - push-then-commit 逐位元組不變：晨報段 `news-segment.service.spec.ts:131 toEqual(before)`、榜單段 `board-segment.service.spec.ts:244 toEqual(before)`（含 `introsBefore` 還原）。
  - 跨段外溢防護（SC-003）：`pipeline.service.spec.ts:91-96`「榜單推播失敗＋同 run 晨報推播成功 → 晨報段 save 後榜單欄位仍為推播前狀態」。
  - 段間隔離兩向＋告警＋不上拋（SC-004）：`pipeline.service.spec.ts:40-73` US4 Acceptance 1~4。
  - US2 雙 cron 四情形（`news-segment.service.spec.ts:152-208`）；冷啟動 11 embeds → send 2 次（`board-segment.service.spec.ts:251`）。
  - 機密不入告警/產物：`discord.embed.spec.ts:45`、`discord.webhook.service.spec.ts:70`、`github-http.spec.ts:85/98` 之 `not.toContain` 斷言。
- **上游回歸**：`board-cadence`/`board-diff`/`push-board`/`board-commit` 純函式測試仍全綠（F7 未動判定純函式，僅退役薄編排殼）。
- **結論**：F7 需求品質與測試覆蓋達 merge 前閘門標準，**可合回 `develop`**（依 CLAUDE.md：`git merge --no-ff`，push 前再確認）。
