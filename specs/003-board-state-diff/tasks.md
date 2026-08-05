---
description: "Task list for 003-board-state-diff implementation"
---

# Tasks: 榜單狀態快照與變化偵測（Board State & Diff）

**Input**: Design documents from `/specs/003-board-state-diff/`

**Prerequisites**: [plan.md](plan.md)、[spec.md](spec.md)、[research.md](research.md)、[data-model.md](data-model.md)、[contracts/](contracts/)、[quickstart.md](quickstart.md)

**Tests**: **必要，非可選**——憲章 VIII（非協商）明文要求「榜單 diff、榜單每週節奏（`lastBoardPushAt` 計時、162h 門檻）」等關鍵邏輯**須有單元測試方可視為完成**。故各 Story 內一律**測試先行**（先寫、確認紅，再實作至綠）。

**Organization**: 依 User Story 分組，每個 Story 可獨立實作與驗證。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可平行（不同檔案、無未完成相依）
- **[Story]**: US1 / US2 / US3，對映 spec.md 的 User Stories
- 每個任務含明確檔案路徑

## Path Conventions

- 單一專案（一次性 CLI job），原始碼於 `src/`。
- **測試與原始碼同目錄**（本專案慣例：`src/board/weekly-stars.spec.ts`），**非** `tests/` 目錄。`tests/fixtures/` 僅存 F2 的 HTML fixture。
- F3 新增模組：`src/diff/`。

---

## Phase 1: Setup

**Purpose**: 建立 F3 模組的型別基礎。**無新增相依**（plan Technical Context：F3 不引入任何 npm 套件）。

- [X] T001 建立 `src/diff/diff.types.ts`，定義 `PushBoardRow` / `PushBoard` / `ChangeKind` / `BoardChange` / `BoardDiff` / `CadenceDecision` / `BoardSegmentResult`，欄位依 [data-model.md](data-model.md) §2；`BoardDiff.changes` 採「單一陣列 + `kind` 標籤」而非三個具名陣列；`BoardSegmentResult` 為以 `status` 判別的聯集 `{ status: 'skipped' } | { status: 'aborted' } | { status: 'ok'; diff: BoardDiff }`（即 T009／T017／T021 所斷言的形狀，介面全文見 [contracts/board-diff.md](contracts/board-diff.md) §2）

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 三個 Story 都依賴的持久化層對齊與上游欄位擴充。

**⚠️ CRITICAL**: 本階段未完成前，任何 User Story 都無法開始——US1 需讀 `state.board` 取 `prevIds`、US2 需讀 `lastBoardPushAt`、US3 需寫回；而 `state.schema.ts` 現為 F1 的 4-way 佔位（含 `devops`），與 F2 的 2-way `Domain` 對不起來，**一寫入即失敗**（research D6）。

- [X] T002 [P] 在 `src/state/state.schema.spec.ts` 補測（先寫、須紅）：含 `domain: "devops"` 的舊 board 條目 → **剔除該條目 + 記錄警告**、其餘條目照常載入、整份狀態不失效（FR-024）；根結構不合法（五欄位缺一 / `board` 非物件）→ **仍擲錯**（憲章 VI 壞檔不覆寫）
- [X] T003 修改 `src/state/state.schema.ts`：`domainSchema` 由 `['ai','devops','backend','frontend']` 對齊為 `['ai','frontend-backend']`（與 `src/board/board.types.ts` 的 `Domain` 一致）；`boardStateSchema.board` 改為**條目層寬鬆載入**（逐條 `safeParse`，不合法者剔除 + warn），根結構維持嚴格（research D6）。一併改掉 `domainSchema` 上方的過時註解「領域歸類（frontend/backend 分列）；enum 值於 F2 clarify 定案，F1 僅固定型別」——前後端已合併且 enum 於此兌現，留著會與新的 2-way 定義矛盾
- [X] T004 [P] 修改 `src/board/board.types.ts`：`BoardRow` 新增 `totalStars: number | null` 與 `language: string | null`（FR-004 決勝第 2 層與快照持久化所需；兩者皆為 `CandidateRepo` 既有值，**不新增任何外部呼叫**，research D1）
- [X] T005 修改 `src/board/board-builder.service.ts` 的 `assembleBoards()`：由 `CandidateRepo` 帶出 `totalStars` 與 `language` 至 `BoardRow`（**不得**變更既有的歸類、合併去重、領域內排序與統一尺——FR-002 禁止另訂換算公式）；同步更新 `src/board/board-builder.service.spec.ts` 既有斷言（依賴 T004）

**Checkpoint**: 持久化層與上游欄位就緒——三個 User Story 可開始。

---

## Phase 3: User Story 1 - 只看見「跟上次比的變化」（Priority: P1）🎯 MVP

**Goal**: 由兩領域榜合成跨領域綜合 top 10，與上次快照比對，只吐出新進／竄升／下降三類變化；掉出與穩定留榜靜默。

**Independent Test**: 以兩份「上次快照 / 本次榜單」的樣本資料執行變化偵測，檢視輸出是否只含三類、且穩定留榜與掉出者確實不在其中——**不依賴 Discord、LLM 或真實網路**即可完整驗證（spec US1 Independent Test）。本階段**不含節奏 guard（US2）與狀態寫回（US3）**。

### Tests for User Story 1 ⚠️ 先寫、確認紅

- [X] T006 [P] [US1] 建立 `src/diff/rank-compare.spec.ts`：四層全序（`weeklyStarsEstimate`↓ → `totalStars ?? 0`↓ → 新進者優先 → `repoId`↑）；**含前三層全平手、僅靠 `repoId` 分出高下**的案例；`totalStars` 為 `null` 時視為最低（FR-004）
- [X] T007 [P] [US1] 建立 `src/diff/push-board.spec.ts`：保底每領域 2 席（SC-005，候選充足＝每領域各 ≥2 筆）；某領域不足 2 筆時照實取用、空席由另一領域依**同一比較器**遞補；候選總數 <10 → 照實 `#1..#N` 不湊數；≤10 筆（SC-009）；**打亂輸入順序重跑 10 次名次序列一致**（SC-008，「相同輸入」＝候選與 `prevIds` 皆相同）；候選 0 筆 → 回傳 `[]`
- [X] T008 [P] [US1] 建立 `src/diff/board-diff.spec.ts`：三類互斥且正確（FR-007/008/009）；掉出 top 10 → 不在任何一類（FR-011/SC-007）；留榜且名次未變 → 不在任何一類（FR-012）；冷啟動 `prev` 空 → 全數新進、0 竄升 0 下降（FR-013/SC-003）；**純位移照實計為下降**（FR-010/US1 場景 6）；更名／轉移擁有者仍以 `repoId` 判同一（FR-006/US1 場景 10）；三類皆空 → `unchanged: true` 且 `topEntry` 為 `#1`（FR-014）；變化總數 ≤10（SC-004）；`needsIntro` 新進/竄升 `true`、下降 `false`（FR-016）；**跨領域邊界的 repo 其領域取本次**（FR-015）
- [X] T009 [P] [US1] 建立 `src/diff/board-diff.service.spec.ts`：**空榜 → 發告警 + 回 `{ status: 'aborted' }` + 不產出 diff、不擲錯、不中斷**（FR-025/SC-010）；告警送出失敗僅記 log、不擲錯（憲章 VII）

### Implementation for User Story 1

- [X] T010 [P] [US1] 建立 `src/diff/rank-compare.ts`：匯出 `compareForPushBoard(prevIds: ReadonlySet<number>)` 回傳比較器；第 4 層 `repoId` 保證**全序**（永不回傳 0）故排名不依賴 `Array.sort` 穩定性（FR-004、research D2）
- [X] T011 [US1] 建立 `src/diff/push-board.ts`：`pickPushBoard(boards, prevIds)` — 攤平兩領域候選 → 每領域保底 2 席 → 其餘席次跨領域競爭 → 合併排序指派 `rank 1..N`。**保底、競爭、指派名次全程只用 `compareForPushBoard` 這一把尺**（FR-003 明文禁止另引「熱度」等替代判準；沿用 F2 的兩層排序會在平手時產生兩套尺，research D2）（依賴 T010）
- [X] T012 [P] [US1] 建立 `src/diff/board-diff.ts`：`diffBoard(prev, pushBoard)` 與常數 `RANK_JUMP_THRESHOLD = 1`（兩方向對稱、單一常數可調，FR-010）；`changes` 依 `currentRank` 升序
- [X] T013 [P] [US1] 建立 `src/diff/diff-log.ts`：結構化輸出變化結果（綜合 top 10、三類變化含 `#舊 → #新`、或「榜單無變化 + 榜首一行摘要」），風格比照既有 `src/board/board-log.ts`（research D8）
- [X] T014 [US1] 建立 `src/diff/board-diff.service.ts`：薄編排——讀 `StateStore` 取 `prev` → `BoardBuilderService.build()` → `pickPushBoard` → **空榜即告警並中止**（FR-025）→ `diffBoard` → 輸出 log。告警走**注入 `DiscordWebhookService` 並呼叫 `postFailureAlert('榜單為空：上游來源全數失敗或候選全被過濾')`**，以私有 best-effort `alert()` 包裝（告警本身失敗只記 log、不擲錯），比照 `src/board/board-builder.service.ts` 既有的 `alert()`（research D4）。**不可**用 `src/discord/failure-alert.ts` 的 `tryPostFailureAlert`——那支吃 `INestApplicationContext` 且會寫 `.radar-alert-sent` marker，是 `main.cli.ts` 頂層 catch 專用。副作用只在本層；判定邏輯全在純函式（依賴 T011、T012、T013）
- [X] T015 [US1] 建立 `src/diff/diff.module.ts` 並註冊至 `src/app.module.ts`；修改 `src/pipeline/pipeline.service.ts` 改為呼叫 `BoardDiffService.runBoardSegment()`（暫不含節奏與寫回），更新其註解（現寫「建置三領域當前榜」為 F2 遺留且領域數已過時）

**Checkpoint**: 變化偵測可獨立驗證——`npm test` 全綠且本機執行可看到三類變化 log。此時**尚未**有節奏 guard 與狀態寫回。

---

## Phase 4: User Story 2 - 榜單每七天才出現一次（Priority: P2）

**Goal**: 以 `lastBoardPushAt` 計時（非 cron）實作每週節奏，門檻 **162 小時**（168h − 6h 寬限）；未到期整段跳過。

**Independent Test**: 給定不同的「上次榜單推播時間」（未到期 / 已到期 / 從未推播 / 未來時間），檢視節奏判定分別為「跳過 / 執行 / 執行 / 執行+告警」——**時間由參數注入，不依賴真實時間流逝**（spec US2 Independent Test）。

### Tests for User Story 2 ⚠️ 先寫、確認紅

- [X] T016 [P] [US2] 建立 `src/diff/board-cadence.spec.ts`：<162h → `{ due: false, reason: 'not-due' }`（FR-018/SC-002）；**恰好 162h → 執行**（`≥` 邊界，SC-002 明定「已滿 162 小時或更久」）；**163h（未滿七天整）→ 執行**（6h 寬限生效，US2 場景 5）；`null` → `{ due: true, reason: 'no-timestamp' }`（FR-019）；**晚於當前時間 → `{ due: true, reason: 'clock-anomaly' }`**（FR-019a/US2 場景 6）；`now` 一律由參數注入
- [X] T017 [P] [US2] 在 `src/diff/board-diff.service.spec.ts` 補測：未到期 → 回 `{ status: 'skipped' }`、**不進行任何榜單抓取**（mock `BoardBuilderService.build` 須零呼叫，FR-018＋憲章 I 不消耗 API 配額）、狀態不變；`clock-anomaly` → **發紅色告警後照常執行**榜單段（FR-019a）

### Implementation for User Story 2

- [X] T018 [P] [US2] 建立 `src/diff/board-cadence.ts`：匯出常數 `BOARD_PUSH_INTERVAL_HOURS = 162` 與純函式 `decideCadence(lastBoardPushAt, now)`；判定順序為 `null` → 未來時間 → `>= 162h` → 否則未到期（research D3）。回傳 `reason` 而非裸 boolean——`clock-anomaly` 與 `due` 都要執行但前者**額外需告警**，回 boolean 會逼編排層重算一次
- [X] T019 [US2] 修改 `src/diff/board-diff.service.ts`：`runBoardSegment(now)` 開頭加節奏 guard——未到期即早退（**在 `build()` 之前**，確保不抓取、不耗配額）；`reason === 'clock-anomaly'` 時經 T014 同一個私有 `alert()` 發紅色告警後續行（FR-019a 明定與 FR-025 為同一種告警——本專案不區分嚴重度）（依賴 T018）

**Checkpoint**: US1 + US2 皆可獨立運作——未到期時整段跳過且無任何 API 呼叫。此時**尚未**有狀態寫回。

---

## Phase 5: User Story 3 - 狀態永遠可信、絕不半套（Priority: P3）

**Goal**: 狀態只在**交付成功後**才寫回，且快照與時間戳同次更新；失敗時狀態原封不動。

**Independent Test**: 模擬「交付成功」與「交付失敗」兩種結果，檢查狀態檔在前者被更新（快照 + 時間戳）、在後者完全未變；再連跑兩次確認第二次只產出差異（spec US3 Independent Test）。

### Tests for User Story 3 ⚠️ 先寫、確認紅

- [X] T020 [P] [US3] 建立 `src/diff/board-commit.spec.ts`：`board` 由 `pushBoard` 重建且 **≤10 筆**、**不含追蹤深度 30 筆**（FR-005/SC-009）；`rank` 存的是**綜合**名次；`starsThisWeek` 欄位存入的是 **`weeklyStarsEstimate`**（統一尺，見 [contracts/board-state.md](contracts/board-state.md) §3）；`lastBoardPushAt` 與 `board` **同一次回傳**（FR-021 禁止半套）；`intros` / `seenNews` / `lastNewsPushAt` **原樣帶回**、掉出 top 10 者的簡介快取**不清除**（FR-023/SC-007）；`firstSeenAt` 既有成員沿用 `prev`、新進者用 `pushedAt`、掉出重回者重設（research D7）
- [X] T021 [P] [US3] 在 `src/diff/board-diff.service.spec.ts` 補測：交付成功 → `commitBoardPush` + `StateStore.save()` 各呼叫一次（FR-020）；**交付失敗 → `save()` 零呼叫、狀態不變**（SC-006）；**空榜中止 → `save()` 零呼叫**（SC-010）；未到期跳過 → `save()` 零呼叫（US2 場景 1）

### Implementation for User Story 3

- [X] T022 [P] [US3] 建立 `src/diff/board-commit.ts`：純函式 `commitBoardPush(state, pushBoard, pushedAt): BoardState`，**不含 I/O**。收斂為**單一提交點**使 FR-021「禁止半套」成為型別層面的保證——一次回傳完整新狀態，呼叫端無法只寫一半（research D5）
- [X] T023 [US3] 修改 `src/diff/board-diff.service.ts`：在**變化結果成功輸出到 log 之後**（即 F3 階段的「交付成功」判準，spec Assumptions）呼叫 `commitBoardPush` 並經 `StateStore.save()` 落檔；任一步擲錯即不 commit。**F7 接上 Discord 後只需把觸發點由「log 成功」換成「推播回報成功」，純函式與其測試不動**（依賴 T022）

**Checkpoint**: 三個 Story 全部可獨立運作；連跑兩次的端到端行為成立。

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T024 [P] 修正 `src/board/board-builder.service.ts` 中 `assembleBoards()` 的過時註解「`boards` 恰含三領域」→ 兩領域（F2 移除 DevOps 後的遺留，非 F3 行為變更）
- [X] T025 執行 `npm run build` 與 `npm test`：全綠，且覆蓋 [data-model.md](data-model.md) §5 的 25 條規則→測試對映
- [X] T026 依 [quickstart.md](quickstart.md) 執行 M2 本機驗收：§2 冷啟動（10 筆新進、狀態寫入 ≤10 筆）→ §3 手動回撥時間戳驗「無變化」（SC-001）→ §4 未到期整段跳過且無 `api: core=…` 行（SC-002）→ §5 空榜時狀態雜湊不變（SC-006/SC-010）→ §6 `git checkout state/board.json` 還原，**不把驗證產生的快照入庫**
- [X] T027 [P] 更新 `.specify/memory/constitution.md` 的 Sync Impact Report：將 Follow-up TODO「F3：`BoardEntry.domain` 由 4-way 佔位對齊為 2-way、移除 `devops`」標記為**已完成**（由 T003 兌現）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 無相依，可立即開始
- **Foundational (Phase 2)**: 依賴 Setup；**阻擋所有 User Story**
- **User Stories (Phase 3–5)**: 皆依賴 Phase 2 完成
- **Polish (Phase 6)**: 依賴所需 Story 完成

### User Story Dependencies

- **US1 (P1)**: Phase 2 後即可開始，不依賴其他 Story
- **US2 (P2)**: Phase 2 後即可開始。純函式 `board-cadence.ts` 與 US1 完全獨立；僅 T019（service 加 guard）觸及 US1 的 `board-diff.service.ts`
- **US3 (P3)**: Phase 2 後即可開始。純函式 `board-commit.ts` 與 US1/US2 完全獨立；僅 T023（service 加 commit）觸及同一服務檔

> **單人開發的實務順序**：US1 → US2 → US3。三者的**純函式**互不相依，但 T015 / T019 / T023 都改 `board-diff.service.ts`，依序做可免除合併衝突。

### Within Each User Story

- 測試先寫、確認紅 → 再實作至綠（憲章 VIII）
- 純函式 → 服務編排 → 模組串接

### Parallel Opportunities

- **Phase 2**: T002（state schema 測試）與 T004（board.types）不同檔可平行；T003 依賴 T002、T005 依賴 T004
- **Phase 3**: T006–T009 四份測試檔可全部平行；T010、T012、T013 不同檔可平行（T011 依賴 T010、T014 依賴 T011–T013）
- **Phase 4/5**: 各自的 `*.spec.ts` 與純函式檔可平行；`board-diff.service.ts` 的修改（T019、T023）必須序列
- **跨 Story**：`board-cadence.ts`(T018)、`board-commit.ts`(T022)、`rank-compare.ts`(T010) 三支純函式互不相依，可同時進行

---

## Parallel Example: User Story 1

```bash
# 先平行寫四份測試（確認全紅）：
Task: "建立 src/diff/rank-compare.spec.ts"
Task: "建立 src/diff/push-board.spec.ts"
Task: "建立 src/diff/board-diff.spec.ts"
Task: "建立 src/diff/board-diff.service.spec.ts"

# 再平行實作彼此無相依的純函式：
Task: "建立 src/diff/rank-compare.ts"
Task: "建立 src/diff/board-diff.ts"
Task: "建立 src/diff/diff-log.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup → Phase 2 Foundational（**關鍵**：state schema 不對齊則任何寫入必炸）
2. Phase 3 US1
3. **停下來驗證**：`npm test` 全綠；本機跑一次可看到綜合 top 10 與三類變化 log
4. 此時已交付本 Feature 的核心價值（憲章 III「只推變化」在榜單側的實現）

### Incremental Delivery

1. Setup + Foundational → 基礎就緒
2. **+ US1** → 變化偵測可觀測（MVP）
3. **+ US2** → 節奏就位，未到期不再浪費 API 配額
4. **+ US3** → 狀態寫回，連跑兩次的端到端行為成立 → M2 驗收（Phase 6）

### 建議的分段 commit（依 CLAUDE.md：可依內聚主題分段，同段的 tasks.md 勾選併入該段）

| 段 | 範圍 | type / scope |
|---|---|---|
| 1 | T001–T005 | `refactor(003-board-state-diff): 狀態 schema 對齊兩領域與 BoardRow 欄位擴充` |
| 2 | T006–T015 | `feat(003-board-state-diff): 跨領域綜合 top 10 選榜與榜單變化偵測` |
| 3 | T016–T019 | `feat(003-board-state-diff): 榜單每週節奏（lastBoardPushAt 計時、162h 門檻）` |
| 4 | T020–T023 | `feat(003-board-state-diff): 交付成功後才寫回的單一狀態提交點` |
| 5 | T024–T027 | `test(003-board-state-diff): M2 本機驗收與收尾` |

> `refactor` 用於第 1 段：該段不改變任何對外行為，只對齊型別與帶出既有欄位。

---

## Notes

- **[P] = 不同檔案、無相依**。`src/diff/board-diff.service.ts` 被 T014／T019／T023 三度修改，故三者**必須序列**（已在相依說明標示）。
- **F3 對 F2 既有碼的改動限於加欄位**（T004/T005）與一則過時註解（T024）——**不得**改動 F2 的歸類、合併去重、領域內排序與統一尺（FR-002）。
- **不新增任何 npm 相依**（plan Technical Context）。
- 驗證產生的 `state/board.json` 快照**不入庫**（T026 §6）；正式排程的狀態 commit 由 workflow 在實際變更時進行（no-diff 早退）。
- 每個任務或內聚群組完成後可 commit；在 Checkpoint 停下來獨立驗證該 Story。
