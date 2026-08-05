# Tech Radar

排程型、純自用、全免費、零維運的每日晨報。每天固定時間自動掃描近一週最受關注、新崛起的 GitHub
repo，並精選當日最值得開發者關注的技術新聞，透過 Discord 推播；同時發佈一個公開的
[GitHub Pages 儀表板](https://sylvia-h.github.io/tech-radar/) 與 RSS/Atom feed，供隨時查閱與
訂閱閱讀器追蹤。

全程以 [GitHub Spec Kit](https://github.com/github/spec-kit)（Spec-Driven Development）開發，
八個 Feature（F1→F8）依序完成，每個非顯而易見的決策都留有 spec／clarify 紀錄可追溯（見文末
[開發歷程](#開發歷程spec-driven-development)）。

## 這個專案在做什麼

- **榜單（推播頻率：每 7 天）**：近一週 GitHub Trending 新崛起的 repo，分 **AI** 與**前後端**
  兩領域各追蹤 top 15，推播綜合 top 10，只呈現「新進 / 竄升 / 下降」的變化（掉出榜靜默）。
- **新聞（推播頻率：每日）**：**AI 為主**、兼及 DevOps／後端／前端，從 20+ 個技術新聞來源中
  篩選、去重、由 LLM 依「對開發者的重要性」精選出當日至多 10 則，翻譯成繁體中文摘要推播。
- **公開儀表板**：GitHub Pages 上的單頁網站，呈現「今日精選新聞 → 本週熱門榜單 → 上次榜單變化
  摘要」，並提供 `feed.xml`（Atom）供 RSS 閱讀器訂閱；repo 若轉為 private 會自動偵測並靜默停止
  發佈。

## 技術亮點

### 零維運、全免費的基礎設施

- 整條 pipeline 只依賴 **GitHub Actions**（執行）＋ **Discord Channel Webhook**（推播）＋
  **Gemini 免費層 Flash 系模型**（LLM）＋ **GitHub API**（資料來源），沒有任何常駐伺服器、資料庫
  或付費方案。跑完即退的一次性 CLI job（`NestFactory.createApplicationContext()`，保留 NestJS
  DI 但不啟 HTTP server）。
- **不自建每日星星快照**：本週增星一律直接借用 GitHub Trending 官方週增量與 Search API
  `created:>7天`，不做 day-over-day 自建比對，降低維運與 API 用量。
- 雙離峰 cron（UTC `07` / `37` 分）＋ guard 互相補位，避免單次排程漏跑；狀態只在**實際變更**時
  才 commit，且 commit 落在獨立的 `state` 分支，不污染 `develop`/`main` 的開發歷史。

### 節制 LLM、把「事實」和「敘事」分工清楚

- **新聞策展每日僅呼叫 Gemini 一次**（`gemini-3.1-flash-lite`）；去重完全**零 LLM**（見下）；
  repo 簡介**一生只生成一次並快取**，之後竄升／重新進榜直接讀快取，不重打 API。
- LLM **不產生任何事實數據**——星數、連結、名次、發佈日期一律由程式提供並直接放進 Discord
  embed／頁面；LLM 只負責「這則新聞為什麼重要」「這個 repo 在做什麼」這類敘事性內容。就算 LLM
  抽風、生成離題內容，數字與連結永遠是真的。
- 對 Gemini 的呼叫內建 429/503 指數退避 + jitter 重試（`src/llm/llm.service.ts`），空回應
  （多為 `MAX_TOKENS` 截斷或安全過濾）刻意**不重試**——重送同一 prompt 通常仍空，重試只會白白
  多燒一次免費層配額，改為交由呼叫端走降級路徑。

### 用「結構」而非「文字指令」馴服單次生成的 LLM（實測踩坑後的修正）

新聞策展 prompt（`src/curation/curation-prompt.ts`）在開發過程中踩過兩個具體的坑，修法很能
說明「單次生成的 LLM 不會真的照順序執行指示」這件事：

1. **官方發布 vs. 社群熱度的優先序**：一開始只用文字指示「先窮盡評估官方發布，社群熱度只補
   剩餘名額」，實測**無效**——total 遠低於上限時，LLM 仍會在同一次生成裡把官方發布和社群熱度
   混著選，因為單次生成沒有「先做完一組再做下一組」這種程序性執行。後來改成**結構性保證**：
   回應拆成 `officialPicks` / `communityPicks` 兩個獨立 JSON 陣列，LLM 只需要把每則候選正確
   分類（比「記得執行順序」簡單得多），「官方優先」則交給合併邏輯**固定**把 `officialPicks`
   排在 `communityPicks` 之前。
2. **Batch composition 效應**：候選池變大時（例如同一批新聞在候選數從 35 則漲到 41 則），LLM
   會刷掉候選池較小時原本會收錄、且客觀上仍符合「重大發布」的候選，因為 LLM 是跟「同批其他候選」
   相對比較，而非對每則各自核對絕對判準。修法是在 prompt 中明訂「重要性判準是絕對的，與候選池
   大小無關」的錨點，要求 LLM 針對每則候選各自核對固定判準，而不是跟同批其他候選比較著選。

### 動態新聞配額——讓「至多 10 則」盡量被填滿，又不犧牲 AI 為主

- AI 新聞**不設固定則數下限**，逐一評選、合格皆收；DevOps／後端／前端合計預設 `≤3`。
- 當日 AI 供給不足以撐滿隱含額度（`10 − 3 = 7`）時，把 AI 未用滿的名額動態讓給非 AI（上限放寬
  至 `10 − AI 則數`），確保「至多 10 則」的名額不會被浪費，同時只在 AI 確實不足時才放寬——不是
  無條件放寬（`effectiveNonAiCap`，`src/curation/curation-quota.ts`）。
- 非 AI 三領域依 DevOps ＞ 後端 ＞ 前端優先序裁切；並設**單一來源上限**（每來源最多 2 則，僅在
  非 AI 候選池 > 3 則時生效）——避免單一高產量來源（例如 `cloudflare-blog` 主題週單日投稿量大）
  一次佔滿當日非 AI 全部名額、排擠其他來源。

### 三層決勝排序的候選漏斗（Stage A，零 LLM）

`src/news/funnel.ts` 對抓進來的候選新聞做過濾＋加權＋收斂：

- 有社群分數的來源（HN、Lobste.rs、Reddit）依 tier 門檻過濾；無社群分數的一手來源（官方 blog／
  GitHub Releases）**不設分數門檻**，改給統一基準分，天然視為強訊號。
- 加權：`base × tierWeight + 交叉驗證加權（同時被 ≥2 來源提到）+ 榜單相關性加權（提到目前榜上
  repo）`。
- 排序決勝鏈：`加權分數 ↓ → 跨來源輪流分配序 ↓（僅同分無分數候選之間）→ normalizedUrl ↑`。
  這條「跨來源輪流分配序」是實測踩坑後加的：若單純用 URL 字母序決勝，量體大的來源（字母序
  偏前）會在收斂截斷前佔滿名額，導致其他一手來源整批出局，連 1 則都拿不到候選池。改為逐輪
  各來源依序各發 1 則（最多 3 輪），保證只要收斂上限有餘裕，每個活躍來源至少有 1 則能進候選池。
- 無分數候選另有 30 天新鮮度視窗，避免封存舊文被討論區重新提及而混入候選集。
- GitHub Releases 另有版本噪音過濾（`src/news/release-filter.ts`）：丟棄 pre-release
  （`-alpha`/`-beta`/`-rc`，含 CPython/PEP 440 無連字號寫法如 `3.15.0b4`）與純 patch release；
  安全修補（`security`/`CVE`/`advisory`）即使是 patch 也保留。

### 去重：URL 正規化為主力、標題相似度補漏，全程零 LLM

`src/news/dedup.ts`：先以正規化 target-URL 合併（`dedupByUrl`），同一連結只留分數最高者為代表、
`sources[]` 累積不重複；再以標題 [Jaccard 相似度](https://en.wikipedia.org/wiki/Jaccard_index)
（閾值 0.6）補漏合併「不同連結但其實是同一件事」的殘留重複。整個去重流程不呼叫 LLM 一次。

### 冪等、單一狀態、防幻覺

- `state/board.json` 是**唯一權威狀態**（榜單快照＋簡介快取＋已推新聞紀錄＋兩個時間戳），只經
  `StateStore` 讀寫，`save()` 為**原子寫入**（先寫 `.tmp` 再 `rename`，避免半套壞檔）。
- `lastNewsPushAt` / `lastBoardPushAt` 雙 guard，抵抗雙離峰 cron 同時觸發造成的重複推播；狀態
  **必須在推播成功後才寫回**，任何一步失敗都不會留下半套狀態。
- Pipeline 頂層把「榜單段」與「晨報段」隔離編排（`src/pipeline/pipeline.service.ts`）：兩段各自
  已處理已知失敗模式（guard 跳過、空內容、推播失敗皆 best-effort 告警不擲錯），頂層的
  try/catch 只是未預期例外的安全網——任一段出現未預期錯誤，仍會 best-effort 告警、不中止另一段、
  已成功落檔的另一段狀態不回滾。

### 來源隔離容錯

任一新聞或榜單來源失敗（抓取逾時、解析失敗、來源回傳 0 筆）都**不會使整條 pipeline 失敗**，會
發送帶來源 `id` 的紅色告警 embed、其餘來源續行。GitHub Pages 發佈段同理：可見性查詢失敗、渲染
失敗、寫檔失敗都會告警但不中止晨報／榜單段。

### 發佈：全有或全無、跟著 repo 可見性自動開關

`src/publish/publish.service.ts`：repo 轉為 private 時自動偵測並靜默跳過發佈（不留下 404 孤兒
站台）；`index.html` 與 `feed.xml` 兩份產物**全有或全無寫檔**——`index.html` 刻意最後寫入，
因為部署 workflow 以 `hashFiles('public/index.html') != ''` 當作部署 gate，讓它兼任「提交點」，
不可能部署出一個既有訂閱者全部 404 的半套站台。

### 測試優先

488 個單元測試（62 個測試套件）涵蓋所有關鍵邏輯：trending 解析（快照測試）、兩領域歸類、榜單
diff、URL/標題去重、簡介快取命中、新聞配額與字數上限、來源 schema/tier 加權、晨報 idempotency
guard、榜單七日節奏（162h 門檻）。外部呼叫（Gemini）一律 mock 測，並另測降級備援路徑。

## 系統架構

一支跑完即退的 NestJS CLI job，`radar.yml` workflow 內兩個 job 依序執行：

```
排程觸發（GitHub Actions 雙離峰 cron，UTC 22:07 / 22:37 → 台北 06:07 / 06:37）
│
├─ radar job
│   ├─ StateStore.load()（讀 state 分支最新快照）
│   ├─ 榜單段（BoardSegmentService，US「每 7 天」）
│   │   ├─ 未達 162h 節奏門檻 → 整段跳過（guard）
│   │   ├─ GitHub Trending（主力）＋ Search API `created:>7天`（補位，容錯隔離）
│   │   ├─ 兩領域關鍵字歸類（AI／前後端，寧缺勿濫）
│   │   ├─ 統一尺 weeklyStarsEstimate 排序，每領域取 top 15（追蹤深度）
│   │   ├─ 與上次快照 diff（新進／竄升／下降；掉出榜靜默、日後重回視為新進）
│   │   ├─ 新進／竄升才生成簡介（Gemini，一生一次、快取，竄升讀快取不重打 API）
│   │   ├─ 推播 Discord 榜單頻道
│   │   └─ 推播成功才寫回榜單狀態（原子寫入）
│   ├─ 晨報段（NewsSegmentService，每日）
│   │   ├─ 20+ 來源併發抓取（RSS/Atom、HN Algolia、Reddit weekly、GitHub Releases）
│   │   ├─ 零 LLM 去重（URL 正規化 → 標題 Jaccard 補漏）
│   │   ├─ 只留「新出現」（比對已推清單 seenNews）
│   │   ├─ Stage A 漏斗：分數門檻＋加權＋三層決勝排序＋跨來源輪流分配＋收斂上限 50
│   │   ├─ Stage B 策展：單次 Gemini 呼叫，語意去重＋依重要性排序＋officialPicks/communityPicks
│   │   ├─ 動態配額夾取（AI 不設限、非 AI ≤3 動態放寬、單一來源上限）
│   │   ├─ 推播 Discord 新聞頻道
│   │   └─ 推播成功才寫回晨報狀態（原子寫入）
│   └─ 任一狀態實際變更 → commit 到獨立 `state` 分支（no-diff 早退，不製造空 commit）
│
└─ publish job（needs: radar）
    ├─ 查詢 repo 可見性（private → 靜默跳過；查詢失敗 → 告警後跳過）
    ├─ 讀最新 state
    ├─ 純函式渲染 index.html + feed.xml（全有或全無寫檔）
    └─ 上傳並部署到 GitHub Pages（任一步驟失敗 → 告警 embed，不中止其他段）
```

### 模組結構（`src/`）

| 模組 | 職責 |
|------|------|
| `config` | env（zod）驗證，缺機密 fail-fast 不推播 |
| `github` / `sources` | GitHub Trending／Search／Repo API 抓取 |
| `classify` | 榜單兩領域（AI／前後端）關鍵字歸類 |
| `board` | 候選合併去重、`weeklyStarsEstimate` 統一尺估算、組榜 |
| `diff` | 榜單七日節奏判定、與上次快照 diff（新進/竄升/下降）、狀態 commit |
| `news` | 新聞來源抓取（fetchers）、去重、漏斗（Stage A）、版本噪音過濾 |
| `curation` | 每日單次 LLM 策展（Stage B）、配額夾取、prompt、降級備援 |
| `intro` | repo 簡介生成（LLM）與快取素材整理 |
| `llm` | Gemini 呼叫唯一封裝（退避重試） |
| `pipeline` | 榜單段／晨報段編排、段間隔離、版面切分（Discord embed chunk） |
| `discord` | Webhook 推播（embed 組版、429 退避、告警） |
| `publish` | GitHub Pages 頁面／Atom feed 渲染、可見性偵測、發佈編排 |
| `state` | `state/board.json` schema 與 `StateStore`（原子讀寫） |

## 新聞來源清單

新聞來源是**唯一設定檔** `src/config/news-sources.ts`——增刪修來源只改這個檔案，不動任何
抓取／漏斗程式碼。目前共 25 個設定項，19 個啟用中：

### Tier 1：常開高訊號（跨領域聚合，有社群分數）

| 來源 id | 類型 | 領域 | 說明 |
|---------|------|------|------|
| `hn` | HN Algolia API | 跨領域 | Hacker News 近 7 天週熱門 |
| `lobsters-ai` | RSS | AI | Lobste.rs `ai` tag |
| `lobsters-devops` | RSS | DevOps | Lobste.rs `devops` tag |
| `lobsters-programming` | RSS | 跨領域 | Lobste.rs `programming` tag |
| `reddit-localllama` | Reddit weekly RSS | AI | r/LocalLLaMA 週熱門 |
| `simonwillison` | RSS | AI | Simon Willison 個人部落格全文 feed |

### Tier 2：高精準一手來源（官方發布，漏斗不設分數門檻）

| 來源 id | 類型 | 領域 | 狀態 | 說明 |
|---------|------|------|------|------|
| `gh-nodejs` | GitHub Releases Atom | 前後端 | 啟用 | Node.js 官方發佈 |
| `gh-cpython` | GitHub Releases Atom | 前後端 | 啟用 | CPython 官方發佈 |
| `gh-typescript` | GitHub Releases Atom | 前後端 | 啟用 | TypeScript 官方發佈 |
| `gh-kubernetes` | GitHub Releases Atom | DevOps | 啟用 | Kubernetes 官方發佈 |
| `openai-blog` | RSS | AI | 啟用 | OpenAI 官方 blog |
| `deepmind-blog` | RSS | AI | 啟用 | DeepMind 官方 basic feed |
| `anthropic-news` | RSS | AI | **停用** | 無公認官方 RSS 端點，避免用第三方中轉站取代 |
| `vue-blog` | RSS | 前後端 | 啟用 | Vue.js 官方 blog |
| `web-dev` | RSS | 前後端 | **停用** | Feed 已逾兩月未更新，形同啞源 |
| `cloudflare-blog` | RSS | DevOps | 啟用 | Cloudflare 官方 blog |
| `cncf-blog` | RSS | DevOps | 啟用 | CNCF 官方 blog |
| `github-next` | RSS | AI | 啟用 | GitHub Next 官方實驗性功能部落格 |

### Tier 3：選配實驗來源（更高門檻、更低權重）

| 來源 id | 類型 | 領域 | 狀態 | 說明 |
|---------|------|------|------|------|
| `gh-vue` | GitHub Releases Atom | 前後端 | 啟用 | Vue core 發佈 |
| `gh-react` | GitHub Releases Atom | 前後端 | 啟用 | React 發佈 |
| `thenewstack` | RSS | DevOps | 啟用 | The New Stack |
| `reddit-devops` | Reddit weekly RSS | DevOps | **停用** | GitHub Actions runner IP 遭 Reddit 持續 403/429 |
| `reddit-node` | Reddit weekly RSS | 前後端 | **停用** | 同上 |
| `reddit-python` | Reddit weekly RSS | 前後端 | **停用** | 同上 |
| `reddit-reactjs` | Reddit weekly RSS | 前後端 | **停用** | 同上 |

> 停用的來源保留設定、不刪除（可隨時復用不動 code）；「解析到 0 筆」必定發告警並帶來源 `id`，
> 不會無聲略過。新增大型 feed 前會先實測量體——單日產出上百筆的來源（如 arXiv 分類 RSS）不予
> 收錄，因為會把候選集塞滿低品質內容、擠壓其餘來源在收斂上限內的曝光機會。

## 篩選機制總覽

一則新聞從「被抓到」到「出現在推播裡」，依序經過：

1. **抓取**：依 `type` 分派 fetcher（`rss-parser` / HN Algolia API / GitHub Releases Atom /
   Reddit weekly RSS），各來源獨立容錯，失敗不影響其他來源。
2. **只留新出現**：比對 `state.publish.feed` / `seenNews` 已推清單，過濾掉推播過的連結。
3. **零 LLM 去重**：URL 正規化合併為主力，標題 Jaccard 相似度（閾值 0.6）補漏；同一則新聞若被
   多個來源同時報導，會合併為一筆並記錄 `sources[]`（≥2 即視為交叉驗證強訊號）。
4. **版本噪音過濾**（僅 GitHub Releases）：丟棄 pre-release／純 patch release，安全修補保留。
5. **Stage A 漏斗**：分數門檻過濾 → 加權（tier 權重＋交叉驗證加權＋榜單相關性加權）→ 三層決勝
   排序（加權分數 → 跨來源輪流分配序 → URL 字母序）→ 收斂取前 50 筆。
6. **Stage B 策展**（每日僅此一次 LLM 呼叫）：Gemini 讀候選清單，完成語意去重、依「對開發者的
   重要性」（非熱度）評選、分類為 `officialPicks` / `communityPicks`，精煉為繁體中文標題（≤70
   字）與內容（≤500 字）。
7. **動態配額夾取**：`officialPicks` 固定排在 `communityPicks` 之前；AI 不設限、非 AI 依供給
   動態夾在 3～7 則之間；非 AI 內部依 DevOps ＞ 後端 ＞ 前端排序，並套用單一來源上限。
8. **推播**：全部通過的項目組成 Discord embed 推去新聞頻道，並寫入 `state.publish.news` 供
   GitHub Pages 頁面／Atom feed 使用（與 Discord 推播內容保證是同一份資料，不會不一致）。
9. **降級備援**：若當日 Gemini 呼叫失敗（重試耗盡／空回應），走降級路徑——寧可呈現精簡版
   （只有標題與連結，不含精煉內容），也不整段開天窗不推播。

## 榜單機制

- **來源**：GitHub Trending 頁面（主力，官方週增量 `starsThisWeek`）＋ GitHub Search API
  `created:>7天`（補位，估算週增星）。任一來源失敗、或主力抓到 0 筆，皆會告警並讓另一來源續行。
- **統一尺**：`weeklyStarsEstimate()`（`src/board/weekly-stars.ts`）把兩種來源的「本週增星」
  換算到同一把尺，且**以總星數為上限**——不會讓極新的 repo 被線性外推放大到不合理的數字。
- **兩領域歸類**：AI／前後端，依 topics／description 關鍵字詞界比對（`src/classify`）；兩者皆
  未命中則排除（寧缺勿濫）。DevOps 已於 2026-07-15 從榜單領域移除（實測歸類正確率 0），但新聞
  側的 DevOps 領域與來源不受影響——兩者是刻意獨立的兩條資料流。
- **推播節奏**：每 7 天推一次、只呈現差異，由 `lastBoardPushAt` 計時（非 cron），162h 門檻
  （非整數 168h，含 6h 寬限吸收 cron 延遲與雙班抖動，避免節奏隨時間單向漂移）。
- **變化偵測**：與上次快照比對名次、產生「新進 / 竄升 / 下降」三類；掉出 top 10 當次靜默，
  日後重回視為新進而非「跌出後又回來」，避免混淆的敘事。

## 技術棧

| 用途 | 技術 |
|------|------|
| 執行環境 | Node.js 24、TypeScript（strict） |
| 應用框架 | NestJS（`createApplicationContext`，一次性 CLI job） |
| LLM | `@google/genai`（Gemini 免費層 `gemini-3.1-flash-lite`） |
| HTML 解析 | `cheerio`（GitHub Trending 頁面解析） |
| RSS/Atom 解析 | `rss-parser` |
| Atom feed 產生 | `feed` |
| 設定驗證 | `zod` |
| 排程與部署 | GitHub Actions（`workflow_dispatch` + 雙 cron）、GitHub Pages |
| 推播 | Discord Channel Webhook（三頻道分流：新聞／榜單／告警） |
| 測試 | Jest、ts-jest |

## 環境需求

- Node.js 24 LTS（本機建議 nvm `24.x`；CI 用 `actions/setup-node@v5` `node-version: 24`）
- npm

## 機密（五項皆必填）

| 變數 | 用途 |
|------|------|
| `DISCORD_NEWS_WEBHOOK_URL` | 每日晨報推播目的地 |
| `DISCORD_BOARD_WEBHOOK_URL` | GitHub repo 榜單推播目的地 |
| `DISCORD_ALERT_WEBHOOK_URL` | 告警訊息目的地（含連通測試、來源失敗、發佈失敗） |
| `GH_API_TOKEN` | GitHub API（唯讀 public repo；不可用 `GITHUB_` 前綴，Actions 會擋） |
| `GEMINI_API_KEY` | Gemini API |

**機密只走環境變數／GitHub Actions Secrets，絕不入庫**（`.env` 已列入 `.gitignore`）。

## 本機執行

```bash
npm ci
npm run build

# 以環境變數提供機密（勿寫進檔案）
DISCORD_NEWS_WEBHOOK_URL="https://discord.com/api/webhooks/…" \
DISCORD_BOARD_WEBHOOK_URL="https://discord.com/api/webhooks/…" \
DISCORD_ALERT_WEBHOOK_URL="https://discord.com/api/webhooks/…" \
GH_API_TOKEN="…" \
GEMINI_API_KEY="…" \
node dist/main.cli.js
```

Windows PowerShell：

```powershell
$env:DISCORD_NEWS_WEBHOOK_URL="https://discord.com/api/webhooks/…"
$env:DISCORD_BOARD_WEBHOOK_URL="https://discord.com/api/webhooks/…"
$env:DISCORD_ALERT_WEBHOOK_URL="https://discord.com/api/webhooks/…"
$env:GH_API_TOKEN="…"; $env:GEMINI_API_KEY="…"
node dist/main.cli.js
```

缺任一機密即 1 分鐘內清楚失敗、exit≠0、不推播（fail-fast）。發佈段（`PUBLISH_MODE=1`）另見
[quickstart](specs/008-pages-publish/quickstart.md)。

## 測試

```bash
npm test
```

488 個單元測試、62 個測試套件，涵蓋所有關鍵邏輯（見[測試優先](#測試優先)）。

## GitHub Actions

`.github/workflows/radar.yml`：`workflow_dispatch` + 雙離峰 cron（UTC `7 22 * * *` /
`37 22 * * *`＝台北 06:07 / 06:37），內含 `radar`（榜單＋晨報）與 `publish`（GitHub Pages 發佈，
`needs: radar`）兩個 job。於 repo Settings → Secrets and variables → Actions 設定五項機密，並在
Settings → Pages 把 Source 設為 **GitHub Actions** 後，於 Actions 頁 **Run workflow** 手動驗證。

狀態僅在實際變更時由 `radar-bot` commit 到獨立的 `state` 分支（no-diff 早退；`develop`/`main`
不會出現這類 bot commit）。

## 開發歷程（Spec-Driven Development）

| Feature | 目錄 | 內容 |
|---------|------|------|
| F1 | `specs/001-foundation` | 專案骨架、狀態存取、推播通道、排程 |
| F2 | `specs/002-board-sources` | 榜單來源抓取與兩領域歸類 |
| F3 | `specs/003-board-state-diff` | 榜單狀態快照與變化偵測（七日節奏） |
| F4 | `specs/004-news-ingest` | 新聞來源設定檔與零 LLM 過濾漏斗 |
| F5 | `specs/005-repo-intro` | LLM 封裝與 repo 簡介生成 |
| F6 | `specs/006-news-curation` | 每日晨報單次 LLM 策展與降級備援 |
| F7 | `specs/007-pipeline-push` | Pipeline 端到端編排與 Discord 組版 |
| F8 | `specs/008-pages-publish` | GitHub Pages 儀表板 + RSS/Atom feed 發佈 |

每個 Feature 從 `develop` 各自 branch，走完整 Spec Kit 流程
（`specify → clarify → plan → checklist → tasks → analyze → implement`）後以 `--no-ff` 合併
回 `develop`。

## 專案文件索引

- **[憲章](.specify/memory/constitution.md)**：八條非協商原則 + 技術與安全約束，最高規範。
- **[開發指南](docs/tech-radar-dev-guide.md)**：架構決策、資料來源選型、Discord 版面、排程設定、
  Feature 規劃全文。
- **[CLAUDE.md](CLAUDE.md)**：給 Agent 的協作指引（真實來源優先序、commit 規範、SDD 流程）。
- 各 `specs/NNN-*/`：每個 Feature 的 spec／plan／tasks／contracts／checklists，是該 Feature
  實作的第一手依據。
