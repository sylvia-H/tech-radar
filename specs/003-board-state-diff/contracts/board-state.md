# Contract: `state/board.json` 榜單區段（F3 首次寫入）

**Feature**: `003-board-state-diff` | **Date**: 2026-07-15

F1 定義了狀態 schema 但不寫入、F2 完全不碰狀態，**F3 是首個實際寫入 `state.board` 與 `lastBoardPushAt` 的 Feature**。本檔釘死該區段的持久化契約與相容性規則。

---

## 1. 榜單區段的形狀

```jsonc
{
  "lastBoardPushAt": "2026-07-08T22:00:00Z", // 上次榜單推播；距今 ≥162h 才再推（7 天 −6h 寬限）
  "board": {
    "123456789": {                            // key = repoId（字串化的數字 id）
      "fullName": "owner/name",
      "url": "https://github.com/owner/name",
      "language": "Rust",
      "domain": "ai",                         // 2-way：'ai' | 'frontend-backend'
      "starsThisWeek": 8600,                  // ← 存的是統一尺 weeklyStarsEstimate（見 §3）
      "rank": 1,                              // 上次的【跨領域綜合】名次 1..10
      "firstSeenAt": "2026-07-08T22:00:00Z"
    }
  }
  // intros / seenNews / lastNewsPushAt 由 F5 / F4 / F6 負責，F3 原樣帶回
}
```

## 2. 不變式

| # | 不變式 | 來源 |
|---|---|---|
| 1 | `board` 條目數 **≤ 10**，恆等於上次推播的綜合 top 10 | FR-005 / SC-009 |
| 2 | **不得**寫入追蹤深度（2 領域 × top 15 = 30 筆）——那只存在單次執行的記憶體 | FR-005 |
| 3 | `rank` 是**跨領域綜合**名次（1..10），**不是**領域內名次 | FR-001 |
| 4 | `board` 與 `lastBoardPushAt` **同一次寫入**一併更新，禁止半套 | FR-021 |
| 5 | 只在**交付成功後**寫回；失敗則逐位元組不變 | FR-020 / SC-006 |
| 6 | 只經 `StateStore` 讀寫，禁止繞過改檔或另建平行狀態 | FR-022 / 憲章 VI |
| 7 | repo 掉出 top 10 → 自 `board` 移除，但 `intros[repoId]` **不清除** | FR-023 / SC-007 |

## 3. `starsThisWeek` 欄位的語意（易誤讀，特此釘死）

欄位名是 `starsThisWeek`，但寫入值是 **`weeklyStarsEstimate`**（F2 統一尺，含「以總星數為上限」的約束），**不是** Trending 的原始 `starsThisWeek`。

- 理由：綜合榜跨兩領域、混合 Trending 與 Search 兩種來源，只有統一尺可比（FR-002）。純 Search 候選根本沒有原始 `starsThisWeek`。
- 名稱不改：F1 已驗收此 schema，改名會波及 F1 測試；此欄唯一消費者是 F3 自己（供變化項目呈現人氣落差，FR-015）。dev-guide §5.1 的註解「上次看到的週增星」即此語意。

## 4. `domain` 的相容性規則（FR-024）

**變更**：`domainSchema` 由 F1 的 4-way 佔位 `['ai','devops','backend','frontend']` 對齊為 **`['ai','frontend-backend']`**，與 `src/board/board.types.ts` 的 `Domain` 一致。這兌現了 F2 plan 遺留、憲章 v1.3.0 Follow-up 列管的對齊項。

**載入寬容度**（兩層分明，不可混淆）：

| 層級 | 遇到不合法 | 行為 |
|---|---|---|
| **根結構**（五欄位、`board` 須為物件） | 缺欄位 / 型別全錯 / JSON 壞掉 | **擲錯、不覆寫**（憲章 VI，沿用 `StateStore.load` 現行行為） |
| **`board` 條目** | 例如舊的 `domain: "devops"` | **剔除該條目 + warn**，其餘條目照常載入 |

- 剔除的語意是安全的：該 repo 等同「不在上次快照」→ 下次以新進呈現。最壞是多推一張卡，不會產生錯誤資料。
- **必須 warn**，不得無聲剔除（憲章 VII）。
- **無需遷移程序**：狀態檔目前是空骨架，尚無正式執行寫入過含 `devops` 的資料（spec Assumptions）。本規則純屬防禦性。

## 5. 併發與原子性

- 沿用 F1 `StateStore.save()` 的原子寫入（先寫 `.tmp` 再 `rename`）——寫入中途被中斷時，`board.json` 仍是完整舊版（US3 場景 5）。F3 **不新增**任何檔案操作。
- 一次性 CLI、單進程，無跨進程併發。同日雙 cron 的重推由節奏 guard 擋下（US2 場景 4）：第一次成功推播後 `lastBoardPushAt` 已更新，第二次算出的間隔遠小於 162h → 跳過。

## 6. workflow 的 commit 行為（不變）

狀態 commit 僅在 `state/board.json` **實際變更時**進行（no-diff 早退，憲章「技術與安全約束」）。F3 的三種不寫回路徑（未到期跳過 / 空榜中止 / 交付失敗）天然產生 no-diff → 不製造空 commit。
