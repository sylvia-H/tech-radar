# Phase 1 Data Model: 002-board-sources

F2 的資料模型**全為單次執行的記憶體結構**（不持久化，spec Assumptions「不引入新狀態」）。所有外部輸入以 `zod` 於邊界驗證後轉為下列型別。持久化的 `BoardState`／`BoardEntry` 屬 F1/F3，本 Feature 不寫入。

---

## 型別：Domain（三領域）

```ts
type Domain = "ai" | "devops" | "frontend-backend"; // 顯示：AI / DevOps / 前後端
```

- 榜單的三個分類；`frontend-backend` = 前端＋後端合併（clarify 已定）。
- 與 F1 `BoardEntry.domain`（4-way 佔位）的對齊屬持久化層、留待 F3（見 research D7）。

## 實體：RawTrendingRepo（Trending 解析輸出，主力）

| 欄位 | 型別 | 說明 |
|------|------|------|
| `fullName` | `string` | `owner/name`（HTML 解析） |
| `description` | `string \| null` | repo 描述 |
| `language` | `string \| null` | 主要語言（Trending 頁標示） |
| `starsThisWeek` | `number`（int ≥ 0） | 本週增星（`stars this week`，**排序主鍵來源**） |

> 解析不到任一列或 `starsThisWeek` 抽不到 → 視為頁面改版，觸發告警（FR-009）。

## 實體：RawSearchRepo（Search 解析輸出，補位）

| 欄位 | 型別 | 說明 |
|------|------|------|
| `repoId` | `number` | GitHub 數字 id（同一性依據） |
| `fullName` | `string` | `owner/name` |
| `description` | `string \| null` | repo 描述 |
| `language` | `string \| null` | 主要語言 |
| `topics` | `string[]` | Search API 回應內含（免再打 /repos） |
| `totalStars` | `number`（int ≥ 0） | 當前總星數 |
| `createdAt` | `string`（ISO 8601） | 建立時間（算 `ageDays`） |
| `queriedDomain` | `Domain` | 該筆來自哪一組領域查詢（提示，非最終歸類） |

## 實體：RepoMeta（`GET /repos/{o}/{r}` 輸出，補 Trending 候選 topics）

| 欄位 | 型別 | 說明 |
|------|------|------|
| `repoId` | `number` | 數字 id |
| `topics` | `string[]` | 主題（歸類主要訊號） |
| `totalStars` | `number` | 當前總星數 |
| `createdAt` | `string`（ISO 8601） | 建立時間 |

## 實體：CandidateRepo（合併後的統一候選）

| 欄位 | 型別 | 說明 |
|------|------|------|
| `repoId` | `number` | 同一性依據、去重 key（FR-004，抗改名）；**必填**——Trending 候選由 `GET /repos` 補取，取不到者於合併前即略過（見表下註） |
| `fullName` | `string` | `owner/name` |
| `url` | `string` | `https://github.com/owner/name` |
| `description` | `string \| null` | 描述 |
| `language` | `string \| null` | 主要語言 |
| `topics` | `string[]` | 主題 |
| `starsThisWeek` | `number \| null` | 本週增星（僅 Trending 來源有） |
| `totalStars` | `number \| null` | 當前總星數（Search / repos 有） |
| `ageDays` | `number \| null` | `今天 − createdAt`（天，Search/repos 有） |
| `sources` | `("trending" \| "search")[]` | 來源標記（可兼具兩者） |
| `domain` | `Domain \| null` | 歸類結果（`null` 表無法歸類 → 排除） |
| `weeklyStarsEstimate` | `number` | 統一排序鍵（見下） |

> **`repoId` 必填**：`RawTrendingRepo` 不含 `repoId`，Trending 候選須經 `GET /repos`（`RepoMeta`）補取；該呼叫失敗（重試耗盡）的候選在合併去重前 **MUST 被略過**，不得以缺 `repoId` 的半套資料入榜（U1／FR-004、[contracts/github-sources.md](contracts/github-sources.md) §3）。

**`weeklyStarsEstimate` 規則**（research D5，純函式 `board/weekly-stars.ts`）：
- Trending 候選（有 `starsThisWeek`）：`= starsThisWeek`。
- 純 Search 候選：`= round(totalStars / max(ageDays, 1) × 7)`（避免除以零，Edge Case「建立天數為 0」）。

## 實體：DomainBoard / CurrentBoard（F2 最終產出）

```ts
interface DomainBoard {
  domain: Domain;
  entries: BoardRow[]; // 已排序、≤15
}
interface BoardRow {
  rank: number;               // 1..15（領域內名次）
  repoId: number;
  fullName: string;
  url: string;
  domain: Domain;
  weeklyStarsEstimate: number;
  starsThisWeek: number | null;
  sources: ("trending" | "search")[];
}
interface CurrentBoard {
  builtAt: string;            // ISO 8601（本次執行時間）
  boards: DomainBoard[];      // 恰三領域（不足 15 照實呈現）
  apiCalls: { core: number; search: number }; // 供 SC-006 觀測
}
```

> `CurrentBoard` 僅存在記憶體與 log；**不寫入 `state/board.json`**。其結構即 F3 之 `buildCurrentBoard()` 契約，見 [contracts/board-output.md](contracts/board-output.md)。

---

## 領域關鍵字種子集（v1 canonical）

置於 `src/classify/domain-keywords.ts`；**增刪只改此檔、不動 pipeline**（憲章 IV 精神）。**topics 為主要比對來源，無 topics 時比對 description**（FR-003）。**比對語意**（小寫後）：**topics 子字串**比對（寬鬆）；**description 詞界**比對（避免 `ai`／`rag`／`gpt` 等短關鍵字誤命中一般字詞）。

| Domain | 關鍵字種子（topics 小寫**子字串**比對；無 topics 時 description 小寫**詞界**比對，見 FR-003） |
|--------|------------------------------------------------------------------|
| `ai` | `llm`、`rag`、`agent`、`gpt`、`ai`、`machine-learning`、`deep-learning`、`llmops`、`transformers` |
| `devops` | `kubernetes`、`terraform`、`gitops`、`devops`、`ci-cd`、`docker`、`observability`、`platform-engineering` |
| `frontend-backend` | `nextjs`、`react`、`svelte`、`vue`、`nodejs`、`golang`、`typescript`、`fastapi`、`frontend`、`backend` |

> 沿用開發指南 §3.2；為可日後擴充的 v1，調整只改設定不改分類邏輯。

---

## 分類與排序規則（驗證重點，對映 SC / FR）

| 規則 | 來源 | 測試要點 |
|------|------|---------|
| topics 命中 → 歸該領域 | FR-003 | topics 明確者歸對領域（AC #2） |
| 無 topics → description 比對；仍無 → 排除 | FR-003、Edge Case | 無 topics 但 description 命中→歸類；皆無→不入任何榜（AC #3） |
| language 僅輔助、不單獨定領域、不參與跨領域決勝 | FR-003（I1） | 只有語言相符、無關鍵字命中 → 不歸類；language 不改變跨領域主領域 |
| description 詞界比對防短詞誤命中 | FR-003（A1） | `ai` 不命中 `domain`／`chain`；`AI-powered` 命中 |
| 跨領域擇一主領域（固定優先序 AI>DevOps>前後端） | FR-011 | 同時命中 AI+DevOps → 入 AI，只出現一次 |
| Trending 候選缺 `repoId`（/repos 失敗）→ 略過 | FR-004（U1）、contracts §3 | mock /repos 失敗 → 該候選不入榜、不擲錯全線 |
| `repoId` 去重（抗改名） | FR-004、SC-003 | 同 repo 兩來源／改名樣本 → 最終只一筆 |
| 每領域 `weeklyStarsEstimate` 排序取 top 15 | FR-005、SC-001 | 超過 15 只留前 15；不足 15 照實 |
| 排序穩定可重現 | SC-005 | 打亂來源處理順序，名次不變（tie-break `repoId asc`） |
| `ageDays=0` 不除以零 | Edge Case | 今日新建 repo 的 estimate 有限、不 NaN/Infinity |
| 任一來源失敗/0 筆 → 帶 id 告警、另一來源續行 | FR-007/FR-009、SC-004 | mock 主力失敗 → 補位仍出榜 + 告警帶來源 id |
| API 呼叫次數在安全範圍 | FR-008、SC-006 | `apiCalls` 計數印出、Trending 候選先去重再打 /repos |

**F2 不涉及**：狀態寫回、`lastBoardPushAt`/`lastNewsPushAt`、diff、推播、簡介、新聞（分屬 F3/F5/F7）。
