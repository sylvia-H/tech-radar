# Phase 0 Research: Pipeline 端到端編排與 Discord 組版推播

本檔解消 spec Assumptions 標記給 `/speckit-plan` 的三處待接項與其餘設計選擇。所有決策皆以既有真實來源
（憲章、dev-guide §5.3/§6/§7/§8）與 F2~F6 已驗收契約（見各服務 in-repo 型別）為依據，**不新增外部相依、
不新增 API/LLM 呼叫、不改上游判定邏輯**。

---

## D1 — `IntroInput` 的 `description/topics` 從何 join（spec Assumptions 待接項 #1）

**Decision**：在 `BoardRow`（`src/board/board.types.ts`）**加上 `description: string | null` 與
`topics: string[]`** 兩欄位；`BoardBuilderService` 的 `assembleBoards`／`finalizeCandidate` 於組列時把
`CandidateRepo` 既有的 `description`/`topics` 一併帶入 `BoardRow`（**當下已在記憶體、零新 API 呼叫**）。
F7 榜單段以 `current.boards` 攤平出 `Map<repoId, BoardRow>`，對每個 `needsIntro` 的 `BoardChange`
以 `repoId` 查表，組出 `IntroInput { repoId, fullName, description, language, topics, starsThisWeek }`
傳入 `IntroService.ensureIntro`。

**Rationale**：
- `BoardRow` 已載 `repoId/fullName/language/starsThisWeek`，`IntroInput` 六欄位僅缺 `description/topics`；
  補這兩欄使 `BoardRow` 成為單一 join 來源，F7 只需一張 `Map`＋一次查表，最簡（符合「一切從簡」）。
- 每個進入 `diff.changes` 的 `repoId` 都源自 `pushBoard` ← `current.boards`，故 join **必為全命中**
  （不會有找不到 metadata 的變化項）。
- 持久化 `BoardEntry`（`board-commit.ts`）由 `PushBoardRow` 產生、**不含** `description/topics`，故本決策
  **不改變落檔內容**（憲章 II：不自存額外歷史）。`PushBoardRow`/`BoardChange`/`diffBoard`/`pickPushBoard`
  **完全不動**。
- FR-008 明列此 join 由 F7 承接；spec Assumptions 授權「於榜單 build 產出一併帶出，不新增外部 API 呼叫」。

**Alternatives considered**：
- *串進 `PushBoardRow`→`BoardChange`*：需改 3 型別＋2 個 F3 純函式＋其快照測試，面更大、逼近「重寫 F3」，
  否決。
- *從 `state.board` 讀回*：持久化不存 `description/topics`（憲章 II），讀不到，否決。
- *F5 內自打 `GET /repos` 補*：增 GitHub 配額（憲章 I/II）且 F5 契約明載「除 README 外不另打 metadata
  API」，否決。

**影響測試**：`board-builder.service.spec.ts` 若有 `BoardRow` 快照，補上兩欄位（同 Feature 家族的
surface，屬預期更新）。新增 `BoardRow → IntroInput` join 的純函式單測。

---

## D2 — 榜單段 push-then-commit 接縫如何取代 F3 現行 log-success→commit（spec Assumptions 待接項 #3）

**Decision**：F7 以 `PipelineService.run()` 為頂層編排，榜單段落在新的 `BoardSegmentService`
（`src/pipeline/board-segment.service.ts`）。此服務**重用 F3 純判定函式不動**——`decideCadence`
（`board-cadence.ts`）、`pickPushBoard`（`push-board.ts`）、`diffBoard`（`board-diff.ts`）、
`commitBoardPush`（`board-commit.ts`）與 F2 `BoardBuilderService.build`——在 `diffBoard` 之後、
`commitBoardPush`+`save` 之前插入：intro join（D1）＋`ensureIntro`、`BoardChangeDigest` 投影（D6）＋
`BoardSummaryService.summarize`、組版（D4）、Discord 推播（D3）。**唯有推播回報成功**才
`commitBoardPush` 並把本次生成的 `intros`（`ensureIntro` 已就地寫入 in-memory `state.intros`）於
**同一次 `StateStore.save()`** 落檔。

F3 現行薄編排 `board-diff.service.ts`（`runBoardSegment`：build→pick→diff→**log 成功即 commit**）
由 `BoardSegmentService` **取代**；其 cadence 早退、空榜 `aborted` 告警、clock-anomaly 告警等副作用
邏輯**平移**到新服務（沿用相同的 `EMPTY_BOARD_ALERT`/`CLOCK_ANOMALY_ALERT` 文案與 `bestEffortFailureAlert`）。
`BoardSegmentResult`（`diff.types.ts`：`skipped`/`aborted`/`ok`）沿用為榜單段回傳判別聯集。

**Rationale**：F3 於 `board-diff.service.ts` 的 doc comment 明寫「F7 接上 Discord 後，只需把『log 成功 →
commit』的觸發點換成『推播回報成功 → commit』，純函式 `commitBoardPush` 與其測試不動」——本決策即
兌現該接縫。判定/轉換純函式全數保留與測試不動，被取代者僅是**薄編排殼**（副作用串接），單一提交點
（FR-019）得以維持、無雙 commit。

**Alternatives considered**：
- *保留 `runBoardSegment` 再外掛推播*：會有兩個榜單編排者與雙重 commit 風險，違單一提交點，否決。
- *把推播 callback 注入 `runBoardSegment`*：等同改其對外形狀且徒增抽象，不如直接由 F7 段服務接管薄編排。

**模組影響**：`DiffModule` 僅 provide `BoardDiffService`；取代後 `DiffModule` 退役（純函式為模組無關的
函式匯入），`app.module.ts` 移除 `DiffModule`、`PipelineModule` 改 import `BoardModule`/`StateModule`/
`DiscordModule`/`IntroModule`/`CurationModule`/`NewsModule`。`board-diff.service.spec.ts` 的薄編排測試
由 `board-segment.service.spec.ts` 承接（以 mock push 斷言 push-then-commit 與 aborted/skipped）。

---

## D3 — Discord 多 embed 送出與「單則 ≤10」通用切分（spec Assumptions 待接項 #2）

**Decision**：
1. **型別加法擴充**（`discord.embed.ts`，不動既有 `buildTestEmbed`/`buildFailureAlert`）：
   `DiscordEmbed` 增 `url?: string`、`fields?: { name: string; value: string; inline?: boolean }[]`；
   `DiscordWebhookPayload` 增 `avatar_url?: string`（**`footer?` 不加——全組版契約未使用，A1 減面**）。新增卡片色常數：
   `COLOR_BOARD_COVER = 0x5865F2`、`COLOR_DIGEST = 0xF5A623`、`COLOR_AI = 0x10A37F`、
   `COLOR_FRONTEND_BACKEND = 0xF7DF1E`（§7.4；`COLOR_FAILURE = 0xE74C3C` 沿用）。
2. **公開送出**：`DiscordWebhookService` 新增 public `async send(payload: DiscordWebhookPayload)`，
   內部委派既有 private `post`（204 成功／429 有限退避／訊息不含機密——**完全不動**）。
3. **通用切分**（純函式 `embed-split.ts`）：`chunkEmbeds(embeds: DiscordEmbed[], max = 10): DiscordEmbed[][]`
   依**顯示順序**（榜單封面 → 卡片… → 晨報）每 `max` 個切一批，F7 段服務對每批呼叫一次 `send`。
   任一批 `length ≤ 10`、順序不亂、無遺漏無重複。

**Rationale**：dev-guide §7.2 的特例敘述（「封面＋10 卡留第一則、晨報送第二則」）在**冷啟動恰 11
embeds**（封面＋10 卡）時，封面＋10 卡本身即 11 > 10、仍會被 Discord 拒收；**依序 chunk-by-10** 是更
簡單且恆正確的通用規則，涵蓋該特例（spec Assumptions 明載此協調屬 F7 內部組版細節、不影響其他
Feature）。加法擴充 `DiscordEmbed` 不影響 F1 既有 embed。

**Alternatives considered**：
- *沿用 §7.2 二分特例*：冷啟動 11-embed 情境仍超限，否決（見 spec Edge Case「冷啟動」）。
- *新建第二個 webhook 送出器*：重複 429/機密消毒邏輯，否決；擴充既有 `DiscordWebhookService` 即可。

---

## D4 — 晨報 6 則逼近 `description` 4096 的拆分

**Decision**：純函式 `buildDigestEmbeds(digest: CuratedDigest, dateLabel): DiscordEmbed[]`：把 6 則組成
一段 markdown description（每則「`N. [繁中標題](url)` ＋ 內容」，AI 優先在前；降級版 `content=null`
時呈現「原文標題＋連結」、不套 300 字改寫）。以 **code point 長度**估算，若超過 4096 則把 items 貪婪
拆成兩張晨報 embed（皆橙 `COLOR_DIGEST`），兩張都併入 D3 的 `chunkEmbeds`。回傳陣列（1 或 2 個 embed）。

**Rationale**：§7.1「6×(50+300)≈2500~3500 字元，仍在 4096 內；逼近上限時拆兩張」；字數口徑以 Unicode
code point 計（沿用 F5/F6 與憲章，spec Assumptions）。純函式便於單測（憲章 VIII）。

**Alternatives considered**：一律一張（可能超 4096 被拒）／一律兩張（多數日多餘一張空 embed）——皆劣於
「超限才拆」的條件式。

---

## D5 — 晨報 idempotency guard（`decideNewsGuard`，~18h）

**Decision**：純函式 `decideNewsGuard(lastNewsPushAt: string | null, now: Date)`，回傳
`{ due: boolean; reason: 'no-timestamp' | 'due' | 'not-due' | 'clock-anomaly' }`，門檻常數
`NEWS_PUSH_INTERVAL_HOURS = 18`（24h 週期留 6h）。判定順序比照 `decideCadence`：`null` → due
（`no-timestamp`）；晚於 `now`（未來時間戳／時鐘異常）→ **保守跳過**（spec Edge Case：晨報 guard
若算出「未到期」則跳過，不重推）——注意與榜單 `clock-anomaly` 語意相反（榜單照常執行、晨報保守跳過），
兩者刻意獨立；`now − t ≥ 18h` → due（`due`）；否則 not-due（跳過整段）。

**Rationale**：憲章 III/VI 與 §8 明定晨報 <~18h 跳過、雙 cron 去重＋漏跑補推；與榜單 162h 門檻**各自
獨立**（FR-002/020）。純函式時間注入、可脫離真實時鐘測（SC-001/007，憲章 VIII）。

**Alternatives considered**：復用 `decideCadence` 換門檻——但兩者的 `clock-anomaly` 行為相反（榜單執行、
晨報跳過），共用會誤導；各自獨立純函式較清楚且各有測試。

---

## D6 — `BoardDiff` → `BoardChangeDigest` 投影（供 F6 `summarize`）

**Decision**：純函式 `toBoardChangeDigest(diff: BoardDiff): BoardChangeDigest`：由 `diff.changes` 依
`kind` 計數 `newcomers/climbed/declined`、依變化項 `domain` 計 `domainCounts.{ai, 'frontend-backend'}`、
`topName` 取 `diff.topEntry.fullName`。交給 `BoardSummaryService.summarize` 得一句繁中封面 TL;DR；
LLM 失敗時 F6 已回退事實型摘要（`degraded=true`），F7 直接採用、不另中止（FR-009）。

**Rationale**：`BoardChangeDigest`（`board-summary.types.ts`）的 doc comment 明載「由呼叫端（F7）自 F3
`BoardDiff` 投影」；F6 不吃整個 `BoardDiff`、不碰 F3 服務。純函式可單測。

---

## D7 — 晨報 `seenNews` 寫回、觀測旗標、段序

**Decision**：
- **`seenNews` 寫回**：晨報推播成功後，對本次推出的每則以其 **normalized target-URL** 加入
  `state.seenNews`（`{ url, seenAt: now }`，去重不重覆加），連同 `lastNewsPushAt = now.toISOString()`
  於**同一次 `save()`** 落檔（FR-005）。降級版各則亦寫回（已推出即已見）。
  > 對齊點：F4 `excludeSeen` 以 `normalizedUrl` 比對，故 F7 寫回**必須存 normalized 形式**。
  > `CuratedNewsItem.url` 的正規化狀態於 implement 時對照 `curation-validate.ts` 確認；若其為原始
  > target-URL，F7 以既有 `normalizeTargetUrl`（`src/news/url-normalize.ts`）正規化後再寫回。空精選
  > （0 則）**不寫、不前進 `lastNewsPushAt`**（FR-006）。
- **觀測旗標**：`NEWS_INGEST_OBSERVE`（`main.cli.ts`）維持原樣為除錯用途（只跑 F4 `ingest` 印候選、
  不推播）；正式 `PipelineService.run()` 走完整兩段。F7 不改 `main.cli.ts` 的頂層 catch／
  `tryPostFailureAlert`／`.radar-alert-sent` marker（FR-016）。
- **段序**：固定「先榜單、後晨報」（dev-guide §5.3/§7.2）；兩段各自 push-then-persist，至多兩次原子
  `save()`。榜單段 `save` 寫 `board`＋`lastBoardPushAt`＋`intros`；晨報段 `save` 寫 `seenNews`＋
  `lastNewsPushAt`（`commitBoardPush` 已把非榜單欄位原樣帶回，兩段互不半套）。

**Rationale**：FR-005/006/016、憲章 VI；段序沿用 §5.3/§7.2。

**Alternatives considered**：移除 `NEWS_INGEST_OBSERVE`——屬實作取捨，保留無害且利除錯，spec Assumptions
已載「保留與否不影響本規格行為」，故保留。

---

## 未解 NEEDS CLARIFICATION

無。三處 spec Assumptions 待接項（D1/D2/D3）已解消；其餘為既有真實來源既定。所有決策不新增相依、
不新增 API/LLM 呼叫、不改上游判定邏輯，通過 Constitution Check。
