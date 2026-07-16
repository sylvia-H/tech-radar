# Contract: 榜單變化偵測介面（F3 → F5/F7）

**Feature**: `003-board-state-diff` | **Date**: 2026-07-15

F3 對外暴露的介面。**消費者**：F5（簡介生成，讀 `needsIntro`）、F7（Discord 組版與推播，讀全部並回報推播結果）。本檔為這些 Feature 的接線依據；結構細節見 [data-model.md](../data-model.md)。

---

## 1. 純函式（`src/diff/`）

全部**無 I/O、無讀時鐘**，時間一律由參數注入。

### `decideCadence(lastBoardPushAt: string | null, now: Date): CadenceDecision`

`src/diff/board-cadence.ts`

判定榜單段是否到期。`BOARD_PUSH_INTERVAL_HOURS = 162`（同檔匯出）。

| 輸入 | 輸出 |
|---|---|
| `null` | `{ due: true, reason: 'no-timestamp' }` |
| 晚於 `now` | `{ due: true, reason: 'clock-anomaly' }` ← **呼叫端須發告警** |
| `now - t >= 162h` | `{ due: true, reason: 'due' }` |
| 其他 | `{ due: false, reason: 'not-due' }` |

### `compareForPushBoard(prevIds: ReadonlySet<number>): (a, b) => number`

`src/diff/rank-compare.ts`

四層全序比較器（FR-004）：`weeklyStarsEstimate` ↓ → `totalStars ?? 0` ↓ → 新進者優先（`!prevIds.has(id)` 在前）→ `repoId` ↑。

**保證**：任兩筆不同 repo 永不回傳 `0`（`repoId` 唯一）→ 排序結果不依賴 `Array.sort` 是否穩定。

### `pickPushBoard(boards: DomainBoard[], prevIds: ReadonlySet<number>): PushBoard`

`src/diff/push-board.ts`

兩領域榜 → 跨領域綜合 top 10。演算法：

1. 攤平兩領域全部候選（≤30 筆）。
2. **保底**：每領域依 `compareForPushBoard` 取最高 2 筆（不足照實取，FR-003）。
3. **競爭**：其餘候選依同一比較器取 `10 − 保底數` 筆。
4. 合併後依同一比較器排序，指派 `rank = 1..N`。

**不變式**：`length ≤ 10`；`rank` 連續由 1 起；候選 <10 時照實回傳（不湊數）；候選 0 筆時回傳 `[]`（**呼叫端須依 FR-025 中止**）。

### `diffBoard(prev: Record<string, BoardEntry>, pushBoard: PushBoard): BoardDiff`

`src/diff/board-diff.ts`

比對產出三類變化。`prev` 直接吃 `state.board`（key 為 `repoId` 字串）。

| 條件 | 結果 |
|---|---|
| 在 `pushBoard`、不在 `prev` | `newcomer`（`previousRank: null`、`needsIntro: true`） |
| 兩者皆有、`prev.rank − curr.rank >= 1` | `climbed`（`needsIntro: true`） |
| 兩者皆有、`curr.rank − prev.rank >= 1` | `declined`（`needsIntro: false`） |
| 兩者皆有、名次相同 | **不出現**（FR-012） |
| 在 `prev`、不在 `pushBoard` | **不出現**（FR-011，掉出靜默） |

`changes` 依 `currentRank` 升序。三類皆空 → `unchanged: true`。`topEntry` 恆為 `pushBoard[0]`。

> `RANK_JUMP_THRESHOLD = 1` 為同檔匯出的常數，兩方向對稱套用。調整門檻**只改此常數**（FR-010 決策第 5 點：可逆）。

### `commitBoardPush(state: BoardState, pushBoard: PushBoard, pushedAt: Date): BoardState`

`src/diff/board-commit.ts`

**唯一**的狀態寫回轉換點（純函式，不落檔）。回傳全新 `BoardState`：

- `board` ← 由 `pushBoard` 重建（≤10 筆）。`firstSeenAt`：既有成員沿用 `state.board[id].firstSeenAt`，新進者用 `pushedAt`。
- `lastBoardPushAt` ← `pushedAt`（**與 `board` 同一次回傳**，FR-021 禁止半套）。
- `intros` / `seenNews` / `lastNewsPushAt` ← **原樣帶回**（FR-023：掉出者的簡介快取不清除）。

---

## 2. 服務（`src/diff/board-diff.service.ts`）

薄編排層，唯一持有副作用（狀態讀寫、告警）。

```
runBoardSegment(now: Date): Promise<BoardSegmentResult>
```

| 情境 | 行為 | 狀態 |
|---|---|---|
| 未到期 | 直接回 `{ status: 'skipped' }` | 不變 |
| 時鐘異常 | 發告警後**照常執行** | 依結果 |
| 空榜 | 發告警 `榜單為空：上游來源全數失敗或候選全被過濾`、回 `{ status: 'aborted' }` | **不變**（`lastBoardPushAt` 不動 → 下次自動重試） |
| 正常 | 回 `{ status: 'ok', diff }`，log 輸出成功後 commit + `save()` | 快照 + 時間戳同次更新 |
| 任一步擲錯 | 不 commit | **逐位元組不變**（SC-006） |

**容錯保證**（憲章 VII）：`aborted` 與告警失敗皆**不擲錯、不中斷**上層 pipeline——新聞段（F4/F6 接上後）照常執行。

---

## 3. 給 F5 / F7 的接線約定

**F5（簡介）**：讀 `diff.changes.filter(c => c.needsIntro)` 決定要為誰生成/讀取簡介。F3 **不生成也不讀取**簡介內容，只標示（FR-016）。

**F7（推播）**：

1. 讀 `BoardDiff` 組版：`unchanged === true` → 縮成一行摘要（用 `topEntry`）；否則依 `kind` 分組出卡片（新進/竄升帶簡介、下降只報 `#previousRank → #currentRank`）。
2. **推播成功後**才呼叫 `commitBoardPush` + `save()`。F7 接上時，把 `board-diff.service` 中「log 成功 → commit」的觸發點換成「Discord 回報成功 → commit」，**純函式與其測試不動**（research D5）。
3. 推播失敗 → 不 commit → 下次執行仍看到同一批變化（FR-020）。

**穩定性承諾**：`BoardChange` 與 `PushBoardRow` 的欄位為 F5/F7 的依賴面，F3 之後的變更須同步本檔。
