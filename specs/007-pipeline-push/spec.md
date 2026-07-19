# Feature Specification: Pipeline 端到端編排與 Discord 組版推播（Pipeline Orchestration & Discord Push）

**Feature Branch**: `007-pipeline-push`

**Created**: 2026-07-19

**Status**: Draft

**Input**: User description: "feature 007-pipeline-push"

> 範圍依真實來源界定：`docs/tech-radar-dev-guide.md` §5.3（推播組成）、§6（簡介流程）、§7（Discord
> 呈現與模板）、§8（排程與雙 guard），以及 §11.2 的 F7 條目；憲章原則 III（榜單每七天／晨報每日、
> 只推變化、字數與配額）、VI（冪等、單一狀態、狀態須在**推播成功後**才寫回、簡介一生只生成一次、
> LLM 不得產生事實數據）、VII（機密隔離、來源與段間隔離容錯、失敗發紅色告警不無聲）、VIII（晨報
> idempotency guard、榜單每週節奏須有測試）。
>
> **F7 是新聞與榜單兩條資料流的「最後一哩」**：把已驗收的上游能力**串成端到端、真正推上 Discord、
> 並在推播成功後原子落檔**。三塊：**(1) 每日晨報端到端**——`lastNewsPushAt` guard →（未跳過時）
> F4 `NewsIngestService.ingest` 取候選 → F6 `NewsCurationService.curate` 策展 → 組橙色晨報 embed →
> 推播 → **成功後**寫回 `seenNews`＋`lastNewsPushAt`；**(2) 榜單日疊加**——沿用 F3 到期判定（162h），
> 為新進／竄升項取 F5 250 字簡介、以 F6 產封面 TL;DR、組藍色封面＋領域配色卡片，推播 → **成功後**
> commit 榜單快照＋`lastBoardPushAt`＋本次簡介；**(3) 段間與版面收尾**——段間隔離容錯（任一段失敗不斷
> 另一段、發紅色告警不無聲）、Discord 單則 ≤10 embeds 的通用切分（含冷啟動 11-embed 情境）。
>
> **本 Feature 不含**：新聞抓取／正規化／階段 A 去重過濾（F4 `004-news-ingest`，已驗收——F7 呼叫其
> `ingest`）；每日單次 LLM 策展、降級備援、榜單封面 TL;DR、輸出硬驗證（F6 `006-news-curation`，已
> 驗收——F7 呼叫 `curate`／`summarize`）；repo 250 字簡介生成與快取邏輯、`LlmService` 封裝（F5
> `005-repo-intro`，已驗收——F7 呼叫 `ensureIntro`）；榜單建置、跨領域綜合 top10、diff、每週節奏判定、
> `commitBoardPush` 純函式（F2／F3，已驗收——F7 重用）；Pages 儀表板／RSS（F8 `008-pages-publish`，
> post-MVP）。F7 **不重寫**任何上述邏輯、**不改**其對外契約，只做**編排、metadata join、組版、推播、
> push-then-persist 與段間隔離**。

## Clarifications

*本 Feature 於 `/speckit-specify` 階段以既有真實來源（dev-guide §5.3/§6/§7/§8、憲章 III/VI/VII/VIII）
與上游已驗收契約推導出全部行為，未留 `[NEEDS CLARIFICATION]`；所有邊界取捨記於 Assumptions。若
`/speckit-clarify` 另有調整再回填於此。*

## User Scenarios & Testing *(mandatory)*

本功能的「使用者」即專案擁有者（自用）。擁有者每天早上打開 Discord，想直接讀到當日的技術晨報；每七天
還想在晨報之前看到「這週榜單有什麼變化」。上游 F2～F6 已把資料流的每一段各自做完並驗收，但它們全都
**只回傳記憶體結構、既不推播也不落檔**：F4 產候選、F5 產簡介、F6 產精選集與封面摘要、F3 產榜單 diff。
更關鍵的是——**F3 目前的榜單段是「輸出 log 後就 commit 狀態，但從未真正推上 Discord」**（F3 刻意留下
接縫，註明「F7 接上 Discord 後把『log 成功 → commit』換成『推播回報成功 → commit』」）。

F7 建立**把這些能力串成端到端、真正送到 Discord、並只在推播成功後原子落檔**的最後一段。它每天執行時
嘗試兩段：**榜單段**（每七天才有內容）疊在**晨報段**（每天）之前；每段各自「組版 → 推播 → 成功後才
寫回自己那份狀態」。兩條硬約束貫穿全程：**冪等與正確性**——晨報以 `lastNewsPushAt` guard 抗雙 cron
重推、狀態一律**推播成功後**才寫、禁止半套；**永不無聲失敗且段間隔離**——任一段（或其下游任一來源／
LLM 呼叫）失敗，都**不得中止另一段**、且失敗都要發紅色告警 embed。

F7 **不決定「今天有沒有新聞可挑、榜單怎麼 diff」**（那是 F4/F6/F3），也**不重寫**簡介、策展、榜單建置
或去重邏輯。它負責的是：判定該不該跑、把上游拼起來、以 `repoId` join 補上組版所需 metadata、依 Discord
規格組出 embed、推播、並在成功後把該段狀態原子寫回。

### User Story 1 - 每日晨報端到端推播：候選 → 策展 → 組版 → 推播 → 成功後落檔（Priority: P1）

擁有者每天要在 Discord 收到一則橙色晨報 embed（≤6 則精選、AI 優先）。系統讀狀態一次，（guard 未跳過時）
呼叫 F4 取當日候選、以當前榜脈絡呼叫 F6 策展得到精選集，把它組成一則晨報 embed 送上 Discord；**推播回報
成功後**才把本次推出的各則記入 `seenNews`、更新 `lastNewsPushAt` 並原子存檔。策展成功為繁中精煉版
（標題＋≤300 字內容），策展失敗時 F6 已回降級版（原文標題＋連結），F7 照樣組版推播、晨報不中斷。

**Why this priority**: 這是 F7 的日常主線，也是 M4 驗收的核心之一——「每日恰一晨報」。榜單七天才推一次，
晨報每天推；沒有這條端到端，上游 F4/F6 的產物就永遠停在記憶體、擁有者收不到任何東西。它本身即最小可用
產品：串好這一段，每天就有可讀的晨報。

**Independent Test**: 於**非榜單日**（`lastBoardPushAt` 距今 <162h）、`lastNewsPushAt` 已到期的狀態下，
以 mock 的來源抓取與 mock `DiscordWebhookService` 執行 pipeline，驗證：恰組出一則橙色晨報 embed 並呼叫
推播一次、每則連結取自候選（無杜撰）、推播成功後 `seenNews` 新增本次各則且 `lastNewsPushAt` 前進、且
**推播成功前狀態未被寫回**。全程 mock，不依賴真實網路。

**Acceptance Scenarios**:

1. **Given** 非榜單日、晨報 guard 已到期、F4 產出一批候選、F6 回傳合規精選集，**When** 執行 pipeline，
   **Then** 系統組出**一則**橙色晨報 embed（每則「[繁中標題](url)」＋≤300 字內容，AI 優先在前）並推播，
   推播成功後把本次各則的 target-URL 記入 `seenNews`、更新 `lastNewsPushAt`、原子存檔。
2. **Given** 當日 F6 走降級路徑（`CuratedDigest.degraded=true`，每則為原文標題＋連結），**When** 組版，
   **Then** 系統照樣組出晨報 embed 並推播，晨報不因策展 LLM 失敗而中斷；降級各則仍於推播成功後寫回
   `seenNews`（已推出即已見）。
3. **Given** 晨報推播**失敗**（Discord 擲錯），**When** 系統處理失敗，**Then** `seenNews`／`lastNewsPushAt`
   **MUST NOT** 被寫回（狀態逐位元組不變），並發一則紅色告警 embed（不無聲）。
4. **Given** F6 回傳空精選集（0 則），**When** 執行晨報段，**Then** 系統**不推空晨報**、**不**前進
   `lastNewsPushAt`（未發生推播即不前進 guard），使同日補跑或隔日得以重試。

---

### User Story 2 - 晨報 idempotency guard：雙 cron 去重＋漏跑補推（Priority: P1）

排程以雙離峰 cron（主排＋補跑）觸發。系統每次執行開頭以 `lastNewsPushAt` 做 guard：若距上次晨報推播
< ~18h 就**整段跳過**晨報（不抓取、不呼叫 LLM、不推播、不寫狀態）。正常日主排推完更新 `lastNewsPushAt`，
補跑那次因 <18h 自動跳過（不重推）；主排若被 Actions 跳過，補跑那次因距上次已 ~24h 而正常補推。等於
雙 cron 去重＋漏跑補推一次搞定。

**Why this priority**: 這是憲章原則 VI（晨報冪等、`lastNewsPushAt` guard、雙 cron 只推一次）與 §8 排程
設計的直接落實，也是 M4 驗收明列「每日恰一晨報（主排漏跑由補跑遞補、不重複）」。優先序 P1：缺了它，
雙 cron 會每天推兩次晨報（洗版），或無法補救漏跑。與 US1 可獨立驗證：US1 驗證「該推時能推完整條」，
US2 專驗「不該推時正確跳過、該補時能補」。

**Independent Test**: 以固定注入時間與不同 `lastNewsPushAt` 值執行晨報段：距今 10h → 跳過（不呼叫 F4/F6、
不推播、狀態不變）；距今 24h → 執行並推播；`lastNewsPushAt=null`（冷啟動）→ 視為到期並執行。全程 mock。

**Acceptance Scenarios**:

1. **Given** `lastNewsPushAt` 距今 < ~18h，**When** 執行晨報段，**Then** 系統跳過整段（不 ingest、不呼叫
   LLM、不推播、不寫狀態），該次晨報推播次數為 0。
2. **Given** `lastNewsPushAt` 距今 ≥ ~18h（或為 `null`），**When** 執行晨報段，**Then** 系統正常執行 US1
   全流程並推播一次。
3. **Given** 正常日主排已推完、補跑於約 30 分鐘後觸發，**When** 補跑執行，**Then** 因距上次 <18h 而跳過，
   當日晨報總推播次數維持 1。
4. **Given** 主排被 Actions 整次跳過、補跑距上次晨報已 ~24h，**When** 補跑執行，**Then** 正常補推一則晨報，
   當日總推播次數為 1（漏跑被遞補）。

---

### User Story 3 - 榜單日疊加：簡介＋TL;DR＋組版＋push-then-commit（Priority: P1）

每七天一次的榜單日，系統在晨報之前疊加榜單區塊。榜單段沿用 F3 的到期判定（162h）與 diff；F7 為每個
新進／竄升項取 F5 的 250 字簡介（讀快取優先、以 `repoId` join 當次榜單抓取結果補上 `description/topics/
language/starsThisWeek` 構成 `IntroInput`），以 F6 把 diff 摘成一句繁中封面 TL;DR，組出**藍色封面 embed**
（TL;DR＋下降一行式；掉出 top10 者靜默不列）＋**每個新進／竄升 repo 一張領域配色卡**（可點標題、fields
標示本週增星／語言／領域或名次變化）。推播成功後**才** commit 榜單快照＋`lastBoardPushAt`＋本次簡介——
**取代 F3 現行「log 成功即 commit（卻從未推播）」**的接縫行為。

**Why this priority**: 這是 F7 相對 F3 最實質的能力增量，也是 M4 驗收另一半——「榜單七天一次、只呈現變化
且附簡介」。優先序 P1：F3 目前會在**沒有真正推播**的情況下更新 `lastBoardPushAt`，等於狀態謊報「已推」；
不修正這條，榜單永遠推不出去卻以為推過了。與 US1 可獨立驗證：US1 是每日晨報、US3 是七天一次的榜單疊加，
吃的輸入（榜單 diff vs 新聞候選）與寫的狀態（`board`/`lastBoardPushAt`/`intros` vs `seenNews`/
`lastNewsPushAt`）皆不同。

**Independent Test**: 於榜單到期（`lastBoardPushAt` 距今 ≥162h 或為 `null`）、榜單 build 產出含新進與竄升
的狀態下，以 mock 上游與 mock 推播執行榜單段，驗證：新進／竄升項各取得簡介（快取命中則不重生成）、封面
帶 TL;DR 與下降一行式、掉出項不出現、推播被呼叫；且**推播成功後才** commit（`board`/`lastBoardPushAt`/
`intros` 一併原子寫回），推播失敗則狀態逐位元組不變（含 `intros` 不落檔）。全程 mock。

**Acceptance Scenarios**:

1. **Given** 榜單到期且本次綜合 top10 非空、diff 含新進與竄升，**When** 執行榜單段，**Then** 系統為每個
   新進／竄升項取得 250 字簡介（快取命中不重生成）、由 F6 取一句封面 TL;DR，組出封面 embed＋每項一張
   領域配色卡並推播。
2. **Given** 榜單推播回報**成功**，**When** 系統落檔，**Then** `commitBoardPush`（`board`＋
   `lastBoardPushAt`）與本次生成的 `intros` 於**同一次原子 save** 寫回；快照與時間戳不半套。
3. **Given** 榜單推播**失敗**，**When** 系統處理失敗，**Then** **MUST NOT** commit（`board`／
   `lastBoardPushAt`／`intros` 皆不變、逐位元組不動），並發紅色告警；本次已生成的簡介不落檔（下次重生成，
   屬已接受的有界成本）。
4. **Given** 某新進／竄升項的 F5 簡介走降級（`status='degraded'`），**When** 組卡，**Then** 該卡以
   description 降級卡呈現、與正常簡介卡可區分，榜單仍照常推播。
5. **Given** 本次綜合 top10 有下降與掉出項，**When** 組封面，**Then** 下降以一行式（`#prev → #curr`）列於
   封面、掉出 top10 者**當次靜默不列**（不推卡、不提示）。

---

### User Story 4 - 段間與來源隔離容錯：任一段／來源失敗不斷全線（Priority: P2）

榜單段與晨報段是兩條獨立資料流。任一段失敗——榜單 build 擲錯、空榜、簡介或 TL;DR LLM 失敗（已由 F5/F6
降級）、乃至榜單推播失敗——都**不得阻斷晨報段**；反之晨報段失敗也**不得回滾或影響已成功落檔的榜單段**。
每段失敗**MUST 發一則紅色告警 embed**（best-effort，送不出去只記 log、不再擲錯），另一段照常執行。單一
新聞來源或單次 LLM 呼叫的失敗，沿用下游 F4（逐源 try/catch＋帶 `id` 告警）與 F5/F6（LLM 降級）的既有
容錯，不使整條 pipeline 失敗。

**Why this priority**: 這是憲章原則 VII（來源與段間隔離容錯、失敗不無聲）在編排層的落實，也是 §11.2 F7
明列「來源隔離容錯落地」。優先序 P2：US1/US3 已交付兩段的 happy path 可用 MVP，本故事是把它們硬化成
「一段爆炸不波及另一段」的保證層。缺了它，一次榜單來源全滅或一次 Discord 429 就可能連帶吃掉當日晨報。
與 US1～US3 可獨立驗證：專門注入「某一段失敗」，斷言另一段仍完成推播且失敗有紅色告警。

**Independent Test**: (a) 讓榜單段擲錯（或空榜 aborted），驗證晨報段仍完整執行並推播、且榜單失敗發了紅色
告警；(b) 讓晨報段擲錯，驗證已成功落檔的榜單段狀態不被回滾、晨報失敗發了紅色告警。全程 mock。

**Acceptance Scenarios**:

1. **Given** 榜單段失敗（build 擲錯／空榜／推播失敗），**When** 執行 pipeline，**Then** 晨報段**照常執行並
   推播**，榜單失敗發一則紅色告警 embed（不無聲）。
2. **Given** 晨報段失敗（策展降級後仍推播失敗，或組版擲錯），**When** 系統處理，**Then** 已於本次成功落檔
   的榜單段狀態**不被回滾**，晨報失敗發一則紅色告警 embed。
3. **Given** 段內 best-effort 告警本身送不出去（Discord 再次擲錯），**When** 系統處理，**Then** 只記一筆
   error log、**不再擲錯**，不使容錯被「告警自身故障」二次中斷。
4. **Given** 單一新聞來源抓取失敗或單次 LLM 呼叫失敗，**When** 執行，**Then** 沿用 F4/F5/F6 既有容錯降級，
   整條 pipeline **不因此失敗**（F7 不重複實作來源層容錯、只加段層隔離）。

---

### User Story 5 - Discord 版面上限與冷啟動拆分（Priority: P3）

Discord 單則訊息最多 10 個 embeds。榜單段與晨報段**各自獨立**依顯示順序（榜單段：封面 → 卡片；晨報段：
晨報 1~2 張）把**自己那份** embeds 切成每則 ≤10 的批次送出（維持段間隔離，FR-013：合併跨段送出會使
一次 Discord 失敗同時波及兩段的 push-then-commit，故不合併）。穩定態每七天多半 0～數張卡，榜單段一則
訊息即可容納；**冷啟動日**全數新進（10 張卡）＋封面＝**11 個 embeds**（僅榜單段自身），**超過單則
上限**，榜單段必須正確拆成 2 則（不得一次送 >10 使 Discord 拒收）；晨報段照常獨立送出自己的 1~2 張。
晨報 6 則若逼近 description 4096 上限，拆成兩張晨報 embed（仍在晨報段自己的批次內）。

**Why this priority**: 這是 dev-guide §7.1/§7.2 的版面規格落地。優先序 P3：穩定態極少觸發拆分，屬邊界情形；
但**冷啟動當次榜單段會實際超過 10 embeds**，若不處理會被 Discord 整則拒收而推播失敗，故仍須正確。與
US1～US3 可獨立驗證：構造榜單段「封面＋10 張卡」的 embed 集合，斷言切分後每則 ≤10、順序不亂、無 embed
遺漏；晨報段的批次獨立驗證。

**Independent Test**: 構造榜單段冷啟動 embed 集合（封面 1＋新進卡 10＝11 個 embeds），呼叫組版／送出，
斷言：切成 2 則、每則 ≤10、顯示順序保持、總 embed 數不增不減；晨報段獨立構造（晨報 1~2 張）斷言單則
送出；再構造榜單段穩定態（封面＋2 卡＝3）斷言單則送出。全程 mock 推播、只檢查批次。

**Acceptance Scenarios**:

1. **Given** 任一段要送出的 embeds 總數 ≤10，**When** 該段送出，**Then** 以**一則**訊息送出。
2. **Given** 榜單段 embeds 總數 >10（冷啟動封面＋10 卡＝11），**When** 榜單段送出，**Then** 依顯示順序
   切成多則、每則**≤10** embeds、無遺漏、無重複，任一則**MUST NOT** 送出 >10 個 embeds；晨報段照常
   獨立送出自己的批次，兩段**不合併**為同一批次序列。
3. **Given** 晨報 6 則的 description 逼近 4096 字元上限，**When** 組晨報 embed，**Then** 拆成兩張晨報 embed
   （仍在晨報段自己的 ≤10 切分規則內），避免單一 description 超限被拒。
4. **Given** 榜單卡片，**When** 組卡，**Then** 依領域上色（AI `0x10A37F`／前後端 `0xF7DF1E`）、封面藍
   `0x5865F2`、晨報橙 `0xF5A623`，卡片標題以 embed `url` 可點。

---

### Edge Cases

- **冷啟動（雙時間戳皆 null）**：榜單視為到期（no-timestamp）、晨報 guard 視為到期；榜單 build 若滿 10 席
  全為新進 → 10 張卡＋封面＝11 embeds，走 US5 通用切分；兩段各自推播成功後才落檔。
- **榜單到期但綜合 top10 為空**（上游來源全滅）：屬異常而非「這週沒變化」——榜單段發紅色告警並**中止榜單段**
  （沿用 F3 `aborted`），但**晨報段照常執行**（段間隔離，US4）。
- **榜單到期但 diff 無任何變化**（新進／竄升／下降皆空）：封面以「本次無變化」摘要呈現；是否仍推榜由本
  Feature 決定——**MUST 仍推封面並更新 `lastBoardPushAt`**（節奏錨定：到期即消耗一次週期，避免每次執行
  重算而漂移）。
- **榜單非到期日**：榜單段整段跳過（不 build、不抓取、不耗 GitHub 配額），當日只有晨報段。
- **晨報候選集為空 / 精選為空**：不推空晨報、不呼叫 LLM（F6 已短路）、不前進 `lastNewsPushAt`（未推播即不
  前進 guard）；同日補跑或隔日重試。
- **晨報全部候選皆已見（seenNews 命中）**：F4 排除後候選為空 → 同上，安靜日、不推。
- **榜單推播成功但晨報推播失敗（榜單日）**：榜單段狀態已正確落檔（已推），晨報段狀態不落檔並發紅色告警；
  次一次執行以晨報 guard 補推晨報（榜單因剛推、未到期而跳過）。
- **簡介或封面 TL;DR 的 LLM 失敗**：F5/F6 已各自降級（description 卡／事實型摘要），榜單仍照常推播，F7 不
  另中止。
- **best-effort 告警送不出去**：只記 error log、不擲錯（US4）。
- **`lastBoardPushAt`／`lastNewsPushAt` 為未來時間（時鐘異常）**：榜單段沿用 F3 既有處理（告警但照常執行、
  時間戳不因此變動）；晨報 guard 若因未來時間戳算出「未到期」則跳過該次（保守不重推），屬已接受的邊界。
- **同一次執行兩段皆到期（榜單日且晨報到期）**：先榜單段、後晨報段，各自「推播成功後才寫回自己那份狀態」，
  產生至多兩次原子 save；任一段失敗不影響另一段已寫回的部分。

## Requirements *(mandatory)*

### Functional Requirements

**每日晨報端到端（PipelineService 編排）**

- **FR-001**: 系統 MUST 在每次執行時，於一次 `StateStore.load()` 後依序嘗試**榜單段**（US3，榜單日才有
  內容）再**晨報段**（US1）；晨報段流程為：guard 判定 →（未跳過時）F4 `ingest` 取候選 → 以榜脈絡呼叫 F6
  `curate` → 組晨報 embed → 推播 →**推播成功後**寫回 `seenNews`＋`lastNewsPushAt` 並原子 `save()`。
- **FR-002**: 系統 MUST 以 `lastNewsPushAt` 做晨報 idempotency guard：距今 < ~18h 即**跳過整個晨報段**
  （不 `ingest`、不呼叫 LLM、不推播、不寫狀態）；`lastNewsPushAt` 為 `null` 視為到期。門檻與晨報每日週期
  一致（24h 留 6h → <~18h 跳過），與榜單 162h 門檻**各自獨立**（憲章 III、§8）。
- **FR-003**: 系統 MUST 以當前榜脈絡建立 `boardRepoNames` 並傳入 F4 `ingest` 與 F6 `curate`，使「候選是否
  命中榜上 repo」的加權生效（沿用 F4/F6 契約）。`boardRepoNames` 一律由 `boardRepoNameSet(state.board)`
  導出：榜單日榜單段成功 commit 後 `state.board` 即當次新榜（兩段共用同一 `state`，見 FR-011／plan），
  故無需另傳當次 build 產物；榜單推播失敗或非榜單日則 fallback 為上次榜名（等價且更簡，屬已接受的有界邊界）。
- **FR-004**: 晨報 embed MUST 由 F6 `CuratedDigest`（≤6 則）組出一則橙色 embed：繁中精煉版每則呈現
  「[繁中標題](url)]（≤50/≤300）＋內容」、AI 優先在前；降級版（`degraded=true`）每則呈現原文標題＋連結
  （不套 300 字改寫）。連結等事實 MUST 取自程式對回的候選、**MUST NOT** 由 LLM 產生。
- **FR-005**: 晨報**推播成功後**，系統 MUST 把本次推出的每則以其 target-URL（正規化）記入 `seenNews`
  （帶 `seenAt`），與 `lastNewsPushAt` 於**同一次原子 save** 寫回；降級版各則亦寫回（已推出即已見）。
- **FR-006**: F6 回傳空精選集（0 則）時，系統 **MUST NOT** 推空晨報、**MUST NOT** 前進 `lastNewsPushAt`
  （未發生推播即不前進 guard），使同日補跑／隔日得以重試（寧缺勿濫、安靜日不洗版）。

**榜單日疊加（US3）**

- **FR-007**: 榜單段 MUST 沿用 F3 `decideCadence`（162h 門檻）判定到期；未到期即整段跳過（不 build、不抓取、
  不耗 GitHub 配額，沿用 F3 早退）。本 Feature **MUST NOT** 改動榜單節奏門檻或 diff 邏輯。
- **FR-008**: 榜單到期且本次綜合 top10 非空時，系統 MUST 為每個 `needsIntro` 的變化項（新進／竄升）呼叫 F5
  `ensureIntro` 取 250 字簡介（快取命中不重生成）；`IntroInput` 的 `description/topics/language/
  starsThisWeek` MUST 由 F7 以 `repoId` **join 當次榜單抓取結果**補入（憲章 II／VI：不從 `state.board`
  讀回、不另打 `GET /repos` 補取，省 GitHub 配額）。
- **FR-009**: 系統 MUST 由 F3 `BoardDiff` 投影出 `BoardChangeDigest`（新進／竄升／下降計數＋領域分布＋
  topName）呼叫 F6 `BoardSummaryService.summarize` 取一句繁中封面 TL;DR；LLM 失敗時 F6 已回退事實型摘要，
  F7 直接採用、不另中止。
- **FR-010**: 榜單 embed MUST 組為：一張**藍色封面**（`0x5865F2`，含 TL;DR＋下降一行式 `#prev → #curr`；
  掉出 top10 者**當次靜默不列**）＋每個新進／竄升 repo **一張領域配色卡**（AI `0x10A37F`／前後端
  `0xF7DF1E`，標題以 `url` 可點，fields：本週增星／語言／〔新進〕領域或〔竄升〕名次變化）；F5 簡介降級
  （`status='degraded'`）以可區分的 description 卡呈現。
- **FR-011**: 系統 MUST 採 **push-then-commit**（取代 F3 現行「log 成功即 commit」）：榜單 embed **推播成功
  後才** `commitBoardPush`（`board`＋`lastBoardPushAt`）並把本次生成的 `intros` 於**同一次原子 save** 寫回；
  推播失敗即**不 commit**、狀態逐位元組不變（含 `intros` 不落檔）。因兩段共用同一 `state` 累積物件且 F5
  `ensureIntro` 於推播前即就地寫 `state.intros`，榜單段 MUST 於**進入時快照 `intros`、於任一推播失敗路徑
  還原**，確保未推出的簡介不因後跑晨報段的成功 `save` 而外溢落檔（SC-003）。
- **FR-012**: 榜單 diff 無任何變化（新進／竄升／下降皆空）時，系統 MUST 仍推封面（以「本次無變化」摘要）
  並更新 `lastBoardPushAt`（到期即消耗一次週期以錨定節奏，避免漂移）。

**段間與來源隔離容錯（憲章 VII）**

- **FR-013**: 榜單段與晨報段 MUST 段間隔離：任一段失敗（含榜單空榜 `aborted`、build／組版／推播擲錯）
  **MUST NOT** 阻斷另一段；晨報段失敗 **MUST NOT** 回滾或影響已成功落檔的榜單段狀態。
- **FR-014**: 每段失敗時，系統 MUST 發一則**紅色告警 embed**（`bestEffortFailureAlert`，送不出去只記 error
  log、**不再擲錯**、不無聲），摘要 **MUST NOT** 含機密（webhook URL／token／prompt／LLM 回應全文）。
- **FR-015**: 單一新聞來源或單次 LLM 呼叫的失敗，MUST 沿用下游 F4（逐源 try/catch＋帶 `id` 告警）與 F5/F6
  （LLM 失敗降級）既有容錯；F7 **MUST NOT** 重複實作來源層容錯，只加**段層**隔離與最終告警。
- **FR-016**: F7 段內 best-effort 告警與 CLI 頂層 catch 告警（`.radar-alert-sent` marker 去重）MUST 並存
  而不互相破壞：段告警為 best-effort、**不寫 marker**；頂層 marker 機制沿用 F1，F7 不改。

**Discord 版面上限與拆分（US5）**

- **FR-017**: 送往 Discord 的訊息 MUST 每則 ≤10 embeds：榜單段與晨報段**各自獨立**依顯示順序（榜單段：
  封面 → 卡片；晨報段：晨報 1~2 張）將**自己那份** embeds 切成每則 ≤10 的批次送出（**不合併跨段送出**，
  維持 FR-013 段間隔離——合併會使一次 Discord 失敗同時波及兩段的 push-then-commit）；冷啟動（榜單段
  封面＋10 卡＝11）等 >10 情境 MUST 正確跨訊息拆分、無遺漏無重複、順序不亂，任一則 **MUST NOT** 送出
  >10 embeds。此通用切分涵蓋 dev-guide §7.2「晨報改送第二則」的特例。
- **FR-018**: 版面規格 MUST 遵守 Discord 上限與 dev-guide §7.1：`title` ≤256、`description` ≤4096、`fields`
  ≤25；晨報 6 則逼近 description 4096 時 MUST 拆成兩張晨報 embed（仍納入 FR-017 切分）。

**狀態與邊界（憲章 VI）**

- **FR-019**: 系統 MUST 只經 `StateStore` 讀寫 `state/board.json`（單一權威狀態）；一次執行至多 `load()`
  一次、每段推播成功後各 `save()` 一次（`StateStore.save` 既有原子寫入）；**禁止半套狀態**。no-diff 時由
  workflow 端既有 no-diff 早退不製造空 commit（F7 **不改** `radar.yml` 結構）。
- **FR-020**: F7 **MUST NOT** 新增第二個 LLM 客戶端、**MUST NOT** 改動 F2/F3/F4/F5/F6 對外契約或重寫其
  邏輯（簡介、策展、榜單建置、diff、去重、節奏門檻）；只做編排、metadata join、組版、推播與 push-then-
  persist。榜單每週節奏與晨報每日 guard **相互獨立**，**MUST NOT** 因新增晨報段而改變 F3 節奏或反之。

### Key Entities *(include if feature involves data)*

- **晨報段結果（News segment outcome）**：記憶體結構——本次晨報是否跳過（guard）／是否推播成功／推出的
  各則（供 `seenNews` 寫回）。只存在於單次執行。
- **榜單段結果（Board segment outcome）**：記憶體結構——是否到期／是否 `aborted`（空榜）／本次 diff、本次
  生成的簡介（供 push 後與 `commitBoardPush` 同次落檔）。只存在於單次執行。
- **簡介 join 視圖（IntroInput join view）**：F7 以 `repoId` 把「當次榜單抓取結果」的 `description/topics/
  language/starsThisWeek` join 到新進／竄升項，構成 F5 `IntroInput`；持久化的 `state.board` 不存
  `description/topics`，故不可從 state 讀回。
- **組版 embed 批次（Embed batch）**：依顯示順序排好的 embed 序列（封面／卡片／晨報），切成每則 ≤10 的送出
  批次。事實欄位（連結／增星／名次）由程式填、敘事欄位（簡介／TL;DR／內容）來自 LLM。
- **狀態寫回單元**：榜單段 save 寫 `board`＋`lastBoardPushAt`＋`intros`；晨報段 save 寫 `seenNews`＋
  `lastNewsPushAt`。兩者各自「推播成功後」寫回，皆為原子寫入，互不半套。兩段共用同一 `state` 累積物件：
  榜單段成功後以 `Object.assign` 回寫（`commitBoardPush` 為純函式、不就地改 `state`），晨報段 save 一併
  帶回其 `board`/`lastBoardPushAt`/`intros`；任一段推播失敗則其持久欄位變更不外溢至另一段的 save。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 每日晨報推播次數**恆為 1**——正常日雙 cron 下，主排推 1 次、補跑因 guard 跳過（0 次）；主排
  漏跑時補跑遞補（1 次）。任一日總晨報推播次數 ∈ {0,1}，且「有可推內容的日子」為 1（0 僅發生於安靜日／
  guard 跳過）。
- **SC-002**: 榜單推播每七天一次——`lastBoardPushAt` 距今 <162h 的執行，榜單推播次數為 **0**；≥162h（或
  null）且非空榜時為 1。榜單與晨報節奏互不干擾（各自到期各自推）。
- **SC-003**: 狀態**一律推播成功後才寫回**——模擬榜單／晨報任一段推播失敗時，該段對應狀態
  （`board`/`lastBoardPushAt`/`intros` 或 `seenNews`/`lastNewsPushAt`）**逐位元組不變**，半套寫入次數為 **0**。
- **SC-004**: 段間隔離 **100%**——注入任一段失敗，另一段仍完成推播（連帶中止數為 **0**）；每段失敗
  **100%** 伴隨一則紅色告警 embed（無聲失敗數為 **0**）。
- **SC-005**: 送往 Discord 的**任一則訊息 embeds 數 ≤10**——含冷啟動（榜單段封面＋10 卡＝11）情境，>10 的
  送出次數為 **0**；切分後（榜單段／晨報段各自）embed 總數不增不減、顯示順序保持。
- **SC-006**: 榜單日新進／竄升卡 **100%** 帶簡介或可區分的降級 description 卡；掉出 top10 的 repo 出現在
  推播的次數為 **0**（當次靜默）。
- **SC-007**: 冪等——對同一 `lastNewsPushAt`/`lastBoardPushAt` 與同一上游輸入重跑，推播與狀態結果一致
  （重複推播數為 **0**、狀態不再變動）。

## Assumptions

- **上游 F2～F6 已驗收、F7 重用不改契約**：`BoardBuilderService.build`、`BoardDiffService`（cadence/diff/
  `commitBoardPush`）、`NewsIngestService.ingest`、`IntroService.ensureIntro`、`NewsCurationService.curate`、
  `BoardSummaryService.summarize`、`DiscordWebhookService`、`StateStore` 皆按其現有型別與行為使用。
- **`IntroInput` 的 `description/topics` 由 F7 以 `repoId` join 當次榜單抓取結果補入**（dev-guide §6 的 F5
  clarify 2026-07-18）。持久化 `state.board` 不存 `description/topics`、不可從 state 讀回；F5 也不另打
  `GET /repos`。**依賴**：若當前榜單 build 產物尚未把 `description/topics` 上 surface 到 F7 可 join 之處，
  屬 `/speckit-plan` 需接的資料管線（預設：於榜單 build 產出一併帶出，不新增外部 API 呼叫、不擴大配額）。
- **guard／cadence 門檻沿用既有**：晨報 <~18h 跳過、榜單 162h 到期（憲章 III、§8），F7 不另調；兩者獨立。
- **push-then-commit 取代 F3 現行 log-success→commit**：F3 已預留此接縫（`commitBoardPush` 純函式與其測試
  不動），F7 把觸發點換成「推播回報成功」。榜單推播失敗時本次簡介不落檔、下次重生成，為已接受的有界成本
  （快取效益只在推播成功後兌現，憲章 VI）。
- **embed ≤10 通用切分為「段內」規則、兩段不合併送出**：dev-guide §7.2 原圖示把封面／卡片／晨報畫成同一個
  陣列一次送出，在**冷啟動恰為 11 embeds**（僅榜單段封面＋10 卡，尚未計入晨報）時仍超過單則 10 上限；
  F7 採**依序 chunk-by-10** 的通用規則，但**只套用在每段自己的 embeds 集合內**（榜單段一次、晨報段
  另一次），不把兩段合併成同一個待切分陣列——合併會使一次 Discord 失敗同時波及兩段的 push-then-commit，
  牴觸 FR-013 段間隔離（不可調整的非協商保證）。§7.2 該圖示視為特例、實作以「段內通用切分＋段間各自
  推播」對齊（此屬 F7 內部組版細節、不影響其他 Feature）。
- **空精選日不推、不前進 guard**：`lastNewsPushAt` **只在晨報推播成功後前進**（與「狀態推播成功後才寫」
  一致）；空精選（0 則）視為未推播 → guard 不前進 → 同日補跑／隔日重試。此為已接受的安靜日行為。
- **段序固定為「先榜單、後晨報」**：疊加順序沿用 dev-guide §5.3/§7.2（榜單區塊在晨報之前）；兩段各自
  push-then-persist，至多兩次原子 save。
- **`NEWS_INGEST_OBSERVE` 觀測旗標**：F4 的觀測模式（只跑 ingest 印候選、不推播）為除錯用途；F7 讓正式
  `PipelineService.run()` 走完整兩段。是否保留該旗標屬實作取捨，於 `/speckit-plan` 決定，不影響本規格行為。
- **workflow（`radar.yml`）結構沿用 F1**：no-diff 早退、失敗補送告警去重（`.radar-alert-sent`）不變；F7 不
  改 workflow 的雙 cron、commit-on-change、failure-alert 步驟。
- **繁中輸出、字數口徑一致**：晨報標題 ≤50／內容 ≤300、簡介 ≤250，「字」以 Unicode code point 計，沿用
  F5/F6 與憲章口徑；F7 只組版呈現，不重做字數收斂（收斂已由 F5/F6 完成）。
</content>
</invoke>
