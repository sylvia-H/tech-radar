# Tech Radar — 開發指南

> 每日一次**晨報**（台灣時間約 06:00）自動追蹤近一週最受關注、新崛起的 GitHub repo（**榜單：AI / 前後端** 兩領域）與相關技術討論（**新聞：AI 為主，兼及 DevOps / 後端 / 前端**）。**榜單與新聞的領域集合刻意不同**——榜單的 DevOps 已於 2026-07-15 移除（實測歸類正確率 0、訊號量級過低，見 §3.2 註），新聞的 DevOps 配額與來源不受影響。晨報固定推**精選 6 則對開發者最重要的新聞**（以 AI 為主，重要度優先於熱度；每則精煉為繁中標題 ≤50 字＋內容 ≤300 字）；repo 榜單變化則**每七天**推一次（與「本週增星」這把七日尺對齊），**只呈現自上次以來的變化**，並為**新進榜與竄升**的 repo 附上 **250 字以內的繁體中文簡介**，透過 Discord 推播到你的手機。純自用、全免費、走 Spec-Driven Development（GitHub Spec Kit + Claude Code）。

---

## 0. 設計摘要與關鍵決策

| 面向       | 決策                                                                                                   | 理由                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| 執行環境   | **GitHub Actions 排程 workflow**                                                                       | 純排程任務（1 次/日）不需要常駐伺服器。Actions 免費、零維運、內建 secrets 與 cron。     |
| 排程       | Actions `schedule:` 每日晨報**雙 cron**（主排 + 補跑，UTC）；榜單每七天一次（由程式依狀態計時，門檻 162h）        | Actions cron 可能延遲/跳過，雙 cron + 狀態 guard 保證每日恰一次；非即時任務可容忍延遲。 |
| 星星暴增   | 讀 **GitHub Trending weekly 的「stars this week」** + Search API `created:>7天`                        | GitHub 官方替你算好一週星星增量，**不必自存快照與 day-over-day 對比**。                 |
| 變化追蹤   | 持久化「上次推播榜」快照，每七天 diff 出**新進 / 竄升 / 下降**（掉出榜靜默）                                       | 「只看變化」的核心；七日尺配七天節奏，兩次比較的視窗不重疊，且不洗版。                  |
| 新聞晨報   | 每日精選 **6 則**（AI 為主，DevOps/後端/前端合計 ≤2），每則**繁中標題 ≤50 字＋內容 ≤300 字**：**結構性去重（target-URL 正規化）→ 門檻 → 單次 LLM 依「開發者重要性」策展** | 控制資訊量、防通知疲勞；**依對開發者的重要性排序（非熱度）**，重要度優先於數量；新聞每日僅 1 次 LLM。                                              |
| 新聞來源   | **單一設定檔集中管理**（`news-sources.ts`），分三層：Tier 1 高訊號聚合 / Tier 2 高精準一手 / Tier 3 選配實驗                | 增刪修來源只改設定檔、不動 pipeline code；用一手來源（releases/官方公告）換掉低訊噪比聚合源。 |
| repo 簡介  | 首次進榜時抓 README → Gemini 產 ≤250 字簡介 → **按 repoId 快取（獨立於榜單快照）**                     | 只生成一次，省額度、內容穩定；跌出榜再進榜也不重生成，且天然只介紹「有變化」的 repo。   |
| 狀態存放   | **commit 回 repo 的 `state/board.json`**（榜單快照 + 簡介快取 + 已推新聞紀錄）                         | 「只看變化」需要跨執行的狀態；committed JSON 零外部依賴，順帶替排程保活（§2.1）。       |
| 推播       | **Discord Channel Webhook**（HTTP POST）                                                               | 只推播不收訊息 → 不需要 bot、gateway、Message Content Intent。                          |
| LLM        | **Gemini 免費層（Flash 系）**                                                                          | 簡介 + 摘要用量遠低於 ~1,500 RPD 免費上限。                                             |
| DB（歷史） | 不用                                                                                                   | MVP 不需要通用資料庫；星星歷史不自存（見 §3）。                                         |

> **NestJS 的角色**：用 `NestFactory.createApplicationContext()` 跑成一次性 CLI job（保留 DI/模組結構、不啟 HTTP server、跑完即退），完美契合 Actions。

---

## 1. 系統架構

```
  GitHub Actions（每日約 06:00 台北 · UTC cron）              Discord
  ┌────────────────────────────────────────┐               （你的私人频道）
  │ 每日 06:00 晨報 · 榜單每七天           │                     ▲
  │  checkout（含 state/board.json）         │                     │ HTTP POST
  │      │                                   │                     │ (embeds)
  │      ▼                                   │   Gemini API   ┌────┴────┐
  │  NestJS app context (CLI)                │──(Flash,免費)─▶│ Webhook │
  │   1. 抓當前榜單                          │                └─────────┘
  │      ├ GitHub Trending weekly            │
  │      └ GitHub Search (created:>7d)       │
  │   2. 載入上次榜單 → diff（新進/竄升/下降）│
  │   3. 對「新進榜」抓 README → Gemini 簡介  │  ← 只對變化的 repo 生成，並快取
  │   4. 抓相關討論（RSS）取變化              │
  │   5. 組「變化摘要」→ POST 到 Discord      │
  │   6. 存回 state/board.json（含簡介快取）  │  ← commit 回 repo
  └────────────────────────────────────────┘
```

- 無伺服器、無通用 DB、無常駐程序。全免費、近乎零維運。
- 唯一持久狀態：`state/board.json`（榜單快照 + 簡介快取 + 已推新聞紀錄），由 workflow commit 回 repo。
- 排程解耦：每日晨報只出新聞精選；repo 榜單變化每七天推一次（以 `state` 內的 `lastBoardPushAt` 計時，門檻 162h，抗漏跑/延遲）。

---

## 2. 免費 Infra 選型

### 2.1 執行環境：GitHub Actions

- **額度**：public repo 無限；private repo 每月 2,000 分鐘。一天 2 次觸發（主排 1～3 分鐘；補跑因 guard 多半數十秒內結束）→ 一個月遠低於限額。
- **注意**：
  - cron 是 **UTC**，尖峰時可能延遲數分鐘（偶爾更久）。摘要推播可接受。
  - 排程 workflow 在 repo **連續 60 天無活動**會被停用；每次 run 都 commit `state/board.json` 即可保活。

### 2.2 狀態存放：`state/board.json`

- 一個 commit 回 repo 的 JSON，兼顧「上次榜單快照」、「簡介快取」與「已推新聞紀錄」。體積小（數十 KB），且被 git 版本化是免費的歷史紀錄。

### 2.3 推播與串接方式：Discord Channel Webhook

本專案是「自用」，串接非常單純，**不需要前後台、帳號或訂閱系統**：

1. 在 Discord 建一個自己的伺服器與一個私人頻道。
2. 頻道設定 → 整合 → Webhook → 新增 Webhook，複製 **Webhook URL**（格式 `https://discord.com/api/webhooks/{id}/{token}`）。
3. 把這個 URL 放進 GitHub Actions Secrets（`DISCORD_WEBHOOK_URL`），**不要進 repo**。
4. job 每次 POST 含 `embeds` 的 JSON 到該 URL 即完成推播。

也就是說——**「開一個頻道、拿到它的 webhook URL、寫進 env」就等於訂閱了**，沒有輸入框/訂閱鈕/後台這回事。要停止收推播，把該 secret 移除或關掉 workflow 即可。注意 webhook URL 本身即是憑證：**持有它的人就能對該頻道發文**，務必當機密保管、別公開貼出。

### 2.4 LLM：Gemini 免費層

- Flash 系（如 `gemini-2.5-flash`），~15 RPM / ~1,500 RPD / 1M context。
- 用途：每個新進榜 repo 一次 250 字簡介 + 榜單日一段「本次變化」TL;DR + 每日一次新聞策展。穩定態榜單七天才有 0～數個新 repo → 用量極低。
- ⚠️ 免費層 prompt 可能被拿去改善模型 → 本專案只送公開資料，OK。加 429 指數退避。

### 2.5 GitHub API：Personal Access Token

- fine-grained、唯讀 public repo，放 Actions Secrets（`GH_API_TOKEN`）。認證後 5,000 req/hr、Search 30/min。抓榜單 + 少量 README fetch 遠在限額內。
- ⚠️ **secret 名稱不可用 `GITHUB_` 前綴**（GitHub 保留字首，存不進去），故命名為 `GH_API_TOKEN`。

### 2.6 發佈（擴充）：GitHub Pages 靜態儀表板 + RSS/Atom

- **本 repo 為 public → GitHub Pages 免費**。可把同一次 pipeline 的產出額外發佈成一頁靜態儀表板 + 一份可訂閱的 feed，讓雷達不只鎖在 Discord。
- **僅 public 啟用**：切成 private 須自動停用發佈，且不得影響 Discord 推播。不增加任何 LLM 呼叫。完整開發重點見 **§14**。

---

## 3. 星星暴增：不自存歷史

目標是「近一週最受關注、新崛起的 repo」。用兩個免費來源讓 GitHub 幫你算好，不必自存快照：

### 3.1 主力：GitHub Trending weekly

- 讀 `https://github.com/trending?since=weekly`。**每個 repo 標了「X stars this week」**——就是你要的週增量，官方算好、零狀態。
- 無官方 API，爬 HTML（`cheerio`）。頁面結構簡單穩定；第三方服務多要錢或不穩，自爬更划算。
- **領域過濾**：Trending 只能用程式語言分頁（`/trending/python?since=weekly`、`typescript`、`go`、`rust`、`shell`…），不能用 topic。做法：爬「全站 + 幾個高相關語言頁」，再對每個候選 `GET /repos/{owner}/{repo}` 取 `topics`，用兩領域（AI／前後端）關鍵字集合比對，命中才留。

```ts
$("article.Box-row").each((_, el) => {
  const fullName = $(el).find("h2 a").text().replace(/\s/g, ""); // "owner/name"
  const desc = $(el).find("p").text().trim();
  const lang = $(el).find('[itemprop="programmingLanguage"]').text().trim();
  const weekly = $(el).find(".float-sm-right").text();
  const starsThisWeek = parseInt(weekly.replace(/[^\d]/g, ""), 10); // ← 排名關鍵
});
```

### 3.2 補位：GitHub Search API（近 7 天新建、已很紅）

- 抓 Trending 會漏掉的「剛誕生就爆紅、尚未擠上榜」的新星：

```
GET /search/repositories?q=(llm OR rag OR agent OR gpt) created:>{今天−7天} stars:>30&sort=stars&order=desc
GET /search/repositories?q=(nextjs OR react OR svelte OR nodejs OR golang) created:>{今天−7天} stars:>20&sort=stars&order=desc
```

- 回傳是**當前總星數**，配合 `created:>7天前` 即等於「一週內誕生且已累積不少星」=「新崛起」，零狀態。

> **榜單為何沒有 DevOps 組**（2026-07-15 移除，F2 M1 驗收實測）：DevOps 榜的候選幾乎只靠 `docker` 命中，而 `docker` 是**部署方式**標籤、不是領域標籤——self-hosted 應用幾乎都貼，導致 `docker-steam-headless`（Steam 遊戲容器）、`docker-mailserver`（郵件伺服器）、`teledrive`（React+FastAPI 檔案管理器，還因 DevOps 優先序較高而被自前後端榜錯置）全數誤收，**歸類正確率 0/3**；且其週增星僅 259/136/25，對比 AI 榜的 13,195/7,129 根本排不上號。僅收窄 `docker` 不足以解決（`docker-mailserver` 真的貼了 `kubernetes`；「能跑在 k8s 上」與「是 k8s 工具」在零 LLM 的純關鍵字分類下無法區分），故直接移除領域。**此決策僅限榜單——§4 的新聞 DevOps 配額與三個專屬來源全數保留**，因為「DevOps 沒有爆紅 repo」不等於「沒有值得讀的 DevOps 消息」。

### 3.3 合併與排名

- 兩來源 union → 用 `repoId`（GitHub numeric id，抗改名）去重。
- 排序鍵：Trending 來源用 `starsThisWeek`；Search 來源用「總星數 ÷ 建立天數」近似速度（**上限為總星數**，見下）。
- 每領域各取 **top 15** 作為「當前榜單」（**追蹤深度**），交給 §5 做變化比對。**推播呈現另取「跨領域綜合 top 10」**：把兩領域 30 筆以統一尺「**估算本週增星**」合成單一排名、**保底每領域至少 2 席**，只推前 10（見 §5.2 / §5.3 / §7）。**追蹤深度（15）大於推播呈現（10）**，`RANK_JUMP_THRESHOLD` 等級的竄升/下降才有被偵測的空間。
  - **統一尺「估算本週增星」**（F2 建立於 `src/board/weekly-stars.ts`，**F3/F7 沿用同一把尺、不另發明**）：
    - Trending repo：用 `starsThisWeek`（官方週增量）。
    - Search-only repo：`min(round((總星數 ÷ max(建立天數, 1)) × 7), 總星數)`。
    - 同時在兩來源者：以 `starsThisWeek` 為準。
  - **為何有「總星數」上限**：補位只撈 `created:>今天−7天`，這些 repo 的星**全部是本週累積的**，故「本週增星」的真值上界就是總星數。無上限時 `×7` 是憑空外推——今日新建、已 300 星者會被估成 2,100，壓過官方週增星 1,800 的 Trending 龍頭，跨領域綜合 top 10 會被灌爆。`建立天數 ≤ 7` 時上限恆生效（等價於直接採計總星數）；保留 `min` 形式只為讓建立天數異常（> 7）的樣本仍走換算公式。`max(建立天數, 1)` 防除零；建立天數無法判定時視為未知、不得當作 0（等同宣稱今日新建）。
    > 此上限係 F2 實作後 code review 定案（2026-07-15），已回填 `specs/002-board-sources/spec.md` FR-005。**F3/F7 實作綜合排名時直接引用 F2 的 `weeklyStarsEstimate()`**，不得重寫一份無上限的公式。

---

## 4. 資訊來源（新聞 / 討論）

補充脈絡用。原則：**能拿 RSS/JSON 就別爬 HTML**、**盡量用「本週熱門」排序對齊週視角**、**只收「有機會改變最終 6 則」的來源——其餘都是維護負債**。

**領域優先序**：**AI 為重點**；其次 DevOps、後端、前端（三者在晨報中**合計 ≤2 則**）。後端只關注 **Node.js 與 Python**；前端以 **TypeScript** 為主、Vue/React 重要性最低；**CSS 技巧/教學一律不收**。

### 4.1 來源策略：分三層，用高精準一手來源換掉低訊噪比聚合源

來源清單的關鍵不在「多元/數量」而在**精準度**：社群聚合源（Dev.to、泛用 subreddit、TechCrunch）量大而吵，最能直接命中「開發者重要性」的一手來源（release 發布、官方模型/API 公告、安全通報）反而該補上。由於最終 6 則是由**單次 LLM 從 15～25 則已去重候選**中挑出（§4.4），吵的來源其實污染不了輸出——但每多一個來源就多一分**維護/壞掉面**與前處理成本。判準因此很清楚：**只留有機會改變 top-6 的來源**，並分三層管理：

| 層級                  | 定位                                                                                       | 漏斗處理（§4.4）                                                 |
| --------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| **Tier 1 常開高訊號** | 跨領域社群聚合：穩定產出重要項目，彼此重疊剛好餵養「≥2 來源=強訊號」的交叉驗證             | 標準分數門檻與加權                                               |
| **Tier 2 高精準一手** | release 發布、官方 AI 公告、安全通報：幾乎零雜訊，直接命中第一順位重要性分類               | 無社群分數 → 不設分數門檻，天然視為強訊號                        |
| **Tier 3 選配實驗**   | 領域補充、社群風向：對 top-6 邊際貢獻低                                                    | 更高門檻、更低權重；**可隨時從清單移除，不動 code**              |

**已淘汰的來源**（訊噪比低或定位不合）：Dev.to 各 tag feed（量最大、平均重要性最低）、TechCrunch AI（商業/募資框架，正是策展要壓低的類型）、CSS-Tricks / Smashing Magazine（常青教學文，且本雷達不收 CSS 技巧）、r/webdev（吵）、r/golang、r/rust（後端改聚焦 Node.js/Python）。這些來源偶有的重要文章，會經由 HN / Lobste.rs 自然補上。

### 4.2 來源清單：單一設定檔集中管理

所有新聞來源**集中於一個設定檔**（`src/config/news-sources.ts`），pipeline 只讀這份清單抓取——**日後增刪修來源只改這個檔案，不動任何 pipeline 程式碼**。

```ts
// src/config/news-sources.ts — 新聞來源的唯一清單（增刪修只改這裡）
export interface NewsSource {
  id: string; // 唯一鍵：抓取告警、seenNews 統計都引用它
  type: "hn-algolia" | "reddit-weekly" | "rss" | "github-releases";
  url: string;
  domain: "ai" | "devops" | "frontend-backend" | "cross"; // 前後端合併（F4 clarify 2026-07-16）；cross 由關鍵字歸類（§4.3）
  tier: 1 | 2 | 3; // 漏斗依 tier 加權（§4.4）
  enabled?: boolean; // 預設 true；先停用觀察比直接刪安全
}
export const NEWS_SOURCES: NewsSource[] = [
  /* 初始清單如下表 */
];
```

#### Tier 1 — 常開高訊號（跨領域聚合）

| 來源                       | 取法                                                                                                                                     | domain | 為什麼值得                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------- |
| **Hacker News**（Algolia） | `https://hn.algolia.com/api/v1/search?tags=front_page`；週熱門用 `search?tags=story&numericFilters=created_at_i>{7天前unix}` 取高 points | cross  | 開發圈單一最高訊號源，含分數可排序。                     |
| **Lobste.rs 標籤 .rss**    | `https://lobste.rs/t/ai.rss`、`/t/devops.rss`、`/t/programming.rss`                                                                      | 各自   | 訊噪比比 HN 高、偏技術深度。                             |
| **Reddit r/LocalLLaMA**    | `https://www.reddit.com/r/LocalLLaMA/top/.rss?t=week`                                                                                    | ai     | 「本週實戰派在意什麼」的最佳指標，對齊週視角、免費穩定。 |
| **Simon Willison 部落格**  | RSS（`simonwillison.net`）                                                                                                               | ai     | AI 領域高訊號個人策展，穩定命中重要事件。                |

#### Tier 2 — 高精準一手（直接對應重要性分類）

| 來源                            | 取法                                                                                                                                                      | domain | 為什麼值得                                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------| ------ | ------------------------------------------------------------------------------------------------ |
| **GitHub Releases feeds**       | `https://github.com/{owner}/{repo}/releases.atom`：`nodejs/node`、`python/cpython`、`microsoft/TypeScript`、`kubernetes/kubernetes`；（低權重）`vuejs/core`、`facebook/react` | 各自   | 官方、穩定、幾乎零雜訊；精準命中第一順位重要性——**新版本 / breaking change / deprecation**。     |
| **官方 AI/模型公告**            | OpenAI、Anthropic、Google DeepMind 官方 blog/news RSS                                                                                                     | ai     | 一手公告取代二手報導，精準抓「重大模型/API 發布」。                                              |
| **Hugging Face Daily Papers**   | `huggingface.co/papers`                                                                                                                                   | ai     | AI 論文動向的高密度精選。                                                                        |

> **安全通報的折衷**：GitHub 至今**沒有官方整站 security advisory RSS**。最省事的做法是讓上列 `releases.atom` **兼當安全訊號**（安全修補通常伴隨 release）；日後要強化，再往清單加生態系 advisory feed 即可——只改設定檔。另外 releases feed 建議在抓取端**過濾 pre-release 與純 patch**（只留 major/minor 或安全修補），避免版本噪音灌爆候選池。

#### Tier 3 — 選配實驗（可隨時砍，不動 code）

| 來源                        | 取法                                                     | domain   | 備註                               |
| --------------------------- | -------------------------------------------------------- | -------- | ---------------------------------- |
| **The New Stack**           | `https://thenewstack.io/feed/`                           | devops   | 深度報導補充。                     |
| **Reddit r/devops**         | `/r/devops/top/.rss?t=week`                              | devops   | 社群風向。                         |
| **Reddit r/node、r/python** | `/r/node/top/.rss?t=week`、`/r/Python/top/.rss?t=week`   | frontend-backend | 對齊後端聚焦 Node.js / Python。    |
| **Reddit r/reactjs**        | `/r/reactjs/top/.rss?t=week`                             | frontend-backend | 抓前端社群風向用，低權重。         |

### 4.3 實作要點

- **統一「本週」口徑**：Reddit `t=week`、HN 過濾近 7 天、GitHub trending weekly，讓整份摘要時間軸一致。
- **歸類與去重**：正規化成 `{ title, url, summary, source, score, domain, tier }`——`domain` 列舉為 `ai | devops | frontend-backend | cross`（**前後端合併**，F4 clarify 2026-07-16），`domain` 與 `tier` 直接取自 `news-sources.ts` 的來源設定（releases 的 nodejs/cpython/typescript/vue/react、r/node、r/python、r/reactjs 皆標 `frontend-backend`），**只有 `cross` 來源（HN、Lobste.rs programming）需要用關鍵字歸類**（前後端相關項一律歸入 `frontend-backend`）；`summary` 為 feed 的摘要/描述節錄（截 ~500 字，供 §4.4 階段 B 產出 300 字內容的素材）。以 `url` 去重、以 `score`/新鮮度排序。
- 新聞同樣走「只推新出現」邏輯：記住上次推過的 url（見 §5.1 `seenNews`），只留**新出現**的討論，再交給 §4.4 漏斗篩選。

> 抓取禮貌：帶自訂 `User-Agent`、條件式請求（ETag / If-Modified-Since）、失敗退避重試。上線前逐一確認 feed URL 可用；「解析到 0 筆」要發告警（帶來源 `id`）而非無聲略過——壞掉的 feed 在 `news-sources.ts` 停用或替換即可，不動 code。

### 4.4 過濾漏斗與晨報精選（每日 6 則）

晨報**只推 6 則新聞**（AI ≥4；DevOps/後端/前端合計 ≤2），且以**對開發者的重要性排序（非熱度）**；每則以**繁體中文**呈現為**標題 ≤50 字＋內容 ≤300 字**。設計原則有三條，缺一不可：**去重要確實**（不回報一堆重複資訊）、**少花 LLM**（新聞策展每日只呼叫 Gemini 一次、不用向量檢索/embeddings）、**選重要而非選熱門**（重要度優先於分數）。

漏斗分兩段：**先用零 LLM 的結構性手段把重複與雜訊砍乾淨，最後只用一次 LLM 依重要性策展。**

#### 階段 A — 零 LLM 結構性去重與過濾（主力）

1. **target-URL 正規化去重（跨來源殺手鐧）**：HN / Reddit / Lobste.rs 對同一則新聞的討論，指向的是**同一個外部連結**。因此對每則抽出其**目標 URL**（新聞本體的連結，而非討論頁 permalink）並正規化後去重：
   - 小寫化 host、去 `www.`、統一結尾斜線；
   - 砍掉追蹤參數（`utm_*`、`ref`、`fbclid`、`gclid`…）；
   - 解常見短網址/轉址（`t.co`、`bit.ly`、`hn.algolia` 導向等，能便宜解就解）。
   - 以正規化後的目標 URL 為 key 合併：**同一則跨來源只留一筆**，保留分數最高者為代表，其餘來源記入 `sources[]`（供第 4 步交叉驗證計數）。這一步不花任何 LLM，就能殺掉絕大多數跨來源重複。
2. **標題近似去重（補漏）**：沒有共同目標 URL 的情況（例如兩篇不同部落格報同一件事），用便宜的字串相似度補一刀：標題正規化（去符號、小寫、去 stop words）後算 token 集合 **Jaccard**，超過門檻（起始 ~0.6–0.7，依實際校）即視為同一則、合併。仍是零 LLM。
3. **品質門檻（絕對下限）＋ tier 加權**：跨來源正規化分數後設硬門檻，低於即丟。建議起始值：HN points > 100、Reddit upvotes > 300、Lobste.rs score > 20（依實際流量再校）。門檻**只適用有社群分數的 Tier 1/3 來源**：**Tier 2 一手來源（releases/官方公告）無社群分數，不設分數門檻、直接進候選**；Tier 3 用更高門檻、更低權重。
4. **交叉驗證加權**：第 1 步合併後 `sources.length ≥ 2`（同事件出現在 ≥2 來源）→ 視為強訊號、優先入選（通常比任何單一分數更準）。Tier 2 項目即使只有單一來源，也**天然視為強訊號**（官方發布本身即是事實確認）。
5. **榜單相關性加權**：新聞內容**提到當前 repo 榜上的專案** → 加權，讓新聞服務於「你已在追的東西」。
6. **新鮮度 / 去歷史重複**：同分時取較新者；已在 `seenNews` 出現過的目標 URL 直接排除（見 §5.1），避免跨天重複回報。

> 經過階段 A，候選通常已收斂到約 **15～25 則、且大致無重複**，才進入唯一一次 LLM 呼叫。

#### 階段 B — 單次 Gemini 策展（每日唯一一次 LLM 呼叫）

把階段 A 的候選一次交給 Gemini（每則附 `title / domain / tier / score / sources 數 / 是否命中榜上 repo / summary（feed 摘要節錄，截 ~500 字）`），在**同一次呼叫**內完成三件事：

- **殘留語意去重**：Gemini 一次看到全部標題，能認出階段 A（純結構/字串）漏掉的「其實是同一件事」並丟掉——這就替代了 embeddings 想做的事，不必另建向量檢索與快取。
- **依「開發者重要性」挑 6 則**：明確要求 **重要 ≠ 熱門**——優先「會改變開發者怎麼做事」的內容：新工具/框架/版本釋出、breaking change、安全通報（CVE/advisory）、重大模型或 API 發布、標準與規範變動、重大 deprecation；壓低純爆紅的口水、drama、純觀點文。**分數只是提示、不是排序主鍵。** 配額為軟性上限：**AI ≥4；DevOps/後端/前端合計 ≤2**。非 AI 的取捨依領域優先序（§4 開頭）：DevOps 優先，後端只看 **Node.js / Python**，前端以 **TypeScript** 為主（Vue/React 重要性最低）；**CSS 技巧/教學文一律不選**。
- **每則精煉為繁中 50/300 格式**：以繁體中文輸出**標題 ≤50 字＋內容 ≤300 字**。內容須說清楚「發生什麼事＋為什麼對開發者重要」，**只依提供的 `title` 與 `summary` 節錄改寫，不得補充來源沒有的事實**。

> 本步**只做選擇、去重與改寫摘要，不得產生或竄改連結/數字**（連結與分數一律由程式帶）。整個新聞流程對 LLM 的用量固定為「每日 1 次」，與候選數無關。

> 若候選不足 6 則（冷門日），就推實際數量、不用湊滿；某類別挂零也沒關係（例如某天完全沒有夠格的前後端新聞）。配額是「上限約束」不是「硬性填滿」；同理，**寧可少而重要，也不要為湊滿而塞進不重要的熱門文**。

---

## 5. 變化追蹤：榜單每七天「只看變化」

榜單推播**不重述整份榜單**，只呈現「自上次榜單推播以來的變化」，且**變化以「跨領域綜合 top 10」為視窗計算**（非各領域全榜；見 §5.2）。節奏取**七天**，理由是它必須與榜單的尺對齊：「本週增星」是**七日指標**，若三天推一次，等於拿兩個**重疊四天**的七日視窗互比——兩次快照有超過一半是同一批星星，名次移動便無法代表真實的週對週變化。七天使兩次比較的視窗剛好不重疊，「這週 vs 上週」才成立；同時週指標幾小時內幾乎不動，七天一次也不會洗版（掉出 top 10 者當次靜默、不另報，日後重回即以新進呈現）。新聞晨報則每日獨立推送（見 §4.4），與榜單節奏解耦。

> **節奏由三天改為七天（2026-07-15，F3 clarify 定案，憲章 v1.3.0）**：原訂三天，經指出「三日節奏 × 七日尺 = 重疊視窗互比」而改為七天。決策全文見 `specs/003-board-state-diff/spec.md` Clarifications Session 2026-07-15。

### 5.1 狀態結構（`state/board.json`）

```jsonc
{
  "lastBoardPushAt": "2026-07-08T22:00:00Z", // 榜單上次推播；距今 ≥162h（7 天 −6h 寬限）才再推榜單
  "lastNewsPushAt": "2026-07-09T22:00:00Z", // 晨報上次推播；距今 <~18h 則本次跳過新聞段（雙 cron 去重 + 漏跑補推，見 §8）
  "board": {
    // 只存「上次推播的綜合 top 10」（≤10 筆）；45 追蹤深度（每領域 top 15）每次執行即時重建、不落地
    "123456789": {
      // key = repoId
      "fullName": "owner/name",
      "url": "https://github.com/owner/name",
      "language": "Rust",
      "domain": "ai",
      "starsThisWeek": 8600, // 上次看到的週增星
      "rank": 1, // 上次名次
      "firstSeenAt": "2026-07-08T22:00:00Z",
    },
  },
  "intros": {
    // 簡介快取「與榜單快照分開存」：跌出榜不刪快取，重新進榜直接命中、不重生成（見 §6）
    "123456789": { "intro": "……250 字簡介……", "introAt": "2026-07-08T22:00:05Z" },
  },
  "seenNews": [
    { "url": "https://…", "seenAt": "2026-07-09T05:00:00Z" }, // 帶時間戳才能按 7 天修剪
  ], // 已推過的討論；每次載入時剔除 seenAt 超過 7 天者，避免陣列無限膨脹
}
```

> **狀態只存推播榜（≤10），不存追蹤深度（30）**：30 筆（兩領域 × top 15）只在單次執行的記憶體中用來挑選綜合 top 10 與偵測竄升/下降，**不寫入 `state.board`**；`state.board` 只保留「上次推播的綜合 top 10」供下次 diff（top 10 外一律當新進，故無需存其名次）。`state.intros` 亦只會有「**曾進過 top 10**」的 repo（簡介只在進榜時生成），且**跌出不清除**以利重回時命中快取——兩者都不會膨脹到 30。

### 5.2 Diff 邏輯

```ts
// 綜合 top 10：把兩領域各自的 top 15（追蹤深度）合成單一推播榜
// prevIds = 上次快照的 repoId 集合（決勝第 3 層需要，見下方 cmp）
function pickPushBoard(board, prevIds) {
  const scored = allDomains(board).map((r) => ({
    ...r,
    // 統一尺「估算本週增星」一律引用 F2 的 weeklyStarsEstimate()（src/board/weekly-stars.ts），
    // 內含「以總星數為上限」的約束——**不得**在此重寫一份無上限的 (總星數/建立天數)*7（見 §3.3）
    weeklyStars: weeklyStarsEstimate(r),
  }));
  // 四層全序決勝比較器（F3 spec FR-004，2026-07-15 定案）：
  //   weeklyStars↓ → totalStars↓ → 新進者優先(!prevIds.has(id)) → repoId↑
  // 選榜全程（保底、競爭、指派名次）一律用這一把尺——**不得**在保底處另用「熱度」等替代判準，
  // 否則同一份輸入會用到兩套尺、平手時挑出的保底與最終名次對不起來（破壞 FR-004 確定性）。
  const cmp = compareForPushBoard(prevIds);
  // 保底：每領域先取 2 席（兩領域 → 2×2=4），其餘 6 席跨領域競爭
  const floor = domains.flatMap((d) => topN(scored.filter(byDomain(d)), 2, cmp));
  const rest = topN(exclude(scored, floor), 10 - floor.length, cmp);
  return assignRanks([...floor, ...rest].sort(cmp)); // key=repoId，rank #1..#10
}

const prev = loadState().board; // 上次推播的綜合 top 10（key=repoId，rank=綜合名次）
const curr = pickPushBoard(buildCurrentBoard(), new Set(keysIn(prev))); // 30 筆 → 綜合 top 10
const T = RANK_JUMP_THRESHOLD; // = 1（F3 spec FR-010 定案，2026-07-15）：名次只要動就算變化

const newcomers = keysIn(curr).filter((id) => !prev[id]); // 🆕 進入 top 10（帶簡介）
// 掉出 top 10（在 prev、不在 curr）**當次靜默**：不推卡、不另報「跌出」；簡介快取保留（見 §6），
// 日後重回時 curr 中它又不在 prev → 自然以 newcomers（新進）呈現。故不需計算 dropped。
const climbed = keysIn(curr).filter(
  (id) => prev[id] && prev[id].rank - curr[id].rank >= T,
); // 🔺 綜合名次竄升
const declined = keysIn(curr).filter(
  (id) => prev[id] && curr[id].rank - prev[id].rank >= T,
); // 🔻 綜合名次下降
// 竄升同樣附簡介（讀快取）；下降只報名次變化
```

- **決勝規則＝四層全序（F3 spec FR-004，2026-07-15 定案）**：`weeklyStars` ↓ → `totalStars` ↓ → **新進者優先**（不在上次快照者在前）→ `repoId` ↑。第 4 層保證**任兩筆必分出高下**，故名次不依賴 `Array.sort` 是否穩定（SC-008）。兩點易踩的坑：(1) **選榜全程只能用這一把尺**——保底席次若沿用 F2 領域內的兩層排序（`weeklyStars↓, repoId↑`，見 `board-builder.service.ts`），平手時挑出的保底會與最終名次用不同標準；(2) 因第 3 層依賴上次快照，**綜合名次是「當前候選 + 上次快照」共同的函式**，同一份候選配不同快照可得到不同（但各自確定）的名次——SC-008 說的「相同輸入」指此二者皆相同。
- **`RANK_JUMP_THRESHOLD` = 1，一律比較絕對綜合名次（F3 spec FR-010，2026-07-15 定案）**：名次前進即竄升、後退即下降，兩方向對稱；**被新進 repo 擠下來的純位移照實計為下降**，不做「共同成員相對名次」等同儕比較。理由摘要——(1) 新進只會把人往下推、不可能往上推，故**絕對名次前進不可能是假的**，竄升側零誤報；(2) 卡片顯示的就是絕對名次，改用相對名次會產出「🔺 竄升 `#5 → #6`」這種數字與箭頭矛盾的卡；(3) 下降側的純位移噪音**已知且被接受**，換取實作與心智從簡（使用者決策）；(4) 與憲章 III 的張力有界——項目數恆 ≤10、下降卡不帶簡介、七天才推一次，且憲章 III 未規定門檻值；(5) T 是單一常數，實測太吵改 2/3 即可。完整決策紀錄見 `specs/003-board-state-diff/spec.md` Clarifications Session 2026-07-15。
- `newcomers` 與 `climbed` 附簡介（進 top 10 首次生成、竄升讀快取）；`declined` 只呈現名次變化；掉出 top 10 者不計入任何推播集合（靜默）。
- **留榜且名次完全未變 → 靜默**：在 `prev` 與 `curr` 皆存在（同一 `repoId`）、且綜合名次變化 `< RANK_JUMP_THRESHOLD`（T=1，故等同**名次完全不變**）的 repo，不落入 `newcomers`／`climbed`／`declined` 任一集合 → **當次不推**（**穩定留榜**，符合憲章 III「只推變化、不重述整份榜單」）。此與「掉出 top 10」同為不推、但語意不同：一個仍在榜、一個已離榜。
  > **T=1 的已知代價（非 bug，係 2026-07-15 定案時明知並接受）**：由於純位移照實計為下降，**只要當次有新進，其下所有既有成員都會各退 ≥1 名而全數成為 `declined` 卡**。因此「穩定留榜即靜默」實際只在**當次沒有任何新進**時才成立。單次卡片總數仍恆 `≤ 10`（視窗僅 10 席）、且 `declined` 不帶簡介，故不失控、不耗 LLM 額度。
- **同一性以 `repoId`（數字 id）判定**：改名／轉移擁有者不影響「是否同一 repo」，故「上次本次同一 repo」一律看 id 而非 `fullName`。
- 「rank」為該 repo 在**跨領域綜合 top 10** 的名次（`#1..#10`）；追蹤深度仍為各領域 top 15（見 §3.3）。
- **冷啟動（首次推播）**：`prev` 為空 → 綜合 top 10 全數落入 `newcomers`，直接推 **10 張帶簡介的卡片**（不採「靜默建 baseline」）。之後穩定態每七天：**帶簡介的卡（新進＋竄升）多為 0～數張**；`declined` 則因 T=1 純位移照實計入，**當次有新進時會連帶產生數張**（不帶簡介，見上）。
- **榜單日但無變化**：不必無聲，但也不用大張旗鼓——把「榜單無變化」縮成晨報裡的一行（例如「📊 榜單無變化 · AI 榜首 owner/name ⭐+8.6k」）即可；job 是否存活改由 §8 的 `if: failure()` 告警與每日晨報本身來保證。

### 5.3 推播的組成

**每日晨報（固定）**

- **📰 精選新聞**：經 §4.4 漏斗（結構性去重 → 門檻 → 單次 LLM 依開發者重要性策展）篩出的 6 則（AI ≥4；DevOps/後端/前端合計 ≤2），每則為**繁中標題（≤50 字）＋內容（≤300 字）**，說明發生什麼事、為什麼對開發者重要。

**榜單日（每七天，疊加在當日晨報前）**——一律以**跨領域綜合 top 10**（保底每領域 ≥2 席）為變化視窗，卡片 fields **標示週增星數**以呈現人氣落差：

- **🆕 新進 top 10**：repo + ⭐本週增星 + **250 字簡介**（首次生成，見 §6）。
- **🔺 竄升**：repo + 綜合名次變化（如 `#9 → #3`）+ **250 字簡介**（讀快取）。
- **🔻 下降**：只報綜合名次變化（如 `#3 → #8`），不帶簡介。
- **掉出 top 10**：**當次靜默**——不推卡、也不列「跌出」提示；簡介快取保留，**日後重回 top 10 即以「🆕 新進」呈現（帶簡介、讀快取）**。

> **卡片張數天然受控**：帶簡介的卡片＝`新進 + 竄升`，因整個視窗僅 10 席故 **≤10 張**；**冷啟動首次推播即 10 張**（全數新進）。穩定態每七天多半 0～數張。Discord 一則訊息 ≤10 embeds；榜單段（封面→卡片）與晨報段各自獨立、超過時各自依序 `chunkEmbeds` 切成多則、獨立送出，不合併（見 §7.1／§7.2，不特例處理晨報）。

---

## 6. 每個 repo 的 250 字簡介

**新進**與**竄升**的 repo 都附簡介：新進在首次進 top 10 時生成一次 ≤250 字繁中簡介並快取，竄升時直接讀快取、不重生成。下降只報名次變化、不顯示簡介；掉出 top 10 當次靜默不推。因此每個 repo 一生只會**生成一次**簡介（首次進 top 10 當下）；快取存於 `state.intros`、獨立於榜單快照，**掉出榜不清除快取**，所以「掉出後又重新進榜」以新進呈現時也直接讀快取、不重生成。

### 6.1 流程

```ts
async function ensureIntro(repo, state) {
  const cached = state.intros[repo.id]?.intro;
  if (cached) return cached; // 快取命中，省一次呼叫

  const readme = await github
    .getReadme(repo.owner, repo.name) // GET /repos/{o}/{r}/readme
    .catch(() => ""); // 無 README 就退回 description+topics
  const material = stripMarkdownNoise(readme).slice(0, 6000); // 去 badge/HTML，截斷控制 token

  const intro = await gemini.generate(introPrompt(repo, material));
  return intro; // 呼叫端寫回 state.intros[repo.id] = { intro, introAt }
}
```

> **`repo` 素材由呼叫端傳入（F5 clarify 2026-07-18）**：`intro` 服務只自行取 README，`description /
> topics / language / starsThisWeek` 等 metadata 由**呼叫端**（F7）以 `repoId` join 當次榜單抓取結果
> 後傳入——因為持久化的 `state.board` 快照**不存 description/topics**，不可從 state 讀回；F5 也不另打
> `GET /repos` 補取（省 GitHub 額度）。簡介失敗時服務回傳可區別的降級結果（帶備援 description），
> 由 F7 渲染為降級卡，失敗不寫入快取。

### 6.2 Prompt 要點

- 明確約束：**繁體中文、250 字以內、只根據提供的 README/metadata，不得杜撰功能或數字**。
- 結構建議：一句它解決什麼問題 → 核心特色 → 適合誰／使用情境。
- 帶入 `fullName / description / language / topics / starsThisWeek` 當輔助 metadata。
- 若 README 為空或極短，就以 description + topics 生成較保守的簡介，並可在簡介末標註「（資訊有限）」。

### 6.3 額度與品質

- **快取是關鍵**：只在首次**進 top 10** 生成（簡介僅推播榜成員才需要）。穩定態每七天才有 0～數個新 repo → 遠低於 1,500 RPD；加上晨報每日一次策展呼叫，用量依舊極低。**冷啟動首次推播最多 10 個新進（≤10 次呼叫）**，也在免費額度內。
- README 截斷到 ~6k 字元即可涵蓋多數專案重點，控制 token 又保品質。

---

## 7. Discord 呈現與模板設計

每日晨報固定有一張**新聞精選 embed**（6 則，AI 優先）；**榜單日**（每七天）再於其前疊加榜單區塊，變化視窗為**跨領域綜合 top 10**（保底每領域 ≥2 席）——**一張榜單變化封面 + 每個新進 top 10／竄升 repo 一張卡**：封面一行式列出不需簡介的名次變化（下降），卡片留給帶 250 字簡介的新進與竄升，卡片 fields 標示**週增星數**（估算本週增星）與綜合名次，並用 embed 的 `url` 讓卡片標題可點（掉出 top 10 者當次靜默、不列於封面）。

### 7.1 embed 規格重點

| 欄位          | 上限                         | 備註                                                           |
| ------------- | ---------------------------- | -------------------------------------------------------------- |
| `title`       | 256                          | 不吃遮罩連結，但可搭配 embed 層級的 `url` 讓**標題整體變連結** |
| `url`         | —                            | 設在 embed 上 → 點標題直接開 repo                              |
| `description` | 4096                         | 放 250 字簡介綽綽有餘；吃遮罩連結、粗體、引言、清單            |
| `fields`      | ≤25，name ≤256 / value ≤1024 | 放 ⭐增星、語言、名次/領域                                     |
| 一則訊息      | ≤10 embeds                   | 榜單段（封面→卡片）與晨報段**各自獨立**依序 chunk-by-10 通用切分（`chunkEmbeds`，F7）、獨立送出，不合併（維持段間隔離）；冷啟動時榜單段自身封面＋10 卡＝11 個 embeds，一律切成多則，不特例處理晨報 |

可用 Markdown：`**粗體**`、`` `行內碼` ``、`> 引言`、`- 清單`、遮罩連結 `[文字](url)`。

### 7.2 版面：晨報新聞（每日）+ 榜單卡（榜單日）

```ts
// 榜單段與晨報段各自獨立組裝、獨立切分、獨立送出（不合併成同一個陣列/迴圈）——
// 合併會使一次 Discord 失敗同時波及兩段的 push-then-commit，牴觸段間隔離（憲章 VII、FR-013）。

// —— 榜單段（僅榜單日執行）：封面（下降）+ 新進/竄升卡 ——（掉出 top 10 靜默、不列封面）
if (isBoardDay) {
  const boardEmbeds = [];
  const line = (r) => `[${r.fullName}](${r.url})`;
  const parts = [`**本次榜單變化**\n${changeTldr}`]; // Gemini 產生的一句話變化摘要（榜單日一次，見 §10）
  if (declined.length)
    parts.push(
      "🔻 下降\n" +
        declined
          .map((r) => `${line(r)} #${r.prevRank} → #${r.rank}`)
          .join("\n"),
    );
  boardEmbeds.push({
    title: `📊 榜單變化 · ${dateLabel}`,
    description: parts.join("\n\n"),
    color: 0x5865f2, // 榜單封面藍
  });

  for (const r of [...newcomers, ...climbed]) {
    const isNew = !r.prevRank; // 新進榜無前次名次
    boardEmbeds.push({
      title: `${isNew ? "🆕" : "🔺"} ${r.fullName}`,
      url: r.url, // 點標題開 repo
      description: r.intro, // ← 250 字簡介
      color: domainColor(r.domain), // AI/前後端 各一色
      fields: [
        {
          name: "本週增星",
          value: `⭐ +${fmt(r.starsThisWeek)}`,
          inline: true,
        },
        { name: "語言", value: `\`${r.language}\``, inline: true },
        isNew
          ? { name: "領域", value: domainLabel(r.domain), inline: true }
          : {
              name: "名次",
              value: `#${r.prevRank} → #${r.rank}`,
              inline: true,
            },
      ],
    });
  }

  // 榜單段：封面＋10 卡＝11（冷啟動）已超過單則 10 embeds 上限 → 依序 chunk-by-10 切成多則。
  for (const batch of chunkEmbeds(boardEmbeds, 10)) {
    await postWebhook({ username: "Tech Radar", avatar_url: RADAR_ICON, embeds: batch });
  }
  // 全批成功才 push-then-commit（榜單快照＋lastBoardPushAt＋本次簡介同次落檔，見 §8）。
}

// —— 晨報段（每日執行）：精選 6 則新聞（AI ≥4；DevOps/後端/前端合計 ≤2）——
const digestEmbeds = [
  {
    title: `📡 Tech Radar 晨報 · ${dateLabel}`,
    description: newsBlock, // 6 則：每則「[繁中標題 ≤50 字](url)」＋ ≤300 字內容，AI 優先排前
    color: 0xf5a623, // 晨報橙
  },
];
// 6 ×（50+300 字）+ 連結 markdown 約 2,500～3,500 字元，仍在 description 4096 上限內；
// 逼近上限時把 6 則拆成兩張晨報 embed，仍在晨報段自己的 chunkEmbeds 批次內。

// 晨報段獨立送出（通常 1 批，穩定態 description 未逼近上限時恰 1 個 embed）。
for (const batch of chunkEmbeds(digestEmbeds, 10)) {
  await postWebhook({ username: "Tech Radar", avatar_url: RADAR_ICON, embeds: batch });
}
// 成功才 push-then-commit（seenNews＋lastNewsPushAt 同次落檔）。
```

> 非榜單日只有一則晨報訊息；榜單日帶簡介的卡片＝「新進 top 10 + 竄升」，因視窗僅 10 席故 ≤10 張。**冷啟動日**（全數新進、10 張卡）＋封面＝**榜單段自身 11 個 embeds**、超過 Discord 單則 10 embeds 上限 → 榜單段依顯示順序切成 2 則（`chunkEmbeds`，F7），不特例處理「晨報改送第二則」——通用切分即可涵蓋，且不會漏送或整批被拒收；晨報段照常獨立送出自己的訊息，**不與榜單段合併**（維持段間隔離，任一段推播失敗不牽連另一段的 push-then-commit）。

> **`dateLabel` 取台北日期（UTC+8）**：晨報／榜單封面標題的 `· ${dateLabel}` 以 `taipeiDateLabel(now)`（`src/pipeline/layout/date-label.ts`）計算，非直接取 `now.toISOString()` 的 UTC 日期。cron 22:xx UTC ＝台北隔日 06:xx，取 UTC 日期會比讀者實際收到的日子慢一天；台灣無夏令時，固定 +8h 位移後取日期即台北當地日期。

> **多批推播非原子（已知有界缺點）**：僅榜單段冷啟動（11 embeds → 10+1）會 >1 批。逐批 `send` 若「前批成功、後批失敗」則該段不提交，下次 cron 整段重跑會**重送前批**（封面＋前 10 卡在 Discord 重複一次）。這是**刻意接受**的取捨——觸發需「冷啟動（一生一次）＋恰在批次間失敗」，機率極低；真正原子化只能壓成單則（犧牲版面／FR-010）或在 `state` 記批次 checkpoint（新增持久化狀態），皆與憲章 I（零維運）／最簡設計不成比例。詳見 `specs/007-pipeline-push/contracts/embed-split.md`。

### 7.3 呈現後大概長這樣（mock）

```
┌─────────────────────────────────────────────┐
│ 📊 榜單變化 · 綜合 top 10 · 2026-07-09         │
│ 本次榜單變化（跨領域綜合 top 10）             │
│ AI 沙箱工具爆紅進榜、GitOps 工具大幅竄升       │
│                                               │
│ 🔻 下降                                       │
│ owner/vue-thing #3 → #8                        │
│ （掉出 top 10 者當次靜默、不列出）            │
├─────────────────────────────────────────────┤
│ 🆕 owner/agent-sandbox      （標題可點）       │
│ 給 AI agent 用的並發安全沙箱。它把每個工具呼叫 │
│ 隔離在輕量 microVM 中，避免 agent 亂執行指令   │
│ 波及主機……（≤250 字）                         │
│ 本週增星 ⭐ +8.6k │ 語言 `Rust` │ 領域 🤖 AI    │
├─────────────────────────────────────────────┤
│ 🔺 owner/gitops-x           （標題可點）       │
│ 宣告式多叢集部署工具，把多個 Kubernetes 叢集的 │
│ 期望狀態集中以 Git 管理……（≤250 字，讀快取）  │
│ 本週增星 ⭐ +11k │ 語言 `Go` │ 名次 #9 → #3     │
├─────────────────────────────────────────────┤
│ 📡 Tech Radar 晨報 · 2026-07-09               │
│ 1. [AI] 某公司開源新一代推理模型（標題 ≤50 字，│
│    可點）                                      │
│    內容 ≤300 字：發生什麼事、對開發者的影響、  │
│    該注意/該做什麼……                          │
│ 2.～4. [AI] ……（同格式）                      │
│ 5. [DevOps] ……  6. [後端·Node.js] ……          │
└─────────────────────────────────────────────┘
```

> 上圖為**榜單日**（榜單區塊 + 最底晨報新聞卡）；**非榜單日**只會出現最底那張「📡 Tech Radar 晨報」新聞卡。

### 7.4 小巧思

- **區塊配色**：榜單變化封面藍 `0x5865F2`、新聞晨報橙 `0xF5A623`；卡片再依領域上色（下）。
- **領域配色（榜單卡片）**：AI `0x10A37F` / 前後端 `0xF7DF1E`，掃描更快。（榜單 DevOps `0x326CE5` 已於 2026-07-15 隨領域移除；**新聞晨報是單張橙卡、領域僅以 `[DevOps]` 等文字標籤呈現，不受影響**。）
- **敘事與數據分工**：簡介、TLDR 交給 Gemini（放 description）；增星、連結、名次由程式放（fields / 封面一行式）。就算 LLM 抽風，數字與連結永遠是真的。
- **失敗要看得到**：任一步失敗發一則紅色告警 embed，別無聲失敗。

---

## 8. 排程設定

台北 UTC+8（無夏令時），每日晨報排**兩個離峰分鐘的 cron 當補跑保險**：

| 台北  | UTC             | cron          | 角色           |
| ----- | --------------- | ------------- | -------------- |
| 06:07 | 22:07（前一日） | `7 22 * * *`  | 主排           |
| 06:37 | 22:37（前一日） | `37 22 * * *` | 補跑（漏跑時） |

> **為什麼兩個 cron？** GitHub Actions 的排程 cron 並不可靠：尖峰可延遲數十分鐘、偶爾整次被跳過。整點（`0`）尤其容易塞車，故取 `:07`、`:37` 這類離峰分鐘。晨報靠 `state.lastNewsPushAt` 做 **idempotency guard**：每次執行開頭，若「距 `lastNewsPushAt` < ~18h」就**跳過新聞段**。正常日主排推完、`lastNewsPushAt` 更新，補跑那次自動跳過（不重複推）；主排若被 Actions 跳過，補跑那次因距上次已 ~24h 而正常補推。等於**雙 cron 去重 + 漏跑補推**一次搞定，也順帶當 keep-alive。
>
> **榜單七天一次不靠 cron**，而是程式讀 `state.lastBoardPushAt`：距今 **≥162 小時**（7 天 168h 減 **6h 寬限**）才做榜單 diff 與推播，一樣抹平漏跑/延遲；一天兩跑也只會在第一次跑到時推、第二次因未到期而跳過。
>
> **為何是 162h 而非 168h**：`lastBoardPushAt` 記的是**推播完成**時間，必定晚於當次 cron 觸發時間。若取精確 168h，七天後同一班 cron 觸發時算出來恆略小於門檻而跳過，改由次一班（`:37`）或隔天補推，起算點又再往後挪——Actions cron 只會延遲不會提前，故誤差**單向累積**，節奏會從 7 天滑成 7.x 天直到跨過一整天。留 6h 寬限即可吸收延遲與雙班抖動，使節奏穩定錨在每週同一時段。比例沿用新聞每日 guard（24h 週期留 6h → 「<18h 跳過」）。
>
> ⚠️ guard 正確性依賴「成功推播後盡快把 `lastNewsPushAt` commit 回 state」。若 job 在推播成功後、commit 前失敗，補跑那次會重推一次——機率低、自用可接受；靠「推播成功後才寫入狀態、且狀態 commit 緊接在推播之後」把這個風險窗縮到最小（見 §12 狀態一致性）。

```yaml
# .github/workflows/radar.yml
name: tech-radar
on:
  schedule:
    - cron: "7 22 * * *" # 06:07 台北 · 每日晨報（主排）
    - cron: "37 22 * * *" # 06:37 台北 · 補跑（主排被 Actions 跳過時遞補；靠 lastNewsPushAt guard 去重）
  workflow_dispatch: {}
permissions:
  contents: write # 為了 commit state/board.json
concurrency:
  group: tech-radar # 避免手動觸發撞上排程造成 push 衝突
  cancel-in-progress: false
jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "24", cache: "npm" }
      - run: npm ci
      - run: npm run build
      - run: node dist/main.cli.js
        env:
          GH_API_TOKEN: ${{ secrets.GH_API_TOKEN }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}
      - name: Commit & push state（rebase + 重試，失敗要響）
        run: |
          git config user.name  "radar-bot"
          git config user.email "radar@users.noreply.github.com"
          git add state/board.json
          git diff --cached --quiet && echo "no state change" && exit 0
          git commit -m "chore: update board state [skip ci]"
          for i in 1 2 3; do
            git pull --rebase --autostash origin "${GITHUB_REF_NAME}" \
              && git push && exit 0
            echo "push retry $i…"; sleep $((RANDOM % 5 + 1))
          done
          echo "::error::failed to push board state after retries"; exit 1
      - name: Notify Discord on failure
        if: failure()
        run: |
          curl -s -H "Content-Type: application/json" \
            -d '{"embeds":[{"title":"⚠️ Tech Radar 執行失敗","description":"workflow 失敗，請查 Actions log。","color":15158332}]}' \
            "${DISCORD_WEBHOOK_URL}"
        env:
          DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}
```

---

## 9. NestJS 專案結構

```
src/
├─ main.cli.ts        # createApplicationContext → 跑 pipeline → 退出
├─ pipeline/          # PipelineService（編排：每日晨報新聞；每七天榜單 diff→簡介→推播→存狀態）
├─ sources/
│  ├─ github-trending.service.ts   # 爬 trending weekly，解析 stars this week
│  ├─ github-search.service.ts     # created:>7d 新崛起 repo
│  ├─ github-readme.service.ts     # 取 README（簡介素材）
│  └─ news.service.ts              # 依 config/news-sources.ts 清單抓取（HN / Reddit / RSS / releases.atom）
├─ classify/          # ClassifyService（兩領域關鍵字/topic 歸類）
├─ news-filter/       # NewsFilterService（去重→門檻→交叉驗證→配額策展，見 §4.4）
├─ diff/              # BoardDiffService（新進/竄升/下降；掉出 top 10 靜默、不推）
├─ intro/             # IntroService（README→Gemini→快取）
├─ summary/           # SummaryService（組「本次變化」TL;DR）
├─ llm/               # LlmService（Gemini 封裝 + 退避）
├─ discord/           # DiscordWebhookService（組 embeds → POST）
├─ state/             # StateStore（讀寫 state/board.json）
└─ config/            # @nestjs/config ＋ news-sources.ts（新聞來源唯一清單，見 §4.2）
```

```ts
// main.cli.ts
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["log", "error", "warn"],
  });
  try {
    await app.get(PipelineService).run();
  } finally {
    await app.close();
  } // 跑完即退，適合 Actions
}
bootstrap();
```

---

## 10. LLM 使用（Gemini）

- **三種呼叫**：(1) 每個**新進榜** repo 一次 250 字簡介（生成後快取，竄升時重用、不重呼叫）；(2) **榜單日**一段「本次變化」TL;DR（一句話變化摘要，放封面 embed）；(3) **每日新聞策展一次**（見 §4.4 階段 B）——在同一次呼叫內完成殘留語意去重 + 依「開發者重要性」挑 6 則 + 每則精煉為**繁中標題（≤50 字）＋內容（≤300 字）**（素材為程式帶入的 title 與 feed 摘要節錄）。
- **新聞策展固定每日 1 次、不用 embeddings**：跨來源去重主力是零 LLM 的 target-URL 正規化（§4.4 階段 A）；殘留重複交給那唯一一次策展呼叫順手處理。**不建向量檢索/embeddings**——素材小、context-stuffing 即可，一次看到全部候選標題就能做完 embeddings 想做的事。用量與候選數無關。
- **選重要而非選熱門**：策展 prompt 明講「重要 ≠ 熱門」，優先會改變開發者做事方式的內容（新工具/版本、breaking change、安全通報、重大模型/API 發布、deprecation），壓低純爆紅口水/觀點文；分數只當提示、非排序主鍵。
- **防幻覺**：prompt 明確要求「只依提供資料、不得杜撰數字/連結」；星數與連結一律由程式提供、不經 LLM（新聞策展同理，只選擇/去重/依 title+summary 改寫繁中摘要，不造連結、分數或來源沒有的事實）。
- **退避**：429 用指數退避 + jitter；單一 repo 簡介失敗不阻斷整批（該卡改顯示 description 當備援）；策展呼叫失敗時退回「純程式排序（分數 + 交叉驗證/tier + 榜單相關性）取前 6」當備援，不阻斷晨報——此時每則僅有「原文標題＋連結」（無繁中 50/300 改寫），屬可接受的降級。

---

## 11. SDD × Spec Kit 落地

流程（Claude Code 作 integration）：**Constitution 全專案建立一次**；之後**每個 Feature（見 §11.2）各自走完一輪**：

```
/speckit.constitution（一次）
→ 每個 Feature：/speckit.specify → /speckit.clarify → /speckit.plan
   → /speckit.checklist → /speckit.tasks → /speckit.analyze → /speckit.implement
```

安裝：`uvx --from git+https://github.com/github/spec-kit.git specify init tech-radar`（選 Claude Code）。

### Constitution（非協商原則）

- **零常駐、零付費 infra**：以 GitHub Actions + Discord Webhook + Gemini 免費層為準。
- **不自存星星歷史**：星星增量取自 GitHub Trending 官方週增量。
- **只推變化 / 控制節奏**：榜單每七天只推與上次的差異；新聞每日晨報固定精選 6 則（AI ≥4；DevOps/後端/前端合計 ≤2），**以對開發者的重要性排序（非熱度）**，每則以**繁中標題 ≤50 字＋內容 ≤300 字**呈現。寧可少而重要，不要洗版、也不為湊滿而塞不重要的熱門文。
- **新聞來源單一清單**：所有新聞來源集中於 `news-sources.ts` 並分層（Tier 1 高訊號聚合 / Tier 2 高精準一手 / Tier 3 選配）；**增刪修來源只改設定檔、不得動 pipeline code**；Tier 3 可隨時移除。領域聚焦：後端只看 Node.js/Python、前端以 TypeScript 為主、不收 CSS 技巧。
- **晨報去重要確實、且省 LLM**：跨來源去重主力為零 LLM 的 **target-URL 正規化**（＋標題近似補漏）；**新聞策展每日僅 1 次 LLM 呼叫、不引入向量檢索/embeddings**，殘留語意重複由該次呼叫順手清除。
- **晨報推播冪等**：每日晨報以 `lastNewsPushAt` 做 guard（距今 <~18h 跳過新聞段），雙 cron 只會推一次；漏跑由補跑 cron 遞補。
- **簡介必快取**：同一 repo 簡介只生成一次（快取獨立於榜單快照，跌出榜不清除）；LLM 不得產生星數/連結等事實數據（新聞策展同理，只選擇/去重不造數據）。
- **狀態單一來源**：`state/board.json` 為唯一權威狀態。
- **秘密不入庫、不入發佈物**：token / webhook URL 走 Actions Secrets；Pages 擴充（§14）僅適用 public repo，任何要發佈到 Pages 的產物（儀表板/feed）**絕不得含機密**。
- **來源隔離容錯**：任一資料源失敗不得使整條 pipeline 失敗。
- **發佈僅限 public、且不得波及推播**：Pages 發佈（§14）僅在 repo 為 public 時啟用，切成 private 須依可見性偵測**自動停用**；發佈是隔離末段，其停用或失敗**絕不得影響 Discord 推播與 state 存取**。
- **關鍵邏輯測試優先**：trending 解析、兩領域歸類、diff、**target-URL 正規化去重**、**標題近似去重**、簡介快取命中、**新聞配額（6 則 / AI≥4 / DevOps+後端+前端合計 ≤2）**、**50/300 字數上限驗證**、**來源清單 schema 驗證（`news-sources.ts`）與 tier 加權**、**晨報 idempotency guard（`lastNewsPushAt` <~18h 跳過）**、**榜單每週節奏（`lastBoardPushAt` 計時、162h 門檻）** 都要單元測試（trending HTML 用快照測試守著；策展呼叫可 mock、另測失敗時的純程式排序備援）。

### 11.1 Git 分支策略（進入開發階段後生效）

- **`main` 不直接 commit**：`main` 只接受來自 `develop` 的合併，保持隨時穩定可回溯。
- **`develop` 為整合分支**（正式開發時手動建立）：所有 Feature 分支合回 `develop`；驗證穩定後再由 `develop` 合入 `main`。
- **每個 Feature 一條分支**：一律**從 `develop` 切出**，命名沿用 Spec Kit 慣例 `NNN-feature-name`（`/speckit.specify` 建分支時，確保當前基底是 `develop`），完成該 Feature 的 implement 與驗收後合回 `develop`。
- **唯一例外**：排程 workflow 由 bot 自動 commit 的 `state/board.json`（§8）——那是上線後的執行期狀態更新，發生在部署所在分支，不屬開發 commit。

### 11.2 Feature 規劃（依 SDD 進程分列，開發時依序執行）

每個 Feature 各自走完一輪 `specify → clarify → plan → checklist → tasks → analyze → implement`；**前一個 Feature 合回 `develop` 後再開下一個**，確保後續 spec 建立在已驗收的基礎上。編號即建議的分支名。

| #   | Feature 分支            | 內容                                | 對應章節           | 依賴     | 里程碑   |
| --- | ----------------------- | ----------------------------------- | ------------------ | -------- | -------- |
| F1  | `001-foundation`        | 專案骨架、狀態存取、推播通道、排程  | §2、§8、§9         | —        | M0       |
| F2  | `002-board-sources`     | 榜單來源抓取與兩領域歸類            | §3                 | F1       | M1       |
| F3  | `003-board-state-diff`  | 榜單狀態快照與變化偵測              | §5                 | F1、F2   | M2（半） |
| F4  | `004-news-ingest`       | 新聞來源設定檔與零 LLM 過濾漏斗     | §4.1–4.3、§4.4-A   | F1       | M2（半） |
| F5  | `005-repo-intro`        | LLM 封裝與 repo 250 字簡介          | §6、§10            | F1、F3   | M3       |
| F6  | `006-news-curation`     | 每日晨報單次 LLM 策展與降級備援     | §4.4-B、§10        | F4、F5   | M4（半） |
| F7  | `007-pipeline-push`     | Pipeline 端到端編排與 Discord 組版  | §5.3、§7、§8       | F3～F6   | M4       |
| F8  | `008-pages-publish`     | Pages 儀表板 + RSS/Atom（post-MVP） | §14                | F7       | M5       |

**F1 `001-foundation` — 專案骨架與推播通道**

- 範圍：NestJS application context CLI（`main.cli.ts`、`AppModule`）、`@nestjs/config` 環境變數載入、`StateStore`（`state/board.json` 讀寫 + schema 雛形）、`DiscordWebhookService`（最小 embed POST + 紅色失敗告警）、Actions workflow（雙 cron、`workflow_dispatch`、concurrency、state commit + rebase 重試、`if: failure()` 告警）。
- 不含：任何資料來源、LLM、漏斗邏輯。
- 驗收（= M0）：`workflow_dispatch` 觸發後手機收到測試 embed，且 state 檔成功 commit 回 repo。

**F2 `002-board-sources` — 榜單來源與兩領域歸類**

- 範圍：`github-trending.service`（爬 weekly、解析 stars this week，**快照測試**）、`github-search.service`（`created:>7d` 兩組查詢）、`ClassifyService`（topics/關鍵字歸類——關鍵字集合在本 Feature 的 clarify 定案）、兩來源 union + `repoId` 去重、排序鍵、每領域 top 15。
- 驗收（= M1）：本機/Actions log 印出正確的兩領域週增星榜。

**F3 `003-board-state-diff` — 榜單狀態與變化偵測**

- 範圍：board 狀態 schema（§5.1）、`BoardDiffService`（跨領域綜合 top 10、保底每領域 2 席、統一尺「估算本週增星」、新進/竄升/下降；掉出 top 10 靜默）、每週節奏（`lastBoardPushAt` guard，162h 門檻）、狀態冪等（成功推播後才寫回）。
- **✅ 已定案（2026-07-15，F3 specify）**：`RANK_JUMP_THRESHOLD` **= 1**，**一律比較絕對綜合名次**、兩方向對稱，**純位移照實計為下降**（不做同儕相對比較）。曾評估的「絕對後退且相對名次亦後退才報」濾除方案**明確捨棄**，以簡化為優先；一整排「🔻 下降 1 名」為已知且被接受的代價（有界：單次 ≤10 張、下降卡不帶簡介、七天一次）。詳見 §5.2 與 `specs/003-board-state-diff/spec.md` FR-010／Clarifications Session 2026-07-15。
- **✅ 已定案（2026-07-15，F3 clarify）**：
  - **節奏三天 → 七天**，到期門檻 **162h**（168h − 6h 寬限）；憲章 v1.3.0 已同步（見 §5、§8）。
  - **決勝規則（四層全序）**：估算本週增星 ↓ → 總星數 ↓ → **新進者優先**（不在上次快照者在前）→ **repoId ↑**（最終決勝）。第四層保證全序，故排名不依賴底層 sort 是否穩定（spec FR-004／SC-008）。
  - **空榜即中止榜單段**：上游全滅或候選全被過濾時不產出 diff、不推播、不寫回狀態，發紅色告警，新聞段照常；`lastBoardPushAt` 不動故下次自動重試（spec FR-025）。
  - **未來時間戳視為已到期並告警**：防止負值間隔恆低於門檻而使榜單段永久靜默；下次成功推播即自我修復（spec FR-019a）。
- 驗收：連跑兩次，第二次只產出差異；未到期（距上次推播 <162h）時榜單段整段跳過。

**F4 `004-news-ingest` — 新聞來源與零 LLM 漏斗（階段 A）**

- 範圍：`news-sources.ts` 設定檔 + schema 驗證 + tier 加權、四種抓取器（`hn-algolia` / `reddit-weekly` / `rss` / `github-releases`，含 User-Agent/條件式請求/0 筆告警、releases 過濾 pre-release 與純 patch）、正規化為統一結構、階段 A 漏斗（**target-URL 正規化去重、標題 Jaccard 補漏**、分數門檻、交叉驗證、榜單相關性加權、`seenNews` 7 天修剪）；上線前逐一驗證 feed URL 可用（§12）。
- **本 Feature 待定已定案（F4 clarify 2026-07-16）**：新聞領域分類法**比照榜單合併前後端**——新聞 `domain` 收斂為 `ai | devops | frontend-backend | cross`（**保留 `devops`**：配額與三個 DevOps 專屬來源不變，憲章 Scope note）。`cross` 來源關鍵字歸類的前後端項一律歸入單一 `frontend-backend` 桶，不再細分 backend/frontend。決策全文見 `specs/004-news-ingest/spec.md` Clarifications Session 2026-07-16 與 FR-027／FR-028。
  > **主題降噪規則歸屬**：「後端只收 Node.js/Python、前端以 TypeScript 為主、不收 CSS 技巧/教學」等**不對稱降噪規則**留在**階段 B（F6 單次 LLM 策展）外顯執行**（§4.4 階段 B 已明列），本 Feature 階段 A **不以關鍵字硬篩內容主題**——語意判斷交 LLM 更準（避免把重要的 CSS 引擎/框架 release 誤殺），且不擴大 F4 範圍。前後端內容於階段 A 一律先歸入 `frontend-backend` 候選，交由階段 B 依開發者重要性取捨。
  > **憲章 III 配額措辭審視結論：不需修訂**。合併僅改**內部 `domain` 列舉與 `cross` 歸類目標**（實作細節，憲章未列舉）；使用者可見的**配額「AI ≥4；DevOps／後端／前端合計 ≤2」與領域聚焦內容政策皆不變**（前後端仍是內容層面的真實類別、降噪續由 §4.4 階段 B 外顯執行），故無語意矛盾、無需版本升版。§4.2 型別與 Tier 3 標記、§4.3 歸類說明已同步為 `frontend-backend`。
- 驗收（F3 + F4 = M2）：跨來源同一則新聞只出現一筆（`sources[]` 正確合併）；候選收斂至約 15～25 則。

**F5 `005-repo-intro` — LLM 封裝與 repo 簡介**

- 範圍：`LlmService`（Gemini 封裝、429 指數退避 + jitter）、`github-readme.service`、`IntroService`（≤250 字繁中簡介、`state.intros` 快取、無 README 退回 description+topics、防幻覺 prompt 約束）。
- 驗收（= M3）：新進榜 repo 附簡介；同一 repo 再次進榜命中快取、不重生成。

**F6 `006-news-curation` — 每日晨報策展（階段 B，單次 LLM）**

- 範圍：單次 Gemini 策展呼叫（殘留語意去重、依**開發者重要性**挑 6 則、配額 AI ≥4 / 其他合計 ≤2、繁中 50/300 改寫 + 字數驗證、不足 6 則不硬湊）、策展失敗退回**純程式排序備援**、榜單日「本次變化」TL;DR。
- 驗收：候選餵入後產出合規的 6 則繁中精選；mock 策展失敗仍能輸出降級版晨報（原文標題 + 連結）。

**F7 `007-pipeline-push` — Pipeline 編排與 Discord 推播**

- 範圍：`PipelineService` 端到端編排（每日晨報固定、榜單日疊加）、晨報 `lastNewsPushAt` idempotency guard（<~18h 跳過）、embed 組版（榜單封面/新進竄升卡/晨報卡、領域配色、≤10 embeds 拆分規則）、來源隔離容錯落地（任一來源失敗不斷全線）。
- 驗收（F6 + F7 = M4）：正式排程連續數日觀察——每日恰一晨報（主排漏跑由補跑遞補、不重複）、榜單七天一次、只呈現變化且附簡介。

**F8 `008-pages-publish` — Pages 儀表板 + RSS/Atom（post-MVP）**

- 範圍：repo 可見性偵測（private 自動整段停用）、`index.html` 由 state 預渲染、`feed.xml`（穩定 GUID、滾動 `feed` 陣列修剪）、`upload-pages-artifact` + `deploy-pages` 部署、完全隔離的末段 job（失敗/停用不影響推播與 state）。
- 驗收（= M5）：公開 URL 可瀏覽榜單與今日晨報；RSS reader 訂閱不重複。

**技術釘死**：在每個 Feature 的 `/speckit.plan` 釘死——NestJS（application context CLI）、`cheerio`、`rss-parser`、`@google/genai`、`undici`/`fetch`；F8 另加 `feed`（產 RSS/Atom）；執行環境 GitHub Actions；狀態 `state/board.json`。

---

## 12. 風險與坑

- **Trending HTML 會改版**：解析加快照測試 + 解析失敗發告警（別無聲）。
- **Trending 無 topic 過濾**：靠語言頁 + 事後 topic 比對，涵蓋度取決於關鍵字集合，需定期回顧。
- **Search 漏老 repo 暴衝**：老 repo 本週爆紅只有 Trending 抓得到 → 兩來源都要。
- **週指標變化慢**：正好用七天節奏推榜單——尺是七日指標，節奏亦取七天，兩次比較的視窗不重疊，且避免每天微幅洗牌洗版。（洗版控制主要靠**七天節奏**與**視窗僅 10 席**；`RANK_JUMP_THRESHOLD` 已定為 1，見 §5.2，故它本身幾乎不濾任何移動。）
- **節奏解耦**：榜單七天一次由 `lastBoardPushAt` 計時（非 cron，門檻 162h），漏跑下次補推即可；新聞每日晨報由雙 cron + `lastNewsPushAt` guard 保證「每日恰一次」。
- **晨報跨來源重複**：主力去重是 **target-URL 正規化**，正確性取決於目標 URL 抽取與轉址處理（`t.co`/短網址/UTM）——這幾處要有測試；無法歸一的殘留重複，交由每日唯一那次策展呼叫清除。避免「同一則新聞被 HN + Reddit 各報一次」。
- **晨報只挑熱門的風險**：策展 prompt 要明確「重要 ≠ 熱門」，否則會被高分口水文洗版；分數只當提示。定期回看選出的 6 則是否真的對開發者有用，據以調 prompt。
- **狀態一致性**：diff 前後對同一份狀態讀寫；job 失敗時不要寫入半套狀態（成功推播後才存回）。新聞推播成功後盡快 commit `lastNewsPushAt`，縮小補跑 cron 重推的風險窗（見 §8）。
- **簡介幻覺**：嚴格「只依 README」；星數/連結不經 LLM。
- **Gemini**：429 退避；只送公開資料；策展呼叫失敗退回純程式排序取前 6，不阻斷晨報。
- **Actions cron UTC 且可能延遲/跳過 / 60 天停用**：對照表要正確；晨報排**雙離峰 cron（`:07`/`:37`）**＋`lastNewsPushAt` guard 抗漏跑（見 §8）；每次 commit 狀態保活。
- **RSS 路徑會變**：上線前逐一確認；抓取帶 User-Agent 與條件式請求。來源集中在 `news-sources.ts`（§4.2），feed 壞掉時停用/替換只改設定檔；「解析到 0 筆」發告警並帶來源 `id`。官方公告類 feed（如 Anthropic）不一定有穩定 RSS，上線前逐一驗證、沒有就先不收。

---

## 13. 里程碑

| 里程碑     | 內容                                                            | 完成即可驗證                                 |
| ---------- | --------------------------------------------------------------- | -------------------------------------------- |
| M0         | Actions 骨架 + Discord Webhook 打通                             | 手機收得到訊息                               |
| M1         | Trending weekly 解析 + Search 補位 + 兩領域歸類                 | log 印出正確的本週增星榜                     |
| M2         | 狀態存取 + diff（新進/竄升/下降）+ **新聞 target-URL/標題去重**   | 連跑兩次，第二次只顯示差異；跨來源同一則只出現一次 |
| M3         | Intro：README → Gemini 250 字簡介 + 快取                        | 新進榜 repo 帶簡介，重複出現讀快取           |
| M4         | 每日晨報（6 則 · 繁中 50/300 格式 · 依開發者重要性）+ 榜單每週 diff 卡片 + 配色，**雙 cron + `lastNewsPushAt` guard** 上線 | 每日恰一晨報（漏跑會補、不重複）、榜單七天一次、只呈現變化且帶簡介 |
| M5（可選） | **GitHub Pages 儀表板 + RSS/Atom（§14）**                       | 公開 URL 可瀏覽榜單與今日晨報；RSS reader 能訂閱且不重複 |

先把 M0→M4 走完，就是一個零維運、全免費、**每日一晨報（精選 6 則）＋榜單每七天報變化且附簡介**的科技雷達。

---

## 14. GitHub Pages 靜態儀表板 + RSS/Atom（公開 repo 擴充）

因為本 repo 是 public，Pages 免費——把**同一次 pipeline 的產出**額外發佈成一頁靜態儀表板 + 一份可訂閱的 feed，讓雷達不只鎖在 Discord。屬 **post-MVP**，先做完 M0→M4 再接。以下為開發重點：

### 14.1 啟用條件與降級（硬性要求）

- **僅在 repo 為 public 時啟用**：發佈開始前先查 repo 可見性（GitHub API repo metadata 的 `private` / `visibility`），private 就整段跳過——不產站、不部署。以偵測為準、不靠人工開關，**切成 private 當天自動停用**。
- **改成 private 必須自動停用發佈、且絕不影響 Discord 推播**。因此發佈是**完全隔離的末段**（獨立 job／最後步驟，`needs` 核心 pipeline）：Discord 推播與 state commit 已在更早、獨立完成；發佈被跳過或失敗都**不得回滾狀態、不得阻斷或把核心標記為失敗**。（延續 Constitution「來源隔離容錯」）

### 14.2 產出（重點）

- **儀表板 `index.html`**：目前各領域榜單（top N + 快取簡介）、上次榜單變化摘要、今日 6 則新聞。build 時由 `state/board.json` 預先渲染，免前端框架、關掉 JS 也能看。
- **`feed.xml`（Atom/RSS）**：一則 entry 對一個值得訂閱的事件（今日新聞、新進榜、竄升 repo）。用**穩定 GUID**（新聞 = 正規化目標 URL、repo = `repoId`）讓 RSS reader 自動去重；在 state 存一個滾動 `feed` 陣列（上限 ~50，沿用 `seenNews` 修剪模式）讓 feed 有歷史。
- **不增加任何 LLM 呼叫**：發佈重用「推去 Discord 的同一批、已去重且已依開發者重要性挑選」的項目，品質一致。
- 不畫歷史星星趨勢圖（我們不自存星星歷史，見 §3）。

### 14.3 部署方式（重點）

- 走 **GitHub Actions 產物部署**（`upload-pages-artifact` + `deploy-pages`；Settings → Pages → Source 選 GitHub Actions）：把網站當 artifact 部署、**不把 HTML commit 進 `main`**，git 歷史保持乾淨。
- 不建議 `/docs` 分支部署：除了 git churn，還有個坑——workflow 內建 `GITHUB_TOKEN` 推的 commit **不會觸發 Pages 自動 build**。

### 14.4 隱私

public repo → `board.json`／簡介／feed／儀表板**全部公開**（已確認 OK）。維持既有原則：**token / webhook URL 只走 Actions Secrets，絕不寫進任何發佈產物**（見 Constitution）。
