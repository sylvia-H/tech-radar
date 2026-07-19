# Implementation Plan: Pipeline 端到端編排與 Discord 組版推播（Pipeline Orchestration & Discord Push）

**Branch**: `007-pipeline-push` | **Date**: 2026-07-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/007-pipeline-push/spec.md`

## Summary

F7 是新聞與榜單兩條資料流的「最後一哩」：把已驗收的上游能力（F2 建榜／F3 diff 與節奏／F4 候選／
F5 簡介／F6 策展與封面 TL;DR）**串成端到端、真正推上 Discord、並在推播成功後原子落檔**。

技術取向：以 `PipelineService` 為頂層編排，一次 `StateStore.load()` 後**先榜單段、後晨報段**，每段
「組版 → 推播 → 推播成功後才寫回自己那份狀態」，兩段**段間隔離**（任一段失敗不斷另一段、皆發紅色告警）。
F7 **不重寫**上游任何判定邏輯（cadence／diff／dedup／curate／intro 純函式與其測試皆不動），只做
**編排、以 `repoId` join 補 metadata、依 Discord §7 規格組版、多 embed 依序 ≤10 切分推播、與
push-then-commit**。榜單段以此**取代 F3 現行「log 成功即 commit（卻從未推播）」的接縫**——這正是 F3
於 `board-diff.service.ts` 註記預留給 F7 的接點。

## Technical Context

**Language/Version**: TypeScript（strict）on Node.js 24

**Primary Dependencies**: NestJS（`createApplicationContext` 一次性 CLI job）、`undici`/`fetch`（Discord
webhook）、`zod`（狀態 schema，沿用 F1）。**F7 不新增任何 runtime 相依、不新增第二個 LLM 客戶端**
（憲章 I／V，FR-020）。

**Storage**: `state/board.json`（唯一權威狀態，只經 `StateStore` 讀寫；憲章 VI）。F7 不新增狀態欄位、
不新增平行狀態。

**Testing**: Jest（單元測試 + 快照）。外部呼叫（Discord push、Gemini via F5/F6）以 mock 測；
另測降級與失敗路徑（憲章 VIII）。

**Target Platform**: GitHub Actions ubuntu-latest 排程 job（雙離峰 cron `:07`/`:37` UTC）＋
`workflow_dispatch`；跑完即退。

**Project Type**: Single project（純自用 CLI，非 web／mobile）。

**Performance Goals**: N/A（批次 job，無延遲/吞吐目標）。硬約束是**用量**：一次執行 Discord 推播訊息
數為「⌈總 embeds / 10⌉」（穩定態多為 1，冷啟動 ≤2），**不新增 GitHub API 呼叫、不新增 LLM 呼叫**
（榜單日 F5 簡介僅對新進/竄升且快取優先、F6 TL;DR 每榜單日 1 次、F6 策展每日 1 次——皆沿用上游）。

**Constraints**:
- **一次執行至多 `load()` 一次、每段推播成功後各 `save()` 一次**（原子寫入，禁止半套；憲章 VI）。
- **狀態一律推播成功後才寫回**（FR-005/011，SC-003）。
- **任一則 Discord 訊息 ≤10 embeds**、`title` ≤256、`description` ≤4096、`fields` ≤25（§7.1）。
- **段間隔離**：榜單段與晨報段互不阻斷、互不回滾（FR-013，SC-004）。
- **機密不入告警／不入任何產物**（憲章 VII，FR-014）。

**Scale/Scope**: 單一使用者（自用）；每日 1 晨報 embed（6 則）、每七天 1 榜單封面＋≤10 卡。

## Constitution Check

*GATE：Phase 0 前必過；Phase 1 設計後複查。*

憲章八條非協商原則對 F7 的落地與判定：

| 原則 | F7 落地 | 判定 |
|------|---------|------|
| **I. 零維運免費基礎設施** | 不新增相依/服務；推播訊息數 = ⌈embeds/10⌉（穩定態 1）；不新增 GitHub/LLM 呼叫 | ✅ Pass |
| **II. 不自存星星歷史** | 不自建星星快照；`IntroInput` 的 metadata 由**當次 build 產物** join（不從 `state.board` 讀回、不另打 `GET /repos`），FR-008 | ✅ Pass |
| **III. 只推變化、控制節奏** | 榜單 162h（沿用 F3 `decideCadence`）、晨報 <~18h guard（新增 `decideNewsGuard`，門檻與 §8 一致、與榜單獨立）；晨報 ≤6 則、字數上限由 F5/F6 完成 F7 只呈現 | ✅ Pass |
| **IV. 新聞來源設定即資料** | F7 只呼叫 F4 `ingest`，不碰來源設定與 pipeline 抓取；0 筆告警沿用 F4 | ✅ Pass |
| **V. 去重確實、節制 LLM** | 不新增 LLM 呼叫、不引入 embeddings；去重沿用 F4/F6 | ✅ Pass |
| **VI. 冪等、單一狀態、防幻覺** | `load` 一次、每段 push 成功後 `save` 一次（原子）；事實欄位（連結/增星/名次）由程式填、敘事（簡介/TL;DR/內容）來自 LLM；guard 抗雙 cron | ✅ Pass |
| **VII. 機密隔離與容錯** | 段間隔離＋每段 best-effort 紅色告警（`bestEffortFailureAlert`，送不出去只記 log）；告警摘要不含機密；沿用 F4/F5/F6 來源層容錯 | ✅ Pass |
| **VIII. 關鍵邏輯測試優先** | 新增純函式（news guard、embed ≤10 切分、digest 4096 拆分、BoardDiff→BoardChangeDigest 投影、embed 組版）皆單測；編排以 mock 測 happy/降級/失敗；push-then-commit 與段間隔離以 mock 斷言狀態逐位元組不變 | ✅ Pass |

**需正式記錄的設計協調（非違反）**：FR-020「MUST NOT 改動 F2/F3 對外契約」與 FR-008「以 `repoId`
join 當次榜單抓取結果補 `description/topics`」之間，需在 `BoardRow` **加上 `description`/`topics`
兩個既有已抓取欄位**才能 join（見 research D1）。此屬 spec Assumptions 明確授權給 `/speckit-plan`
承接的「metadata join 管線」（「於榜單 build 產出一併帶出，不新增外部 API 呼叫、不擴大配額」），
且為**加法式 surface 已抓取的公開欄位**、不改任何判定語意（diff/rank/cadence/dedup 全不動）、
**不寫入持久化 `BoardEntry`**（憲章 II）。故非契約破壞，於 Complexity Tracking 記錄以昭覈實。

**需正式記錄的設計協調（VI，非違反）②——兩段共享 `state` 的落檔次序**：榜單段與晨報段共用**單一可變
`state` 累積物件**，各段「推播成功後才寫回自己那份持久欄位」、至多兩次原子 `save()`。兩處次序協調必須落地
（否則違 SC-003）：(a) `commitBoardPush` 為**純函式**（回傳新 `BoardState`、不就地改 `state`），榜單段成功後
**必須 `Object.assign(state, next)` 回寫共享 `state`**，否則後跑的晨報段 `save` 會以推播前的舊
`board`/`lastBoardPushAt` 覆蓋榜單段落檔；(b) F5 `ensureIntro` **於推播前**即就地寫 `state.intros`，榜單段須於
**進入時快照 `intros`、於任一推播失敗路徑還原**，確保「榜單推播失敗簡介不落檔」（FR-011）不因晨報段成功
`save` 而外溢。此屬**編排層落檔次序**，判定/轉換純函式（`commitBoardPush`/`ensureIntro` 契約）**不動**——
詳見 contracts C1~C4 與 data-model §3。

**Gate 結論**：無未正當化的違反。**PASS**（可進入 Phase 0）。

## Project Structure

### Documentation (this feature)

```text
specs/007-pipeline-push/
├── plan.md              # 本檔
├── research.md          # Phase 0：關鍵決策（D1~D7）
├── data-model.md        # Phase 1：記憶體實體與型別擴充
├── quickstart.md        # Phase 1：端到端驗證情境
├── contracts/           # Phase 1：F7 內部編排/組版/切分契約
│   ├── pipeline-orchestration.md
│   ├── discord-layout.md
│   └── embed-split.md
└── tasks.md             # Phase 2（/speckit-tasks 產出，非本命令）
```

### Source Code (repository root)

F7 主要新增於 `src/pipeline/`（編排＋段服務）與 `src/pipeline/layout/`（純組版/切分函式），並**加法式擴充**
`src/discord/`（embed 型別＋public 送出）與 `src/board/board.types.ts`（`BoardRow` 兩欄位）。上游
F2~F6 服務與純函式**原地重用、不改判定邏輯**。

```text
src/
├── pipeline/
│   ├── pipeline.service.ts          # 【改寫】頂層編排：load 一次 → 榜單段 → 晨報段（段間隔離）
│   ├── board-segment.service.ts     # 【新增】榜單段：cadence→build→pick→diff→intro join→TL;DR→組版→push→commit
│   ├── news-segment.service.ts      # 【新增】晨報段：guard→ingest→curate→組版→push→seenNews/lastNewsPushAt
│   ├── pipeline.module.ts           # 【改寫】imports: Board/State/Discord/Intro/Curation/News
│   └── layout/
│       ├── news-guard.ts            # 【新增純函式】decideNewsGuard(lastNewsPushAt, now)（~18h）
│       ├── board-change-digest.ts   # 【新增純函式】BoardDiff → BoardChangeDigest 投影（供 F6.summarize）
│       ├── board-embeds.ts          # 【新增純函式】buildCoverEmbed / buildRepoCard（封面藍＋領域配色卡）
│       ├── digest-embeds.ts         # 【新增純函式】buildDigestEmbeds（6 則；逼近 4096 拆兩張）
│       └── embed-split.ts           # 【新增純函式】chunkEmbeds(embeds, 10)（依序 ≤10 切分）
├── discord/
│   ├── discord.embed.ts             # 【擴充】DiscordEmbed 加 url?/fields?；payload 加 avatar_url?；卡片色常數
│   └── discord.webhook.service.ts   # 【擴充】新增 public send(payload)（重用既有 private post：204/429 退避不變）
├── board/
│   └── board.types.ts               # 【擴充】BoardRow 加 description/topics（build 既有已抓取欄位，供 join）
└── diff/                            # 純函式（board-cadence/board-diff/push-board/board-commit）不動；
                                      #   薄編排 board-diff.service.ts 由 board-segment.service.ts 取代（見 research D2）
```

**Structure Decision**：沿用既有 single-project 分層（`src/<domain>/`，服務 `@Injectable` + 純函式旁置）。
F7 的**編排**集中在 `src/pipeline/`；**純組版/判定**下沉到 `src/pipeline/layout/*` 與擴充的
`src/discord/*` 以利無 mock 單測（憲章 VIII）。上游模組（BoardModule/IntroModule/CurationModule/
NewsModule/DiscordModule/StateModule）以 DI 重用，不複製其邏輯。

## Complexity Tracking

僅記錄 Constitution Check 標示的「需正當化」設計協調（非原則違反）：

| 項目 | 為何需要 | 為何不採更簡替代 |
|------|----------|------------------|
| `BoardRow` 加 `description`/`topics` 兩欄位（連帶 `board-builder.service.spec.ts` 快照補欄） | F5 `IntroInput` 需 `description/topics/language/starsThisWeek`；後三者 `BoardRow` 已有，僅缺前二。二者於 `assembleBoards` 當下的 `CandidateRepo` 已在手，加法 surface 即可 join，零新 API 呼叫（FR-008、spec Assumptions 授權） | (a) 串進 `PushBoardRow`/`BoardChange`：需動 3 個型別＋`pickPushBoard`/`diffBoard` 純函式與其快照測試，違「不重寫 F3 邏輯」精神且面更大；(b) 從 `state.board` 讀回：持久化不存 `description/topics`（憲章 II），讀不到；(c) 另打 `GET /repos`：增 GitHub 配額（憲章 I/II 禁止） |
| 榜單薄編排 `board-diff.service.ts`（log→commit）由 `board-segment.service.ts`（push→commit）取代 | F3 現行「log 成功即 commit」從未真正推播、等於狀態謊報「已推」（US3）；F7 必須把觸發點換成「推播回報成功」。F3 已於該檔註記此接縫預留給 F7 | 保留舊薄編排並外掛推播：會出現「兩個榜單段編排者」與雙重 commit 風險，違單一提交點（FR-019）。F3 的**純判定函式** `decideCadence`/`pickPushBoard`/`diffBoard`/`commitBoardPush` 與其測試**維持不動**——被取代的僅是薄編排殼 |
