# Contract: 網頁與 feed 內容格式

**Feature**: 008-pages-publish | 涉及檔案：`src/publish/render-page.ts`、`src/publish/render-feed.ts`

## C1. 儀表板頁面（`index.html`）內容契約

三個區塊，順序固定：

1. **推播榜**（FR-001）：`state.board`（`Record<repoId, BoardEntry>`）依 `domain` 分兩區
   （AI／前後端），各自依 `rank` 升冪列出；每筆顯示 `fullName`／`url`／`language`／
   `starsThisWeek`／`state.intros[repoId]?.intro`（簡介快取，若無則不顯示簡介欄）。
   `state.board` 為空物件時，該區塊顯示「尚無榜單資料」（US1 Acceptance Scenario 2）。
2. **上次榜單變化摘要**（FR-001）：`state.publish?.boardSummary`。存在則顯示
   `summary` 文字＋`generatedAt`（換算台北時間標示「XX 月 XX 日」）；不存在（含全新空骨架、或
   `publish` 欄位不存在的舊 state）顯示「尚無榜單變化紀錄」。
3. **今日精選新聞**（FR-002/015）：`state.publish?.news`。存在則列出 `items[]`（每則
   `title`／`content`），並在區塊標題旁標示 `generatedAt`（FR-015：讓訪客分辨是否為當日產出）；
   不存在顯示「尚無新聞精選」。
   **`content === null`（策展降級項，`CuratedNewsItem.content` 型別為 `string | null`）**：
   該則**只輸出標題與連結，整個內容區塊不輸出**——不得印出字面 `null`，也不加「本則未經精煉」
   之類的提示文字（降級屬內部狀態，沒有必要暴露在公開頁面；與 Discord 降級版面「有什麼就給
   什麼」的處理精神一致）。該則仍**必須呈現**，不得被過濾掉，否則網頁與 Discord 推播內容不再
   一致（FR-002/009）。

**MUST NOT**：呈現 `state.board` 以外的榜單資料（追蹤深度 top 15 不在此頁）；呈現任何機密欄位
（state 中本就不存在機密，此為程式邏輯保證的自然結果，非新增檢查）。

**HTML escape**：`fullName`／`intro`／`summary`／新聞 `title`／`content` 等一切插入頁面的文字，
一律經 escape 函式處理（`&`/`<`/`>`/`"`/`'`）——防禦性措施，見 research D5。

## C2. feed.xml 內容契約

- 逐一走訪 `state.publish?.feed ?? []`（已由核心段修剪至 ≤50、依寫入順序由舊到新），輸出時
  **反轉為新到舊**（Atom/RSS 慣例：最新事件在前）。
- 每筆 entry：
  - `id`：直接使用 `FeedEntry.id`（已含命名空間前綴，見 data-model.md §2.2）。
  - `title`：`FeedEntry.title`。
    - `type === 'news'`：新聞標題原文。
    - `type === 'board-new'`：`「{fullName} 新進榜」` 樣式。
    - `type === 'board-climbed'`：`「{fullName} 竄升」` 樣式。
  - `link`：`FeedEntry.url`。
  - `date`：`FeedEntry.publishedAt`（`Date` 物件，`feed` 套件要求）。
  - `description` → `atom:summary`：`FeedEntry.content`（2026-08-04 新增）。`null`（策展降級）
    或欄位缺席（榜單事件、F8 早期舊 state）時傳 `undefined`，`feed` 套件的 `if (item.description)`
    即整個略過 `summary` 元素——**MUST NOT** 印出字面 `null` 或「本則未經精煉」之類提示，與 C1 的
    降級處理精神一致。
- **MUST NOT** 帶任何星數／週增星等數值欄位（FR-016）——`FeedEntry` schema 本身就沒有這些欄位，
  此規則在型別層面已經是不可能違反，此處僅重申契約意圖。
- Feed 層級中繼資料：`title`＝「Tech Radar」、`id`/`link`＝
  `https://{owner}.github.io/{repo}/`（由 `GITHUB_REPOSITORY` 推導）、`updated`＝
  `state.publish?.feed` 最新一筆的 `publishedAt`（陣列為空時用 `now`）。
- **Atom 規格必要元素（2026-08-04 補訂，RFC 4287）**：
  - `author`＝`{ name: 'Tech Radar' }`。§4.1.2 規定每則 entry **MUST** 有 `atom:author`，但
    feed 層備有 author 時 entry 可省略——故填一個固定值即滿足全篇。這是「本 feed 的發行者」，
    與第三方文章的原作者無關（我們沒有那項資料），因此**永遠不會缺值、不會因來源無署名而失敗**。
  - `feedLinks.atom`＝`{pagesUrl}feed.xml`，使輸出含 §4.1.1 SHOULD 的 `rel="self"` link。
- `state.publish?.feed` 為 `undefined`／空陣列時，輸出一份 0 entries 的合法 feed（不擲錯，
  對應 US1 Acceptance Scenario 2 的「空狀態不得使發佈流程失敗」延伸到 feed 產物）。

## C3. 兩產物與 Discord 推播內容的一致性（FR-002/009）

`index.html` 的新聞區塊、`feed.xml` 的新聞類 entry，其 `title`／`content`／`url` 皆來自
`state.publish.news.items`（即 `CuratedNewsItem[]`）——與同一次 `NewsSegmentService.run()` 推去
Discord 的 `digest.items` 是**同一個陣列**（`news-segment.service.ts` 寫入 `state.publish.news`
時直接引用 `digest.items`，不做任何篩選/改寫，見 `state-write-contract.md` C2）。因此「網頁/feed
內容與 Discord 推播一致」在資料流層面是**恆等**，不需要額外的一致性檢查或測試比對——測試只需確認
「寫入 `state.publish.news` 的是同一個 `digest.items` 參照／深相等」。榜單摘要同理：
`state.publish.boardSummary.summary` 與封面 embed 使用的 `summary.summary` 是同一個字串。
