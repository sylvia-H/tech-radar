# Phase 1 Data Model: 榜單狀態快照與變化偵測（F3）

**Feature**: `003-board-state-diff` | **Date**: 2026-07-15 | **Plan**: [plan.md](plan.md)

分三層：**輸入**（F2 記憶體型別，F3 只加欄位）、**F3 記憶體型別**（單次執行）、**持久化**（`state/board.json`）。

---

## 1. 輸入層（F2 既有，F3 擴充）

### `BoardRow`（`src/board/board.types.ts`）— **修改**

| 欄位 | 型別 | 來源 | 備註 |
|---|---|---|---|
| `rank` | `number` | F2 | **領域內**名次 1..15。F3 不使用（F3 自行算綜合名次） |
| `repoId` | `number` | F2 | **同一性主鍵**（FR-006） |
| `fullName` | `string` | F2 | |
| `url` | `string` | F2 | |
| `domain` | `Domain` | F2 | `'ai' \| 'frontend-backend'` |
| `weeklyStarsEstimate` | `number` | F2 | 統一尺；決勝第 1 層（FR-002 禁止另訂公式） |
| `starsThisWeek` | `number \| null` | F2 | 僅 Trending 候選有 |
| `sources` | `SourceTag[]` | F2 | |
| **`totalStars`** | **`number \| null`** | **F3 新增** | 決勝第 2 層（research D1） |
| **`language`** | **`string \| null`** | **F3 新增** | 寫入 `BoardEntry.language` 所需 |

> 兩個新欄位皆為 `CandidateRepo` 既有值的**轉遞**，由 `assembleBoards()` 帶出。**不新增外部呼叫**。

### `CurrentBoard` / `DomainBoard` — 不變

F3 消費 `CurrentBoard.boards`（恰兩領域、各 ≤15 筆），不修改其結構。

---

## 2. F3 記憶體層（`src/diff/diff.types.ts`）— 全新

### `PushBoardRow`

跨領域綜合 top 10 的一列。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `rank` | `number` | **綜合**名次 `#1..#10`（卡片顯示的就是它，FR-001/FR-010） |
| `repoId` | `number` | |
| `fullName` | `string` | |
| `url` | `string` | |
| `language` | `string \| null` | |
| `domain` | `Domain` | |
| `weeklyStarsEstimate` | `number` | |
| `totalStars` | `number \| null` | |

### `PushBoard`

`PushBoardRow[]`，長度 0..10，`rank` 為連續 `1..N`。

### `ChangeKind`

`'newcomer' | 'climbed' | 'declined'`（三個**互斥**集合，FR-007/008/009）。

### `BoardChange`

| 欄位 | 型別 | 說明 |
|---|---|---|
| `kind` | `ChangeKind` | |
| `repoId` | `number` | |
| `fullName` | `string` | |
| `url` | `string` | |
| `domain` | `Domain` | 供上層分類呈現（FR-015） |
| `weeklyStarsEstimate` | `number` | 供上層呈現人氣落差（FR-015） |
| `currentRank` | `number` | 本次綜合名次 |
| `previousRank` | `number \| null` | 上次綜合名次；`newcomer` 恆為 `null`（FR-008/009 要求竄升/下降兩者皆帶） |
| `needsIntro` | `boolean` | `newcomer`/`climbed` → `true`；`declined` → `false`（FR-016） |

> `needsIntro` **只是標示**，F3 不生成也不讀取簡介內容（FR-016）。

### `BoardDiff`

| 欄位 | 型別 | 說明 |
|---|---|---|
| `changes` | `BoardChange[]` | 三類合併，長度 ≤10（SC-004）。順序：綜合名次升序 |
| `unchanged` | `boolean` | 三類皆空 → `true`（FR-014） |
| `topEntry` | `PushBoardRow` | 本次綜合榜 `#1`，供「無變化」一行摘要（FR-014）。**空榜不會走到此處**（FR-025 先中止） |
| `pushBoard` | `PushBoard` | 本次綜合 top 10，供 commit 使用 |

> `changes` 採**單一陣列 + `kind` 標籤**而非三個具名陣列：SC-004 要求「總數 ≤10」、`diff-log` 與 F7 封面都要依綜合名次排序輸出，單一陣列讓這兩件事都不必先合併再排序。需要分組時 `filter(c => c.kind === ...)` 即可。

### `CadenceDecision`

| 欄位 | 型別 | 說明 |
|---|---|---|
| `due` | `boolean` | `true` → 執行榜單段；`false` → 整段跳過（FR-018） |
| `reason` | `'no-timestamp' \| 'due' \| 'not-due' \| 'clock-anomaly'` | `clock-anomaly` 時呼叫端**須發告警**（FR-019a，research D3） |

### `BoardSegmentResult`

`BoardDiffService.runBoardSegment(now)` 的回傳型別（介面全文見 [contracts/board-diff.md](contracts/board-diff.md) §2）。**判別聯集**（discriminated union，以 `status` 為判別子）：

| `status` | 附帶欄位 | 情境 |
|---|---|---|
| `'skipped'` | 無 | 節奏未到期，整段跳過（FR-018） |
| `'aborted'` | 無 | 本次綜合榜為空，已發告警並中止（FR-025） |
| `'ok'` | `diff: BoardDiff` | 正常產出變化結果 |

> 三者**不帶 `reason`**：`skipped` 與 `aborted` 的原因已由 `CadenceDecision.reason` 與告警文案各自說明，呼叫端（本階段是 `PipelineService`，F7 之後是推播層）只需分辨「有沒有 `diff` 可用」。用判別聯集而非 `{ status, diff?: BoardDiff }` 是為了讓 `status === 'ok'` 時 `diff` 在型別上必定存在，呼叫端不必做非空斷言。

---

## 3. 持久化層（`src/state/state.schema.ts`）— 修改

### `domainSchema` — **破壞性對齊**

```
變更前：z.enum(['ai', 'devops', 'backend', 'frontend'])   // F1 4-way 佔位
變更後：z.enum(['ai', 'frontend-backend'])                 // 對齊 board.types.ts（FR-024）
```

### `boardEntrySchema` — 不改欄位，改**載入寬容度**

| 欄位 | 型別 | 寫入來源（`commitBoardPush`） |
|---|---|---|
| `fullName` | `string` | `PushBoardRow.fullName` |
| `url` | `string`（url 格式） | `PushBoardRow.url` |
| `language` | `string \| null` | `PushBoardRow.language` |
| `domain` | `Domain`（2-way） | `PushBoardRow.domain` |
| `starsThisWeek` | `number`（int ≥0） | `PushBoardRow.weeklyStarsEstimate` ← **注意：存的是統一尺估算值，非原始 `starsThisWeek`** |
| `rank` | `number`（int ≥1） | `PushBoardRow.rank`（**綜合**名次 1..10） |
| `firstSeenAt` | ISO 8601 | 既有成員沿用 `prev`；新進者用 `pushedAt`（research D7） |

> **`starsThisWeek` 欄位名的既有落差**：schema 欄位叫 `starsThisWeek`，但寫入的是 `weeklyStarsEstimate`（統一尺，含「以總星數為上限」約束）。dev-guide §5.1 註解即為「上次看到的週增星」＝統一尺值。**F3 不改欄位名**——改名會動到 F1 已驗收的 schema 與其測試，且此欄的唯一消費者是 F3 自己（供 diff 呈現人氣落差）。以註解釘死語意即可。

### `boardStateSchema.board` — 條目層寬鬆載入（FR-024）

- **根結構嚴格**：五欄位缺一 / `board` 非物件 → **擲錯**（憲章 VI 壞檔不覆寫，沿用 `StateStore.load` 現行行為）。
- **條目寬鬆**：逐條驗證，不合法者（如舊 `domain: "devops"`）**剔除 + warn**，其餘條目照常載入（research D6）。

### 不受 F3 影響的欄位

| 欄位 | F3 行為 |
|---|---|
| `intros` | **原樣保留**——commit 時不讀不改不清除（FR-023/SC-007）。掉出 top 10 的 repo 其簡介快取留存率須為 100% |
| `seenNews` | 不觸碰（F4/F6） |
| `lastNewsPushAt` | 不觸碰（F6） |

---

## 4. 狀態轉換

```
載入 state ──> decideCadence(lastBoardPushAt, now)
                 │
                 ├─ due=false ──────────────> 整段跳過，狀態不變（FR-018）
                 │
                 └─ due=true（reason=clock-anomaly 時另發告警）
                      │
                      v
                 F2 build() ──> pickPushBoard(boards, prevIds)
                      │
                      ├─ 空榜 ──> 告警 + 中止，狀態不變（FR-025）
                      │
                      └─ 非空 ──> diffBoard(prev, pushBoard)
                                     │
                                     v
                                 輸出 log（本階段的「交付」）
                                     │
                                     ├─ 失敗 ──> 狀態不變（SC-006）
                                     │
                                     └─ 成功 ──> commitBoardPush(state, pushBoard, pushedAt)
                                                   └─> StateStore.save()（board + lastBoardPushAt 同次，FR-021）
```

---

## 5. 驗證規則（憲章 VIII 必測項 → 測試對映）

| 規則 | 來源 | 測試落點 |
|---|---|---|
| 四層決勝構成**全序**，相同輸入名次 100% 一致 | FR-004 / SC-008 | `rank-compare.spec.ts`（含三層全平手僅靠 repoId 分出）、`push-board.spec.ts`（重跑 10 次序列一致） |
| 保底每領域 2 席；候選不足照實取用、不虛構 | FR-003 / SC-005 | `push-board.spec.ts` |
| 候選總數 <10 → 照實 `#1..#N`，不湊數 | Edge Case | `push-board.spec.ts` |
| 綜合榜 ≤10 筆 | FR-001 / SC-009 | `push-board.spec.ts` |
| 新進 / 竄升 / 下降三類互斥且正確 | FR-007/008/009 | `board-diff.spec.ts` |
| 掉出 top 10 → 不在任何一類 | FR-011 / SC-007 | `board-diff.spec.ts` |
| 留榜且名次未變 → 不在任何一類 | FR-012 | `board-diff.spec.ts` |
| 冷啟動（`prev` 空）→ 全數新進、0 竄升 0 下降 | FR-013 / SC-003 | `board-diff.spec.ts` |
| 純位移（被新進擠下）**照實計為下降** | FR-010 / US1 場景 6 | `board-diff.spec.ts` |
| 更名／轉移擁有者仍視為同一 repo（`repoId` 判定） | FR-006 / US1 場景 10 | `board-diff.spec.ts` |
| 三類皆空 → `unchanged=true` 且有 `topEntry` | FR-014 / SC-001 | `board-diff.spec.ts` |
| 變化項目總數 ≤10 | SC-004 | `board-diff.spec.ts` |
| `needsIntro`：新進/竄升 `true`、下降 `false` | FR-016 | `board-diff.spec.ts` |
| 節奏：<162h 跳過；≥162h / 無時間戳 → 執行 | FR-017/018/019 / SC-002 | `board-cadence.spec.ts` |
| 節奏：163h（未滿七天整）→ 執行（寬限生效） | US2 場景 5 | `board-cadence.spec.ts` |
| 未來時間戳 → `due=true` + `clock-anomaly` | FR-019a / US2 場景 6 | `board-cadence.spec.ts` |
| commit：快照與時間戳**同次**更新 | FR-021 | `board-commit.spec.ts` |
| commit：`intros` 原樣保留（掉出者不清除） | FR-023 / SC-007 | `board-commit.spec.ts` |
| commit：`firstSeenAt` 既有沿用、新進用 `pushedAt` | research D7 | `board-commit.spec.ts` |
| commit：持久化 ≤10 筆、不寫入追蹤深度 30 筆 | FR-005 / SC-009 | `board-commit.spec.ts` |
| 空榜 → 不 commit、發告警、不中斷 | FR-025 / SC-010 | `board-diff.service.spec.ts` |
| 交付失敗 → 狀態逐位元組不變 | FR-020 / SC-006 | `board-diff.service.spec.ts` |
| 舊 `devops` 條目不使整份狀態失效（剔除 + warn） | FR-024 | `state.schema.spec.ts` |
| 根結構壞檔仍擲錯、不覆寫 | 憲章 VI | `state.store.spec.ts`（既有，補回歸） |
