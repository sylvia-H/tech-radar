# Research: GitHub Pages 儀表板 + RSS/Atom 發佈

**Feature**: 008-pages-publish | **Date**: 2026-08-04

本檔解決 Technical Context 的未定決策。憲章與 dev-guide §14 已釘死大方向（NestJS CLI job、
`feed` 套件、`upload-pages-artifact` + `deploy-pages`、僅 public 啟用、完全隔離末段）；本檔聚焦
「怎麼接進既有架構」的落地決策。

## D1：發佈段是獨立 GitHub Actions job，還是 pipeline 內第三段？

**Decision**：獨立 job（`publish`），`needs: radar`，**不是** `PipelineService` 內的第三個 segment。

**Rationale**：
- dev-guide §14.1 字面即要求「完全隔離的末段（獨立 job／最後步驟）」。
- `upload-pages-artifact` / `deploy-pages` 是 GitHub Actions 原生 action，無法從 npm 套件內呼叫，
  本來就得是 workflow 層的 job/step。
- Job 級隔離比 in-process try/catch 更強：`radar` job 的 commit 早在 `publish` job 開始前就已經
  完成並 push，`publish` job 無論怎麼失敗都物理上不可能影響到它（連「同一個 process 內的共享
  物件」這種都不存在）。FR-007「發佈段對 state 唯讀」在此架構下是**結構性成立**，不需要額外程式
  碼保證。

**Alternatives considered**：
- 併入 `PipelineService` 第三段（`PublishSegmentService`，仿 F7 `BoardSegmentService`/
  `NewsSegmentService`）：省一次 `actions/checkout`＋`npm ci`，但拿掉了「Pages 部署 action 只能在
  workflow 層跑」這個硬限制的自然邊界，得自己在程式碼裡再造一層「不准寫 state」的紀律，且 job 失敗
  時的 Actions UI 呈現（單一 job 混雜核心推播與發佈兩種語意的失敗）不利於維運判讀。否決。

## D2：發佈段的程式進入點

**Decision**：沿用既有單一入口 `dist/main.cli.js`，以環境變數旗標分派——比照 `main.cli.ts` 現有
的 `NEWS_INGEST_OBSERVE` 慣例，新增 `PUBLISH_MODE=1` 時改跑 `PublishService`，不跑
`PipelineService`。

**Rationale**：專案只有一個編譯輸出、一個 `npm run build`；新增第二個 `main.*.ts` 入口需要多一組
`tsc` 輸出路徑與 `package.json` script，而環境變數分派這個模式在 codebase 裡已有先例
（`main.cli.ts:8-9,26-29`），維持單一入口對這個「零維運」專案更省事。

**Alternatives considered**：獨立 `main.publish.cli.ts` 編譯出 `dist/main.publish.cli.js`：關注點
分離更乾淨，但多一個 build 產物、多一份 `bootstrap()` 樣板，對單人自用專案是不必要的重複。否決
（見 Complexity Tracking 的簡化偏好）。

## D3：repo 可見性查詢

**Decision**：新增 `RepoVisibilityService`，重用既有 `GithubHttpService.getJson<{ private: boolean }>`
打 `GET /repos/{owner}/{repo}`（`GithubModule` 已提供單例，含重試/退避/UA，不新增 HTTP 客戶端）。
`owner/repo` 取自 GitHub Actions 自動提供的 `GITHUB_REPOSITORY` 環境變數，新增為 `envSchema` 的
**選用**欄位（非機密，不比照五個必填機密）。查詢結果 `private === false` 視為 public；`private`
缺失、格式不符、或請求本身擲錯（`GithubHttpError`／網路錯誤）一律視為「無法確認為 public」。

**輸入層級缺失（2026-08-04 補定，原 checklist CHK005）**：`GITHUB_REPOSITORY` 未設定、或格式不含
`/`（拆不出 `owner`/`repo`）時，**不發請求、直接回 `'unknown'`**——與回應層級的異常共用同一個出口，
因此也會走 `bestEffortFailureAlert` 告警分支。刻意**不**為它另立一條「靜默跳過」分支：判斷
「本次能不能安全發佈」只該有一套邏輯，多一條靜默路徑就多一種「發佈長期停擺而無人知曉」的失效
模式（正是 FR-017 要防的）。已知代價：在本機以 `PUBLISH_MODE=1` 執行卻沒設 `GITHUB_REPOSITORY`
時，每跑一次就會送出一則紅色告警；這在自用專案是可接受的噪音（本機驗證本就該照 quickstart 帶齊
環境變數，或把 `DISCORD_ALERT_WEBHOOK_URL` 指向 placeholder）。

`GITHUB_REPOSITORY` 同時是 D4 `pagesUrl`（`https://{owner}.github.io/{repo}/`）的唯一來源；由於
渲染發生在可見性查詢回 `'public'` 之後，走到該步時 `owner`/`repo` 必定已成功解析，`pagesUrl`
不需要再處理一次缺值。

**Rationale**：與專案既有「所有 GitHub 呼叫走同一個節流客戶端」的規則一致（`GithubModule` docstring
明講這是為了共享 rate-limit 節流狀態，憲章 I）；用既有型別化客戶端也讓這段查詢能以 mock 單測
（憲章 VIII），不必额外引入 `gh` CLI 或裸 `curl` 步驟。

**Alternatives considered**：在 workflow 用 `curl`/`gh api` 做可見性查詢（bash 步驟，省一次
`npm ci`/`build`）：能在裝依賴前快速失敗、省幾十秒 CI 分鐘，但這點分鐘數對「零維運免費基礎設施」
的用量護欄毫無意義，卻要多維護一套與程式內查詢邏輯重複的判斷（bash 版與 TS 版兩份「怎麼算 public」
的邏輯，容易日後不同步）。否決，選擇「單一套邏輯、可測試」。

## D4：feed.xml 產生方式

**Decision**：用 `feed`（npm，dev-guide/憲章已釘死）建構 `Feed` 物件，輸出 **Atom**
（`feed.atom1()`）存成 `feed.xml`。每則 entry 的 `id`／`link`／`title`／`date` 對應 FR-004 定義的
識別鍵；**entry 不帶任何星數/數值指標**（FR-016）。Feed 層級 `id`/`link` 用
`https://{owner}.github.io/{repo}/`（由 `GITHUB_REPOSITORY` 推導，不新增設定）。

**Rationale**：Atom 的 `<id>`/`<updated>` 語意就是為「跨執行穩定識別＋去重」設計，與 FR-004 的需求
直接對應；`feed` 套件的 `addItem({id, link, title, date})` 一次呼叫即可同時滿足 Atom/RSS 慣例讀者
（reader 對 Atom `<id>` 或 RSS `<guid>` 的去重行為一致）。

**Alternatives considered**：輸出 RSS 2.0（`feed.rss2()`）：RSS `<guid>` 語意等價可用，純粹命名慣例
差異，非技術性分歧；選 Atom 只因其欄位命名更貼近本 feature 的用詞（stable id），不影響任何 FR。

## D5：儀表板頁面渲染方式

**Decision**：純函式 `renderPage(state, now) => string`，樣板字面值組 HTML（無前端框架、無建置
步驟），內聯 `<style>`，所有插入文字一律經過 HTML escape。

**Rationale**：dev-guide §14.2「免前端框架、關掉 JS 也能看」已定調；純函式輸入輸出便於快照測試
（憲章 VIII）。escape 是防禦性措施——雖然內容來自我方 LLM 策展／簡介，但這是公開網頁的呈現層，
沒有理由對插入文字的字元集做假設。

**Alternatives considered**：引入靜態網站產生器（Eleventy/Astro）：對「單頁儀表板、無需路由/分頁」
的需求是明顯過度設計，且新增建置步驟與相依，違反「一切從簡」與零維運前提。否決。

## D6：狀態欄位擴充（FR-013/014）

**Decision**：`BoardState` 新增**選用**欄位 `publish?: PublishState`，內含：
- `news?: { items: CuratedNewsItem[]; generatedAt: string }`——直接重用 F6 既有 `CuratedNewsItem`
  型別，不新定義形狀（同一批資料，FR-002/009）。
- `boardSummary?: { summary: string; generatedAt: string }`——`summary` 即 F6
  `BoardChangeSummary.summary`（已推去 Discord 封面的同一句 TL;DR），不重新計算。
- `feed?: FeedEntry[]`——上限 50、沿用「修剪」慣例（詳 data-model.md）。

`boardStateSchema` 只需在既有五個必填根欄位之外，加一個 `publish: publishStateSchema.optional()`；
`.optional()` 保證缺此欄位的既有 state 檔（今天的 `state/board.json` 就是一例）能被
`boardStateSchema.safeParse` 無錯載入，滿足 FR-014 與憲章 VI「壞檔不覆寫」不受影響（壞檔判定邏輯
本身不動，只是根層多一個可為 `undefined` 的欄位）。

**Rationale**：spec Clarifications 已定案「核心段寫、發佈段唯讀」；欄位形狀盡量重用既有型別，減少
「兩份幾乎一樣的資料形狀」的維護成本（一切從簡）。

## D7：誰在核心段寫入 `publish` 欄位

**Decision**：
- **榜單段**：擴充 `commitBoardPush(state, pushBoard, pushedAt, diff, summary)`（新增
  `diff: BoardDiff`、`summary: BoardChangeSummary` 兩個參數，呼叫端 `board-segment.service.ts`
  在其既有作用域內都已算好）。純函式內部：`boardSummary` 直接取 `summary.summary`；從
  `diff.changes` 過濾 `kind !== 'declined'` 產生榜單 feed entries（見 D9 GUID 規則），併入既有
  `state.publish.feed` 並修剪至 50。回傳的新 `BoardState` 仍是唯一寫回轉換點，維持其現有
  docstring 承諾的性質。
- **晨報段**：`news-segment.service.ts` 既有「push-then-commit」區塊（推播成功後、`save()` 前）
  加兩行：設定 `state.publish.news`、把 `digest.items` 轉成 feed entries 併入
  `state.publish.feed` 並修剪至 50。不新增 `save()` 呼叫，沿用既有單次寫回。

**Rationale**：兩段本來就各自「推播成功後才寫回」，這正是 FR-013「與既有狀態寫回屬同一次原子寫入」
的自然落點；不需要新的編排層或第三次 `save()`。

**Alternatives considered**：新增獨立的「發佈資料組裝」服務，在兩段之外另跑一次、自己 `save()`：
會製造第三次寫回時機，與 F7 既有「至多兩次 save」的設計約束衝突，且要重新面對「這次 save 前另一段
是否已完成」的競態問題（目前完全不存在，因為兩段本就循序執行、共用同一個 `state` 物件）。否決。

## D8：feed 修剪規則

**Decision**：新增純函式 `trimFeed(entries, limit = 50)`：超出上限時**從陣列前端**移除最舊者
（陣列本身依寫入順序追加於尾端＝由舊到新）。與既有 `pruneSeenNews`（依時間戳修剪）不同——feed 是
「筆數上限」而非「保留天數」，故不能重用同一函式，另立一個小純函式。

**Rationale**：FR-005 明講是「數量上限」不是「天數上限」，两种修剪語意不同，硬套 `pruneSeenNews`
反而要塞一個假的 `retentionDays` 概念進去，不如各自表述來得直接。

## D9：feed entry 的 GUID 構成與命名空間

**Decision**：
- 新聞 entry：`id = "news:" + normalizeTargetUrl(item.url)`。正規化在 `makeNewsFeedEntries`
  內部完成（重用 `src/news/url-normalize.ts`，與 `seenNews` 記鍵同源）；`FeedEntry.url` 保留
  未正規化的原始連結供訪客點擊。
- 榜單 entry：`id = "repo:" + repoId + ":" + kind + ":" + dateLabel`（`kind` 為 `new`/`climbed`，
  由 `ChangeKind` 的 `newcomer`/`climbed` 映射而來——映射表見 data-model.md §2.2，字串屬對外
  契約、日後不得更名；`dateLabel` 為 `taipeiDateLabel(now)`，與該次推播封面使用的同一個日期
  字串一致，避免 UTC/台北時區不一致造成同日兩個不同日期字串）。

**Rationale**：spec Clarifications 已定案 GUID 需含事件型別與日期。前綴 `news:`/`repo:` 是為了讓
兩種識別鍵語意上不同來源卻共用同一個 `feed` 陣列時，命名空間不會意外碰撞（即使機率趨近於零，
前綴的成本幾乎是零，能徹底排除疑慮就一併做掉）。

## D10：發佈失敗的告警與結束狀態

**Decision**：`PublishService.run()` 內部完整 try/catch：
- 可見性查得 `private` → 靜默 return（`console`/`Logger` 記一筆即可，不呼叫 Discord）。
- 可見性查詢本身擲錯 → `bestEffortFailureAlert`（沿用既有共用函式）後 return（不 rethrow）。
- 渲染／寫檔任一步驟擲錯 → 同樣 `bestEffortFailureAlert` 後 return（不 rethrow）。
- 全數成功 → 寫出 `public/index.html`、`public/feed.xml`。

CLI 進入點在 `PUBLISH_MODE=1` 分支**一律以 0 結束**（無論上述哪個分支），不像既有
`PipelineService` 失敗路徑那樣 rethrow 到頂層造成非零 exit。workflow 用「`public/index.html`
是否存在」（`hashFiles('public/index.html') != ''`）決定要不要跑
`upload-pages-artifact`/`deploy-pages`，不需要額外的 `$GITHUB_OUTPUT` 佈線。

**Rationale**：這與專案既有「來源隔離容錯」的慣例（best-effort 告警、不讓單一元件的失敗炸穿整個
process）完全一致（憲章 VII、`bestEffortFailureAlert` 現有用法）；用檔案是否存在做 workflow 層的
條件判斷，比額外寫 GITHUB_OUTPUT 更簡單，且「有沒有東西可以部署」本來就該用「有沒有產出檔案」來
判斷，語意直接對應。

**Alternatives considered**：CLI 在錯誤路徑非零 exit（讓 Actions UI 把 `publish` job 標成失敗、
更顯眼）：需要额外分辨「private 跳過」（該回 0）與「查詢/渲染失敗」（該回 1，且此時已發過告警）
两种結束碼，多一層判斷卻沒有換到實質好處——告警已經送了，Discord 才是本專案唯一在意的可見性管道
（憲章 VII「不得無聲失敗」講的是告警，不是 Actions UI 顯示紅叉）。保留給日後若真的需要 Actions UI
可見性時再加，目前不做。

### D10a：`actions/deploy-pages` 部署動作本身失敗時的告警（補充決策）

**問題**：`PublishService.run()` 的 try/catch（見上）只包住渲染／寫檔，跑在 Node process 內；
`actions/upload-pages-artifact`／`actions/deploy-pages` 是 `PublishService` 已經以 0 結束**之後**
才執行的獨立 workflow step，不在該 try/catch 範圍內。若這一步本身失敗（例如 Pages 未正確啟用、
GitHub 端暫時性錯誤），`PublishService` 早已送出「成功」訊號，不會呼叫 `bestEffortFailureAlert`
——會變成一種 D10 未涵蓋到的靜默失敗，違反 FR-017／US3 AS2「發佈執行失敗 MUST 告警」與憲章 VII。

**Decision**：`radar.yml` 的 `publish` job 在 `Deploy to GitHub Pages` step 之後，新增一個
`if: failure()` 的告警 step，直接以 `curl` POST 固定內容的紅色 embed 到
`DISCORD_ALERT_WEBHOOK_URL`（不經過 `PublishService`／`bestEffortFailureAlert`，因為此時 Node
process 早已結束）：

```yaml
- name: Alert on deploy failure
  if: failure()
  run: |
    curl -sS -X POST -H "Content-Type: application/json" \
      -d '{"embeds":[{"title":"⚠️ 發佈部署失敗","color":15548997,"description":"GitHub Pages 部署動作本身失敗，請查看本次 Actions 執行紀錄。"}]}' \
      "$DISCORD_ALERT_WEBHOOK_URL"
  env:
    DISCORD_ALERT_WEBHOOK_URL: ${{ secrets.DISCORD_ALERT_WEBHOOK_URL }}
```

`if: failure()` 在此上下文語意精確：`PublishService` 內部已處理的分支（private 跳過／可見性查詢
失敗／渲染寫檔失敗）皆以 exit code 0 結束，不會讓 job 進入 `failure()` 狀態；只有這一步之後、
workflow 層自身的 step（`actions/upload-pages-artifact`／`actions/deploy-pages`）失敗時才會觸發，
不需要额外用 step `id`／`outcome` 判斷來源。

**Rationale**：這是本 Feature 唯一一段「結構上不可能被既有 TS 錯誤處理路徑涵蓋」的失敗模式（部署
動作是 GitHub 官方 action，只能在 workflow 層執行，見 D1）；固定內容的 `curl` 呼叫沒有分支邏輯，
不會重蹈 D3「bash 版與 TS 版兩份判斷邏輯容易不同步」的覆轍——這裡沒有「判斷」，只有「失敗就發一則
固定訊息」，維護成本趨近於零，換得憲章 VII 在此失效模式下不再有缺口。

**Alternatives considered**：不處理，接受此失效模式僅反映於 Actions UI 紅叉：與 FR-017／US3 AS2
現有文字矛盾（兩者字面上已要求涵蓋「發佈執行失敗」），且憲章 VII 為非協商原則，不宜為求簡化而
默許一種靜默失敗。否決。
