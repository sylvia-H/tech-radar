# Contract: F2 產出 — CurrentBoard（供 log 觀測與 F3 取用）

F2 的唯一產出是記憶體中的 `CurrentBoard`（**不寫入 `state/board.json`**）。它有兩個消費者：

1. **M1 觀測**：`PipelineService` 以結構化 log 印出（驗收依據）。
2. **F3（下游）**：`BoardBuilderService.build()` 的回傳即 F3 `buildCurrentBoard()` 契約；F3 據此做 diff／挑綜合 top 10／寫回狀態。

---

## 介面

```ts
// src/board/board-builder.service.ts
class BoardBuilderService {
  // 編排 sources → classify → merge(repoId 去重) → weeklyStarsEstimate → 每領域 top 15
  // 主力/補位以 try/catch 隔離；任一失敗或 0 筆 → 帶來源 id 告警、另一來源續行
  async build(): Promise<CurrentBoard>;
}
```

`CurrentBoard` / `DomainBoard` / `BoardRow` 結構見 [../data-model.md](../data-model.md)。契約要點：

- **`boards` 恰含三領域**（`ai`／`devops`／`frontend-backend`）；某領域候選不足 15 → `entries` 照實筆數，不硬湊、不補位（Edge Case「候選不足 15」）。
- **每筆唯一**：全 `boards` 中同一 `repoId` 只出現一次，且只在其**主領域**（FR-004/FR-011）。
- **排序穩定**：`entries` 依 `(weeklyStarsEstimate desc, repoId asc)`；`rank` 為 1..n 連號。相同輸入必得相同順序（SC-005）。
- **不含機密**：`CurrentBoard` 及其 log **不得**含 token 或任何非公開資料。
- **`apiCalls`**：本次 core／search 呼叫數，供 SC-006 觀測（log 印出）。
- **原始欄位去向**：`totalStars`／`createdAt`（`ageDays`）等原始欄位保留於**建置期記憶體的 `CandidateRepo`**，其估算已折入 `BoardRow.weeklyStarsEstimate`，故 `BoardRow` 不另攜帶；F3/F7 每輪呼叫 `build()` 即重新取得當輪估算值（spec Assumptions「保留原始欄位供其計算」指此建置期計算，非要求輸出契約攜帶原始值）。

## M1 log 輸出格式（觀測，非嚴格 schema）

每領域一段，每筆一行，欄位齊備（SC-001）：

```
📊 CurrentBoard @ 2026-07-12T22:07:00Z  (api: core=112, search=3)
── AI ──────────────────────────────
 #1  owner/agent-sandbox      ~8600/wk  [trending]        ai
 #2  owner/new-rag-lib         ~2100/wk  [search]          ai
 …（≤15）
── DevOps ──────────────────────────
 #1  owner/gitops-x          ~11000/wk  [trending,search] devops
 …
── 前後端 ───────────────────────────
 #1  owner/svelte-thing       ~4300/wk  [trending]        frontend-backend
 …
```

- `~N/wk` = `weeklyStarsEstimate`（Trending 為實際週增星；Search 為估算，以 `~` 標示估算）。
- `[sources]` 標來源，便於人工抽查主力/補位涵蓋。
- 領域標題用中文「前後端」；資料列 `domain` 用 enum 值。

## 邊界（F2 不做）

- **不**寫回 `state/board.json`、不設 `lastBoardPushAt`。
- **不** diff（新進/竄升/下降）、**不**挑綜合 top 10、**不**推播 Discord、**不**生成簡介。
- 以上皆由 F3（diff＋綜合 top 10＋狀態）與 F7（推播）依本契約之 `CurrentBoard` 接續。
