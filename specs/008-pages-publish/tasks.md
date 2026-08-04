---

description: "Task list for GitHub Pages 儀表板 + RSS/Atom 發佈"
---

# Tasks: GitHub Pages 儀表板 + RSS/Atom 發佈

**Input**: Design documents from `specs/008-pages-publish/`
**Prerequisites**: [plan.md](./plan.md)、[spec.md](./spec.md)、[research.md](./research.md)、
[data-model.md](./data-model.md)、[contracts/](./contracts/)、[quickstart.md](./quickstart.md)

**Tests**: 本專案憲章原則 VIII 明訂關鍵邏輯（純函式、狀態寫回、schema 相容性、可見性判定各分支）
MUST 有單元測試方可視為完成；下列任務已依此內含測試，不再另立獨立「測試先行」子階段——延續本
codebase 既有慣例（實作檔與同名 `*.spec.ts` 併排撰寫、隨後即測，見既有 `board-commit.ts`／
`board-commit.spec.ts` 等）。

**Organization**: 依 User Story（US1/US2/US3，對應 spec.md 優先序 P1/P2/P3）分組；Foundational
階段涵蓋三個故事共用、且依既有「`commitBoardPush` 為唯一狀態寫回轉換點、不拆成另一個組裝函式」
設計決策（plan.md Complexity Tracking）不宜拆分的核心管線改動。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可平行執行（不同檔案、彼此無依賴）
- **[Story]**: 所屬 User Story（US1/US2/US3）
- 每項任務皆附精確檔案路徑

## Path Conventions

單一專案（`src/`、`.github/workflows/`，皆位於 repo 根目錄），沿用 plan.md「Project Structure」。

---

## Phase 1: Setup

**Purpose**: 補齊本 Feature 唯一新增的 runtime 相依。

- [X] T001 執行 `npm install feed` 新增 `feed` 套件相依（`package.json`／`package-lock.json`；
  憲章/dev-guide §14 已釘死此套件，research D4）

**Checkpoint**：`feed` 套件可被 import，後續 render-feed 任務可開始。

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 三個 User Story 共用、且依設計決策不宜拆分的核心改動——狀態 schema 擴充、
可見性查詢服務、純函式共用元件。**這個階段完成前，任何 User Story 皆無法獨立測試**（`Publish
Service` 沒有 schema 可讀、沒有可見性查詢就無法產生任何發佈產物）。

- [X] T002 [P] 在 `src/config/env.schema.ts` 新增選用欄位 `GITHUB_REPOSITORY: z.string().trim()
  .optional()`（非機密，不比照五個必填欄位；供 `RepoVisibilityService` 取得
  `owner/repo`，research D3）。**維持選用、不 fail-fast**：本機執行核心 pipeline 時本就沒有此
  變數，缺值的後果收斂在發佈段內（見 T007 的 `'unknown'` 分支），不得讓核心段因此起不來
- [X] T003 在 `src/state/state.schema.ts` 新增 `feedEntrySchema`／`curatedNewsItemSchema`／
  `publishNewsSchema`／`publishBoardSummarySchema`／`publishStateSchema`，並將
  `boardStateSchema` 擴充 `publish: publishStateSchema.optional()`（data-model.md §1；
  `curatedNewsItemSchema` 欄位對應 `src/curation/curation.types.ts` 的 `CuratedNewsItem`，
  該檔案本身不動——注意 `content` 為 `z.string().nullable()`）。
  **`feed` 欄位 MUST NOT 加 `.max(50)`**：schema 在 `StateStore.load()` 時驗證，超限會讓
  `load()` 擲錯而打掛核心推播段（違反 FR-014），上限一律由寫入端的 `trimFeed` 單點保證
  （data-model.md §1「驗證規則」）
- [X] T004 [P] 在 `src/state/state.schema.spec.ts` 新增向後相容測試：既有（不含 `publish` 鍵）
  的 state fixture 經 `boardStateSchema.safeParse` MUST 成功，且 `result.data.publish ===
  undefined`（contracts/state-write-contract.md C4，對應 FR-014／SC-007，依賴 T003）
- [X] T005 [P] 新增 `src/publish/publish.types.ts`：`RepoVisibility = 'public' | 'private' |
  'unknown'`（data-model.md §2.1）
- [X] T006 [P] 新增 `src/publish/html-escape.ts`（`escapeHtml(text: string): string`，轉義
  `&`/`<`/`>`/`"`/`'`）與 `src/publish/html-escape.spec.ts`（research D5）
- [X] T007 新增 `src/publish/repo-visibility.service.ts`：`RepoVisibilityService.check(): Promise
  <RepoVisibility>`，注入 `GithubHttpService`（`src/github/github-http.ts`）與 `ConfigService`，
  打 `GET /repos/{owner}/{repo}`（`owner/repo` 取自 `GITHUB_REPOSITORY`），`private === false` →
  `'public'`；**`GITHUB_REPOSITORY` 未設定、或格式不含 `/`（拆不出 `owner`/`repo`）→ 不發請求、
  直接回 `'unknown'`**（與其他「無法確認為 public」情形同一出口，不另立靜默分支——見 research D3
  「輸入層級缺失」段）；`private` 缺失/格式不符/請求擲錯（`GithubHttpError`／網路錯誤）→
  `'unknown'`；`private === true` → `'private'`（research D3，依賴 T002/T005）
- [X] T008 [P] 新增 `src/publish/repo-visibility.service.spec.ts`：mock
  `GithubHttpService.getJson` 驗證 public／private／查詢擲錯（含回應格式不符）三分支對應
  `'public'`/`'private'`/`'unknown'`，另加**第四個案例**：`GITHUB_REPOSITORY` 未設定／不含 `/`
  時回 `'unknown'` 且 `getJson` **未被呼叫**（plan.md Testing、quickstart.md 單元測試涵蓋範圍，
  依賴 T007）

**Checkpoint**：schema 與可見性查詢就緒；User Story 階段可開始。

---

## Phase 3: User Story 1 - 免 Discord 瀏覽當前雷達快照 (Priority: P1) 🎯 MVP

**Goal**：repo 為 public 時，公開網頁呈現推播榜（依 AI／前後端分區）、上次榜單變化摘要、今日
精選新聞；無資料時顯示空狀態而非報錯。

**Independent Test**：repo 為 public 且已有至少一次成功推播後，本機執行
`PUBLISH_MODE=1 node dist/main.cli.js`（quickstart.md 情境 1），`public/index.html` 呈現與
Discord 推播一致的榜單／摘要／新聞；`emptyBoardState()` 重跑仍正常產生空狀態頁面、exit 0。

### Implementation for User Story 1

- [X] T009 [US1] 擴充 `src/diff/board-commit.ts`：`commitBoardPush` 新增 `summary:
  BoardChangeSummary` 參數，回傳的 `BoardState` 加上 `publish: { ...state.publish, boardSummary:
  { summary: summary.summary, generatedAt: pushedAtIso } }`（state-write-contract.md C1 的
  `boardSummary` 部分；`diff` 參數與 `feed` 寫入留待 US2 的 T026 補上，避免此階段引入尚未存在的
  `feed-entry.ts`）
- [X] T010 [US1] 更新 `src/diff/board-commit.spec.ts`：既有快照測試補上 `publish.boardSummary`
  正確性（含 `state.publish` 原本為 `undefined` 與已有既存值兩種情形），依賴 T009
- [X] T011 [US1] 更新 `src/pipeline/board-segment.service.ts`（~L119 `commitBoardPush` 呼叫點）
  傳入既有作用域內已算好的 `summary`（L102），依賴 T009
- [X] T012 [US1] 擴充 `src/pipeline/news-segment.service.ts` 既有 push-then-commit 區塊
  （`stateStore.save(state)` 之前）：新增 `state.publish = { ...state.publish, news: { items:
  digest.items, generatedAt: seenAt } }`（state-write-contract.md C2 的 `news` 部分；`feed`
  寫入留待 US2 的 T029），依賴 T003
- [X] T013 [US1] 更新 `src/pipeline/news-segment.service.spec.ts`：驗證推播成功後
  `state.publish.news.items` 與 `digest.items` 為同一參照（feed-page-contract.md C3，對應
  FR-002/009），依賴 T012
- [X] T014 [P] [US1] 新增 `src/publish/render-page.ts`：`renderPage(state: BoardState, now: Date)
  => string`，三區塊固定順序——推播榜（依 `domain` 分 AI／前後端、依 `rank` 升冪，含
  `intros[repoId]?.intro`；`state.board` 為空顯示「尚無榜單資料」）、上次榜單變化摘要
  （`state.publish?.boardSummary`，含 `generatedAt` 換算台北時間「XX 月 XX 日」；不存在顯示
  「尚無榜單變化紀錄」）、今日精選新聞（`state.publish?.news`，含 `generatedAt`；不存在顯示
  「尚無新聞精選」；**單則 `content` 為 `null`（策展降級項）時只輸出標題與連結、不輸出內容
  區塊，且該則不得被過濾掉**——`CuratedNewsItem.content` 型別為 `string | null`，直接內插會
  印出字面 `null`，過濾掉則會讓網頁與 Discord 推播不一致，見 feed-page-contract.md C1）；
  所有插入文字皆呼叫 `escapeHtml`（feed-page-contract.md C1，依賴 T006）
- [X] T015 [P] [US1] 新增 `src/publish/render-page.spec.ts`：快照測試涵蓋（a）完整資料、
  （b）`emptyBoardState()` 空狀態、（c）HTML escape（標題/簡介含 `<`/`&` 等字元）、
  （d）含一則 `content: null` 的降級新聞（斷言輸出不含字面 `null`、該則標題仍在），依賴 T014
- [X] T016 [P] [US1] 新增 `src/publish/render-feed.ts`：`renderFeed(state: BoardState, pagesUrl:
  string) => string`，以 `feed` 套件 `Feed`／`feed.atom1()` 輸出；讀
  `state.publish?.feed ?? []`（此階段恆為空陣列，entries 由 US2 的 T026/T029 開始填入）並反轉為
  新到舊；feed 層級 `title`＝「Tech Radar」、`id`/`link`＝`pagesUrl`、`updated`＝最新一筆
  `publishedAt`（陣列為空時用 `now`）；空陣列時輸出合法的 0 entries feed，不擲錯
  （feed-page-contract.md C2，data-model.md §2.6）
- [X] T017 [P] [US1] 新增 `src/publish/render-feed.spec.ts`：快照測試——0 entries 時仍為合法
  Atom XML，依賴 T016
- [X] T018 [US1] 新增 `src/publish/publish.service.ts`：`PublishService.run(): Promise<void>`
  依 contracts/publish-orchestration.md C2 完整流程——
  類別內自備 `private readonly logger = new Logger(PublishService.name)`（`bestEffortFailureAlert`
  的第二個參數需要，比照既有 `BoardSegmentService`／`PipelineService` 慣例）→
  `visibility = await repoVisibility.check()` →
  `'private'` 時記一筆 info log 並 return（不寫檔、不告警）→
  `'unknown'` 時 `bestEffortFailureAlert('可見性查詢失敗，本次跳過發佈')` 並 return（不寫檔）→
  `try` 區塊內依序 `state = await stateStore.load()`（**MUST 在 try 內**——`load()` 遇壞檔會
  擲錯，留在 try 外會讓 `run()` 違反「永不 throw」且漏掉 FR-017 告警）、由
  `GITHUB_REPOSITORY` 推導 `pagesUrl = https://{owner}.github.io/{repo}/`（研究 D4；能走到這一步
  表示可見性查詢已成功解析出 `owner/repo`）、以純函式 `renderPage`/`renderFeed` 各自產出字串、
  確認皆成功後才依序
  `fs.writeFile('public/index.html', ...)`／`fs.writeFile('public/feed.xml', ...)`（C3「全有或
  全無」，不留半份 `public/` 目錄）→
  `catch` 區塊 `bestEffortFailureAlert('發佈失敗：' + err.message)` 並 return；
  整個函式永不 throw（依賴 T007/T014/T016）
- [X] T019 [US1] 新增 `src/publish/publish.service.spec.ts`：mock
  `RepoVisibilityService`/`StateStore`/`fs`，驗證（a）public 成功寫出兩個檔案、（b）
  `emptyBoardState()` 仍正常寫出兩個檔案（US1 AS1/AS2）、（c）`stateStore.load()` 擲錯時
  **不 throw**、發出一則告警、且不寫出任何檔案（FR-017 的讀取失敗分支）、（d）state 帶有
  `publish` 但時間戳為舊值（模擬核心段本次因節奏/guard 跳過）時仍正常寫出兩個檔案並沿用既有
  快照內容（FR-012），依賴 T018
- [X] T020 [US1] 新增 `src/publish/publish.module.ts`：`@Module({ imports: [StateModule,
  GithubModule, DiscordModule], providers: [RepoVisibilityService, PublishService], exports:
  [PublishService] })`（plan.md Project Structure，依賴 T007/T018；不 import 任何 LLM 模組，
  結構性滿足 FR-010）
- [X] T021 [US1] 在 `src/app.module.ts` 的 `imports` 新增 `PublishModule`，依賴 T020
- [X] T022 [US1] 在 `src/main.cli.ts` 新增 `PUBLISH_MODE=1` 分派分支（比照既有
  `NEWS_INGEST_OBSERVE` 慣例）：該分支呼叫 `app.get(PublishService).run()`、不跑
  `PipelineService`，且**一律以 0 結束**（不進入既有 `PipelineService` 失敗路徑的非零 exit 邏輯，
  research D10），依賴 T020
- [X] T023 [US1] 在 `.github/workflows/radar.yml` 新增獨立 `publish` job：`needs: radar`、
  `runs-on: ubuntu-latest`、`permissions: { contents: read, pages: write, id-token: write }`
  （**`contents: read` 不可省**——job 層 `permissions` 會整組取代 workflow 層的
  `contents: write`，未列出的 scope 一律為 `none`，兩個 `actions/checkout` 會失去 repo 讀取權；
  GitHub 官方 Pages 範本亦列此項）、`environment: github-pages`；步驟依序為
  checkout → checkout `state` 分支（`ref: state`、`path: state-branch`，唯讀，取 `radar` job
  剛 commit 的內容）→ **`Load state into workspace`：`mkdir -p state && cp
  state-branch/state/board.json state/board.json`**（比照 `radar` job 既有同名步驟；
  `StateStore` 讀的是 `process.cwd()/state/board.json`，而 code 分支**未追蹤**此檔，漏了這步
  `load()` 會靜默回退成 `emptyBoardState()` 並發佈出一份空頁，屬無聲錯誤輸出）→ setup-node →
  `npm ci` → `npm run build` →
  `PUBLISH_MODE=1 node dist/main.cli.js`（env 含 `GITHUB_REPOSITORY: ${{ github.repository }}`
  與既有五個 secrets）→ `Upload Pages artifact`（`actions/upload-pages-artifact@v3`，
  `if: hashFiles('public/index.html') != ''`）→ `Deploy to GitHub Pages`
  （`actions/deploy-pages@v4`，同一 `if` 條件）（contracts/publish-orchestration.md C1/C4，
  依賴 T022；**不**新增任何寫回 `state` 分支的步驟）

**Checkpoint**：US1 可獨立測試——quickstart.md 情境 1 應可通過（頁面正確呈現、空狀態不報錯、
`public/feed.xml` 產生但暫為 0 entries）。

---

## Phase 4: User Story 2 - 以 RSS/Atom 訂閱雷達更新 (Priority: P2)

**Goal**：feed 涵蓋今日精選新聞、新進榜、竄升三類事件，entry 識別鍵跨執行穩定（重跑不重複、
重回榜再現），上限 50 筆滾動修剪。

**Independent Test**：quickstart.md 情境 2——重跑同一份 state，`feed.xml` entry 清單不變；
手動追加一筆日期不同的榜單事件，重跑後兩筆 id 不同的 entry 同時出現；任一 RSS/Atom reader 可
正確解析。

### Implementation for User Story 2

- [X] T024 [P] [US2] 新增 `src/publish/feed-entry.ts`：
  `newsFeedId(normalizedUrl): string`（`"news:" + normalizedUrl`）、
  `boardFeedId(repoId, kind, dateLabel): string`（`"repo:" + repoId + ":" + kind + ":" +
  dateLabel`）、
  `makeBoardFeedEntries(diff: BoardDiff, dateLabel: string, now: Date): FeedEntry[]`（僅
  `newcomer`/`climbed`，`declined` 不產生，FR-003；title 依 kind 組
  「{fullName} 新進榜」／「{fullName} 竄升」）、
  `makeNewsFeedEntries(items: CuratedNewsItem[], now: Date): FeedEntry[]`（一則新聞一筆，
  title 為新聞原標題；**id MUST 為 `newsFeedId(normalizeTargetUrl(item.url))`**——正規化在此
  函式內完成，重用既有 `src/news/url-normalize.ts`，FR-004「新聞以正規化目標 URL 為識別鍵」；
  直接用原始 `url` 會讓同一則新聞從不同來源進來時 id 不穩定，SC-002 失效。`FeedEntry.url` 仍存
  **未正規化**的 `item.url`（訪客要點的是原連結，正規化只用於識別鍵））、
  `trimFeed(entries: readonly FeedEntry[], limit = 50): FeedEntry[]`（超出上限時從陣列前端
  移除最舊者）（data-model.md §2.2/2.3，research D8/D9）。
  **`ChangeKind` → GUID `kind` 的映射固定為 `newcomer → 'new'`、`climbed → 'climbed'`**
  （`declined` 無映射），對應 `FeedEntry.type` 的 `'board-new'`／`'board-climbed'`；此字串一旦
  發佈即為對外契約，**日後不得更名**（改了等於所有既有 entry 在訂閱者的 reader 中重新出現一次）
- [X] T025 [P] [US2] 新增 `src/publish/feed-entry.spec.ts`：GUID 格式（`news:`/`repo:` 前綴不
  碰撞）、**榜單 id 的字面樣式為 `repo:{repoId}:new:{dateLabel}`／`repo:{repoId}:climbed:
  {dateLabel}`**（以字面斷言鎖住 `newcomer → 'new'` 映射，避免日後重構時無聲改名）、
  **同一則新聞的兩個等價原始 URL（例如帶 `?utm_source=` 追蹤參數與不帶）產生同一個 id**
  （驗 `normalizeTargetUrl` 確實被套用）、`declined` 不產生 entry、`trimFeed` 超過 50 筆移除
  最舊、同一 repo 不同 `dateLabel`（跨天重回／再次竄升）產生不同 id，依賴 T024
- [X] T026 [US2] 擴充 `src/diff/board-commit.ts`：`commitBoardPush` 再新增 `diff: BoardDiff`
  參數，`next.publish.feed = trimFeed([...(state.publish?.feed ?? []),
  ...makeBoardFeedEntries(diff, dateLabel, pushedAt)], 50)`（`dateLabel` 用
  `taipeiDateLabel(pushedAt)`，與封面組版同源，state-write-contract.md C1 完整版），
  依賴 T009/T024
- [X] T027 [US2] 更新 `src/diff/board-commit.spec.ts`：`publish.feed` 正確併入榜單事件、
  `declined` 排除、修剪至 50，依賴 T026
- [X] T028 [US2] 更新 `src/pipeline/board-segment.service.ts`（同一 `commitBoardPush` 呼叫點）
  補傳既有作用域內已算好的 `diff`（L73），依賴 T026
- [X] T029 [US2] 擴充 `src/pipeline/news-segment.service.ts` push-then-commit 區塊：
  `state.publish.feed = trimFeed([...(state.publish?.feed ?? []),
  ...makeNewsFeedEntries(digest.items, now)], 50)`（state-write-contract.md C2 完整版），
  依賴 T012/T024
- [X] T030 [US2] 更新 `src/pipeline/news-segment.service.spec.ts`：`publish.feed` 正確併入新聞
  entries、與既有榜單 entries 疊加後修剪至 50，依賴 T029
- [X] T031 [US2] 更新 `src/publish/render-feed.ts`（延伸 T016）：確認 entry 映射——
  `id`＝`FeedEntry.id`、`title`＝`FeedEntry.title`、`link`＝`FeedEntry.url`、
  `date`＝`FeedEntry.publishedAt`，不帶任何星數欄位（`FeedEntry` schema 本身無此欄位，
  型別層面已排除，feed-page-contract.md C2），依賴 T016/T024
- [X] T032 [US2] 更新 `src/publish/render-feed.spec.ts`：填入榜單+新聞混合 entries 的快照
  （新到舊排序、三種 title 樣式皆正確），依賴 T031
- [X] T033 [US2] 依 quickstart.md 情境 2 步驟 1-5 手動驗證：重跑不重複、重回榜再現、任一
  RSS/Atom reader 可解析（記錄驗證結果，不產生新程式碼），依賴 T023/T032

**Checkpoint**：US1＋US2 皆可獨立運作——feed 內容正確、去重與重現語意皆成立（SC-002/SC-006）。

---

## Phase 5: User Story 3 - repo 轉為 private 時自動停止發佈 (Priority: P3)

**Goal**：repo 切為 private 時發佈自動靜默停用；可見性查詢失敗與部署動作本身失敗皆須告警
（不得無聲失敗，憲章 VII）；核心推播段與 state 完全不受影響。

**Independent Test**：quickstart.md 情境 3——可見性查詢回 `private` 時不產生 `public/`、不告警、
exit 0；查詢本身失敗時同樣不產生 `public/`、但收到一則紅色告警。

### Implementation for User Story 3

- [X] T034 [P] [US3] 在 `.github/workflows/radar.yml` 的 `publish` job、`Deploy to GitHub Pages`
  步驟之後新增 `Alert on deploy failure` 步驟：`if: failure()`，`curl` 一則固定內容的紅色 embed
  至 `DISCORD_ALERT_WEBHOOK_URL`（不經過 `PublishService`，因為該 process 早已以 exit 0 結束，
  contracts/publish-orchestration.md C5、research D10a；補齊 CHK009/CHK022 缺口）
- [ ] T035 [P] [US3] 在 `src/publish/publish.service.spec.ts`（延伸 T019）新增隔離回歸測試：
  給定 `visibility` 為 `'private'` 或 `'unknown'`，斷言 `stateStore.save()`／
  `discord.send()`（`'news'`/`'board'` channel）**皆未被呼叫**（US3 AS1/AS2、
  contracts/publish-orchestration.md C1「發佈段對 state 唯讀」），依賴 T018
- [ ] T036 [US3] 依 quickstart.md 情境 3 步驟（3a/3b）手動驗證：private 靜默跳過（無告警）、
  可見性查詢失敗告警（收到紅色 embed）、且同期間 `state/board.json` 與 Discord
  新聞／榜單頻道完全無動作，依賴 T023/T034/T035

**Checkpoint**：三個 User Story 皆可獨立驗證；FR-017 告警涵蓋範圍完整（含部署失敗分支）。

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**：收尾檢查，不引入新行為。

- [ ] T037 [P] 執行 `npm run build && npm test`，確認全專案（含既有 F1-F7 測試）無迴歸
- [ ] T038 依 quickstart.md 情境 4 人工檢查最終 `.github/workflows/radar.yml`：`publish` job 的
  `needs`／`permissions`／`environment`／兩個 `if: hashFiles(...)` 條件／新增的
  `if: failure()` 告警步驟皆存在，且未新增任何寫回 `state` 分支的步驟
- [ ] T039 [P] 覆核 FR-008：確認 `render-page.ts`／`render-feed.ts`／`publish.service.ts` 三檔
  皆未讀取 `GH_API_TOKEN`／`DISCORD_*_WEBHOOK_URL` 等機密環境變數，僅讀取 `state`（發佈產物不含
  機密的程式邏輯保證）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**：無依賴，可立即開始。
- **Foundational (Phase 2)**：依賴 Setup 完成（`feed` 套件雖到 US1/US2 才用到，但不影響
  Foundational 內部任務可先行）——**封鎖**所有 User Story。
- **User Story 1 (Phase 3)**：依賴 Foundational 完成；為 MVP，建議優先完成。
- **User Story 2 (Phase 4)**：依賴 Foundational 完成；亦依賴 US1 已建好的
  `render-feed.ts`/`publish.service.ts`/workflow `publish` job 骨架（T016/T018/T023）——本
  Feature 因 contracts C3「index.html 與 feed.xml 全有或全無」之設計限制，US2 在檔案結構上
  建立於 US1 之上，但**驗收範圍**彼此獨立（US1 不要求 feed 有內容，US2 才要求）。
- **User Story 3 (Phase 5)**：依賴 Foundational 完成；依賴 US1 的 `publish.service.ts`/
  workflow `publish` job（T018/T023）已存在（新增告警步驟與隔離回歸測試皆建立於既有骨架上）。
- **Polish (Phase 6)**：依賴所有欲交付的 User Story 完成。

### Within Each User Story

- US1：schema 寫入（T009-T013）與純渲染函式（T014-T017）可平行 → 兩者收斂於編排服務
  T018 → 模組/CLI/workflow 佈線（T020-T023）。
- US2：`feed-entry.ts` 純函式（T024-T025）先行 → 核心段寫入擴充（T026-T030）與
  `render-feed.ts` entry 映射（T031-T032）依賴它 → 最後端到端驗證（T033）。
- US3：workflow 告警步驟（T034）與隔離回歸測試（T035）可平行 → 端到端驗證（T036）收斂。

### Parallel Opportunities

- Foundational：T002/T004/T005/T006/T008 可平行（各自不同檔案，T004 依賴 T003 完成後才有意義
  但檔案不同仍可平行撰寫）。
- US1：T014/T015（`render-page.ts`）與 T016/T017（`render-feed.ts`）可平行；T009-T013
  （schema 寫入端）與 T014-T017（純渲染函式）互不依賴，可平行推進，最後在 T018 收斂。
- US2：T024/T025（`feed-entry.ts`）完成後，T026-T028（榜單段）與 T029-T030（晨報段）可平行。
- US3：T034（workflow YAML）與 T035（隔離測試）可平行。

---

## Parallel Example: User Story 1

```bash
# Foundational 完成後，US1 可同時展開兩條平行線：
Task: "新增 src/publish/render-page.ts 與 render-page.spec.ts（T014/T015）"
Task: "新增 src/publish/render-feed.ts 與 render-feed.spec.ts（T016/T017）"
# 與此同時，另一條平行線處理核心段狀態寫入：
Task: "擴充 src/diff/board-commit.ts 的 commitBoardPush 加 summary 參數（T009/T010/T011）"
Task: "擴充 src/pipeline/news-segment.service.ts 寫入 state.publish.news（T012/T013）"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. 完成 Phase 1（Setup）＋ Phase 2（Foundational，封鎖項）。
2. 完成 Phase 3（US1）。
3. **停下並驗證**：quickstart.md 情境 1（含空狀態）。
4. 部署（`main` 尚未 merge 前，可先在 feature branch 用本機 `PUBLISH_MODE=1` 驗證，不必等
   workflow 實際跑過 Pages 部署）。

### Incremental Delivery

1. Setup + Foundational → 基礎就緒。
2. 加 US1 → 獨立驗證（頁面可看、空狀態不報錯）→ MVP。
3. 加 US2 → 獨立驗證（feed 內容正確、去重/重現語意成立）。
4. 加 US3 → 獨立驗證（private 靜默、查詢/部署失敗皆告警）。
5. Polish → 全專案迴歸檢查、workflow 結構人工複查、機密洩漏覆核。

---

## Notes

- `[P]` 任務＝不同檔案、彼此無阻塞依賴。
- `[Story]` 標籤把任務對應回 spec.md 的 User Story，供追溯。
- `commitBoardPush`（`src/diff/board-commit.ts`）依設計決策（plan.md Complexity Tracking）
  維持**單一函式、不拆成組裝函式**——因此 US1（T009）與 US2（T026）對它的擴充是**同一函式的
  兩次漸進式簽章變更**，而非兩個獨立元件，這是本 Feature 唯一刻意違反「每個 Story 完全獨立
  改動不同檔案」原則之處，原因見 plan.md 該表格列 2。
- 每完成一個 Phase／User Story 即建立一個 commit（CLAUDE.md `/speckit-implement` 分段
  commit 規則），commit scope 為 `008-pages-publish`。
- 本 tasks.md 產出前已對 spec.md/plan.md/research.md/data-model.md/contracts/ 完成
  `/speckit-checklist` 逐項核對（見 `checklists/pre-tasks-gate.md`），CHK009/CHK022（部署失敗
  告警缺口）已於 T034 補上；CHK003/CHK005/CHK029 已於 2026-08-04 `/speckit-analyze` 後續修訂
  補齊（spec Assumptions、research D3「輸入層級缺失」、FR-015/016 各補一條 Acceptance Scenario），
  其餘 4 項（CHK004/013/014/023）經覆核確認為刻意不處理，理由見該 checklist 總結。
- 同一輪 `/speckit-analyze` 修訂另調整了 T002/T003/T007/T008/T014/T015/T018/T019/T023/T024/T025
  的任務描述（state 載入步驟、`contents: read`、`load()` 納入 try、`.max(50)` 移除、GUID 正規化
  與 `kind` 映射、降級新聞呈現、FR-012 回歸案例）——實作時請以現行描述為準。
