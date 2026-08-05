# Phase 1 Data Model: Pipeline 端到端編排與 Discord 組版推播

F7 幾乎不引入持久化資料——**唯一持久化狀態仍是 `state/board.json`**（沿用 F1 `boardStateSchema`，
**不新增欄位**）。本檔記錄：(1) F7 對既有型別的**加法擴充**、(2) 單次執行的**記憶體實體**、
(3) 兩段的**狀態寫回單元**。持久化 schema 見 `src/state/state.schema.ts`（不動）。

## 1. 既有型別的加法擴充（不改語意）

### 1.1 `BoardRow`（`src/board/board.types.ts`）— 加兩欄位（research D1）

| 欄位 | 型別 | 來源 | 用途 |
|------|------|------|------|
| `description`（新增） | `string \| null` | `CandidateRepo.description`（build 當下已在手） | join 成 `IntroInput.description` |
| `topics`（新增） | `string[]` | `CandidateRepo.topics`（同上） | join 成 `IntroInput.topics` |

既有 `repoId/fullName/language/starsThisWeek` 不變。**不寫入持久化 `BoardEntry`**（`commitBoardPush`
由 `PushBoardRow` 產列，`PushBoardRow` 不含此二欄，故落檔內容不變；憲章 II）。

### 1.2 `DiscordEmbed` / `DiscordWebhookPayload`（`src/discord/discord.embed.ts`）— 加可選欄位（research D3）

| 型別 | 新增欄位 | 型別 | 用途 |
|------|----------|------|------|
| `DiscordEmbed` | `url?` | `string` | 卡片標題可點開 repo（§7.1） |
| `DiscordEmbed` | `fields?` | `{ name: string; value: string; inline?: boolean }[]` | 卡片：本週增星／語言／領域或名次（`fields ≤25`） |
| `DiscordWebhookPayload` | `avatar_url?` | `string` | webhook 身分欄（組版契約 L5 payload 引用；可省值但保留欄位） |

皆為可選 → F1 既有 `buildTestEmbed`/`buildFailureAlert` 不受影響。新增色常數：`COLOR_BOARD_COVER`
`0x5865F2`、`COLOR_DIGEST` `0xF5A623`、`COLOR_AI` `0x10A37F`、`COLOR_FRONTEND_BACKEND` `0xF7DF1E`。

## 2. 單次執行的記憶體實體（不持久化）

### 2.1 榜單段結果（Board segment outcome）

沿用 `BoardSegmentResult`（`src/diff/diff.types.ts`，判別聯集，不動）：
`{ status: 'skipped' } | { status: 'aborted' } | { status: 'ok'; diff: BoardDiff }`。
F7 榜單段內部另持有（不外露）：本次 `current: CurrentBoard`（含新 `BoardRow` 欄位）、
`introResults: Map<repoId, IntroResult>`、`summary: BoardChangeSummary`、組出的 `DiscordEmbed[]`。

### 2.2 簡介 join 視圖（IntroInput join view）

`Map<number /*repoId*/, BoardRow>`，由 `current.boards[].entries` 攤平建立；對每個
`needsIntro` 的 `BoardChange` 查表 → 組 `IntroInput`（`src/intro/intro.types.ts`，不動）。全命中
（見 research D1）。

### 2.3 晨報段結果（News segment outcome）

記憶體結構（F7 內部，不需新型別，可用區域變數）：
- `guard`：`decideNewsGuard` 回傳（`due`/`reason`）。
- `candidates: NewsCandidate[]`（F4 `ingest`）、`digest: CuratedDigest`（F6 `curate`，含 `degraded`）。
- `pushedItems: CuratedNewsItem[]`：本次推出的各則（供 `seenNews` 寫回）。

### 2.4 組版 embed 批次（Embed batch）

`DiscordEmbed[]`（顯示順序：榜單封面 → 卡片… → 晨報 1~2）→ `chunkEmbeds(embeds, 10)` →
`DiscordEmbed[][]`（每批 ≤10）。事實欄位（連結／增星／名次）由程式填；敘事欄位（簡介／TL;DR／
內容）來自 LLM（憲章 VI）。

### 2.5 F7 新增純函式的輸入/輸出投影

| 純函式 | 輸入 | 輸出 |
|--------|------|------|
| `decideNewsGuard` | `lastNewsPushAt: string\|null`, `now: Date` | `{ due; reason }`（research D5） |
| `toBoardChangeDigest` | `BoardDiff` | `BoardChangeDigest`（`board-summary.types.ts`，research D6） |
| `buildCoverEmbed` | `BoardChangeSummary`, `BoardDiff`（declined 一行式）, dateLabel | `DiscordEmbed`（封面藍） |
| `buildRepoCard` | `BoardChange`, `IntroResult`, join `BoardRow` | `DiscordEmbed`（領域色卡；降級以可區分 description 卡） |
| `buildDigestEmbeds` | `CuratedDigest`, dateLabel | `DiscordEmbed[]`（1~2 張，橙；research D4） |
| `chunkEmbeds` | `DiscordEmbed[]`, `max=10` | `DiscordEmbed[][]`（research D3） |

## 3. 狀態寫回單元（推播成功後才寫，原子）

兩段共用**單一可變 `state` 累積物件**（`PipelineService.run` 一次 `load()` 後傳入；research C1）。

| 段 | 觸發 | 寫回機制 → `save()` 落檔欄位 | 純函式 |
|----|------|-----------------------------|--------|
| 榜單段 | 榜單推播回報成功 | `Object.assign(state, commitBoardPush(state, pushBoard, now))` 回寫共享 `state` → `board` + `lastBoardPushAt` + 本次 `intros`（`ensureIntro` 就地寫入）；`save(state)` | `commitBoardPush`（純函式、回傳新 `BoardState`、不就地改 `state`；不動） |
| 晨報段 | 晨報推播回報成功 | `state.seenNews`（+本次各則 normalized url）+ `state.lastNewsPushAt`；`save(state)` 一併帶回榜單段已 `Object.assign` 回寫的 `board`/`lastBoardPushAt`/`intros` | F7 內組（normalized url，research D7） |

**不變式**（憲章 VI / SC-003）：
- 一次執行至多 `load()` 一次；每段各至多 `save()` 一次（原子寫入，`StateStore.save` 不動）。
- **`commitBoardPush` 為純函式**：回傳新 `BoardState`，**不**就地改共享 `state`；榜單段成功後**必須**以
  `Object.assign(state, next)` 回寫，否則後跑的晨報段 `save` 會用推播前的舊 `board`/`lastBoardPushAt`
  覆蓋榜單段落檔（半套風險）。
- **推播失敗 → 該段不 `save()` 且回滾其記憶體副作用**：榜單段於**進入時快照 `introsBefore={...state.intros}`**，
  任一未成功推播路徑**還原 `state.intros=introsBefore`**——確保「推播失敗簡介不落檔」不因後跑晨報段的成功
  `save` 而外溢（FR-011；下次重生成，已接受的有界成本）。
- 兩段狀態互不半套：皆以完整 `BoardState` 落檔；後跑段的 `save` 帶回先跑段（若成功）已回寫的欄位、
  帶回先跑段（若失敗）未變的欄位。
- **禁止**新增第二份狀態或平行快取；`IntroInput` metadata 由記憶體 join，不進 `state`（憲章 II/VI）。
