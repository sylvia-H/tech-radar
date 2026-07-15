# Phase 0 Research: 002-board-sources

本 Feature 的關鍵未定項已於 `/speckit-clarify`（Session 2026-07-11）定案並回填 spec（FR-010）。以下彙整實作層技術決策；spec 已定案者標「(clarify 已定)」，不重開。格式：Decision / Rationale / Alternatives。

---

## D1 — Trending 主力：爬取與解析

- **Decision**：以 `cheerio` 抓 `https://github.com/trending?since=weekly` 及語言頁 `?since=weekly`（**全站 ＋ `typescript` / `javascript` / `python` / `rust` / `shell`**，clarify 已定）。每列 `article.Box-row` 解析 `owner/name`、`description`、`language`、以及「stars this week」數字（`.float-sm-right` 文字取數）。跨 6 頁先以 `fullName` 去重，再進分類。
- **Rationale**：Trending 無官方 API；HTML 結構穩定、第三方服務多要錢或不穩，自爬最省且符合憲章 I。週增星是官方算好的量、零狀態（憲章 II）。
- **Alternatives**：GraphQL/第三方 trending API（要錢或不穩）；`?since=daily`（非週視角，違背週指標）——皆否決。
- **回歸保護**（FR-009）：存 `tests/fixtures/trending-weekly.html` 做**快照測試**；解析結果為 0 筆或欄位抽不到 → 視為頁面改版，**發帶來源 id 告警**，不得靜默當「本週無熱門」。

## D2 — GitHub API 用量預算（憲章 I 核心 gate）

- **Decision**：單次執行預算——(a) Trending HTML **6 次**（github.com 網頁，不計 API 限額）；(b) 每個 **Trending 唯一候選**呼叫 `GET /repos/{owner}/{repo}` 取 topics，去重後 ≤ ~120 次（core，估算值；SC-006 安全上限設 ~150；2026-07-15 實測 102 次）；(c) Search **2 次**（每領域一組，DevOps 移除後由 3 次減為 2 次；API 端已回 topics，免再打 /repos）。core 上限 5,000/hr、Search 30/min → 使用率 < 3% / 7%。
- **Rationale**：唯一會逼近限額的是 Trending 候選的 topics 補抓；用「先 `fullName` 去重再打 /repos」「有限並發 ≤6」「條件式請求（ETag）」壓低次數與 secondary rate limit 風險。
- **Alternatives**：對每列都打 /repos（重複浪費）；用 GraphQL 批次取 topics（可行但增複雜度，F2 規模用不到）——暫否決，量大時再議。
- **量測**：`board-builder` 記錄本次 core/search 呼叫次數並在 log 印出，供 SC-006 人工核對。

## D3 — 補位 Search：兩組領域查詢

- **Decision**：對 AI / 前後端各發一次 `GET /search/repositories`，`q` 帶該領域關鍵字 OR 群、`created:>{今天−7天}`、`stars:>{門檻}`，`sort=stars&order=desc`，取每組前 N（N 取足以供分類與 top 15，建議 ~30）。**門檻（clarify 已定）**：AI `stars:>30`、前後端 `stars:>20`（DevOps 組已於 2026-07-15 隨領域移除，查詢由 3 組減為 **2 組**）。
- **Rationale**：`created:>7天前` ＋ 當前總星數即「一週內誕生且已累積不少星」＝新崛起，零狀態（憲章 II）。Search 回應本身含 `topics`，補位候選不需再打 /repos。
- **Alternatives**：單一大查詢再本地分類（q 語意糊、命中差）；用 stars 排序以外的 sort（偏離「已很紅」）——否決。
- **注意**：Search 回的是**當前總星數＋建立日期**（非週增星），排序用 `weeklyStarsEstimate`（D5）換算。

## D4 — 兩領域歸類演算法（clarify 已定規則，本節定實作）

- **Decision**：對每個候選，依序：
  1. **topics**（主要訊號）比對兩領域關鍵字種子集 → 命中的領域集合。
  2. 若**無 topics**，改以 **description** 比對關鍵字 → 命中領域集合。
  3. **language** 僅作**輔助訊號**、**不得單獨決定領域**，且**不參與跨領域主領域決勝**（跨領域一律依步驟 4 固定優先序）；language 至多用於「已因 topics/description 命中單一領域」時的信心佐證，不改變領域歸屬。
  4. 命中多領域 → **擇一主領域**，固定優先序 **AI > 前後端**（FR-011）。
  5. topics 與 description 皆無命中 → **排除**（不強行歸類，寧缺勿濫）。
  - 歸類採**寬鬆傾向**：確屬兩領域的開發者工具不因關鍵字過嚴被漏收。
  - **比對語意**（A1，**2026-07-15 修訂**）：topics 與 description **一律小寫詞界**比對（以非英數字元為界）。原定 topics 用子字串（求寬鬆），但 `ai` 會命中 `blockchain`／`domain-driven-design`、`rag` 會命中 `drag-and-drop`，加上 AI 優先序最高 → 直接侵蝕 SC-002；寬鬆傾向改由種子集補充群（`openai`／`agents`／`reactjs`…）承擔。見 [data-model.md](data-model.md) 與 spec FR-003、Clarifications Session 2026-07-15。
  - **實作**：兩領域各預編一條 `(?<![a-z0-9])(kw|kw…)(?![a-z0-9])` regex（模組載入時編一次），topics 逐個比對、description 整串比對；增刪關鍵字仍只改 `domain-keywords.ts`。
- **Rationale**：直接落實 spec FR-003/FR-011 與 clarify；純字串比對、零 LLM（憲章 V）。
- **Alternatives**：LLM 歸類（違憲章 V、且 F2 不引入 LLM）；允許同時入多榜（clarify 已否決，去重/名額會亂）；topics 子字串比對（A1 原案，已因 SC-002 誤判撤回）；token 前綴／後綴比對（可不擴充種子集就接住 `openai`，但 `rag` 仍會誤命中 `drag`）——皆否決。
- **關鍵字種子集（v1 canonical）**：見 [data-model.md](data-model.md#領域關鍵字種子集v1-canonical) 與 `src/classify/domain-keywords.ts`；增刪只改該檔（憲章 IV 精神）。

## D5 — 合併去重與排序鍵 `weeklyStarsEstimate`

- **Decision**：兩來源 union 後以 **GitHub 數字 `repoId`** 判同一性去重（抗改名，FR-004）；同一 repo 同時來自兩來源時，保留 Trending 的 `starsThisWeek`。為每個候選計算**統一排序鍵 `weeklyStarsEstimate`**：
  - Trending 候選：`= starsThisWeek`；
  - 純 Search 候選：`= min(round(totalStars / max(ageDays, 1) × 7), totalStars)`（估成週增星等值，`max(_, 1)` 避免除以零，**上限 `totalStars`** 見下）。
  每領域內以 `weeklyStarsEstimate` 由大到小穩定排序，取 **top 15**。
- **總星數上限（2026-07-15 修訂）**：補位只撈 `created:>今天−7天`，這些 repo 的星**全部是本週累積的**，故「本週增星」的真值上界即 `totalStars`；無上限時今日新建 300 星者會被外推成 2,100，壓過官方週增星 1,800 的主力龍頭（`ageDays ≤ 7` 時上限恆生效，等價於直接採計 `totalStars`；保留 `min` 形式是為了讓 `ageDays > 7` 的異常樣本仍走換算公式）。`ageDays` 無法判定（`createdAt` 壞）時 MUST 為 `null` 而非 `0`——判 0 等同宣稱今日新建。
- **Rationale**：一個領域榜會**混合兩來源**，需要單一可比排序鍵才能產生穩定 top 15。`weeklyStarsEstimate` 忠於 FR-005（主力 `starsThisWeek`、補位 `總星數÷建立天數`，×7 使兩者同尺），並**同時是 F3/F7 綜合 top 10 要用的同一把尺**——F2 先建立、下游沿用，不重複發明。
- **穩定性**（SC-005/FR-005）：排序以 `(weeklyStarsEstimate desc, repoId asc)` 為 tie-break，確保同輸入必得同順序、不受來源處理順序影響。
- **Alternatives**：Trending 群固定排在 Search 群之上再各自排序（武斷、會壓掉真正高速的新星）；不換算、各領域內只按來源分組（無法產生單一 top 15）——否決。
- **spec 對齊註記**：spec Assumptions「各領域內排序不需換算成同一標度」係指**不需跨領域**換算；F2 仍需在**領域內**以 `weeklyStarsEstimate` 統一兩來源，二者不衝突（FR-005 為約束來源、本鍵為其實作）。

## D6 — 來源隔離與容錯（FR-007/FR-009）

- **Decision**：`board-builder` 對「主力 Trending」與「補位 Search」各自 try/catch；任一拋錯或**解析到 0 筆**→ 呼叫 F1 `failure-alert` 送**紅色告警並帶來源 id**（如 `github-trending` / `github-search:ai`），另一來源仍照常產出其榜單；兩者皆正常則不發任何來源告警（SC-004）。
- **隔離粒度＝單次請求（2026-07-15 修訂）**：主力 6 個語言頁在 `fetchTrending` 內**逐頁 try/catch**，失敗頁記入 `TrendingResult.failedPages`（全站頁記 `all`）由 `board-builder` 逐一發 `github-trending:{page}` 告警，其餘頁照常合併；**合併後 0 筆**才擲錯、轉為 `github-trending` 主力告警。原本 6 頁共用一個 try/catch，任一頁 404 或任一列欄位漂移就讓另外 5 頁的上百筆候選一起丟掉、主力全滅——與 FR-007「不得使整條流程失敗」相違。逐列的欄位漂移仍擲錯（FR-009 的改版偵測不放寬），但爆炸半徑限縮在該頁。
- **Rationale**：無人值守自用任務的護欄（憲章 VII）；沿用 F1 既有告警通道，不新建。
- **Alternatives**：任一失敗即中止全流程（違 FR-007）；靜默略過 0 筆（違 FR-009，會把「解析壞掉」誤當「本週無熱門」）；單列漂移只略過該列（會讓真正的改版被稀釋成「少幾筆」而測不出，違 FR-009）——皆否決。

## D7 — 兩領域 Domain enum 與 F1 佔位對齊

- **Decision**：F2 記憶體型別 `Domain = "ai" | "frontend-backend"`（2-way；`frontend-backend` 對應人類標籤「前後端」）。**DevOps 已於 2026-07-15 移除**（實測歸類正確率 0、週增星量級遠低，見 spec Clarifications Session 2026-07-15；僅榜單，新聞不受影響）。F1 `state.schema.ts` 之 `BoardEntry.domain` 目前為 4-way 佔位（`ai|devops|backend|frontend`），因 **F2 不持久化**故**不在本 Feature 修改**；持久化層對齊 2-way（**含移除 `devops`**）留待 **F3**（首次寫回 board）。
- **Rationale**：F1 data-model 已註明「domain enum 值在 F2 clarify 定案」；F2 定義權威分類型別、但依 spec「不寫回 state」故不動 schema，避免在無持久化需求下改動 F1 交付。
- **Alternatives**：F2 直接改 `state.schema.ts` 為 2-way（超出 F2「不觸狀態」範圍、且無 runtime 用途）；沿用 4-way 分列 backend/frontend（變多領域榜、違 spec 兩領域/共 30）——否決。
- **命名**：程式 enum 用 `frontend-backend`；log/顯示用「前後端」；卡片配色沿用 §7.4「前後端 `0xF7DF1E`」（屬 F7）。

## D8 — M1 可觀測性接點（不越界到 F3/F7）

- **Decision**：`PipelineService` 增一個「建置並印榜」步驟：呼叫 `BoardBuilderService.build()` 取得 `CurrentBoard`，以結構化 log 印兩領域榜（每筆：名次、`owner/name`、`weeklyStarsEstimate`、來源、領域）。**不** diff、**不**推播 Discord、**不**寫 `state/board.json`。可經 `workflow_dispatch` 或本機 `node dist/main.cli.js` 觸發。
- **Rationale**：M1 驗收就是「log 印出正確兩領域榜」；把建置掛進既有 pipeline 進入點最省事，且不製造狀態或推播副作用（憲章 III/VI 不受影響）。
- **Alternatives**：另做獨立 CLI 子命令（多一個進入點、非必要）；直接接 Discord 推播（越界到 F7）——否決。

## D9 — 抓取禮貌與退避（憲章 VII / §12）

- **Decision**：`github-http` 共用客戶端統一：自訂 `User-Agent`（如 `tech-radar/1.0 (+github actions; personal)`）、`Authorization: Bearer $GH_API_TOKEN`、對 Trending 頁支援 ETag/If-Modified-Since、失敗（5xx/429/network）**指數退避＋jitter**、`GET /repos` 批次以**有限並發 ≤6**；讀取 `X-RateLimit-Remaining`，逼近時退避。
- **限流型 403 與憑證型 403 分流（2026-07-15 修訂）**：GitHub 的 secondary rate limit 與限額耗盡**可能回 403 而非只有 429**，辨識特徵是帶 `Retry-After` 或 `X-RateLimit-Remaining: 0`。此類 403 MUST 併入退避重試；純憑證型 403（無上述 header）維持不重試、直接擲錯。否則 `GET /repos` 批次一觸發 secondary limit 就整批不重試地失敗，還會被 `shouldAlertRepoFailures` 的 401/403 門檻誤報成憑證問題（U3 門檻本身不變）。
- **`X-RateLimit-Remaining` 讀取**：header 缺席時 MUST 直接略過判斷——`Number(null)` 是 `0` 不是 `NaN`，逕自轉數字會把「沒有這個 header」誤判成「剩餘 0、逼近限額」而白白退避。
- **API 呼叫計數（SC-006）**：MUST 於**送出前**累加（失敗與退避重試都算同一次邏輯呼叫）——失敗的呼叫一樣吃掉限額，只計成功數會讓用量觀測在最需要它的失敗場景下低估。
- **Rationale**：符合抓取禮貌與 secondary rate limit 規避；集中於單一客戶端便於測試與日後 F5 復用。
- **Alternatives**：無節制並發（易觸 secondary limit）；引入 axios/Octokit（多相依，內建 fetch 已足）——否決。

---

**NEEDS CLARIFICATION 狀態**：無。spec FR-010 之四項關鍵未定項（語言頁、門檻、跨領域規則、關鍵字集）已於 clarify 定案；本 research 僅補實作層決策，Constitution Check 通過，可進入 Phase 1。
