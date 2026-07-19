# Tasks: Pipeline 端到端編排與 Discord 組版推播（Pipeline Orchestration & Discord Push）

**Input**: Design documents from `specs/007-pipeline-push/`

**Prerequisites**: plan.md ✅、spec.md ✅、research.md（D1~D7）✅、data-model.md ✅、contracts/（pipeline-orchestration / discord-layout / embed-split）✅、quickstart.md ✅

**Tests**: 本 Feature **要求測試**——憲章原則 VIII 明列「晨報 idempotency guard、榜單每週節奏、去重、字數/配額、組版切分」等關鍵邏輯**須有單元測試方可視為完成**；quickstart.md 亦列出必測覆蓋。故每個 User Story 皆含測試任務。

**Organization**: 依 User Story 分組（US1~US5，優先序 P1/P1/P1/P2/P3），每組可獨立實作與測試。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可平行（不同檔案、無未完成相依）
- **[Story]**: US1~US5；Setup/Foundational/Polish 無 Story 標籤
- 每個任務含明確檔案路徑

## Path Conventions

Single project（純自用 CLI）：原始碼於 `src/<domain>/`，測試為旁置 `*.spec.ts`（Jest）。F7 主要新增於 `src/pipeline/`＋`src/pipeline/layout/`，並加法式擴充 `src/discord/`、`src/board/`。上游 F2~F6 服務與純函式**原地重用、不改判定邏輯**。

---

## Phase 1: Setup（共用前置）

**Purpose**: 確立變更前的綠燈基線，避免把既有失敗誤記到 F7。

- [ ] T001 執行 `npm run build`（tsc strict 零 error）與 `npm test`（全綠）確立基線，記錄現有 48 個 `*.spec.ts` 通過；確認 `src/pipeline/layout/` 目錄將由後續任務建立（首個 layout 檔一併建目錄）。

**Checkpoint**: 基線綠燈，可開始改動。

---

## Phase 2: Foundational（阻塞性前置——所有 User Story 共用的傳輸層與型別）

**Purpose**: 建立兩段共用的 Discord 傳輸擴充、通用切分、與 join 所需的既有欄位 surface。**這些不含任一 Story 的業務判定**，但 US1/US3 皆依賴。

**⚠️ CRITICAL**: 本階段完成前，任何 User Story 的段服務都無法組版/推播。

- [X] T002 加法擴充 Discord 型別與色常數於 [src/discord/discord.embed.ts](../../src/discord/discord.embed.ts)：`DiscordEmbed` 增 `url?`、`fields?: { name; value; inline? }[]`（**不加 `footer?`——全組版契約未使用，減面**）；`DiscordWebhookPayload` 增 `avatar_url?`（組版契約 L5 payload 引用）；新增 `COLOR_BOARD_COVER=0x5865F2`、`COLOR_DIGEST=0xF5A623`、`COLOR_AI=0x10A37F`、`COLOR_FRONTEND_BACKEND=0xF7DF1E`（`COLOR_FAILURE` 沿用）；同步更新 [src/discord/discord.embed.spec.ts](../../src/discord/discord.embed.spec.ts) 覆蓋新欄位為可選（不破壞既有 `buildTestEmbed`/`buildFailureAlert`）。（contract discord-layout.md L1；data-model §1.2）
- [X] T003 於 [src/discord/discord.webhook.service.ts](../../src/discord/discord.webhook.service.ts) 新增 public `async send(payload: DiscordWebhookPayload): Promise<void>`，內部委派既有 private `post`（204/429 退避與機密消毒**完全不動**）；於 [src/discord/discord.webhook.service.spec.ts](../../src/discord/discord.webhook.service.spec.ts) 加測 `send` 委派 `post`。（research D3；依賴 T002）
- [X] T004 [P] 實作通用切分純函式 `chunkEmbeds(embeds, max=10)` 於 `src/pipeline/layout/embed-split.ts`，並建 `src/pipeline/layout/embed-split.spec.ts` 覆蓋契約六案例（空→`[]`、穩定態 4→1 批、恰滿 10→1 批、冷啟動 12→10+2、邊界 11→10+1、順序保持 `flat`===輸入）。（contract embed-split.md；data-model §2.5）
- [X] T005 [P] 擴充 `BoardRow` 加 `description: string | null` 與 `topics: string[]` 於 [src/board/board.types.ts](../../src/board/board.types.ts)；於 [src/board/board-builder.service.ts](../../src/board/board-builder.service.ts) 組列時把 `CandidateRepo` 既有 `description`/`topics` 一併帶入（**零新 API 呼叫**）；更新 [src/board/board-builder.service.spec.ts](../../src/board/board-builder.service.spec.ts) 快照補兩欄位。**不寫入持久化 `BoardEntry`**（`PushBoardRow` 不含此二欄，落檔內容不變；憲章 II）。（research D1；plan Complexity Tracking；data-model §1.1）

**Checkpoint**: 傳輸擴充與 join 欄位就緒，段服務可開始組版/推播。

---

## Phase 3: User Story 1 - 每日晨報端到端推播（Priority: P1）🎯 MVP

**Goal**: 每天讀狀態一次 →（guard 未跳過時）F4 `ingest` 取候選 → F6 `curate` 策展 → 組一則橙色晨報 embed → 推播 →**推播成功後**寫回 `seenNews`＋`lastNewsPushAt` 並原子存檔。

**Independent Test**: 非榜單日（`lastBoardPushAt` <162h）、`lastNewsPushAt` 已到期，mock 上游與 `DiscordWebhookService`：恰組一則橙色晨報 embed 並 `send` 一次、每則連結取自候選（無杜撰）、推播成功後 `seenNews` 新增本次各則且 `lastNewsPushAt` 前進、**推播成功前狀態未被寫回**。

### Implementation for User Story 1

- [ ] T006 [P] [US1] 實作晨報 guard 純函式 `decideNewsGuard(lastNewsPushAt: string|null, now: Date)` 於 `src/pipeline/layout/news-guard.ts`（回 `{ due; reason: 'no-timestamp'|'due'|'not-due'|'clock-anomaly' }`，常數 `NEWS_PUSH_INTERVAL_HOURS=18`；未來時間戳→保守跳過），並建 `src/pipeline/layout/news-guard.spec.ts` 覆蓋四種 reason。（research D5；憲章 VIII）
- [ ] T007 [P] [US1] 實作晨報組版純函式 `buildDigestEmbeds(digest: CuratedDigest, dateLabel)` 於 `src/pipeline/layout/digest-embeds.ts`（正常：`N. [標題](url)`＋內容、AI 優先在前；降級 `content===null`：原文標題＋連結不套改寫；code-point >4096 貪婪拆兩張橙 embed），並建 `src/pipeline/layout/digest-embeds.spec.ts`。（research D4；contract discord-layout.md L4；FR-004/FR-018）
- [ ] T008 [US1] 實作 `NewsSegmentService.run(state, now)` 於 `src/pipeline/news-segment.service.ts`：`decideNewsGuard`→（`!due` 早退不 ingest/LLM/push/save）→`boardRepoNames = boardRepoNameSet(state.board)`（**一律由共享 `state.board` 導出**；榜單日榜單段成功 commit 後即當次新榜，無「用其榜 `current`」分支，I1）→`newsIngest.ingest(now, boardRepoNames)`→`newsCuration.curate(candidates, boardRepoNames)`→（`items.length===0` 不推空晨報、不前進 `lastNewsPushAt`、早退）→`buildDigestEmbeds`→`chunkEmbeds`→逐批 `discord.send`→**推播成功後**把各則 normalized url（`normalizeTargetUrl`，見 [src/news/url-normalize.ts](../../src/news/url-normalize.ts)）併入 `state.seenNews`＋`state.lastNewsPushAt=now.toISOString()`→`stateStore.save(state)`（**此 `state` 為兩段共享累積物件，已含榜單段以 `Object.assign` 回寫的 `board`/`lastBoardPushAt`/`intros`，一次 save 帶齊、不覆蓋榜單段落檔**，C1）。（contract pipeline-orchestration.md C3；FR-002/003/004/005/006；research D7；依賴 T004/T006/T007）
- [ ] T009 [US1] 改寫 [src/pipeline/pipeline.service.ts](../../src/pipeline/pipeline.service.ts) 之 `run()`：`state = await stateStore.load()`（整個 run 僅一次，作為**兩段共享的可變累積物件**）、`now = new Date()`，呼叫 `NewsSegmentService.run(state, now)`（榜單段於 US3 疊加）；更新 [src/pipeline/pipeline.module.ts](../../src/pipeline/pipeline.module.ts) imports 為 `StateModule`/`DiscordModule`/`NewsModule`/`CurationModule`、providers 加 `NewsSegmentService`。（contract pipeline-orchestration.md C1；FR-001/019；依賴 T008）
- [ ] T010 [US1] 建 `src/pipeline/news-segment.service.spec.ts` 覆蓋 US1 Acceptance 1~4（mock 上游與 `send`）：正常→一則橙 embed＋`send` 一次＋推播成功後 `seenNews`/`lastNewsPushAt` 前進且 `save` 一次、**推播前 state 未寫回**；降級（`degraded=true`）→照樣推播＋各則寫回；推播失敗→`seenNews`/`lastNewsPushAt` 逐位元組不變＋發紅色告警；空精選→不推、不前進。（SC-001/003；憲章 VIII；依賴 T008）

**Checkpoint**: US1 可獨立運作——每日晨報端到端能推、能落檔、失敗不寫半套。此即 MVP。

---

## Phase 4: User Story 2 - 晨報 idempotency guard：雙 cron 去重＋漏跑補推（Priority: P1）

**Goal**: 每次執行開頭以 `lastNewsPushAt` guard 抗雙 cron 重推、補跑遞補漏跑；「每日恰一晨報」。

**Independent Test**: 以固定注入時間與不同 `lastNewsPushAt` 執行晨報段：10h→跳過整段（不 ingest/LLM/推播/寫狀態）；24h 或 `null`→執行並推播；主排推完＋補跑 <18h→跳過（當日總推播 1）；主排漏跑＋補跑 ~24h→補推（總 1）。

### Implementation for User Story 2

- [ ] T011 [US2] 於 `src/pipeline/news-segment.service.spec.ts` 增補 guard 系統行為案例（延用 T008 的段服務、mock 上游）：`lastNewsPushAt` 距今 10h→**整段跳過**（斷言 `ingest`/`curate`/`send`/`save` 皆未被呼叫、推播數 0）；距今 24h 與 `null`→執行推播一次；雙 cron 去重（主排推完前進時間戳、補跑 <18h 跳過，當日總推播維持 1）；漏跑補推（補跑 ~24h→補推 1）。斷言 SC-001「任一日總晨報推播次數 ∈ {0,1}」。（憲章 VI/VIII；依賴 T008）

**Checkpoint**: US1＋US2 一起保證「每日恰一晨報、不重推、能補跑」。

---

## Phase 5: User Story 3 - 榜單日疊加：簡介＋TL;DR＋組版＋push-then-commit（Priority: P1）

**Goal**: 榜單到期（162h）時在晨報之前疊加榜單區塊；為新進/竄升取 F5 簡介、F6 封面 TL;DR，組藍色封面＋領域配色卡，**推播成功後才** commit 榜單快照＋`lastBoardPushAt`＋本次簡介——取代 F3 現行「log 成功即 commit（卻從未推播）」接縫。

**Independent Test**: 榜單到期、綜合 top10 非空、diff 含新進與竄升，mock 上游與 `send`：新進/竄升各取簡介（快取命中不重生成）、封面帶 TL;DR＋下降一行式、掉出項不出現、推播被呼叫；推播成功後 `board`/`lastBoardPushAt`/`intros` 同次原子 save，推播失敗則逐位元組不變（含 `intros` 不落檔）。

### Implementation for User Story 3

- [ ] T012 [P] [US3] 實作 `toBoardChangeDigest(diff: BoardDiff): BoardChangeDigest` 純函式於 `src/pipeline/layout/board-change-digest.ts`（依 `kind` 計 `newcomers`/`climbed`/`declined`、依變化項 `domain` 計 `domainCounts.{ai,'frontend-backend'}`、`topName` 取 `diff.topEntry.fullName`），並建 `src/pipeline/layout/board-change-digest.spec.ts`。（research D6；供 [src/curation/board-summary.service.ts](../../src/curation/board-summary.service.ts) `summarize`）
- [ ] T013 [P] [US3] 實作榜單組版純函式於 `src/pipeline/layout/board-embeds.ts`：`buildCoverEmbed(summary, diff, dateLabel)`（`title` `📊 榜單變化 · ${dateLabel}`、`COLOR_BOARD_COVER`、TL;DR＋`🔻 下降` 一行式 `[fullName](url) #prev → #curr`、`unchanged` 時「本次無變化」摘要、掉出 top10 靜默不列）與 `buildRepoCard(change, introResult, row)`（`🆕`/`🔺` 標題＋`url` 可點、`domainColor`、`introResult.status∈{cached,generated}`→簡介卡／`degraded`→可區分 description 卡、`fields`：本週增星/語言/〔新進〕領域或〔竄升〕名次），並建 `src/pipeline/layout/board-embeds.spec.ts`。（contract discord-layout.md L2/L3；FR-004/010/012；SC-006）
- [ ] T014 [US3] 實作 `BoardSegmentService.run(state, now)` 於 `src/pipeline/board-segment.service.ts`：`decideCadence`（`clock-anomaly`→`bestEffortFailureAlert` 照常執行；`!due`→`{status:'skipped'}` 早退不 build）→`boardBuilder.build()`→`pickPushBoard`（空→`EMPTY_BOARD_ALERT`＋`{status:'aborted'}`）→`diffBoard`→**intro join**（**先快照 `introsBefore={...state.intros}` 供失敗還原**；`current.boards` 攤平 `Map<repoId, BoardRow>`，對 `needsIntro` 的 `BoardChange` 組 `IntroInput`＋`ensureIntro(input, state)` 快取優先、就地寫 in-memory `state.intros`）→`summarize(toBoardChangeDigest(diff))`→`buildCoverEmbed`＋`[...newcomers,...climbed].map(buildRepoCard)`→`chunkEmbeds`→逐批 `send`→**push-then-commit**：全批成功→`Object.assign(state, commitBoardPush(state, pushBoard, now))`（**回寫共享 `state`**，含就地變更後的 `intros`；`commitBoardPush` 為純函式不就地改 `state`）→`stateStore.save(state)`→`{status:'ok', diff}`；**任一未成功推播路徑（推播/組版/上游擲錯）於回傳/上拋前還原 `state.intros=introsBefore`**（未推出簡介不落檔、避免經晨報段 save 外溢；FR-011/SC-003）。沿用 `EMPTY_BOARD_ALERT`/`CLOCK_ANOMALY_ALERT` 文案。（contract pipeline-orchestration.md C2；FR-007/008/009/010/011/012；research D1/D2；依賴 T004/T005/T012/T013）
- [ ] T015 [US3] 接上榜單段並退役 F3 薄編排：改寫 [src/pipeline/pipeline.service.ts](../../src/pipeline/pipeline.service.ts) `run()` 於晨報段**之前**呼叫 `BoardSegmentService.run(state, now)`（同一 `state` 物件累積，先榜單後晨報；榜單段成功後以 `Object.assign` 回寫 `state`，晨報段 `save` 一併帶回，C1）；[src/pipeline/pipeline.module.ts](../../src/pipeline/pipeline.module.ts) 加 import `BoardModule`/`IntroModule` 與 provider `BoardSegmentService`；移除 [src/app.module.ts](../../src/app.module.ts) 的 `DiffModule`；移除薄編排 [src/diff/board-diff.service.ts](../../src/diff/board-diff.service.ts)（**保留** `decideCadence`/`pickPushBoard`/`diffBoard`/`commitBoardPush` 純函式與其測試不動）。（research D2；FR-011/019/020；依賴 T014、T009）
- [ ] T016 [US3] 建 `src/pipeline/board-segment.service.spec.ts`（承接原 `board-diff.service.spec.ts` 薄編排斷言）覆蓋 US3 Acceptance 1~5（mock 上游與 `send`）：新進/竄升取簡介、快取命中不重生成；封面＋卡片推播；推播成功→`Object.assign(state,…)` 回寫後 `board`+`lastBoardPushAt`+`intros` **同一次原子 save**；推播失敗→三者逐位元組不變（含 `intros` **還原至段前快照 `introsBefore`**、不落檔）＋紅色告警；簡介降級→可區分 description 卡；下降一行式＋掉出 top10 靜默不列。（SC-002/003/006；憲章 VIII；依賴 T014）

**Checkpoint**: US1~US3（三條 P1）皆可獨立驗證——晨報每日、榜單七天一次且 push-then-commit。

---

## Phase 6: User Story 4 - 段間與來源隔離容錯（Priority: P2）

**Goal**: 任一段（或其下游來源/LLM）失敗都不阻斷另一段、不回滾已落檔段；每段失敗發紅色告警（best-effort，送不出去只記 log、不再擲錯）。

**Independent Test**: (a) 榜單段擲錯/空榜 aborted→晨報段仍完整推播＋榜單發紅色告警；(b) 晨報段擲錯→已落檔的榜單段狀態不回滾＋晨報發紅色告警。

### Implementation for User Story 4

- [ ] T017 [US4] 於 [src/pipeline/pipeline.service.ts](../../src/pipeline/pipeline.service.ts) `run()` 為兩段各自加 try/catch 隔離：段內擲錯→`bestEffortFailureAlert`（紅色 embed、摘要不含 webhook URL/token/prompt/LLM 回應全文）、**不中止另一段、不回滾**、單段失敗**不再上拋**（避免誤觸 `main.cli.ts` 頂層 catch）；段告警**不寫** `.radar-alert-sent` marker（與頂層 marker 機制並存不互擾）。（contract pipeline-orchestration.md C1/C4；FR-013/014/016；依賴 T015）
- [ ] T018 [US4] 建 `src/pipeline/pipeline.service.spec.ts` 覆蓋 US4 Acceptance 1~4（mock）：榜單段失敗（build 擲錯/空榜/推播失敗）→晨報段照常推播＋榜單紅色告警；晨報段失敗→已落檔榜單段不回滾＋晨報紅色告警；**榜單段推播失敗＋同 run 晨報段推播成功→晨報段 `save` 後 `board`/`lastBoardPushAt`/`intros` 仍為榜單推播前狀態（榜單段未推出的簡介未經共享 `state` 外溢落檔，C1/FR-011/SC-003）**；best-effort 告警自身擲錯→只記 error log、不再擲錯；單源/單次 LLM 失敗→沿用 F4/F5/F6 降級、pipeline 不整條失敗。斷言 SC-004（連帶中止數 0、無聲失敗數 0）。（憲章 VII/VIII；依賴 T017）

**Checkpoint**: 兩段硬化為「一段爆炸不波及另一段」。

---

## Phase 7: User Story 5 - Discord 版面上限與冷啟動拆分（Priority: P3）

**Goal**: 依顯示順序（封面→卡片→晨報）依序 chunk-by-10 送出；冷啟動 >10 embeds 正確跨訊息拆分；晨報逼近 4096 拆兩張；配色/可點正確。

**Independent Test**: 構造冷啟動 embed 集合（封面＋10 卡＋晨報＝12）→切成 2 則（10+2）、每則 ≤10、順序不亂、無遺漏；穩定態（4）→一則；晨報 6 則逼近 4096→兩張晨報 embed。

### Implementation for User Story 5

- [ ] T019 [US5] 在 `src/pipeline/layout/board-embeds.ts` 與 `src/pipeline/layout/digest-embeds.ts` 落實並斷言 Discord 欄位上限（`title`≤256、`description`≤4096、`fields`≤25）；於各自 `*.spec.ts` 補上限案例。（contract discord-layout.md L1/§7.1；FR-018）
- [ ] T020 [US5] 於 `src/pipeline/board-segment.service.spec.ts` 與 `src/pipeline/news-segment.service.spec.ts` 增補版面整合斷言：冷啟動（封面＋10 卡＋晨報＝12）→`send` 呼叫 2 次且各批 ≤10（10+2）、顯示順序 `cover→cards→digest` 保持、embed 總數不增不減；穩定態→`send` 一次；晨報逼近 4096→兩張橙 embed 仍納入切分；卡片依領域上色/封面藍/晨報橙/標題 `url` 可點。（contract discord-layout.md L5/L6；SC-005；依賴 T014/T008/T004）

**Checkpoint**: 所有 User Story 皆獨立可用；冷啟動不再被 Discord 整則拒收。

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: 收尾、回歸、真實來源同步。

- [ ] T021 [P] 更新 [docs/tech-radar-dev-guide.md](../../docs/tech-radar-dev-guide.md) §11.2 F7 條目與 M4 里程碑敘述為「已實作」（§7.1/§7.2 chunk-by-10 已於 `/speckit-tasks` 前複查同步，無需再改）。
- [ ] T022 驗證 [src/main.cli.ts](../../src/main.cli.ts) 頂層路徑不變仍正確：`NEWS_INGEST_OBSERVE` 除錯旗標（只跑 F4 `ingest` 印候選、不推播）保留、頂層 catch／`tryPostFailureAlert`／`.radar-alert-sent` marker 沿用 F1、正式路徑呼叫 `PipelineService.run()` 走完整兩段。（research D7；FR-016）
- [ ] T023 執行 quickstart.md 驗證：`npm run build`（strict 零 error）＋`npm test` 全綠，確認既有 `board-cadence`/`board-diff`/`push-board`/`board-commit` 純函式測試**仍全綠**（F7 未動判定純函式），且新增純函式與段服務測試通過。

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup（Phase 1）**：無相依，立即開始。
- **Foundational（Phase 2）**：依賴 Setup；**阻塞所有 User Story**（傳輸擴充、chunkEmbeds、BoardRow join 欄位）。
- **User Stories（Phase 3~7）**：皆依賴 Foundational。
  - US1（P1）→ US2（P1）：US2 的 guard 系統行為測試沿用 US1 的 `NewsSegmentService`。
  - US3（P1）：依賴 Foundational（T004/T005）＋ US1 的 `PipelineService.run()` 骨架（T009，US3 於其前疊加榜單段）。
  - US4（P2）：依賴 US3（`run()` 兩段皆接上後才硬化隔離）。
  - US5（P3）：依賴 US1/US3 段服務與 Foundational chunkEmbeds。
- **Polish（Phase 8）**：依賴所有目標 Story 完成。

### 關鍵相依鏈

- T002 → T003（`send` 用擴充後的 payload 型別）
- T004（chunkEmbeds）→ T008（news 段推播）、T014（board 段推播）、T020
- T005（BoardRow join 欄位）→ T014（intro join）
- T006/T007 → T008 → T009 → T010；T008 → T011
- T012/T013 → T014 → T015 → T016；T014 → T020
- T015 → T017 → T018

### Within Each User Story

- 純函式（layout/*）先於段服務；段服務先於 `PipelineService` 接線；段服務完成後才寫其整合測試。
- 榜單/晨報段各自「組版 → 推播 → 推播成功後才寫回自己那份狀態」，至多兩次原子 `save()`。

---

## Parallel Opportunities

- **Foundational**：T004、T005 可平行（不同模組）；T002→T003 需序（同 Discord 模組、型別相依）。
- **US1**：T006、T007 可平行（兩個獨立 layout 純函式）；T008 需其完成。
- **US3**：T012、T013 可平行（兩個獨立 layout 純函式）；T014 需其完成。
- **Polish**：T021 可與 T022/T023 平行（純文件）。
- 不同 Story 間：US1/US2 共用 `news-segment.service.ts`（序做）；US3 與 US1 主要在不同檔案，但 T015 改 `pipeline.service.ts`/`pipeline.module.ts`/`app.module.ts` 與 T009 同檔，須序做。

### Parallel Example: Foundational

```bash
# 傳輸與 join 欄位可並行（不同檔案）：
Task T004: "chunkEmbeds 純函式 + 六案例 spec in src/pipeline/layout/embed-split.ts"
Task T005: "BoardRow description/topics 擴充 + board-builder surface in src/board/"
```

### Parallel Example: User Story 3

```bash
# 兩個 layout 純函式並行：
Task T012: "toBoardChangeDigest in src/pipeline/layout/board-change-digest.ts"
Task T013: "buildCoverEmbed/buildRepoCard in src/pipeline/layout/board-embeds.ts"
```

---

## Implementation Strategy

### MVP First（User Story 1 只）

1. 完成 Phase 1 Setup。
2. 完成 Phase 2 Foundational（阻塞所有 Story）。
3. 完成 Phase 3 US1（每日晨報端到端）。
4. **STOP & VALIDATE**：以 `news-segment.service.spec.ts` 獨立驗證晨報能推、能落檔、失敗不寫半套。
5. 每日已有可讀晨報＝最小可用產品。

### Incremental Delivery

1. Setup＋Foundational → 傳輸就緒。
2. ＋US1 → 每日晨報端到端（MVP）。
3. ＋US2 → 冪等 guard（每日恰一晨報、補跑遞補）。
4. ＋US3 → 榜單日疊加＋push-then-commit（取代 F3 假「已推」）。
5. ＋US4 → 段間隔離容錯硬化。
6. ＋US5 → 版面上限與冷啟動拆分。
7. Polish → 回歸與真實來源同步。

### 分段 commit（依 CLAUDE.md）

`/speckit-implement` 期間依 Phase／User Story 分段 commit：每完成一個 Phase 或 User Story 的實作＋測試即建立一個 commit，標 `feat(007-pipeline-push): …`（type 依該段主要性質，測試段可 `test`），同段 `tasks.md` 勾選併入該段 commit。

---

## Notes

- [P] = 不同檔案、無未完成相依；[Story] 標籤對應 spec.md 的 US1~US5。
- 憲章 VIII 必測項於本表落點：晨報 guard（T006/T011）、榜單每週節奏（沿用 F3 測試，T023 回歸）、去重（沿用 F4，寫回 normalized url 於 T008/T010）、字數/配額（沿用 F5/F6）、組版切分（T004/T020）、簡介快取命中（T016）、idempotency（T010/T011）、push-then-commit 逐位元組不變（T010/T016）。
- **不改上游判定邏輯**：`decideCadence`/`pickPushBoard`/`diffBoard`/`commitBoardPush` 純函式與其 spec 全程不動（T015 只移除薄編排殼）。
- 每段狀態一律**推播成功後才寫回**、原子、禁止半套（SC-003）；機密不入告警/不入任何產物（FR-014）。
