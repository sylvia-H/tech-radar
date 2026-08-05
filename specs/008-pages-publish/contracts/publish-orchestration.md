# Contract: 發佈段編排（Publish Orchestration）

**Feature**: 008-pages-publish | Segment: `publish` GitHub Actions job → `PublishService.run()`

## C1. 觸發與隔離邊界

- `publish` job 為獨立 job，`needs: radar`，於 `radar` job 成功結束後才開始（workflow 層
  `needs`，非程式碼判斷）。
- `radar` job 失敗（含未成功 commit 狀態）時，`publish` job 依 GitHub Actions 預設行為不執行——
  這不違反 FR-007，因為此時根本沒有新狀態可發佈，行為等同「本次發佈沿用上次已提交的快照」
  （下次成功的 `radar` job 觸發時會自然補上）。
- `publish` job 內對 `state/board.json` **只讀**：以第二個 `actions/checkout`（`ref: state`、
  `path: state-branch`）取得 `radar` job 剛 commit 的最新內容，再比照 `radar` job 既有的
  `Load state into workspace` 步驟複製到工作區的 `state/board.json`
  （`mkdir -p state && cp state-branch/state/board.json state/board.json`），之後全程不寫回、
  不 commit、不 push（無這類 workflow 步驟）。
  **複製步驟 MUST NOT 省略**：`StateStore` 讀的路徑是 `process.cwd()/state/board.json`
  （`state.store.ts` 的 `DEFAULT_STATE_PATH`），而 code 分支並未追蹤 `state/board.json`——
  只 checkout 到 `state-branch/` 而不複製，`load()` 會靜默回退成 `emptyBoardState()`，
  發佈出一份「尚無資料」的空頁與 0 entries feed，且因不算失敗而不會告警（無聲錯誤輸出）。
- `publish` job 的 job 層 `permissions` MUST 同時列出 `contents: read`、`pages: write`、
  `id-token: write`：job 層 `permissions` 會整組**取代** workflow 層的 `contents: write`，
  未列出的 scope 一律為 `none`，漏了 `contents: read` 會使上述兩個 checkout 失去 repo 讀取權。

## C2. `PublishService.run()` 流程（永不 throw）

```
1. visibility = await RepoVisibilityService.check()
2. if visibility === 'private':
     log 一筆 info，return（不寫檔、不告警）——FR-017 靜默分支
3. if visibility === 'unknown':
     bestEffortFailureAlert('可見性查詢失敗，本次跳過發佈')，return（不寫檔）——FR-017 告警分支
     （`GITHUB_REPOSITORY` 未設定／格式不含 `/` 亦歸此分支，見 research D3）
4. try:
     state = await stateStore.load()          ← MUST 在 try 內（見下方「載入失敗」說明）
     pagesUrl = `https://{owner}.github.io/{repo}/`（owner/repo 取自 GITHUB_REPOSITORY；
                能走到這一步表示步驟 1 已成功解析出 owner/repo，故此處不會再缺值）
     html = renderPage(state, now)
     xml  = renderFeed(state, pagesUrl)
     寫入 public/index.html、public/feed.xml
   catch (err):
     bestEffortFailureAlert(`發佈失敗：${err.message}`)，return（不留半份 public/ 目錄——
     見 C3 的「全有或全無」寫入規則）
5. return（正常結束）
```

**載入失敗必須被同一個 `catch` 涵蓋**：`StateStore.load()` 遇壞檔會擲錯（憲章 VI「壞檔不覆寫」），
若把它留在 `try` 之外，`run()` 會違反自身「永不 throw」的不變式，且不會發出 FR-017 要求的告警
（FR-017 的「發佈執行失敗」涵蓋讀取狀態失敗、渲染失敗、寫檔失敗三者）。

**C2 不變式**：`run()` 呼叫端（CLI `PUBLISH_MODE=1` 分支）永遠以 exit code 0 結束（research D10）。
唯一的「失敗訊號」管道是 Discord 告警，不是 process exit code。

## C3. 檔案寫入的「全有或全無」規則

`public/index.html` 與 `public/feed.xml` 要嘛兩者都成功寫入，要嘛都不寫入——不留下只有一個檔案
的中間狀態。實作上：先各自渲染成字串（純函式、不碰檔案系統），確認兩者都成功產出字串後才依序
`fs.writeFile`。理由：workflow 用 `hashFiles('public/index.html')` 判斷「有沒有東西可以部署」
（見 C4），若 `feed.xml` 缺席但 `index.html` 存在，會部署出一個訪客點 feed 連結會 404 的網站。

**`index.html` MUST 最後寫（2026-08-04 補訂）**：兩次 `fs.writeFile` 本質上不是原子操作，光是
「兩份字串都已產出」不足以保證兩個檔案都落地——第二次寫入仍可能失敗。真正的保證來自**順序**：
把 workflow 的 gate 檔（`index.html`）留到最後寫，等於讓它兼任提交點，任一次寫入失敗都不可能留下
「有 `index.html` 卻缺 `feed.xml`」的組合，因此不可能部署出既有訂閱者全部 404 的站。順序即保證，
不需要 tmp+rename。**MUST NOT** 把 `index.html` 移回第一個寫。

## C4. Workflow 層的部署觸發條件

```yaml
- name: Upload Pages artifact
  if: hashFiles('public/index.html') != ''
  uses: actions/upload-pages-artifact@v3
  with:
    path: public

- name: Deploy to GitHub Pages
  if: hashFiles('public/index.html') != ''
  uses: actions/deploy-pages@v4
```

`private` 或 `unknown` 分支（C2 步驟 2/3）都不產生 `public/index.html`，故這兩個條件天然涵蓋
FR-006「查詢結果為 private、或查詢本身失敗，MUST 完整跳過本次發佈（不產生也不更新任何發佈產物）」
——不需要額外的 workflow 層 `if` 判斷可見性，檔案存在與否即是唯一的判斷依據（單一事實來源，不重複
判斷邏輯）。

## C5. 部署動作本身失敗的告警（補 FR-017／US3 AS2 的部署失敗分支）

C4 的兩個部署 step 之後，MUST 再加一個 `if: failure()` 的告警 step，直接 `curl` 一則固定內容的
紅色 embed 到 `DISCORD_ALERT_WEBHOOK_URL`（不經過 `PublishService`，因為 Node process 早已在此之前
以 exit 0 結束，見 research D10a）：

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

理由：`upload-pages-artifact`／`deploy-pages` 是 workflow 層自身的 step，失敗時不會經過
`PublishService` 的 try/catch（該 process 早已結束並回傳 0），是本 Feature 唯一「結構上不可能被
既有 TS 錯誤處理路徑涵蓋」的失敗模式。`if: failure()` 在此語意精確——C2 內部已處理的分支
（private 跳過／可見性查詢失敗／渲染寫檔失敗）皆以 exit code 0 結束，不會讓 job 進入 `failure()`
狀態，故此 step 只會被部署 step 本身的失敗觸發，不需要額外用 step `id`／`outcome` 判斷來源。

## C6. 與核心推播段的資料依賴

`PublishService` 讀到的 `state.publish` 完全由核心段（`board-segment.service.ts` /
`news-segment.service.ts`）在**更早、獨立的 `radar` job** 內寫入（見
`state-write-contract.md`）。發佈段本身不計算、不重新選擇、不改寫任何內容（FR-002/009/010）——
它是一個純粹的「讀 state → 渲染」函式組合，唯一的判斷邏輯是 C2 的可見性分支。
