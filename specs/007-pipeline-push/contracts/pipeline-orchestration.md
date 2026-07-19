# Contract: Pipeline 編排（兩段、段間隔離、push-then-commit）

F7 對外的「介面」是一支跑完即退的 CLI job；本契約描述 `PipelineService.run()` 及兩段服務的**行為
契約**（前置條件、步驟、後置條件、失敗語意）。上游服務型別引用其 in-repo 定義，不在此複述。

## C1. `PipelineService.run(): Promise<void>`（頂層編排）

**前置**：DI 已建（`NestFactory.createApplicationContext`）；三機密齊備（缺任一於 context 建立即
fail-fast，由 workflow 補告警，F7 不改）。

**步驟**（單次執行）：
1. `state = await stateStore.load()`（**整個 run 僅此一次 load**，FR-019）。`now = new Date()`。
2. **榜單段**（`BoardSegmentService.run(state, now)`）以 try 包裹：擲錯 → best-effort 紅色告警、
   **不中止晨報段**（FR-013/014）。段內推播成功後自行 `save()`（其 `save` 帶回未變的 news 欄位）。
3. **晨報段**（`NewsSegmentService.run(state, now)`）以 try 包裹：擲錯 → best-effort 紅色告警。
   段內推播成功後自行 `save()`（帶回未變的 board 欄位）。
4. 兩段皆以**傳入的同一 `state` 物件**為累積基準（single mutable accumulator）。榜單段推播成功後
   **必須把 `commitBoardPush` 回傳的新 `BoardState` 以 `Object.assign(state, next)` 寫回這個共享
   `state`**（`commitBoardPush` 為純函式、回傳新物件、**不**就地改 `state.board`/`state.lastBoardPushAt`；
   若不寫回，其變更即遺失）。如此後跑的晨報段 `save(state)` 會**一起帶回**榜單段已 commit 的
   `board`/`lastBoardPushAt`/`intros`，兩段互不回退（否則晨報段 `save` 會以推播前的舊
   `board`/`lastBoardPushAt` 覆蓋掉榜單段的落檔，SC-003 半套風險）。

**後置**：至多兩次原子 `save()`；任一段失敗不影響另一段已落檔的部分（SC-004）。

**失敗語意**：段間**任一段擲錯都被段層 try 捕獲並告警**，`run()` 對「單段失敗」**不再上拋**（避免一段
失敗連帶觸發 `main.cli.ts` 頂層 catch 而誤導）。僅當**兩段編排框架本身**（非段內業務）異常才上拋交
頂層。段內 best-effort 告警**不寫 `.radar-alert-sent` marker**（FR-016：與頂層 marker 機制並存不互擾）。

## C2. `BoardSegmentService.run(state, now): Promise<BoardSegmentResult>`

**步驟**：
1. `cadence = decideCadence(state.lastBoardPushAt, now)`（F3 純函式，不動）。
   - `reason === 'clock-anomaly'` → best-effort 告警，但**照常執行**（FR-019a，時間戳不因此變動）。
   - `!cadence.due` → 早退 `{ status: 'skipped' }`（**不 build、不抓取、不耗 GitHub 配額**，FR-007）。
2. `current = await boardBuilder.build()`（F2，含新 `BoardRow.description/topics`）。
3. `pushBoard = pickPushBoard(current.boards, prevIds)`（F3 純函式）。
   - `pushBoard.length === 0`（空榜＝上游全滅）→ best-effort `EMPTY_BOARD_ALERT`、**中止**
     `{ status: 'aborted' }`（不 diff、不 commit，FR-013/025；晨報段仍照常，C1）。
4. `diff = diffBoard(state.board, pushBoard)`（F3 純函式）。
5. **intro join**（research D1）：**先於本段任何 `ensureIntro` 前快照 `introsBefore = { ...state.intros }`**
   （供失敗還原，見「後置/失敗」）。`rowByRepoId = flatten(current.boards)`；對每個
   `c ∈ diff.changes where c.needsIntro`，`ensureIntro(introInputFrom(rowByRepoId.get(c.repoId)),
   state)`（快取命中不重生成；就地寫入 in-memory `state.intros`）。
6. `summary = await boardSummary.summarize(toBoardChangeDigest(diff))`（F6；失敗已降級，直接採用，FR-009）。
7. **組版**：`cover = buildCoverEmbed(summary, diff, dateLabel)`；`cards = [...newcomers, ...climbed]
   .map(c => buildRepoCard(c, introResults.get(c.repoId), rowByRepoId.get(c.repoId)))`；
   `embeds = [cover, ...cards]`（掉出 top10 者**不出現**；`diff.unchanged` 時封面以「本次無變化」摘要，
   FR-012）。
8. **推播**：`for (const batch of chunkEmbeds(embeds, 10)) await discord.send(payload(batch))`。
9. **push-then-commit**（唯一提交點，FR-011）：全部批次推播成功 → `Object.assign(state,
   commitBoardPush(state, pushBoard, now))`（F3 純函式回傳新 `BoardState`，帶回未變的
   `seenNews`/`lastNewsPushAt` 與步驟 5 就地變更後的 `state.intros`；以 `Object.assign` **回寫共享**
   `state`，使晨報段 `save` 一起帶回，見 C1 步驟 4）→ `await stateStore.save(state)` →
   `{ status: 'ok', diff }`。

**後置/失敗**：未達「全部批次推播成功」的任何路徑（推播擲錯、組版/上游擲錯）→ **不 commit**，且在
回傳/上拋前**還原 `state.intros = introsBefore`**——使 `board`/`lastBoardPushAt`/`intros` 皆逐位元組
不變、本次生成的簡介不落檔（含後跑的晨報段成功 `save` 亦**不外溢**帶出，FR-011/SC-003）→ 由 C1 段層
try 告警。（空榜 `aborted` 於步驟 3 早退、尚未生成簡介，還原為 no-op。）`diff.unchanged` 仍推封面並
更新 `lastBoardPushAt`（FR-012）。

## C3. `NewsSegmentService.run(state, now): Promise<NewsSegmentResult>`

**步驟**：
1. `guard = decideNewsGuard(state.lastNewsPushAt, now)`（純函式，research D5）。
   - `!guard.due` → 早退 skip（**不 ingest、不呼叫 LLM、不推播、不寫狀態**，FR-002）。
2. `boardRepoNames = boardRepoNameSet(state.board)` 傳入下游（FR-003）。榜單日榜單段成功 commit 後
   `state.board` 已是**當次新榜**（見 C1 步驟 4 的共享 `state`），故無需另接 `current`；榜單推播失敗或
   非榜單日則 fallback 為上次榜名（等價且更簡，屬已接受的有界邊界）。
3. `candidates = await newsIngest.ingest(now, boardRepoNames)`（F4）。
4. `digest = await newsCuration.curate(candidates, boardRepoNames)`（F6；空候選 F6 短路、失敗 F6 降級）。
   - `digest.items.length === 0` → **不推空晨報、不前進 `lastNewsPushAt`**、早退（FR-006）。
5. **組版**：`embeds = buildDigestEmbeds(digest, dateLabel)`（1~2 張橙；降級版原文標題＋連結，FR-004）。
6. **推播**：`for (const batch of chunkEmbeds(embeds, 10)) await discord.send(...)`（晨報獨立於榜單段
   推播時通常 1 批）。
7. **push-then-commit**：推播成功 → 把本次各則 normalized url 併入 `state.seenNews`（`{url, seenAt:
   now}`，去重）、`state.lastNewsPushAt = now.toISOString()` → `await stateStore.save(state)`。此
   `state` 即共享累積物件，**已含榜單段（若本 run 有）以 `Object.assign` 回寫的
   `board`/`lastBoardPushAt`/`intros`**，故一次 `save` 帶齊兩段成果、互不覆蓋（C1 步驟 4；SC-003）。

**後置/失敗**：推播擲錯 → **不 save**（`seenNews`/`lastNewsPushAt` 不變，SC-003）→ C1 告警。

## C4. 不變式（全段共用）

- **推播成功後才寫回**、每段至多一次原子 `save()`、禁止半套（憲章 VI，SC-003）。
- **段間隔離**：任一段失敗不阻斷/回滾另一段（SC-004）。
- **每段失敗必發紅色告警**（best-effort，送不出去只記 log、不再擲錯，FR-014/US4；摘要不含機密）。
- **段內持久副作用隔離至推播成功**：兩段共用單一可變 `state`；榜單段對 `state.intros` 的就地生成，於該段
  未成功推播時**還原**（entry 快照 `introsBefore`）；晨報段對 `seenNews`/`lastNewsPushAt` 亦僅於推播成功後
  才寫。任一段失敗，其對 `state` 持久欄位的變更**不外溢**到另一段的 `save`（FR-011，SC-003）。
- **不新增 LLM 客戶端、不改 F2~F6 對外契約與判定邏輯**（FR-020）；榜單 162h 與晨報 18h 門檻獨立。
