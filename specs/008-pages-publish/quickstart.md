# Quickstart: GitHub Pages 儀表板 + RSS/Atom 發佈

**Feature**: 008-pages-publish

本檔驗證發佈段端到端運作，對應 spec 的三個 User Story。細節見 `contracts/`（內容契約）與
`data-model.md`（型別）；本檔不重複列實作程式碼。

## 前置準備

1. `npm ci && npm run build`（一般專案建置，見 CLAUDE.md）。
2. GitHub repo Settings → Pages → Source 選「GitHub Actions」（一次性人工設定，非本 Feature
   自動化範圍，dev-guide §14.3 已註記）。
3. 本機驗證不需真的部署到 Pages——`PublishService` 產出的是本機檔案（`public/index.html`、
   `public/feed.xml`），可直接用瀏覽器開啟檔案或起一個靜態伺服器檢視。

## 情境 1：US1——public repo、已有推播快照 → 頁面正確呈現

```bash
# 1. 準備一份含 board/intros/publish 的 state/board.json（可用既有 state 分支快照，
#    或跑一次 npm run build && node dist/main.cli.js 讓核心段先產出真實資料）。

# 2. 模擬 publish job 的環境變數並執行發佈段：
GITHUB_REPOSITORY="<owner>/<repo>" \
GH_API_TOKEN="<fine-grained PAT>" \
DISCORD_ALERT_WEBHOOK_URL="<alert webhook>" \
DISCORD_NEWS_WEBHOOK_URL="<placeholder>" \
DISCORD_BOARD_WEBHOOK_URL="<placeholder>" \
GEMINI_API_KEY="<placeholder>" \
PUBLISH_MODE=1 node dist/main.cli.js
```

**預期**：`public/index.html`、`public/feed.xml` 產生；打開 `index.html` 可見推播榜（依 AI／
前後端分區）、上次榜單變化摘要、今日精選新聞（含產生時間標示）；內容與該次 state 快照的
`state.publish` 一致（見 `contracts/feed-page-contract.md` C1）。

**驗證空狀態**（Acceptance Scenario 2）：state 為 `emptyBoardState()` 時重跑，`index.html` 三區塊
皆顯示「尚無資料」樣式文案，流程仍以 exit 0 結束、`public/` 兩個檔案仍正常產生。

## 情境 2：US2——feed 訂閱、重跑不重複、重回榜再現

1. 執行情境 1 的指令一次，記錄 `public/feed.xml` 內的 entry `id` 清單。
2. **不改變 state**、重跑同一指令。
3. **驗證**：`feed.xml` 的 entry 清單與步驟 1 完全相同（因為 `state.publish.feed` 未變——
   feed entries 只在核心段推播成功時才新增，重跑發佈段本身不寫 state，見
   `contracts/publish-orchestration.md` C1）。
4. 模擬「某 repo 掉出榜後於日後重回」：手動在 state 的 `feed` 陣列追加一筆
   `id: "repo:{repoId}:new:2026-08-11"`（比對 §1 已存在的 `id: "repo:{repoId}:new:2026-08-04"`），
   重跑發佈段，**驗證**兩筆 id 不同的 entry 同時出現在 `feed.xml`（對應 spec Acceptance
   Scenario 4／SC-006）。
5. 用任一 RSS/Atom reader（或線上驗證器）訂閱本機 `feed.xml`（file:// 或本機靜態伺服器 URL），
   確認能正確解析、entry 標題／連結可讀。

## 情境 3：US3——repo 切為 private 自動停止發佈

> ⚠️ 以下兩段指令**必須帶齊 `envSchema` 的五項必填機密**（三個 Discord webhook ＋
> `GH_API_TOKEN` ＋ `GEMINI_API_KEY`）。這五項的驗證發生在 `NestFactory.createApplicationContext()`
> 階段、早於 `PUBLISH_MODE` 分派，缺任一項會 fail-fast 並以 **exit 1** 結束，就驗不到下面要驗的
> 東西了。三個 webhook 需符合 Discord webhook URL 格式，`DISCORD_NEWS/BOARD` 用格式合法的
> placeholder 即可（發佈段不會用到它們）。

```bash
# 情境 3a：可見性查詢回 private（可用測試用 private repo，或於 RepoVisibilityService 測試中 mock）
GITHUB_REPOSITORY="<owner>/<private-test-repo>" \
GH_API_TOKEN="<token with read access>" \
DISCORD_ALERT_WEBHOOK_URL="<alert webhook>" \
DISCORD_NEWS_WEBHOOK_URL="<placeholder>" \
DISCORD_BOARD_WEBHOOK_URL="<placeholder>" \
GEMINI_API_KEY="<placeholder>" \
PUBLISH_MODE=1 node dist/main.cli.js
```

**預期**：不產生 `public/` 任何檔案；exit code 0；**不**送出 Discord 告警（FR-017 靜默分支）；
Actions log／CLI stdout 有一筆記錄可查。

```bash
# 情境 3b：可見性查詢失敗（GITHUB_REPOSITORY 指向不存在的 repo，或暫時撤銷 GH_API_TOKEN 權限）
GITHUB_REPOSITORY="<owner>/does-not-exist" \
GH_API_TOKEN="<token>" \
DISCORD_ALERT_WEBHOOK_URL="<alert webhook>" \
DISCORD_NEWS_WEBHOOK_URL="<placeholder>" \
DISCORD_BOARD_WEBHOOK_URL="<placeholder>" \
GEMINI_API_KEY="<placeholder>" \
PUBLISH_MODE=1 node dist/main.cli.js
```

**預期**：不產生 `public/` 任何檔案；exit code 0；**收到**一則紅色告警 embed（FR-017 告警分支）。

**同分支的另一個入口**（research D3「輸入層級缺失」）：完全不設 `GITHUB_REPOSITORY`（其餘五項
機密照帶）重跑，預期結果與 3b 相同——不產生 `public/`、exit 0、收到一則紅色告警；差別只在於
此時**不會發出任何 GitHub API 請求**。

**驗證「不影響核心推播段」**（Acceptance Scenario 2）：情境 3a/3b 執行期間，`state/board.json`
與 Discord 新聞／榜單頻道完全沒有任何動作——這在架構上是自動成立的（`publish` 是獨立 job，
`PublishService` 對 state 只讀，見 `contracts/publish-orchestration.md` C1），不需要額外驗證步驟，
只需確認 `PublishService` 程式碼路徑內確實沒有任何 `stateStore.save()` 或 `discord.send()` 呼叫。

## 情境 4：workflow 層整合（人工檢查，非自動化測試）

檢查 `.github/workflows/radar.yml` 新增的 `publish` job：
- `needs: radar`。
- 有 `permissions: { contents: read, pages: write, id-token: write }`（**`contents: read` 不可
  漏**——job 層 `permissions` 會取代 workflow 層的 `contents: write`，漏了兩個 checkout 會失去
  repo 讀取權）、`environment: github-pages`。
- 有把 state 載入工作區的步驟（`mkdir -p state && cp state-branch/state/board.json
  state/board.json`，比照 `radar` job 既有同名步驟）——**漏了這步不會報錯**，只會靜默發佈出一份
  空頁（`StateStore` 找不到 `state/board.json` 時回退為 `emptyBoardState()`）。
- `Upload Pages artifact`／`Deploy to GitHub Pages` 兩步驟皆帶
  `if: hashFiles('public/index.html') != ''`（見 `contracts/publish-orchestration.md` C4）。
- 部署兩步驟之後有一個 `if: failure()` 的告警 step，失敗時會 `curl` 一則紅色 embed 到
  `DISCORD_ALERT_WEBHOOK_URL`（見 `contracts/publish-orchestration.md` C5／research D10a，補
  FR-017／US3 AS2 的部署失敗告警分支）。
- 未新增任何寫回 `state` 分支的步驟（與現有 `radar` job 的「Commit state」步驟對照，`publish`
  job 不應有對應步驟）。

## 單元測試涵蓋範圍對照（憲章 VIII，實作階段以 tasks.md 落實）

- `trimFeed`／`makeBoardFeedEntries`／`makeNewsFeedEntries`／`newsFeedId`／`boardFeedId`：純函式
  單測。
- `commitBoardPush` 擴充後的快照測試：`publish.boardSummary`／`publish.feed` 正確性。
- `news-segment.service.ts` 擴充：mock `discord.send` 成功後 `state.publish.news`／`feed` 正確
  賦值。
- `RepoVisibilityService`：mock `GithubHttpService.getJson` 三種結果（public/private/擲錯），
  加上 `GITHUB_REPOSITORY` 未設定／格式不含 `/` → `'unknown'` 且不發請求。
- `PublishService`：`load()` 擲錯時不 throw、發告警、不寫檔（FR-017 讀取失敗分支）；核心段本次
  跳過（時間戳為舊值）時仍正常產出兩個檔案（FR-012）。
- `renderPage`／`renderFeed`：快照測試，含空狀態、含 HTML escape、含 `content: null` 的降級新聞。
- `boardStateSchema` 向後相容：不含 `publish` 鍵的既有 fixture 仍能 `safeParse` 成功。
