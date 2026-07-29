<!--
SYNC IMPACT REPORT
==================
Version change: 1.4.0 → 1.5.0
Bump rationale: MINOR——原則 III 的**新聞晨報 AI 下限由「≥5」提高為「≥7」，且字數上限由
  「標題 ≤50 / 內容 ≤300」放寬為「標題 ≤70 / 內容 ≤500」**（repo 簡介 ≤250 不變）。屬既有原則內的
  參數調整（先例：1.4.0 同樣調整原則 III 的新聞配額參數，判 MINOR），未移除或重新定義八條原則
  本身，故非 MAJOR；因調整的是 NON-NEGOTIABLE 原則本身的具體數字（非僅技術約束細節），故非 PATCH。
  決策來源：使用者發現 1.4.0 上線後晨報實際每天仍只收到約 5 則新聞（`MIN_AI=5` 在 prompt 中僅為
  軟性下限措辭、程式端不強制湊滿），要求把 AI 下限提高到 7 以加重措辭力道；同時認為 300 字內容
  偏短，要求放寬到 500 字，並一併把標題上限放寬到 70 字（repo 簡介維持 250 字不變），2026-07-29。

  動機：AI 下限調整是「軟性提示」層級的加重，非程式端硬性保證——候選不足或 LLM 判斷不足時仍會
  照實輸出較少則數，此為既有「寧缺勿濫、不硬湊」精神的延續，不是新的保證。字數放寬則讓每則新聞
  能更完整交代「發生什麼事＋為何對開發者重要」，尤其對內容較複雜的項目（如新模型/API 發布、
  breaking change）更有餘裕說明。

Modified sections:
  - 原則 III「只推變化、控制節奏」→ AI 下限 ≥5 → ≥7；標題 ≤50/內容 ≤300 → 標題 ≤70/內容 ≤500
    （簡介 ≤250 不變）。
  - 原則 VIII「關鍵邏輯測試優先」→ 必測項「新聞配額」「字數上限驗證」數字同步更新。
Added sections: 無
Removed sections: 無

Templates requiring updates:
  - CLAUDE.md ✅ 已同步（硬規則 3 之新聞配額與字數上限，並記錄 2026-07-29 調整前數字供對照）
  - docs/tech-radar-dev-guide.md ✅ 已同步（§0 決策表、§3.3 來源判準、§4.4 過濾漏斗與晨報精選、
    §7 Discord 呈現、§9 組版範例程式碼註解、§11.1 Constitution 摘要段、§13 風險提醒、
    M4 里程碑、M0→M4 總結、§14 儀表板描述）
  - src/curation/curation-quota.ts ✅ 已同步（MIN_AI=5→7；MAX_ITEMS=10、MAX_NON_AI=3 不變）
  - src/curation/curation-validate.ts ✅ 已同步（clampToLimit 上限 50→70、300→500）
  - src/curation/curation-prompt.ts ✅ 已同步（prompt 內硬編碼的「≤50 字」「≤300 字」字樣同步為
    「≤70 字」「≤500 字」；MIN_AI 由常數內插，無需另改）
  - 相關測試（curation-quota.spec.ts、curation-fallback.spec.ts、curation-validate.spec.ts、
    curation.service.spec.ts、digest-embeds.spec.ts）✅ 已同步
  - specs/004-news-ingest、specs/006-news-curation 之既有 spec/plan/quickstart、以及
    dev-guide §11.2 F6 條目（「範圍」「驗收」二行，屬 F6 完成當時的驗收紀錄）⚠ 維持原樣不改——
    歷史 Feature 已驗收合併，屬完成當時的歷史紀錄（沿用本專案「歷史 spec 不回改，只更新真實
    來源」慣例，見 CLAUDE.md）

Follow-up TODOs: 無

Prior history:
  - 1.4.0（2026-07-19）：MINOR——原則 III 的新聞晨報配額由「6 則 / AI ≥4 / 非AI ≤2」放寬為
    「至多 10 則 / AI ≥5 / 非AI ≤3」。決策來源：候選規模（15～25 則/日）相對於 6 則上限明顯保守。
  - 1.3.2（2026-07-19）：PATCH——排程 workflow 狀態 commit 落在獨立的 `state` orphan 分支，不再
    落在 `develop`/`main`；`state/board.json` 仍是唯一權威狀態，只是改變它被 commit 到哪個分支。
  - 1.3.1（2026-07-19）：PATCH——Discord Secrets 由單一 `DISCORD_WEBHOOK_URL` 拆分為三條獨立
    webhook（`DISCORD_NEWS_WEBHOOK_URL` 晨報／`DISCORD_BOARD_WEBHOOK_URL` 榜單／
    `DISCORD_ALERT_WEBHOOK_URL` 告警），讓三類推播可各自獨立訂閱/靜音。
  - 1.3.0（2026-07-15）：MINOR——原則 III 的榜單推播節奏由「每三天」改為「每七天」，明定到期
    門檻為 162 小時（168h − 6h 寬限），使節奏與「估算本週增星」的七日尺對齊；新聞側完全不受
    影響。Drive-by 一併校正檔尾 Version/Last Amended 漏更、原則 VIII 殘留「三領域」用字。
  - 1.2.0（2026-07-15）：MINOR——榜單領域由三領域收斂為兩領域（AI / 前後端），移除 DevOps；
    依 F2 M1 驗收實測（歸類正確率 0、訊號量級過低）。新聞側 DevOps 配額與來源不受影響。
  - 1.1.0（2026-07-11）：MINOR——原則 III 收斂榜單推播變化類型，移除「跌出」為獨立推播項。
  - 1.0.1（2026-07-11）：PATCH——釐清「技術與安全約束」狀態 commit 措辭（no-diff 早退）。
  - 1.0.0（2026-07-11）：首次由模板具體化為正式憲章（MAJOR 起始版），確立八條非協商原則、
    技術與安全約束、開發流程與治理章節。

Follow-up TODOs（沿自舊版本，仍有效）:
  - F4 (004-news-sources)：新聞 domain 分類法「是否比照榜單合併前後端」之待定項仍有效，但
    **不得**因榜單移除 DevOps 而連帶移除新聞的 devops（見 1.2.0 Scope note；dev-guide §11.2 F4）。
-->

# Tech Radar Constitution

> 每日晨報自動追蹤近一週最受關注、新崛起的 GitHub repo（**榜單：AI / 前後端**）與相關技術
> 討論（**新聞：AI 為主，兼及 DevOps / 後端 / 前端**），透過 Discord 推播；純自用、全免費、
> 零維運，走 Spec-Driven Development。
>
> 榜單與新聞是**兩條獨立資料流**，領域集合刻意不同：榜單的 DevOps 已於 2026-07-15 移除
> （F2 M1 驗收實測歸類正確率 0、訊號量級過低），新聞的 DevOps 配額與來源則維持不變。
> 本憲章為全專案的最高規範，凌駕其他慣例；違反須依「治理」章節記錄並取得核可。

## Core Principles

### I. 零維運免費基礎設施（NON-NEGOTIABLE）

執行、推播、LLM 一律建立在免費且零常駐的服務之上：以 **GitHub Actions 排程 workflow**
為執行環境、**Discord Channel Webhook** 為推播通道、**Gemini 免費層（Flash 系）** 為 LLM。
禁止引入常駐伺服器、付費方案，或任何需要按月計費的基礎設施。任何設計若使月用量逼近
免費上限（Actions 分鐘、Gemini RPD、GitHub API 限額），必須先降用量或改架構，不得升級付費。

理由：本專案為個人自用、以「零成本、近乎零維運」為存在前提；破壞此前提即失去專案意義。

### II. 不自存星星歷史（NON-NEGOTIABLE）

「本週增星」一律取自 **GitHub Trending weekly 官方週增量** 與 **Search API `created:>7天`**，
禁止自建每日星星快照或 day-over-day 對比機制。唯一被允許持久化的榜單資料，是用於「只看變化」
的上次榜單快照（見原則 VI），而非通用星星時序歷史。

理由：官方已算好週增量，自存歷史徒增狀態、儲存與維運負擔，違背零維運前提。

### III. 只推變化、控制節奏（NON-NEGOTIABLE）

推播節奏與資訊量受硬性約束，優先「少而重要」而非「多而全」：

- **榜單每七天推一次，且只呈現與上次的差異**（新進 / 竄升 / 下降），不重述整份榜單；
  **repo 掉出推播榜（跨領域綜合 top 10）當次靜默、不另報「跌出」，日後重回即以新進呈現**；
  每週節奏由 `lastBoardPushAt` 計時（非 cron），到期門檻為 **162 小時**（七天 168 小時減
  6 小時寬限，用於吸收排程延遲與雙班抖動，使節奏不單向漂移）。節奏必須與榜單的尺對齊：
  「估算本週增星」是七日指標，短於七天推播等同以**重疊視窗**互比，名次移動即失去意義。
- **新聞晨報每日固定精選至多 10 則**，配額為 **AI ≥ 7；DevOps / 後端 / 前端合計 ≤ 3**（軟性上限，
  寧缺勿濫、不足 10 則不硬湊）。
- 新聞以**對開發者的重要性排序（非熱度）**；分數僅為提示，非排序主鍵。
- 每則新聞以**繁體中文**呈現：**標題 ≤ 70 字 + 內容 ≤ 500 字**；repo 簡介 **≤ 250 字**。
- 領域聚焦：後端只看 **Node.js / Python**、前端以 **TypeScript** 為主（Vue/React 最低），
  **CSS 技巧 / 教學一律不收**。

理由：核心價值是「只看變化、避免通知疲勞」；放寬節奏或字數即退化為洗版式資訊流。

### IV. 新聞來源設定即資料（NON-NEGOTIABLE）

所有新聞來源**集中於單一設定檔** `src/config/news-sources.ts`，並分三層管理
（Tier 1 高訊號聚合 / Tier 2 高精準一手 / Tier 3 選配實驗）。**增、刪、修來源只改此設定檔，
禁止改動任何 pipeline 程式碼**；Tier 3 可隨時移除。壞掉的 feed 以停用 / 替換設定處理，
且「解析到 0 筆」必須發告警並帶來源 `id`，不得無聲略過。

理由：來源清單是最常變動且最脆弱的一環；設定與程式解耦才能低成本維護、快速止血。

### V. 去重確實且節制 LLM（NON-NEGOTIABLE）

晨報跨來源去重的主力是**零 LLM 的 target-URL 正規化**（＋標題近似 Jaccard 補漏）。
新聞策展**每日僅呼叫 Gemini 一次**，且**禁止引入向量檢索 / embeddings**；殘留語意重複
由該次策展呼叫順手清除。LLM 對整條新聞流程的用量必須固定為「每日 1 次」，與候選數無關。

理由：去重是資訊品質的地基，須確實但廉價；把 LLM 用量鎖死可保證額度安全與行為可預期。

### VI. 冪等、快取與單一狀態來源（NON-NEGOTIABLE）

- **狀態單一權威來源**：`state/board.json`（榜單快照 + 簡介快取 + 已推新聞紀錄）為唯一權威狀態。
- **晨報冪等**：以 `lastNewsPushAt` 做 guard（距今 < ~18h 跳過新聞段），雙 cron 只會推一次，
  漏跑由補跑 cron 遞補；狀態必須在**推播成功後**才寫回，禁止寫入半套狀態。
- **簡介必快取**：同一 repo 的 250 字簡介一生只生成一次，快取獨立於榜單快照、跌出榜不清除。
- **LLM 不得產生事實數據**：星數、連結、名次一律由程式提供；LLM 只做選擇、去重與依素材改寫，
  禁止杜撰來源沒有的數字、連結或事實。

理由：跨執行的正確性依賴單一狀態與冪等保證；快取與防幻覺是額度與可信度的雙重護欄。

### VII. 機密隔離與容錯發佈（NON-NEGOTIABLE）

- **秘密不入庫、不入發佈物**：token / webhook URL 只走 GitHub Actions Secrets，
  絕不寫進 repo、也絕不寫進任何發佈到 GitHub Pages 的產物（儀表板 / feed）。
- **來源隔離容錯**：任一資料來源失敗，不得使整條 pipeline 失敗；失敗須發紅色告警 embed，
  不得無聲失敗。
- **發佈僅限 public、且不得波及推播**：GitHub Pages 發佈為完全隔離的末段，僅在 repo 為 public
  時啟用，切成 private 須依可見性偵測**自動停用**；其停用或失敗絕不得回滾狀態、
  阻斷 Discord 推播或影響 state 存取。

理由：機密外洩與級聯失敗是自用專案唯二的高影響風險；隔離與容錯把爆炸半徑限制在單一元件內。

### VIII. 關鍵邏輯測試優先（NON-NEGOTIABLE）

下列關鍵邏輯必須有單元測試，方可視為完成：trending HTML 解析（以快照測試守著改版）、
**兩領域歸類**、榜單 diff、**target-URL 正規化去重**、**標題近似去重**、簡介快取命中、
**新聞配額（至多 10 則 / AI ≥ 7 / DevOps+後端+前端 ≤ 3）**、**70 / 500 / 250 字數上限驗證**、
**來源清單 schema 驗證與 tier 加權**、**晨報 idempotency guard（`lastNewsPushAt` < ~18h 跳過）**、
**榜單每週節奏（`lastBoardPushAt` 計時、162 小時門檻）**。外部呼叫（Gemini 策展）以 mock 測試，
並必須另測「策展失敗時退回純程式排序」的降級備援路徑。

理由：這些是資料正確性與節奏保證的要害；無測試覆蓋即無法在改動來源或解析時安全回歸。

## 技術與安全約束

- **技術釘死**（於每個 Feature 的 `/speckit-plan` 確認）：NestJS 以
  `NestFactory.createApplicationContext()` 跑一次性 CLI job（保留 DI、不啟 HTTP server、跑完即退）；
  `cheerio`（爬 Trending）、`rss-parser`、`@google/genai`、`undici`/`fetch`；F8 另加 `feed`。
- **執行與排程**：GitHub Actions，晨報排雙離峰 cron（`:07` / `:37`，UTC），並以 guard 抗漏跑；
  狀態 commit **僅在 `state/board.json` 實際變更時進行**（沿用開發指南 §8 workflow 的 no-diff 早退，
  不製造空 commit），且落在獨立的 `state` 分支（2026-07-19 起，見開發指南 §2.2/§8），不落在
  `develop`/`main`。workflow 活性（避免 60 天停用）由正式期每日 `lastNewsPushAt` 變更與開發期
  程式碼 commit 自然維持，不依賴人工心跳 commit。
- **Secrets 命名**：`GH_API_TOKEN`（不可用 `GITHUB_` 前綴）、`GEMINI_API_KEY`、Discord webhook
  三頻道分流（`DISCORD_NEWS_WEBHOOK_URL` 晨報／`DISCORD_BOARD_WEBHOOK_URL` 榜單／
  `DISCORD_ALERT_WEBHOOK_URL` 告警，2026-07-19 由單一 `DISCORD_WEBHOOK_URL` 拆分），
  皆存於 Actions Secrets。
- **抓取禮貌**：帶自訂 User-Agent、條件式請求（ETag / If-Modified-Since）、失敗指數退避；
  Gemini 429 用指數退避 + jitter。
- **只送公開資料給 LLM**：策展與簡介只送公開來源內容，符合免費層資料使用條款。

## 開發流程

- **Spec-Driven Development（Spec Kit + Claude Code）**：Constitution 全專案建立一次；
  之後每個 Feature 各自走完一輪
  `specify → clarify → plan → checklist → tasks → analyze → implement`；
  **前一個 Feature 合回 `develop` 後再開下一個**。
- **Git 分支策略**（進入開發階段後生效）：
  - `main` **不直接 commit**，只接受來自 `develop` 的合併，保持隨時穩定可回溯。
  - `develop` 為整合分支；所有 Feature 分支從 `develop` 切出，命名沿用 `NNN-feature-name`，
    完成 implement 與驗收後合回 `develop`；驗證穩定後再由 `develop` 合入 `main`。
  - **無例外**：排程 workflow 由 bot 自動 commit 的 `state/board.json`（執行期狀態更新）落在
    獨立的 `state` 分支（2026-07-19 起），不落在 `develop`/`main`，兩者皆無須為此設例外。
- **Feature 順序**：依開發指南 §11.2 的 F1 `001-foundation` → F8 `008-pages-publish` 依序執行，
  各 Feature 的驗收即對應里程碑 M0–M5；F8（Pages）為 post-MVP，先完成 M0→M4。
- **品質閘門**：每個 Feature 的 `plan.md` 須通過 Constitution Check；違反原則者須在
  Complexity Tracking 記錄理由，否則不得進入實作。

## Governance

- **本憲章凌駕其他慣例**：與本憲章衝突的做法一律以本憲章為準。
- **版本政策**（語意化版本）：
  - MAJOR：移除或重新定義原則、或做出向後不相容的治理變更。
  - MINOR：新增原則 / 章節，或實質擴充既有指引。
  - PATCH：釐清用字、修正錯字等非語意調整。
- **修訂程序**：修改本檔須（1）更新版本號與日期、（2）於檔首 Sync Impact Report 記錄變更、
  （3）檢查並同步 `.specify/templates/` 下的 plan / spec / tasks 範本與開發指南，確保無過時引用。
- **合規審查**：所有 `/speckit-plan` 產出的 plan 必須執行 Constitution Check；PR / 審查須驗證
  本憲章各非協商原則未被破壞；任何複雜度或例外皆須明確記錄與正當化。
- **來源文件**：執行期與設計細節以 `docs/tech-radar-dev-guide.md` 為準；該指南與本憲章不一致時，
  以本憲章的非協商原則為最高約束，並修訂指南使其一致。

**Version**: 1.5.0 | **Ratified**: 2026-07-11 | **Last Amended**: 2026-07-29
