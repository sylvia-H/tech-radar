# Phase 0 Research: 004-news-ingest

本 Feature 無殘留 NEEDS CLARIFICATION（domain 列舉與主題降噪歸屬已於 Clarifications 2026-07-16
定案）。以下為實作前需釘死的技術決策，逐項給 Decision / Rationale / Alternatives。依據來源：
`docs/tech-radar-dev-guide.md` §4.1–4.4、`.specify/memory/constitution.md`（原則 IV/V/VI/VII/VIII）、
現有程式碼慣例（`github-http.ts`、`state.schema.ts`、`classify/`）。

## D1. 來源設定檔的形狀與驗證（FR-001/002/003, 憲章 IV）

- **Decision**：`src/config/news-sources.ts` 匯出 `NEWS_SOURCES: NewsSource[]`，型別
  `{ id, type, url, domain, tier, enabled? }`（`enabled` 未給預設 `true`）。另立
  `src/config/news-source.schema.ts` 以 zod 定義 `newsSourceSchema` 與清單層
  `validateNewsSources()`：逐筆 schema 驗證 ＋ **唯一 `id` 檢查**，遇重複 id 或缺必填欄位
  **擲明確錯誤**（帶違規 id），不靜默載入。`domain` 列舉 `ai|devops|frontend-backend|cross`、
  `type` 列舉四種、`tier` 為 `1|2|3`。
- **Rationale**：憲章 IV 要求「來源即設定、schema 驗證擋壞清單」；`id` 是抓取告警與 `seenNews`
  統計的引用鍵，重複會讓告警與統計失真，故 id 唯一性須顯式檢查（zod enum/object 不涵蓋跨筆唯一性，
  需額外一段）。沿用專案「zod 邊界驗證」慣例（見 `state.schema.ts`／`github-search.service.ts`）。
- **Alternatives**：(a) 只用 TS 型別不做 runtime 驗證——被否，設定檔是人手最常改、最易錯處，
  無 runtime 驗證會讓壞清單無聲載入。(b) 把驗證塞進各抓取器——被否，違反「設定與 pipeline 解耦」。

## D2. 四種抓取器的分派與介面（FR-004, 憲章 IV）

- **Decision**：`fetchers/fetcher.ts` 定義 `RawItem`（抓取器統一輸出）與 `SourceFetcher` 介面
  `(source, ctx) => Promise<RawItem[]>`；以 `type` → fetcher 的 `Record` 分派。新增**同類型**來源
  只在 `news-sources.ts` 加一筆即可，不動抓取器程式碼；新增**新類型**才需加 fetcher（本 Feature
  釘死四種，見 spec Assumptions）。`ctx` 提供 `now`、`http`（`news-http`）、`parser`（rss-parser 實例）
  以利注入測試。
- **Rationale**：FR-004 明確要求「新增同類型只改設定」；策略表分派使抓取器對設定封閉、對來源開放。
- **Alternatives**：抓取器內 `switch(source.type)` 單一大函式——被否，四種解析邏輯差異大，分檔較清晰
  且各自可獨立快照測試（憲章 VIII）。

## D3. HTTP 抓取（FR-009, 憲章 VII）

- **Decision**：`src/news/news-http.ts` 提供 `getText(url, conditional?)` 與 `getJson<T>(url)`，帶自訂
  `User-Agent`、可選條件式請求（ETag／If-Modified-Since，304 回 notModified）、5xx/429/網路錯誤指數
  退避＋jitter（鏡射 `github-http.ts` 的 `requestWithRetry`/`backoffMs`）。**無 token、host 無關**；
  錯誤訊息**可含來源 URL**（feed 皆公開、不帶 token，無機密外洩風險；`github-http` 隱去 URL 是為避免
  洩漏帶 Bearer 的請求，該理由於 news-http 不成立），利於定位失敗來源。
- **Rationale**：新聞 feed 皆公開、跨多 host（reddit.com、lobste.rs、hn.algolia.com、github.com、
  各官方 blog），不能复用帶 GitHub Bearer 的 `getJson`。抓取禮貌與退避為憲章 VII／§4.3 硬要求。
- **Alternatives**：(a) 直接把 `github-http` 的 `getText` 拿來用——被否，語意耦合 GitHub 模組且命名
  誤導。(b) 引入 `undici` 自訂 Agent——非必要（原生 `fetch` 於 Node 24 足夠，憲章釘死 `undici/fetch`
  二選一）。**條件式請求**：F4 執行期不持久化 ETag（無前值可帶，實為 no-op），介面留供日後強化，
  與 `github-http` 現況一致。

## D4. HN Algolia 抓取與 target-URL（FR-005/010/015）

- **Decision**：`hn-algolia.fetcher` 打
  `https://hn.algolia.com/api/v1/search?tags=story&numericFilters=created_at_i>{7天前unix}`（JSON），
  取 `points` 為 `score`、`title`、`created_at_i` 為新鮮度。**target-URL = 命中項的 `url`**（外部
  連結）；`url` 為空（Ask HN／純文字貼）時**退回 HN permalink**（`https://news.ycombinator.com/item?id=`）
  作為去重鍵（FR-015）。`domain: cross` → 交 `news-classify` 歸類。
- **Rationale**：HN 討論指向同一外部連結，是跨來源去重的殺手鐧（§4.4 步驟 1）；無外部連結者以自身
  連結為鍵，不得崩潰或無聲丟棄。
- **Alternatives**：`tags=front_page`——被否，front_page 非「近 7 天」口徑，改用 `created_at_i` 過濾對齊
  週視角（FR-010）。

## D5. RSS/Atom 解析（Reddit weekly／一般 RSS／GitHub releases）

- **Decision**：用 `rss-parser`（憲章釘死）解析。Reddit `/top/.rss?t=week` 與 Lobste.rs `t/*.rss`、
  官方 blog RSS 走 `rss.fetcher`／`reddit-weekly.fetcher`；GitHub `releases.atom` 走
  `github-releases.fetcher`。RawItem 取 `title`、`link`（＝target-URL 候選）、`contentSnippet`／
  `content`（摘要節錄，截 ~500 字供 F6）、`isoDate`（新鮮度）。RSS 通常無社群分數 → `score` 視來源
  性質：Reddit RSS 無 upvote 數（RSS 不帶），故 Reddit `.rss` 之 `score` 記 `null`（見 D8 對「無分數」
  的處理）。
- **Rationale**：`rss-parser` 同時吃 RSS2.0 與 Atom，省去手寫 XML。截 ~500 字對齊 §4.3。
- **Alternatives**：`cheerio` 手解 XML——被否，重造輪子且脆。**注意**：Reddit `.rss` 不含分數，dev-guide
  §4.4 建議的「Reddit upvotes > 300」門檻在純 RSS 下無法取值——記為 research 風險，見 D8 處理（無分數
  來源不套分數門檻，與 Tier 2 同路徑，避免把「取不到分數」誤殺）。

## D6. GitHub releases 版本過濾（FR-008, SC-010）

- **Decision**：`release-filter.ts` 純函式 `isNoisyRelease(tag/title): boolean`：**drop** 含 pre-release
  標記者（`-alpha`／`-beta`／`-rc`／`-pre`／`-dev`／`-canary`，不分大小寫）與**純 patch**（semver
  `x.y.z` 中 `z>0` 且非安全修補）；**keep** major/minor（`z==0` 或 minor/major 位變動）與帶安全字樣者
  （title/notes 命中 `security`／`CVE`／`advisory`）。無法解析版本者保守保留（不誤殺）。
- **Rationale**：§4.2「releases 過濾 pre-release 與純 patch，避免版本噪音灌爆候選池」；安全修補常伴
  patch 號但屬第一順位重要性，故安全字樣豁免。SC-010 要求 pre-release／純 patch 出現次數為 0。此過濾
  僅就**版本類型**判定、**不含時間窗**；releases 的「近期」口徑由 `releases.atom` 天然近況界定
  （FR-010），刻意不加逐筆日期過濾以免無謂邏輯，殘留偏舊項交新鮮度決勝與 F6 處理。
- **Alternatives**：完整 semver 函式庫——被否，避免相依膨脹；標題級啟發式＋保守保留已足（門檻可調、
  上線再校，spec Assumptions）。

## D7. target-URL 正規化（FR-011, SC-009）— 去重主鍵

- **Decision**：`url-normalize.ts` 純函式 `normalizeTargetUrl(raw): string`：小寫 host、去 `www.`、
  移除追蹤參數（`utm_*`／`ref`／`fbclid`／`gclid`／`mc_*` 等，用前綴＋清單）、統一結尾斜線（去尾斜線，
  root 保留 `/`）、保留其餘 query 與 path、去 fragment；**可低成本解開的短網址**（`t.co`／`bit.ly`
  等已知轉址 host）以「一次 HEAD/GET 取 Location」解開，**解不開或非已知短網址則照原樣正規化**
  （FR-011 Edge：不發起昂貴或不可靠請求）。指向同一資源者得相同鍵（SC-009）。
- **Rationale**：§4.4 步驟 1 明列的正規化規則；去尾斜線／去 www／去追蹤參數是跨來源重複的最大公因數。
- **Alternatives**：用 WHATWG `URL` 逐段處理（採用）vs 正則硬拆（否，易錯）。短網址解開預設**關閉網路解址、
  只做已知 host 的單次解**，避免抓取禮貌與零維運破口——實作上以「是否為已知短網址 host」為 gate。

## D8. 分數門檻與「無社群分數」處理（FR-016/019, SC-005）

- **Decision**：`funnel.ts` 對**有社群分數的來源套品質門檻**、低於則丟。門檻依 tier 與來源型別查
  `SCORE_THRESHOLDS`（起始值：HN points>100、Lobste.rs>20；Tier 3 更高門檻更低權重）。**無社群分數者
  （Tier 2 一手來源，以及 Reddit `.rss` 這種 RSS 取不到分數者）MUST NOT 套分數門檻**，直接保留、
  天然視為強訊號。門檻與權重集中為可調常數表。
- **Rationale**：FR-016/SC-005「Tier 2 被分數門檻丟棄比率 0%」；D5 指出 Reddit RSS 無分數，若對「score
  為 null」硬套門檻會誤殺，故統一規則為「**score 存在才比門檻**」。tier 差異化加權落實 FR-019。
- **Alternatives**：給無分數項填 0 再套門檻——被否，會把 Tier 2／Reddit 全殺，違反 SC-005。

## D9. 標題近似去重（FR-013, SC-001 補漏）

- **Decision**：`title-similarity.ts`：標題正規化（小寫、去標點、去 stop words）→ token 集合 →
  **Jaccard 相似度**；`dedup.ts` 在 URL 合併後，對「無共同 target-URL」者兩兩比對，超過門檻
  `TITLE_JACCARD_THRESHOLD`（起始 0.6，可調）即合併（保留最高分為代表、併 sources[]）。門檻為可調參數。
- **Rationale**：§4.4 步驟 2；Jaccard 零 LLM、廉價。門檻偏保守起步避免誤合併（Edge Case）。
- **Alternatives**：Levenshtein／餘弦——Jaccard 對「同事件不同標題」召回足夠且最簡；embeddings 為
  憲章 V 明文禁止。

## D10. 交叉驗證與榜單相關性加權（FR-017/018, 榜單無資料時安全略過）

- **Decision**：`funnel.ts` 加權訊號：(1) `sources.length >= 2` → 交叉驗證強訊號加權；Tier 2 單一來源
  亦視為強訊號。(2) 候選標題/摘要**提到當前榜上 repo** → 加權；榜單相關集由 `NewsIngestService` 從
  `state.board` 的 `fullName`／短名建 `Set` 傳入，**空集合時整段略過、不加權、不報錯**（FR-018 Edge）。
  比對用小寫詞界（避免子字串誤命中，沿用 `classify` 的教訓）。
- **Rationale**：§4.4 步驟 4/5；榜單資料可能不存在（未到期未建當前榜、或狀態初始），必須安全略過。
- **Alternatives**：即時抓當前榜——被否，F4 不重建榜單（spec Assumptions），消費既有 `state.board` 快照即可。

## D11. 排序決勝與確定性（FR-020, SC-011）

- **Decision**：加權後以**全序決勝**排序：加權分數 ↓ → 新鮮度（`isoDate`）↓ → 正規化 target-URL ↑
  （最終決勝鍵，保證全序）。收斂：排序後取前 N（目標區間上限，如 25），候選稀少照實輸出、不硬湊
  （FR-021）。合併階段的**代表項**亦以確定性決勝（同分時 `sourceId`→`originalUrl` 字典序，FR-012），
  與排序同屬 SC-011 的全序保證。
- **Rationale**：SC-011 要求「相同輸入多次執行成員與排序 100% 一致、不依賴 sort 穩定性」；沿用 F3
  榜單「四層全序決勝」的作法（見 dev-guide §5.2）。以 URL 作最終鍵因其在去重後必唯一。
- **Alternatives**：只用分數＋新鮮度兩層——被否，同分同時間者順序不定，破壞確定性。

## D12. `seenNews` 修剪與跨天排除（FR-022/023/024, 憲章 VI）

- **Decision**：`seen-news.ts` 純函式 `pruneSeenNews(entries, now, retentionDays=7)`（剔除 `seenAt`
  逾 7 天者）與 `excludeSeen(candidates, seenSet, now)`（以**正規化 target-URL**比對排除已見）。
  `NewsIngestService` 於 `StateStore.load()` 後在**記憶體**修剪並用於排除；**不寫回**（寫回屬 F6/F7
  推播成功後）。比對用 D7 同一套 `normalizeTargetUrl`。
- **Rationale**：FR-024 明定本 Feature 只消費與修剪、寫回屬 F6/F7；FR-022 要求以同一套正規化比對，
  否則帶不同追蹤參數的同一連結會漏排除。修剪不落地也符合「無副作用早退」精神。
- **Alternatives**：把修剪塞進 `StateStore.load()`——被否，`StateStore` 應保持與領域無關的通用存取；
  修剪是新聞領域規則，放新聞層並以 `now` 注入利於測試。

## D13. 編排、容錯與觀測（FR-025/026, 憲章 VII；本 Feature 產出面）

- **Decision**：`NewsIngestService.ingest(now, boardRepoNames)`：驗證設定 → 對每個 `enabled` 來源
  **獨立 try/catch** 抓取＋正規化（失敗記錄並跳過、不斷全線 FR-026；**解析 0 筆發帶 `id` 告警**
  FR-025，含 Tier 2）→ 匯集 → URL 去重 → 標題 Jaccard 去重 → `cross` 歸類 → 漏斗過濾／加權／排序 →
  排除 seen → 回傳 `CandidateSet` 並經 `news-log.ts` 印出觀測。告警走 `bestEffortFailureAlert`
  （送出失敗只記 log 不擲錯）。**本 Feature 不接入 `PipelineService` 推播路徑**（F7 才串接）；
  可由 `main.cli` 於觀測模式呼叫或留待 F7。
- **Rationale**：憲章 VII 來源隔離＋紅色告警；FR-025「0 筆必告警且帶 id、Tier 2 不例外」。复用既有
  `best-effort-alert` 保持告警語意一致。
- **Alternatives**：一次 `Promise.all` 無隔離——被否，單源失敗會拖垮全線，違反 FR-026。採逐源隔離
  （可並發但各自捕捉）。

## D14. 新增相依：`rss-parser`

- **Decision**：`npm i rss-parser`（憲章技術釘死清單內）。僅用於 feed 解析。
- **Rationale**：Reddit/Lobste.rs/官方 blog RSS 與 GitHub Atom 皆需健壯解析；憲章已釘死此庫。
- **Alternatives**：`@google/genai`／`undici`／`feed` 本 Feature **不引入**（分屬 F5/F6/F8）。

---

### 風險與後續校準（非阻擋）

- Reddit `.rss` 無 upvote 分數 → 走「無分數＝不套門檻」路徑（D8）；若日後需分數，改用 Reddit JSON
  端點屬設定/來源調整，不影響本設計。
- 短網址解址預設保守（只解已知 host、單次）；門檻值（分數、Jaccard、收斂上限）皆可調起始值，上線
  逐一驗證 feed URL 後再校（spec Assumptions、dev-guide §4.4/§12）。
