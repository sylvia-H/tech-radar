# Implementation Plan: 榜單狀態快照與變化偵測（Board State & Diff）

**Branch**: `003-board-state-diff` | **Date**: 2026-07-15 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-board-state-diff/spec.md`

## Summary

在 F2「兩領域當前榜（各 top 15、僅記憶體）」之上，新增**跨執行的變化偵測**：把兩領域榜合成單一**跨領域綜合 top 10**（保底每領域 2 席、統一尺 `weeklyStarsEstimate`、**四層全序決勝**），與 `state.board` 中「上次推播的綜合 top 10」以 **repoId** 比對，產出**新進 / 竄升 / 下降**三類變化（掉出與穩定留榜靜默），並以 `lastBoardPushAt` 實作**每七天節奏**（門檻 **162 小時**）。狀態僅在**交付成功後**才由單一提交點寫回，且沿用 F1 的原子寫入。

本 Feature **不組 Discord 版面、不推播、不生成簡介、不碰新聞**（分屬 F5/F7/F4）。M2 驗收＝本機連跑兩次，第二次輸出「榜單無變化」；未到期時榜單段整段跳過。

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 24 LTS（沿用 F1/F2）

**Primary Dependencies**: **無新增相依**。沿用 NestJS（application context）、`zod`（state schema）。F3 為純記憶體運算 + 既有狀態讀寫，不引入 `@google/genai`（F5）、`rss-parser`（F4）。

**Storage**: `state/board.json`，經 F1 既有 `StateStore` 讀寫（憲章 VI：不得繞過）。**F3 是首個實際寫入 `state.board` 的 Feature**——F1 只定義 schema、F2 完全不碰狀態。持久化上限 ≤10 筆（FR-005/SC-009）。

**Testing**: Jest + `ts-jest`（沿用）。F3 的核心全是**純函式**（選榜、決勝比較器、diff、節奏判定、commit 轉換），可完全脫離網路與真實時間測試；時間一律由參數注入（spec Assumptions「時間可注入」）。

**Target Platform**: GitHub Actions `ubuntu-latest`、Node 24；本機 `node dist/main.cli.js` 觀察 log 並連跑兩次驗收。

**Project Type**: 單一專案（一次性 CLI job），沿用 F1/F2 結構，新增 `diff/` 模組。

**Performance Goals**: F3 自身為 O(n log n) 記憶體排序（n ≤ 30），耗時可忽略；單次執行時間仍由 F2 的外部抓取主導。

**Constraints**:
- **無新增外部呼叫**（憲章 I）：F3 消費 F2 已在記憶體中的 `CurrentBoard`，**不得**為了取決勝所需的 `totalStars` 另打 API（見 research D1）。
- **狀態單一權威**（憲章 VI）：只經 `StateStore`；快照與 `lastBoardPushAt` **同一次寫入**一併更新，禁止半套。
- **節奏非 cron**（憲章 III）：以 `lastBoardPushAt` 計時，門檻 162h。
- **容錯不沉默**（憲章 VII）：空榜、未來時間戳皆須告警且不得中斷新聞段。

**Scale/Scope**: 輸入 ≤30 筆（2 領域 × top 15）；推播榜 ≤10 筆；持久化 ≤10 筆；單次變化項目 ≤10 筆（SC-004）。

## Constitution Check

*GATE: 須在 Phase 0 前通過，Phase 1 設計後複查。*（憲章 **v1.3.0**）

| # | 原則 | F3 是否觸及 | 判定 |
|---|------|------------|------|
| I | 零維運免費基礎設施 | 是（間接） | ✅ **零新增相依、零新增外部呼叫**；決勝所需 `totalStars` 由 F2 既有候選欄位帶出，不另打 API（research D1） |
| II | 不自存星星歷史 | 是（首次持久化榜單） | ✅ 憲章 II 明文允許「用於只看變化的**上次榜單快照**」；F3 只存 ≤10 筆的上次推播榜，**不存追蹤深度 30 筆、不做 day-over-day、不建每日快照**（FR-005/SC-009） |
| III | 只推變化、控制節奏 | **是（核心）** | ✅ 每七天（162h 門檻、`lastBoardPushAt` 計時非 cron）；只產出新進/竄升/下降，掉出與穩定留榜靜默，不重述整份榜單。`RANK_JUMP_THRESHOLD=1` 之張力已評估（見下方註記） |
| IV | 新聞來源設定即資料 | 否 | ✅ F3 不涉新聞來源 |
| V | 去重確實且節制 LLM | 是（同一性判定） | ✅ 以數字 `repoId` 判定同一性，**零 LLM**；F3 不呼叫 Gemini |
| VI | 冪等、快取與單一狀態來源 | **是（核心）** | ✅ 只經 `StateStore`；**單一提交點**確保快照與時間戳同次寫入、交付成功後才寫；沿用 F1 原子寫入與壞檔擲錯；簡介快取獨立、跌出不清除（FR-023） |
| VII | 機密隔離與容錯發佈 | 是（告警） | ✅ 空榜（FR-025）與未來時間戳（FR-019a）皆發告警、不沉默；皆不使新聞段或整條 pipeline 失敗；F3 不觸碰機密 |
| VIII | 關鍵邏輯測試優先 | 是 | ✅ 榜單 diff、每週節奏（162h）、四層決勝全序、保底席次、空榜中止、快照 ≤10、簡介快取留存皆納入交付（FR 對映見 tasks 階段） |

**關於 `RANK_JUMP_THRESHOLD = 1` 與憲章 III 的張力**（checklists/requirements.md Notes 要求 plan 階段裁定是否需正式登記）：**判定為不違反、不入 Complexity Tracking**。理由：憲章 III 規範的是「只推變化、不重述整份榜單」與**推播節奏**，**未規定名次移動門檻值**，故 T 屬本 Feature 權責內的參數選擇；且其代價有界（單次項目恆 ≤10、下降卡不帶簡介、七天才推一次）。該決策已依 CLAUDE.md 跨 Feature 規定落地至 `docs/tech-radar-dev-guide.md` §5.2 與 §11.2，非僅存於本 spec。

**結論**：無違反、無需正當化的複雜度 → Complexity Tracking 留空。設計後複查（見文末）維持通過。

## Project Structure

### Documentation (this feature)

```text
specs/003-board-state-diff/
├── plan.md              # 本檔（/speckit-plan 輸出）
├── research.md          # Phase 0 輸出（技術決策 D1–D8）
├── data-model.md        # Phase 1 輸出（記憶體 + 持久化實體、驗證規則、狀態轉換）
├── quickstart.md        # Phase 1 輸出（M2 驗證指引：連跑兩次 / 節奏 / 空榜）
├── contracts/           # Phase 1 輸出
│   ├── board-diff.md        # BoardDiffService 對外介面與 BoardDiff 結構（供 F5/F7）
│   └── board-state.md       # state.board 持久化契約（2-way domain、寬鬆載入、commit 語意）
├── checklists/
│   └── requirements.md  # /speckit-specify 已產出（16/16）
└── tasks.md             # /speckit-tasks 產出（本命令不建立）
```

### Source Code (repository root)

```text
src/
├── pipeline/
│   └── pipeline.service.ts        # 擴充：節奏 guard → build → diff → log →（交付成功）commit 寫回
├── board/
│   ├── board.types.ts             # 擴充：BoardRow 增 totalStars / language（決勝與快照所需，research D1）
│   ├── board-builder.service.ts   # 微調：assembleBoards 帶出新欄位（選榜/排序邏輯不動）
│   └── weekly-stars.ts            # 不動（統一尺沿用，FR-002 禁止另訂公式）
├── diff/                          # 【本 Feature 新增】
│   ├── push-board.ts              # pickPushBoard：保底每領域 2 席 + 跨領域競爭 → 綜合 top 10
│   ├── push-board.spec.ts
│   ├── rank-compare.ts            # 四層全序比較器（週增星→總星數→新進者優先→repoId）
│   ├── rank-compare.spec.ts
│   ├── board-diff.ts              # diffBoard：新進/竄升/下降 + 無變化 + 榜首摘要（純函式）
│   ├── board-diff.spec.ts
│   ├── board-cadence.ts           # isBoardDue：162h 門檻、無時間戳/未來時間戳處理
│   ├── board-cadence.spec.ts
│   ├── board-commit.ts            # toBoardSnapshot / commit 轉換（純函式；快照+時間戳同次）
│   ├── board-commit.spec.ts
│   ├── board-diff.service.ts      # 薄編排：注入 StateStore/告警，串起上列純函式
│   ├── board-diff.service.spec.ts
│   ├── diff.module.ts
│   ├── diff.types.ts              # PushBoardRow / BoardDiff / BoardChange / CadenceDecision / BoardSegmentResult
│   └── diff-log.ts                # 變化結果的結構化 log（M2 觀測，比照 board-log.ts）
└── state/
    ├── state.schema.ts            # 修改：domain 對齊 2-way（移除 devops）+ board 條目寬鬆載入（FR-024）
    └── state.schema.spec.ts       # 補測：舊 devops 條目不使整份狀態失效
```

**Structure Decision**：沿用 F1/F2 單一專案與開發指南 §9 模組切分，新增 `diff/` 承載本 Feature。設計原則是**把所有判定邏輯放進純函式**（`push-board` / `rank-compare` / `board-diff` / `board-cadence` / `board-commit`），`board-diff.service.ts` 只做薄編排與副作用（讀寫狀態、發告警）——如此憲章 VIII 所列的必測邏輯全部可脫離網路與真實時間測試。`intro/`、`summary/`、`llm/`、`news-filter/` 留待 F4–F7。

**對 F2 既有碼的改動限於加欄位**（`BoardRow` 增 `totalStars`/`language`、`assembleBoards` 帶出），**不動 F2 的歸類、合併去重、領域內排序與統一尺**——FR-002 明文禁止另訂換算公式。

## Complexity Tracking

> 無違反憲章之處，本表留空。

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| —         | —          | —                                    |

## Post-Design Constitution Re-Check

Phase 1 設計（research / data-model / contracts / quickstart）完成後複查：

- **I 免費基礎設施**：research D1 確認決勝所需 `totalStars` 由 F2 候選既有欄位帶出，**F3 新增外部呼叫數為 0**、新增相依為 0。✅
- **II 不自存星星歷史**：`contracts/board-state.md` 明訂持久化僅 ≤10 筆的上次推播榜、且為憲章 II 明文允許之用途；追蹤深度 30 筆只存在記憶體（FR-005）。✅
- **III 節奏與只推變化**：`board-cadence.ts` 以 162h 門檻 + `lastBoardPushAt` 計時（research D3）；`board-diff.ts` 只吐三類變化，掉出/穩定留榜靜默。T=1 之張力已於上方裁定為不違反。✅
- **VI 單一狀態與冪等**：`board-commit.ts` 為**唯一**寫回轉換點，快照與時間戳同次更新（research D5）；沿用 `StateStore` 原子寫入；`intros` 於 commit 時原樣保留（FR-023）。✅
- **VII 容錯不沉默**：空榜（FR-025）與未來時間戳（FR-019a）皆經 `DiscordWebhookService.postFailureAlert()` 發紅色告警並續行（比照 `BoardBuilderService.alert()` 的 best-effort 包裝，告警本身失敗只記 log；**非** `failure-alert.ts` 的 `tryPostFailureAlert`——那是 `main.cli.ts` 頂層 catch 專用），`lastBoardPushAt` 不動故下次自動重試。✅
- **VIII 測試優先**：diff、節奏、四層全序、保底席次、空榜、快照上限、簡介留存皆有對映純函式測試（見 data-model「驗證規則」與 quickstart）。✅

**跨 Feature 一致性註記**：F2 plan 遺留的「`state.schema.ts` 之 `BoardEntry.domain` 由 4-way 佔位對齊為 2-way（含移除 `devops`）留待 F3」於本 Feature 兌現（FR-024，research D6）——F3 是首個實際寫入 `state.board` 的 Feature，正是對齊時機。憲章 v1.3.0 Follow-up TODOs 之該項可於 F3 實作後結案。

無新增違反 → Gate 維持 PASS。
