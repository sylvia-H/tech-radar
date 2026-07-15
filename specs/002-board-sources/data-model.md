# Phase 1 Data Model: 002-board-sources

F2 的資料模型**全為單次執行的記憶體結構**（不持久化，spec Assumptions「不引入新狀態」）。所有外部輸入以 `zod` 於邊界驗證後轉為下列型別。持久化的 `BoardState`／`BoardEntry` 屬 F1/F3，本 Feature 不寫入。

---

## 型別：Domain（兩領域）

```ts
type Domain = "ai" | "frontend-backend"; // 顯示：AI / 前後端
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

> **不記「來自哪組領域查詢」**：曾有 `queriedDomain` 欄位（提示用），但 FR-003 要求一律以 topics／description 歸類、皆無命中即排除（寧缺勿濫），該欄位在流程中從未被消費 → 2026-07-15 移除（見 spec Clarifications Session 2026-07-15）。補位候選不因「被某組查詢撈到」而放行歸類。

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
- 純 Search 候選：`= min(round(totalStars / max(ageDays, 1) × 7), totalStars)`——`max(_, 1)` 避免除以零（Edge Case「建立天數為 0」）；**上限 `totalStars`** 因補位只撈 `created:>7天`、其星全為本週累積，本週增星不可能超過總星數（FR-005、research D5）。
- `ageDays` 為 `null`（`createdAt` 無法解析）時走 `max(null ?? 1, 1)` 的預設，同受總星數上限保護。

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
  boards: DomainBoard[];      // 恰兩領域（不足 15 照實呈現）
  apiCalls: { core: number; search: number }; // 供 SC-006 觀測
}
```

> `CurrentBoard` 僅存在記憶體與 log；**不寫入 `state/board.json`**。其結構即 F3 之 `buildCurrentBoard()` 契約，見 [contracts/board-output.md](contracts/board-output.md)。

---

## 領域關鍵字種子集（v1 canonical）

置於 `src/classify/domain-keywords.ts`；**增刪只改此檔、不動 pipeline**（憲章 IV 精神）。**topics 為主要比對來源，無 topics 時比對 description**（FR-003）。**比對語意**（小寫後）：**topics 與 description 一律詞界比對**（以非英數字元為界，避免 `ai`／`rag`／`gpt` 等短關鍵字誤命中 `blockchain`／`domain`／`drag-and-drop`；A1 於 2026-07-15 由「topics 子字串」修訂而來）。

**結構**：每領域為 `{ search, extra }` 兩群（`DOMAIN_KEYWORD_SETS`）——`search` 兼作補位 Search 的 `q` OR 群、`extra` 只供比對；`DOMAIN_KEYWORDS`（完整集）與 `SEARCH_QUERIES`（OR 群）皆由此**衍生**。兩群 MUST 以結構表達，MUST NOT 退回「陣列前 N 個即 OR 群」的隱性約定，也 MUST NOT 在 `github-search.service` 另抄一份字面量（`vue` 曾錯置於前段而使兩份清單漂移）。

| Domain | `search` 群（兼作 Search `q`） | `extra` 群（僅比對，含詞界接不到的黏著變體） |
|--------|------------------------------|--------------------------------------------|
| `ai` | `llm`、`rag`、`agent`、`gpt` | `ai`、`machine-learning`、`deep-learning`、`llmops`、`transformers`、`llms`、`agents`、`agentic`、`openai`、`genai`、`chatgpt` |
| `frontend-backend` | `nextjs`、`react`、`svelte`、`nodejs`、`golang` | `typescript`、`vue`、`fastapi`、`frontend`、`backend`、`reactjs`、`sveltekit`、`vuejs` |

> **`devops` 群已於 2026-07-15 隨榜單 DevOps 領域移除**（原 `kubernetes`／`terraform`／`gitops` ＋ `devops`／`ci-cd`／`docker`／`observability`／`platform-engineering`）：其命中主力 `docker` 是「部署方式」而非「領域」標籤，實測歸類正確率 0（見 spec Clarifications Session 2026-07-15）。**僅榜單**；新聞側 DevOps 不受影響。

> 沿用開發指南 §3.2；為可日後擴充的 v1，調整只改設定不改分類邏輯。`extra` 群末段的黏著變體係 A1 改詞界後補回原本靠子字串涵蓋的常見 topic——**寬鬆傾向由此群承擔，不得回頭放寬比對語意**。

---

## 分類與排序規則（驗證重點，對映 SC / FR）

| 規則 | 來源 | 測試要點 |
|------|------|---------|
| topics 命中 → 歸該領域 | FR-003 | topics 明確者歸對領域（AC #2） |
| 無 topics → description 比對；仍無 → 排除 | FR-003、Edge Case | 無 topics 但 description 命中→歸類；皆無→不入任何榜（AC #3） |
| language 僅輔助、不單獨定領域、不參與跨領域決勝 | FR-003（I1） | 只有語言相符、無關鍵字命中 → 不歸類；language 不改變跨領域主領域 |
| topics／description 一律詞界比對，防短詞誤命中 | FR-003（A1） | `ai` 不命中 topic `blockchain`／`domain-driven-design`、description `domain chain`；`ai-agents`／`AI-powered` 命中 |
| 黏著變體由種子集 `extra` 群涵蓋 | FR-003（A1） | topic `openai`／`genai`／`agents`／`reactjs` 仍歸對領域 |
| Search `q` OR 群衍生自 `search` 群、不另抄字面量 | FR-010、領域關鍵字種子集 | `SEARCH_QUERIES[i].keywords` 恆等於 `DOMAIN_KEYWORD_SETS[domain].search` |
| 跨領域擇一主領域（固定優先序 AI>前後端） | FR-011 | 同時命中 AI+前後端 → 入 AI，只出現一次 |
| 榜單無 DevOps 領域 | Clarifications 2026-07-15 | 純 DevOps topics（`docker`／`kubernetes`）→ 排除；`teledrive` 那類 `react+docker` → 歸前後端而非被搶走 |
| Trending 候選缺 `repoId`（/repos 失敗）→ 略過 | FR-004（U1）、contracts §3 | mock /repos 失敗 → 該候選不入榜、不擲錯全線 |
| `repoId` 去重（抗改名） | FR-004、SC-003 | 同 repo 兩來源／改名樣本 → 最終只一筆 |
| 每領域 `weeklyStarsEstimate` 排序取 top 15 | FR-005、SC-001 | 超過 15 只留前 15；不足 15 照實 |
| 排序穩定可重現 | SC-005 | 打亂來源處理順序，名次不變（tie-break `repoId asc`） |
| `ageDays=0` 不除以零 | Edge Case | 今日新建 repo 的 estimate 有限、不 NaN/Infinity |
| estimate 不超過 `totalStars` | FR-005、Edge Case | 今日新建 300 星 → estimate 為 300 而非 2,100；`ageDays>7` 仍走換算公式 |
| 任一來源失敗/0 筆 → 帶 id 告警、另一來源續行 | FR-007/FR-009、SC-004 | mock 主力失敗 → 補位仍出榜 + 告警帶來源 id |
| Trending 逐頁隔離 | FR-007 | mock 單頁 404／單列漂移 → 其餘 5 頁仍出榜 + `github-trending:{page}` 告警；全部頁失敗 → 主力告警 |
| API 呼叫次數在安全範圍 | FR-008、SC-006 | `apiCalls` 計數印出、Trending 候選先去重再打 /repos |

**F2 不涉及**：狀態寫回、`lastBoardPushAt`/`lastNewsPushAt`、diff、推播、簡介、新聞（分屬 F3/F5/F7）。
