# Tech Radar

排程型、純自用、全免費、零維運的每日技術晨報。每天台北時間早上六點，自動掃描近一週最受關注、
新崛起的 GitHub repo，並從 19 個技術新聞來源精選當日最值得開發者關注的消息，翻成繁體中文推播到
Discord；同時發佈公開的 [GitHub Pages 儀表板](https://sylvia-h.github.io/tech-radar/) 與
[Atom feed](https://sylvia-h.github.io/tech-radar/feed.xml)，供隨時查閱與訂閱閱讀器追蹤。

整條 pipeline 只用 **GitHub Actions ＋ Discord Webhook ＋ Gemini 免費層 ＋ GitHub API**，沒有伺服器、
沒有資料庫、沒有付費方案；LLM **每日只呼叫一次**，去重與排序全程零 LLM。全程以
[GitHub Spec Kit](https://github.com/github/spec-kit)（Spec-Driven Development）開發，八個 Feature
依序完成，每個非顯而易見的決策都留有 spec／clarify 紀錄（見文末[開發歷程](#開發歷程spec-driven-development)）。

## 目錄

- [一眼看懂](#一眼看懂)
- [推播長什麼樣](#推播長什麼樣)
- [系統架構](#系統架構)
- [新聞來源清單](#新聞來源清單)
- [新聞篩選機制](#新聞篩選機制)
- [榜單機制](#榜單機制)
- [工程亮點：踩坑之後的設計](#工程亮點踩坑之後的設計)
- [公開儀表板與 Atom feed](#公開儀表板與-atom-feed)
- [模組結構](#模組結構)
- [技術棧、機密與本機執行](#技術棧機密與本機執行)
- [開發歷程（Spec-Driven Development）](#開發歷程spec-driven-development)

## 一眼看懂

| 項目 | 數字 |
|------|------|
| 新聞來源 | 25 個設定項、19 個啟用（AI 6／DevOps 5／前後端 6／跨領域 2） |
| 每日新聞 | 至多 10 則，AI 為主、非 AI 預設 ≤3（動態放寬） |
| LLM 呼叫 | 新聞策展每日 1 次；repo 簡介一生 1 次並快取；榜單日多 1 次一句話 TL;DR |
| 榜單 | 每領域追蹤 top 15，推播綜合 top 10，每 7 天只推變化 |
| 榜單資料 | GitHub Trending weekly 6 個頁面 ＋ Search API 2 條查詢，不自存星星歷史 |
| 排程 | 雙離峰 cron（台北 06:07 主班、06:37 補班）＋ 時間戳 guard |
| 常駐服務／資料庫 | 0 |
| 月費 | $0 |
| 單元測試 | 488 個、62 個測試套件 |

三條輸出流：

- **每日晨報**（Discord 新聞頻道）：AI 為主、兼及 DevOps／後端／前端，每則含繁中標題（≤70 字）
  與「發生了什麼、為何對開發者重要」的內容（≤500 字）。
- **每週榜單變化**（Discord 榜單頻道）：AI 與前後端兩領域的 GitHub 新崛起 repo，只推「新進／竄升／
  下降」，新進與竄升附 250 字繁中簡介。
- **公開儀表板 ＋ Atom feed**（GitHub Pages）：今日精選新聞 → 本週榜單 → 上次變化摘要；feed 保留
  最近 50 筆。

## 推播長什麼樣

晨報是一則橘色 embed，標題帶台北日期，內容逐則編號（以下取自實際推播）：

```
📡 Tech Radar 晨報 · 2026-09-02

1. 程式語言 Mojo 正式宣佈開源
   專為人工智慧與高效能運算設計的程式語言 Mojo 正式宣佈開源。這項轉變對開發者而言意義重大，
   意味著社群可以更深入參與該語言的底層架構、貢獻程式碼……

2. Google Gemini 推出全新代理式影片理解功能
   Google 替 Gemini 模型推出具備代理式（agentic）能力的影片理解功能……

3. Cloudflare 透過 Zstandard 與 Pingora 探索快取儲存空間最佳化
   Cloudflare 分享了他們如何在快取系統中導入 Zstandard 壓縮技術與 Pingora 架構……
```

榜單日先來一張封面卡（藍色），再每個新進／竄升 repo 一張卡（AI 綠色、前後端黃色）。封面文字取自
實際推播，卡片內容為示意：

```
📊 榜單變化 · 2026-08-31
本次榜單變化
本次技術雷達榜單由 tt-a1i/archify 奪得 #1，共有 9 個新進項目（AI 佔 7 個、前後端佔 2 個）
以及 1 個下降項目。
🔻 下降
makeplane/plane #8 → #10

🆕 schollz/croc                                  ← 標題可點，連到 repo
croc 是一款基於 Go 語言的高效能檔案傳輸工具，解決了跨設備傳輸檔案時……（≤250 字）
本週增星 ⭐ +1.1k   語言 `Go`   領域 前後端

🔺 owner/repo
……
本週增星 ⭐ +8.6k   語言 `Python`   名次 #9 → #3
```

星數、連結、名次、日期全部由程式填入，LLM 只寫敘事文字。任何來源失敗、發佈失敗都會另發紅色
告警到獨立的告警頻道，不會污染晨報與榜單頻道。

## 系統架構

一支跑完即退的 NestJS CLI job（`NestFactory.createApplicationContext()`，保留 DI、不啟 HTTP
server），由 `radar.yml` 內兩個 job 依序執行：

```
GitHub Actions 雙離峰 cron（UTC 22:07 / 22:37 ＝ 台北 06:07 / 06:37）
│
├─ radar job
│   ├─ 從獨立 state 分支載入 state/board.json（唯一權威狀態）
│   │
│   ├─ 榜單段（BoardSegmentService）—— 每 7 天
│   │   ├─ lastBoardPushAt 距今 < 162h → 整段跳過，不耗任何 GitHub 配額
│   │   ├─ GitHub Trending weekly 6 頁 ＋ Search API 2 條查詢，各自容錯隔離
│   │   ├─ 零 LLM 兩領域歸類（AI／前後端；topics 優先、未命中即排除）
│   │   ├─ weeklyStarsEstimate 統一尺 → 每領域 top 15 → 綜合 top 10（每領域保底 2 席）
│   │   ├─ 與上次快照 diff → 新進／竄升／下降（掉榜靜默）
│   │   ├─ 新進／竄升生成 250 字簡介（快取命中不打 LLM）＋ 一句話 TL;DR
│   │   ├─ 推播榜單頻道
│   │   └─ 推播成功才寫回狀態（原子寫入）
│   │
│   ├─ 晨報段（NewsSegmentService）—— 每日
│   │   ├─ lastNewsPushAt 距今 < 18h → 整段跳過
│   │   ├─ 19 個來源抓取（RSS/Atom、HN Algolia、Reddit weekly、GitHub Releases），各自容錯
│   │   ├─ 零 LLM 去重：URL 正規化合併 → 標題 Jaccard ≥0.6 補漏
│   │   ├─ 跨領域來源關鍵字歸類；剔除 45 天內已推播者
│   │   ├─ Stage A 漏斗：分數門檻 → 30 天新鮮度 → 加權 → 三層決勝排序 → 收斂至 50 則
│   │   ├─ Stage B 策展：唯一一次 Gemini 呼叫 → officialPicks / communityPicks
│   │   ├─ 硬驗證：幻覺剔除 → 單一來源 ≤2 → 非 AI 動態上限 → 總數 ≤10 → 字數收斂
│   │   ├─ 推播新聞頻道
│   │   └─ 推播成功才寫回狀態（原子寫入）
│   │
│   └─ 狀態有實際變更 → radar-bot commit 到 state 分支（no-diff 早退）
│
└─ publish job（needs: radar）
    ├─ 查 repo 可見性：private → 靜默跳過；查詢失敗 → 告警後跳過
    ├─ 純函式渲染 index.html ＋ feed.xml（零 LLM，模組層即不引入 LLM）
    └─ 上傳並部署到 GitHub Pages
```

兩段各自吞掉已知失敗模式（guard 跳過、空內容、推播失敗皆 best-effort 告警、不擲錯）；頂層
try/catch 只是未預期例外的安全網，任一段炸掉不會中止另一段，已落檔的狀態也不回滾。

## 新聞來源清單

來源是**唯一設定檔** `src/config/news-sources.ts`。增刪修來源只改這個檔案，不動任何抓取／漏斗
程式碼；載入時以 zod 驗證欄位與 `id` 唯一性，任何違規直接擲錯。每個來源只有六個欄位：
`id`、`type`、`url`、`domain`、`tier`、`enabled`，沒有逐來源的權重或門檻，所有數字都由 tier 決定。

### Tier 的實際意義

| Tier | 定位 | 分數門檻 | 權重 | 說明 |
|------|------|----------|------|------|
| 1 | 常開高訊號聚合 | 100 | ×1.0 | 有社群分數者（HN）低於門檻即淘汰 |
| 2 | 官方一手來源 | 無 | ×1.0 | 沒有社群分數，一律以基準分 100 入池，天然視為強訊號 |
| 3 | 選配實驗 | 150 | ×0.5 | 更高門檻、一半權重，可隨時停用 |

### 目前清單（25 項、19 啟用）

**Tier 1：常開高訊號**

| 來源 id | 類型 | 領域 | 說明 |
|---------|------|------|------|
| `hn` | HN Algolia API | 跨領域 | Hacker News 近 7 天 story，唯一帶社群分數的來源 |
| `lobsters-ai` | RSS | AI | Lobste.rs `ai` tag |
| `lobsters-devops` | RSS | DevOps | Lobste.rs `devops` tag |
| `lobsters-programming` | RSS | 跨領域 | Lobste.rs `programming` tag |
| `reddit-localllama` | Reddit weekly RSS | AI | r/LocalLLaMA 週熱門 |
| `simonwillison` | RSS | AI | Simon Willison 全文 feed |

**Tier 2：官方一手來源**

| 來源 id | 類型 | 領域 | 狀態 | 說明 |
|---------|------|------|------|------|
| `openai-blog` | RSS | AI | 啟用 | OpenAI 官方 news |
| `deepmind-blog` | RSS | AI | 啟用 | DeepMind 官方 basic feed |
| `github-next` | RSS | AI | 啟用 | GitHub Next 官方實驗性功能部落格 |
| `anthropic-news` | RSS | AI | 停用 | 無公認官方 RSS 端點，不以第三方中轉站替代 |
| `gh-nodejs` | GitHub Releases | 前後端 | 啟用 | Node.js 官方發佈 |
| `gh-cpython` | GitHub Releases | 前後端 | 啟用 | CPython 官方發佈 |
| `gh-typescript` | GitHub Releases | 前後端 | 啟用 | TypeScript 官方發佈 |
| `vue-blog` | RSS | 前後端 | 啟用 | Vue.js 官方 blog |
| `web-dev` | RSS | 前後端 | 停用 | feed 自 2026-05-29 起停更，形同啞源 |
| `gh-kubernetes` | GitHub Releases | DevOps | 啟用 | Kubernetes 官方發佈 |
| `cloudflare-blog` | RSS | DevOps | 啟用 | Cloudflare 官方 blog |
| `cncf-blog` | RSS | DevOps | 啟用 | CNCF 官方 blog |

**Tier 3：選配實驗**

| 來源 id | 類型 | 領域 | 狀態 | 說明 |
|---------|------|------|------|------|
| `gh-vue` | GitHub Releases | 前後端 | 啟用 | Vue core 發佈 |
| `gh-react` | GitHub Releases | 前後端 | 啟用 | React 發佈 |
| `thenewstack` | RSS | DevOps | 啟用 | The New Stack |
| `reddit-devops` | Reddit weekly RSS | DevOps | 停用 | GitHub Actions runner IP 遭 Reddit 持續 403/429 |
| `reddit-node` | Reddit weekly RSS | 前後端 | 停用 | 同上 |
| `reddit-python` | Reddit weekly RSS | 前後端 | 停用 | 同上 |
| `reddit-reactjs` | Reddit weekly RSS | 前後端 | 停用 | 同上 |

### 來源治理原則

- **停用不刪除**：壞掉的 feed 一律以 `enabled: false` 加日期註解處理，設定檔本身就是決策紀錄
  （為何停、何時覆測、覆測結果）。
- **不引入不可控中轉**：Reddit 被擋後曾評估第三方 RSS 代理，因候選節點 DNS 不存在且違反零維運
  取向而放棄；Anthropic 無官方 feed 就先不收。
- **新增前先量體**：漏斗每來源每輪最多 1 則、最多 3 輪；單日產出上百筆的來源（如 arXiv 分類 RSS
  實測單日 261 筆）會擠壓其他來源在 50 則收斂上限內的曝光，不予收錄。Hugging Face Blog 曾啟用
  一天即移除：其回溯至 2020 年的常青教學文，標題多為通用 ML 詞彙，在跨來源標題去重時與
  OpenAI 一篇同名文章誤合併，讓後者對策展 LLM 完全隱形。
- **0 筆必告警**：「解析到 0 筆」一定發帶來源 `id` 的紅色告警，不會無聲略過；但計數取**過濾前**
  的筆數，所以 GitHub Releases 整批被版本噪音過濾掉不會誤報。

## 新聞篩選機制

一則新聞從「被抓到」到「出現在推播裡」依序經過九關；前八關除了第六關之外全部是純函式、零 LLM。

### 第 1 關：抓取（`src/news/fetchers/`）

依 `type` 分派四種 fetcher，同型來源只需加設定：

| 類型 | 做法 | 分數 |
|------|------|------|
| `hn-algolia` | 附 `created_at_i > 7 天前` 與 `hitsPerPage=100`，客戶端再核對一次 7 天口徑；Ask HN 無外連時以 HN item 頁為去重鍵 | `points` |
| `rss` | `rss-parser`，缺標題或連結即丟棄 | 無 |
| `reddit-weekly` | 同 RSS，Reddit RSS 不帶 upvote | 無 |
| `github-releases` | 同 RSS，再經**版本噪音過濾** | 無 |

版本噪音過濾（`src/news/release-filter.ts`）：丟棄 pre-release（`-alpha`／`-beta`／`-rc`／`-canary`
等，以及 CPython 的 PEP 440 寫法如 `3.15.0b4`）與純 patch release；標題或內文含 `security`、
`CVE-`、`advisory` 者即使是 patch 也保留；版本號無法解析者保守保留。

抓取禮貌：自訂 User-Agent、429/5xx/網路錯誤指數退避＋jitter（最多 3 次、上限 8 秒）、尊重
`Retry-After`；其他 4xx 立即放棄。每個來源獨立 try/catch，失敗只影響自己。

### 第 2 關：URL 正規化去重（`src/news/url-normalize.ts`、`dedup.ts`）

同一件事常被多個來源報導，去重主力是零 LLM 的 target-URL 正規化：

- 協定與主機轉小寫、去 `www.`、去 `#fragment`、去尾斜線（根路徑除外）。
- 移除追蹤參數：`utm_*`、`mc_*` 前綴，以及 `ref`、`fbclid`、`gclid`、`igshid`、`ncid`、`spm`、
  `cmpid` 等；剩餘 query 依 key、value 排序，讓參數順序不同的連結合併。
- 刻意**不**做短網址解析（需要額外網路請求），殘留的 `t.co`／`bit.ly` 重複交給第六關的 LLM 補。

同 URL 只留分數最高者為代表（無分數視為 −∞、同分取 `sourceId` 字典序），`sources[]` 聯集累積。

### 第 3 關：標題相似度補漏（`src/news/title-similarity.ts`）

不同連結但其實是同一件事（官方 blog 與 HN 討論串），以標題 Jaccard 相似度補漏：小寫、以非英數
切詞、去約 50 個英文停用詞，`|交集| / |聯集| ≥ 0.6` 即合併。這一關全程不呼叫 LLM。

### 第 4 關：領域歸類（`src/news/news-classify.ts`）

非跨領域來源沿用設定的 `domain`；`hn`、`lobsters-programming` 兩個跨領域來源以詞界正規表達式
比對標題＋摘要，優先序 **AI ＞ DevOps ＞ 前後端**（關鍵字 25／17／23 個）。任何領域都未命中
即丟棄，寧缺勿濫。

### 第 5 關：剔除已推播（`src/news/seen-news.ts`）

比對 `seenNews` 已推清單（保留 45 天，讀寫兩端都修剪），比對鍵同樣是正規化後的 URL，所以換了追蹤
參數再出現仍算已推。這一關刻意排在收斂之前，避免已推項目佔用收斂名額。

保留天數原為 7 天，2026-09-02 改為 45 天：保留期必須大於等於一則新聞最久還能當候選的時間，而無分數
來源的新鮮度視窗是 30 天，官方 feed 又常把同一篇掛上數週。原本每隔 8 天同一則就會再推一次，實測
310 則推播中有 46 則是重複；單元測試現在斷言保留期 ≥ 新鮮度視窗，兩個常數不會再各自漂移。

### 第 6 關：Stage A 漏斗（`src/news/funnel.ts`）

| 步驟 | 規則 |
|------|------|
| 分數門檻 | 只對**有**分數者生效：Tier 1 ≥100、Tier 3 ≥150；Tier 2 無門檻；被 ≥2 來源交叉驗證者豁免（避免官方文章被低分 HN 投稿合併後連帶出局） |
| 新鮮度 | 無分數者需在 30 天內發表（`publishedAt` 為原文真實日期），避免封存舊文被討論區重新提及混入；HN 因 `publishedAt` 是投稿時間而豁免 |
| 加權 | `base × tierWeight ＋ 交叉驗證加權 100（sources ≥ 2）＋ 榜單相關性加權 50（提到目前榜上 repo）`，無分數者 `base = 100` |
| 排序 | `加權分數 ↓ → 跨來源輪流分配序 ↑ → normalizedUrl ↑`；`publishedAt` 刻意不當跨來源決勝鍵，只在同來源組內決定先後 |
| 收斂 | 取前 **50** 則送 LLM |

**跨來源輪流分配**是實測踩坑後加的：所有無分數的一手來源都是 100 分同分，單純用 URL 字母序決勝時
`blog.cloudflare.com` 曾佔掉 25 席中的 9 席，把好幾個官方來源整批擠出候選池。現在同分候選按來源
分組、逐輪各發 1 則、最多 3 輪，超過 3 輪的直接剔除；只要收斂名額扣掉有分數候選後 ≥ 當日活躍
來源數，每個來源至少有 1 則能進候選池。同一來源內「留哪 3 則」依發表日期由新到舊（2026-09-02 起，
先前沿用 URL 字母序，路徑帶月份縮寫的來源會讓 `/Aug/` 長期壓過 `/Sep/`）；跨來源之間仍是公平輪流，
不會重新引入「誰發得勤誰贏」的偏誤。

### 第 7 關：Stage B 策展，每日唯一一次 LLM 呼叫（`src/curation/`）

候選為 0 則時連 LLM 都不叫。有候選時只送公開欄位：`ref`（0 起算索引）、標題、領域、tier、分數、
來源數、是否在榜、發表天齡、摘要節錄（≤500 字）。**不送 URL**。天齡是 2026-09-02 補上的：此前 LLM
分不出三週前與今天的文章，prompt 以「重要性相當時優先較新者，但天齡不改變是否重大」的軟性偏好使用它。

Prompt 要求三件事：殘餘語意去重、依「對開發者的重要性而非熱度」挑至多 10 則、每則改寫為繁中
標題（≤70 字）＋內容（≤500 字，回答「發生了什麼、為何對開發者重要」）。回應固定為兩個陣列
`officialPicks` / `communityPicks`，每則只回 `ref`、`title`、`content`。

Prompt 內兩個實測後的關鍵設計，見[工程亮點](#工程亮點踩坑之後的設計)。

### 第 8 關：硬驗證管線（`src/curation/curation-validate.ts`）

固定順序，**只在 LLM 已選的集合內剔除或重排，永不遞補新候選**：

1. `officialPicks` 固定接在 `communityPicks` 之前合併。
2. **幻覺剔除**：`ref` 必須是 `[0, 候選數)` 內的整數，越界即丟；重複 `ref` 只留第一次。
   `url`、`domain`、`sourceCount`、`weightedScore` 全由程式從 `candidates[ref]` 附回，LLM 沒有
   任何機會產生連結。
3. **單一來源上限**：非 AI 同一來源最多 2 則，只在非 AI 候選池 > 3 則時生效（起因：Cloudflare
   主題週單日佔滿當日非 AI 全部 3 席）。
4. **非 AI 動態上限** `max(3, 10 − AI 則數)`：AI 不設下限也不設上限，逐一評選、合格皆收；AI 供給
   不足 7 則時把未用滿的名額讓給非 AI（AI 4 則 → 非 AI 可到 6 則），只在 AI 確實不足時放寬。
   超額時 DevOps 優先保留，同領域內維持重要性序。
5. 總數截至 10：官方發布若已達 10 則，社群熱度會在此被完全截掉，這正是結構性優先的體現。
6. 字數收斂：以 Unicode code point 計數（emoji 安全），超長時回溯到最近的句號／問號／驚嘆號
   截斷並補 `…`，**不**重打 LLM。

### 第 9 關：推播、寫狀態、降級

- 推播成功後才寫回：`seenNews` 追加正規化 URL、`lastNewsPushAt` 更新、`publish.news` 與 feed
  （上限 50 筆）同步更新，Discord 與 Pages 保證是同一份資料。
- **18 小時 guard**：距上次推播不足 18h（24h − 6h 寬限）整段跳過，抵抗 06:37 補班 cron 重推；
  時間戳落在未來視為時鐘異常，保守跳過；空內容不推播也**不**推進時間戳，讓補班或隔天重試。
- **降級而非開天窗**：LLM 重試耗盡、空回應或 JSON 解析失敗時，改以 Stage A 的加權分數順序取
  候選，套用相同的配額與總數規則，以 `content: null`、`degraded: true` 推播（只有原文標題與連結）。
  不會推出未經驗證的 LLM 原文，也不會整天沒有晨報。

## 榜單機制

### 資料來源：不自存星星歷史

「本週增星」一律借用 GitHub 官方數字，不自建每日星星快照、不做 day-over-day 比對：

| 來源 | 內容 | 容錯 |
|------|------|------|
| GitHub Trending weekly（主力） | 全站 ＋ `typescript`、`javascript`、`python`、`rust`、`shell` 共 6 頁，`since=weekly`，以 `cheerio` 解析官方「stars this week」 | 逐頁隔離，一頁失敗只丟該頁；6 頁合計 0 筆才視為失敗並告警 |
| GitHub Search API（補位） | 每領域一條查詢：`(llm OR rag OR agent OR gpt) created:>7天前 stars:>30`、`(nextjs OR react OR svelte OR nodejs OR golang) created:>7天前 stars:>20`，各取 30 筆 | 逐查詢隔離；0 筆是正常結果，不告警 |
| `GET /repos/{full_name}` | 為 Trending 候選補 `repoId`、topics、總星數、建立日 | 併發 ≤6，單筆失敗只丟該候選；401/403 立即告警，否則失敗率 > 50% 才告警 |

Search 的 OR 群組直接從歸類關鍵字表衍生（曾因兩處各寫一份而讓 `vue` 漂移），且查詢屬於哪個領域
**不**帶進歸類，一律由 topics／description 重新判定。

**統一尺** `weeklyStarsEstimate`（`src/board/weekly-stars.ts`）：Trending 候選直接用官方週增量；
Search 候選以 `min(round(總星數 ÷ 天齡 × 7), 總星數)` 估算。上限是關鍵：`created:>7天` 的 repo
所有星星都來自本週，總星數就是真實上界，沒有它，一個今天建立、300 星的 repo 會被線性外推到
2,100 星而壓過真正的 Trending 冠軍。天齡無法解析回 `null` 而非 0，因為 0 代表「今天建立」會被
最大幅放大。

GitHub API 用量：每次執行 2 次 search ＋ 每個 Trending 候選 1 次 core ＋ 每個新進／竄升 repo 1 次
README；呼叫在送出前計數（失敗也算），剩餘額度低於門檻（core 50／search 3）時預先退避，403 帶
`Retry-After` 視為次級速率限制而非憑證問題。

### 兩領域歸類：零 LLM（`src/classify/`）

- **topics 優先**：有 topics 只看 topics，未命中不回退到 description；沒有 topics 才看
  description。`language` 刻意不當輸入。
- **詞界比對**：小寫詞界正規表達式，子字串比對會讓 `ai` 命中 `blockchain`。代價是 `openai`、
  `agents`、`reactjs` 這類黏合詞要逐一補進 `extra` 清單。
- 同時命中多領域時 **AI ＞ 前後端**；都未命中即排除，寧缺勿濫。
- **DevOps 已於 2026-07-15 從榜單移除**：實測歸類正確率 0/3（候選幾乎只靠 `docker` 命中，那是
  部署方式不是領域），週增星 259／136／25 對比 AI 的 13,195／7,129。此決定**只影響榜單**，新聞側
  的 DevOps 配額與來源完全不受影響；舊狀態檔中的 `devops` 項目以逐筆寬鬆載入丟棄並警告，不讓
  整個狀態檔失效。

### 組榜與排名

- **追蹤深度**：每領域 top 15，依統一尺排序，不足 15 不硬湊。
- **推播榜**：綜合 top 10，先為每領域保留 2 席，剩餘 6 席跨領域競爭。
- **決勝鏈**：`週增星 ↓ → 總星數 ↓ → 新進者優先 → repoId ↑`。同一個比較器用於保底席、競爭席與
  最終名次，第四層保證嚴格全序，結果不依賴 sort 穩定性。
- 身分一律用數字 `repoId`，改名或轉移 owner 不會被當成新 repo。

### 變化偵測：只推差異（`src/diff/board-diff.ts`）

| 類型 | 定義 | 附簡介 |
|------|------|--------|
| 🆕 新進 | 在本次 top 10、不在上次 | 是 |
| 🔺 竄升 | 名次前進 ≥1 | 是 |
| 🔻 下降 | 名次後退 ≥1 | 否，只列一行 `#前 → #後` |
| 不變 | 名次相同 | 不出現 |
| 掉榜 | 不在本次 top 10 | 靜默；日後重回視為新進，簡介讀快取 |

「掉榜靜默」是結構性的：diff 只迭代本次推播榜，程式上不存在「掉榜」這種變化型別。已知代價：
門檻為 1 名時，任一新進會把下方所有 repo 都推成「下降」，但下降卡不耗簡介與 LLM，且視窗只有
10 席，成本有界。

### 七日節奏：162 小時，不是 168

榜單以 `lastBoardPushAt` 計時，不綁 cron。門檻 `162h = 168h − 6h`：時間戳記錄的是推播**完成**
時刻，永遠晚於 cron 觸發；若用整數 168h，七天後同一班 cron 算出來永遠差一點點而跳過，改由下一班
推，起點就往後滑。Actions cron 只會晚不會早，誤差**單向累積**，節奏會從 7 天漂成 7.x 天。6 小時
寬限同時吸收 cron 延遲與雙班抖動。判定回傳的是原因（`no-timestamp`／`clock-anomaly`／`due`／
`not-due`）而非布林值，時鐘異常時照跑但額外告警。未到期的執行在呼叫任何 GitHub API 之前就返回。

### 250 字簡介與一句話 TL;DR（`src/intro/`、`src/curation/board-summary*`）

- 簡介**一生只生成一次**，以 `repoId` 為鍵快取在狀態檔，掉榜不清除，重回即命中。
- 素材：抓 README（≤6,000 字，去 markdown 噪音）；不足 200 字則退回 description ＋ topics；
  兩者皆空則要求 LLM 標註「（資訊有限）」。
- Prompt 固定結構「解決什麼問題 → 核心特色 → 適合誰」，並明令不得產生星數、名次、連結。
- 任何失敗都降級為 GitHub description 並在卡片標示「（簡介暫缺）」，且**不寫入快取**，下次重試
  而非把失敗結果永久固化。
- 榜單日另呼叫一次 LLM，把 diff 統計（新進／竄升／下降數、領域分布、榜首）寫成一句繁中 TL;DR；
  失敗時退回純事實模板「本週 N 個新進、M 個竄升、K 個下降」。

## 工程亮點：踩坑之後的設計

### 用「結構」而非「文字指令」馴服單次生成的 LLM

策展 prompt 踩過兩個具體的坑，修法都是把約束從 prompt 文字移到程式結構：

1. **官方發布 vs 社群熱度的優先序**。原本用文字指示「先窮盡官方發布，社群熱度只補剩餘名額」，
   實測無效：總數只有 8 則、離上限還遠，LLM 仍把兩類混著選，因為單次生成沒有「先做完一組再做
   下一組」的程序性執行。改成回應拆為 `officialPicks` / `communityPicks` 兩個獨立陣列，LLM 只需
   把每則正確分類（遠比「記得執行順序」簡單），「官方優先」交給合併邏輯固定排序，截斷時永遠先
   吃社群那一組。
2. **Batch composition 效應**。候選池從 35 則漲到 41 則時，LLM 悄悄刷掉了先前會收錄、客觀上仍
   是重大發布的 DeepMind 模型公告，因為它是跟同批其他候選相對比較，不是對每則核對絕對判準。
   憲章限制每日只能呼叫一次，無法用分批緩解，只能在 prompt 內明訂「重要性判準是絕對的，與候選池
   大小無關」的錨點與「算重大／不算重大」清單。
3. **拿掉固定的 AI 下限**。曾設「AI ≥7」，實測 LLM 連續多日精確卡在 7 則，數字錨定壓過了判斷。
   改為 AI 不設下限、非 AI 動態讓額，讓「至多 10 則」盡量填滿又不犧牲 AI 為主。

### LLM 寫敘事，程式寫事實

LLM 只能用索引指涉候選、只回敘事文字；星數、連結、名次、日期永遠由程式填入，兩個 prompt 都明令
不得產生這些數字。就算 LLM 抽風，數字與連結永遠是真的。空回應（多為截斷或安全過濾）刻意
**不重試**，重送同一 prompt 通常仍空，只會白燒免費層配額，改走降級路徑。

### 冪等、單一狀態、推播成功才落檔

- `state/board.json` 是唯一權威狀態，只經 `StateStore` 讀寫；`save()` 先驗證、以 key 排序序列化
  （git diff 乾淨）、寫 `.tmp` 再 `rename`；`load()` 遇壞檔擲錯不覆寫。
- 榜單段先 `save()` 成功才把新狀態 assign 進共用物件，失敗只需還原簡介快照即可完整回滾，未落檔
  的榜單推播不可能透過晨報段稍後的 `save()` 外洩。
- 狀態 schema 對 `feed[].url` 刻意不加 `.url()`、對 `feed` 不加 `.max(50)`：嚴格驗證會在推播
  **成功之後**讓 `save()` 擲錯、遺失時間戳，補班 cron 就會重推同一份晨報。上限只在唯一寫入點強制。
- 狀態 commit 落在獨立的 orphan `state` 分支：`develop`／`main` 不出現 bot commit，高頻變動檔不
  製造合併衝突，且 commit 仍算 repo 活動、避免 Actions 60 天無活動自動停用。

### 防禦式細節

- Trending 解析器抽數字而非用 `isFinite` 守衛，因為 `Number('') === 0` 會在頁面改版時無聲記成
  0 星；同類坑在速率限制標頭（`Number(null) === 0`）與天齡計算（回 `null` 不回 0）也各擋一次。
- 告警去重靠 CLI 成功送出告警後寫下的 `.radar-alert-sent` 標記檔：workflow 的備援告警只看標記
  是否存在，涵蓋啟動前失敗、告警本身送不出、狀態 push 失敗，且不重複發。
- webhook URL 本身就是憑證：GitHub／Discord 的錯誤訊息一律不含 URL，網路錯誤重新包裝後才拋出。
- 日期標籤固定以 UTC+8 換算台北日期，否則早上六點的晨報會標成前一天。
- Discord 一律每 10 個 embed 分批：冷啟動封面＋10 張卡＝11 個 embed，正是舊的「摘要另發一則」特例
  仍會壞掉的情境。

## 公開儀表板與 Atom feed

`publish` job 在 `radar` 之後執行，對狀態檔**唯讀**、零 LLM（模組層即不引入 LLM module）：

- 先查 repo 可見性：轉 private 自動靜默跳過（不留 404 孤兒站台，也不每天告警）；查詢失敗告警後跳過。
- `index.html`：無 JS 的靜態頁，順序為今日精選新聞 → 本週榜單（分 AI／前後端，含快取簡介）→ 上次
  變化摘要；所有插值經 HTML escape。
- `feed.xml`：Atom 1.0，最新在前，最多 50 筆。新聞 GUID 為 `news:{正規化 URL}`；榜單事件 GUID 為
  `repo:{repoId}:{new|climbed}:{日期}`，帶日期是因為同一 repo 可合法在數週後再次新進，純 `repoId`
  會被閱讀器當作已讀吞掉。feed 只有新進與竄升，刻意**不存星數**，50 筆帶星數的時間序列就等於
  自存星星歷史。
- **全有或全無**：`feed.xml` 先寫、`index.html` 最後寫，部署 gate 是 `hashFiles('public/index.html')`，
  讓它兼任提交點，不可能部署出訂閱者全部 404 的半套站台。

## 模組結構

| 模組（`src/`） | 職責 |
|------|------|
| `config` | env（zod）驗證，缺機密 fail-fast；`news-sources.ts` 來源清單與 schema |
| `sources` / `github` | GitHub Trending 解析、Search／Repo／README API、速率限制與退避 |
| `classify` | 榜單兩領域關鍵字歸類（零 LLM） |
| `board` | 候選合併、`weeklyStarsEstimate` 統一尺、每領域 top 15 |
| `diff` | 綜合 top 10、決勝比較器、七日節奏判定、與上次快照 diff、狀態 commit 純函式 |
| `news` | 四種 fetcher、URL 正規化、標題相似度、已推清單、Stage A 漏斗、版本噪音過濾 |
| `curation` | Stage B 單次 LLM 策展：prompt、解析、硬驗證、配額、字數收斂、降級；榜單 TL;DR |
| `intro` | README 素材整理、簡介 prompt、250 字收斂、快取與降級 |
| `llm` | Gemini 唯一封裝（429/503 退避、空回應不重試、錯誤帶狀態碼） |
| `pipeline` | 榜單段／晨報段編排、guard、embed 組版與分批 |
| `discord` | 三頻道 webhook、429 退避、失敗告警、告警標記檔 |
| `publish` | 可見性偵測、頁面／feed 純函式渲染、發佈編排 |
| `state` | 狀態 schema（寬鬆載入策略）與 `StateStore` 原子讀寫 |

## 技術棧、機密與本機執行

| 用途 | 技術 |
|------|------|
| 執行環境 | Node.js 24、TypeScript（strict） |
| 應用框架 | NestJS 11（`createApplicationContext`，一次性 CLI job） |
| LLM | `@google/genai`（Gemini 免費層 `gemini-3.5-flash-lite`） |
| HTML／RSS 解析 | `cheerio`、`rss-parser` |
| Atom 產生 | `feed` |
| 驗證 | `zod`（env、來源清單、狀態檔、GitHub API 回應） |
| 排程與部署 | GitHub Actions（`workflow_dispatch` ＋ 雙 cron）、GitHub Pages |
| 推播 | Discord Channel Webhook，三頻道分流 |
| 測試 | Jest、ts-jest |

### 機密（五項皆必填，只走環境變數／Actions Secrets，絕不入庫）

| 變數 | 用途 |
|------|------|
| `DISCORD_NEWS_WEBHOOK_URL` | 每日晨報 |
| `DISCORD_BOARD_WEBHOOK_URL` | 榜單變化 |
| `DISCORD_ALERT_WEBHOOK_URL` | 告警（來源失敗、發佈失敗、備援告警） |
| `GH_API_TOKEN` | GitHub API 唯讀；不可用 `GITHUB_` 前綴，Actions 會擋 |
| `GEMINI_API_KEY` | Gemini API |

缺任一機密即 fail-fast、exit ≠ 0、不推播；驗證錯誤訊息只含欄位名，不含值。

### 本機執行

```bash
npm ci
npm run build

DISCORD_NEWS_WEBHOOK_URL="https://discord.com/api/webhooks/…" \
DISCORD_BOARD_WEBHOOK_URL="https://discord.com/api/webhooks/…" \
DISCORD_ALERT_WEBHOOK_URL="https://discord.com/api/webhooks/…" \
GH_API_TOKEN="…" \
GEMINI_API_KEY="…" \
node dist/main.cli.js
```

```powershell
$env:DISCORD_NEWS_WEBHOOK_URL="https://discord.com/api/webhooks/…"
$env:DISCORD_BOARD_WEBHOOK_URL="https://discord.com/api/webhooks/…"
$env:DISCORD_ALERT_WEBHOOK_URL="https://discord.com/api/webhooks/…"
$env:GH_API_TOKEN="…"; $env:GEMINI_API_KEY="…"
node dist/main.cli.js
```

另有兩個模式：`NEWS_INGEST_OBSERVE=1` 只跑 Stage A 漏斗並印出候選表（不呼叫 LLM、不推播），
`PUBLISH_MODE=1` 只跑發佈段（見 [quickstart](specs/008-pages-publish/quickstart.md)）。

### 測試

```bash
npm test
```

488 個單元測試、62 個測試套件，與原始碼同目錄。憲章要求的關鍵邏輯皆有覆蓋：Trending 解析（HTML
快照）、兩領域歸類、榜單 diff 與決勝、URL／標題去重、簡介快取命中、新聞配額與字數上限、來源
schema 與 tier 加權、晨報 18h guard、榜單 162h 節奏、狀態原子寫入。Gemini 一律 mock，並另測降級路徑。

### GitHub Actions

`.github/workflows/radar.yml`：`workflow_dispatch` ＋ cron `7 22 * * *`、`37 22 * * *`（UTC），
`concurrency` 排隊不取消。`radar` job 從 `state` 分支載入狀態、執行、僅在有 diff 時由 `radar-bot`
commit 回 `state` 分支（push 失敗重試 3 次）；`publish` job `needs: radar`，以 job 層級最小權限
部署 Pages。設定方式：Settings → Secrets and variables → Actions 填五項機密；Settings → Pages 把
Source 設為 GitHub Actions；到 Actions 頁 Run workflow 手動驗證。

## 開發歷程（Spec-Driven Development）

| Feature | 目錄 | 內容 |
|---------|------|------|
| F1 | `specs/001-foundation` | 專案骨架、狀態存取、推播通道、排程 |
| F2 | `specs/002-board-sources` | 榜單來源抓取與兩領域歸類 |
| F3 | `specs/003-board-state-diff` | 榜單快照與變化偵測（七日節奏） |
| F4 | `specs/004-news-ingest` | 新聞來源設定檔與零 LLM 過濾漏斗 |
| F5 | `specs/005-repo-intro` | LLM 封裝與 repo 簡介生成 |
| F6 | `specs/006-news-curation` | 每日單次 LLM 策展與降級備援 |
| F7 | `specs/007-pipeline-push` | Pipeline 端到端編排與 Discord 組版 |
| F8 | `specs/008-pages-publish` | GitHub Pages 儀表板 ＋ Atom feed |

每個 Feature 從 `develop` 各自 branch，走完整 Spec Kit 流程（`specify → clarify → plan →
checklist → tasks → analyze → implement`）後以 `--no-ff` 合併回 `develop`。

### 文件索引

- **[憲章](.specify/memory/constitution.md)**：八條非協商原則＋技術與安全約束，最高規範。
- **[開發指南](docs/tech-radar-dev-guide.md)**：架構決策、來源選型、Discord 版面、排程、Feature 規劃。
- **[CLAUDE.md](CLAUDE.md)**：給 Agent 的協作指引（真實來源優先序、commit 規範、SDD 流程）。
- 各 `specs/NNN-*/`：每個 Feature 的 spec／plan／tasks／contracts／checklists。
