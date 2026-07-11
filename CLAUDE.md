<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
`specs/001-foundation/plan.md`
<!-- SPECKIT END -->

# tech-radar — Agent 協作指引

tech-radar 是一個**排程型、純自用、全免費、零維運**的每日晨報：自動追蹤 DevOps / AI /
前後端近一週最受關注、新崛起的 GitHub repo 與相關討論，透過 Discord 推播。以 GitHub Spec
Kit（SDD）開發。**工程約束以 `.specify/memory/constitution.md` 憲章為最高規範**，凌駕其他
慣例；本檔只放憲章與開發指南中與 Agent 日常操作相關的行動層守則。

## 溝通語言

- 與使用者的**對話輸出一律用繁體中文**：回報成果、說明、詢問問題、提案都用繁體中文。
- 技術識別項原文照舊：程式碼、指令、檔名/路徑、Conventional Commits 前綴、API/token 名稱、
  既有文件既定用語，不翻譯。

## 真實來源（Source of Truth，不得憑空發明）

- **最高規範**：`.specify/memory/constitution.md`（憲章，八條非協商原則 + 技術與安全約束）。
  與其他文件衝突時以憲章為準。
- **執行期與設計細節**：`docs/tech-radar-dev-guide.md`（開發指南）——架構決策、資料來源選型、
  Discord 版面、排程設定、SDD Feature 規劃（§11.2 F1→F8）。與憲章不一致時以憲章非協商原則為準，
  並修訂指南使其一致。
- **唯一權威狀態**：`state/board.json`（榜單快照 + 簡介快取 + 已推新聞紀錄 + 兩時間戳）。
  只經 `StateStore` 讀寫，禁止繞過直接改檔或另建平行狀態（憲章 VI）。
- **新聞來源即設定**：`src/config/news-sources.ts`（F4+）——增刪修來源**只改此設定檔，禁止改動
  pipeline 程式碼**（憲章 IV）。
- **開發步驟**：正式流程走 Spec Kit；各 Feature 的 `specs/NNN-*/`（spec / plan / tasks /
  contracts / checklists）為該 Feature 的實作依據。

> 目前作用中的 Feature 見 `.specify/feature.json`（現為 `specs/001-foundation`）。F2+ 才會出現的
> 檔案（如 `news-sources.ts`、`sources/`、`news-filter/`）在動手前先確認是否已存在，勿引用尚未建立者。

### 跨 Feature 決策必須落地到真實來源（MUST）

在任一 Feature 的 `/speckit-clarify`、`/speckit-analyze`（或任何階段）中，若修正或新定了一項決策，
而該決策**不屬於本次 Feature 的實作範圍、卻會影響其他 Feature**（例：在 F2 clarify 定了 F3/F7 的
推播規則），則 **MUST** 立即將該決策寫入對應的真實來源——`docs/tech-radar-dev-guide.md`（架構／
執行／版面等設計細節）或 `.specify/memory/constitution.md`（涉及非協商原則時），並**同步修訂既有
內容使其與新決策一致、消除矛盾**（例如舊的推播模型段落須一併改寫，不得留下自相矛盾的敘述）。
**MUST NOT** 只寫進 Agent memory、或僅留在該 Feature 的 spec 就當作已定案。Agent memory 可作輔助
備忘，但**不是專案真實來源**；未同步到 dev-guide／憲章前，該跨 Feature 決策一律視為「未落地」。

## 環境

- 作業系統 **Windows**。終端機預設 **PowerShell**：用 `Copy-Item`、
  `New-Item -ItemType Directory -Force`、`Remove-Item -Recurse -Force`，不要用 `cp` / `mkdir -p`
  / `rm -rf`。Bash 工具是 POSIX sh，兩者語法不可混用。
- 套件管理用 **npm**（非 pnpm、非 monorepo）：`npm ci`、`npm run build`（`tsc`）、`npm test`（Jest）。
- **Node.js 24**（本機建議 nvm `24.x`；CI 用 `actions/setup-node@v4` `node-version: 24`）。
- 全程 **strict TypeScript**，避免 `any` 逃逸。
- 無本機 infra（無 docker / DB / 常駐服務）：本專案是一支跑完即退的一次性 CLI。
- 本機執行需三個機密以環境變數提供（勿寫入檔案）；缺任一即 fail-fast 不推播。

## 工程硬規則（皆容易被違反，須隨時遵守；括號為對應憲章原則）

1. **零維運免費基礎設施（I）**：只用 GitHub Actions（執行）+ Discord Channel Webhook（推播）+
   Gemini 免費層 Flash 系（LLM）+ GitHub API。**禁止**引入常駐伺服器、付費方案，或任何逼近免費
   上限（Actions 分鐘、Gemini RPD、GitHub API 限額）的設計——先降用量或改架構，不得升級付費。
2. **不自存星星歷史（II）**：「本週增星」一律取自 GitHub Trending weekly 官方週增量與 Search API
   `created:>7天`。**禁止**自建每日星星快照或 day-over-day 對比。
3. **只推變化、控制節奏（III）**：榜單**每三天推一次且只呈現差異**（`lastBoardPushAt` 計時，非
   cron）；新聞**每日固定精選 6 則**（AI ≥ 4；DevOps/後端/前端合計 ≤ 2，寧缺勿濫）；字數上限
   **標題 ≤ 50 / 內容 ≤ 300 / 簡介 ≤ 250**；一律繁體中文；按對開發者重要性排序（非熱度）。
4. **來源只改設定檔（IV）**：新聞來源增刪修只動 `src/config/news-sources.ts`，不碰 pipeline；
   「解析到 0 筆」**必須發告警並帶來源 `id`**，不得無聲略過。
5. **去重確實、節制 LLM（V）**：去重主力是零 LLM 的 target-URL 正規化（＋標題近似補漏）；新聞策展
   **每日僅呼叫 Gemini 一次**，**禁止 embeddings / 向量檢索**。
6. **冪等、單一狀態、防幻覺（VI）**：以 `lastNewsPushAt` guard 抗雙 cron 重推；**狀態必須在推播
   成功後才寫回**，禁止半套狀態；`StateStore.save()` 為**原子寫入**（先寫 `.tmp` 再 `rename`），
   `load()` 遇壞檔擲錯不覆寫；簡介一生只生成一次並快取；**LLM 不得產生事實數據**（星數/連結/名次
   一律由程式提供）。
7. **機密隔離與容錯（VII）**：token / webhook URL 只走 GitHub Actions Secrets，**絕不入庫、絕不寫進
   任何發佈產物**（只 commit 憑證的示意，不 commit `.env` / API key）；任一資料來源失敗不得使整條
   pipeline 失敗；失敗須發紅色告警 embed，不得無聲。
8. **關鍵邏輯測試優先（VIII）**：trending 解析（快照測試）、三領域歸類、榜單 diff、URL/標題去重、
   簡介快取命中、新聞配額與字數上限、來源 schema/tier 加權、晨報 idempotency guard、榜單三日節奏
   ——這些**須有單元測試方可視為完成**；外部呼叫（Gemini）以 mock 測，並另測降級備援路徑。

### 技術約束（於各 Feature `/speckit-plan` 確認）

- NestJS 以 `NestFactory.createApplicationContext()` 跑一次性 CLI job（保留 DI、不啟 HTTP server、
  跑完即退）。技術釘死：`cheerio`、`rss-parser`、`@google/genai`、`undici`/`fetch`（F8 另加 `feed`）。
- **Secrets 命名固定**：`GH_API_TOKEN`（**不可**用 `GITHUB_` 前綴，Actions 會擋）、`GEMINI_API_KEY`、
  `DISCORD_WEBHOOK_URL`，皆存於 Actions Secrets。
- 排程雙離峰 cron（`:07` / `:37`，UTC）＋ guard 抗漏跑；狀態 commit **僅在 `state/board.json` 實際
  變更時**（no-diff 早退，不製造空 commit）。
- 抓取禮貌：自訂 User-Agent、條件式請求（ETag / If-Modified-Since）、失敗指數退避；Gemini 429 用
  指數退避 + jitter。只送公開資料給 LLM。

## Commit 規範

- 沿用 Conventional Commits 前綴（`feat` / `fix` / `build` / `ci` / `chore` / `docs` / `test` /
  `refactor`），**前綴後的描述用繁體中文**；技術識別項保留原文。
- **type 選用準則**（依該 commit 主要性質擇一）：
  - `feat`：對使用者/產品有意義的**能力增量**（如推播通道、榜單 diff、新聞漏斗）。
  - `fix`：修正錯誤行為。
  - `build`：建置系統、相依與工具設定（`package.json` / `tsconfig` / jest 設定 / lockfile）。
  - `ci`：CI 設定（`.github/workflows/*`）。
  - `chore`：上述未涵蓋的維護與純鷹架（空骨架、狀態檔還原等）。
  - `docs` / `test` / `refactor`：文件 / 測試 / 不改行為的重構。
- **scope 用完整 Feature 目錄名**：`feat(001-foundation): ...`（本專案慣例用 `001-foundation`，
  非縮寫 `001`）。跨 Feature 或全域雜項可省略 scope（如 `chore: initialize spec kit workspace`）。
- 範例（取自本專案實際歷史）：
  - `feat(001-foundation): 專案骨架、Discord 推播通道與狀態持久化`
  - `fix(001-foundation): StateStore.save 改為原子寫入避免半寫入壞檔`
  - `build(001-foundation): 初始化 TypeScript/NestJS 專案與工具鏈`
  - `ci(001-foundation): 新增排程 radar workflow`
- **多行訊息**用 Bash 工具搭配 POSIX heredoc 餵給 `git commit -F -`；勿在 Bash 工具用 PowerShell
  here-string `@'…'@`。單行用 `-m`。不使用 `--no-verify`、不跳過 hook——hook 失敗修根因。
- **預設只在使用者要求時才 commit**；且開發期一律在 Feature branch 上進行，**不在 `develop` 直接
  commit**。秘密永不入庫（硬規則 7）。
- `/speckit-implement` 期間可依 tasks.md 的內聚主題**分段 commit**（讓歷史能還原開發順序），每個
  commit 標 Feature scope、type 依該段主要性質；同段的 `tasks.md` 勾選併入該段 commit。

## SDD 流程與分支

- 開發主支為 **`develop`**。每個正式 Feature 從 `develop` 重新 branch（命名 `NNN-feature-name`），
  走完整流程：`specify → clarify → plan → checklist → tasks → analyze → implement → 驗收 →
  merge 回 develop`，完成後才開下一支。Feature 順序依開發指南 §11.2（F1 `001-foundation` →
  F8 `008-pages-publish`）。
- 不要在同一 branch 混多個大 Feature；不要貼整包 code 取代 `/speckit-implement`。
- **`main` 不直接 commit**，只接受來自 `develop` 的合併。唯一 bot 例外：排程 workflow 自動 commit
  的 `state/board.json`（執行期狀態更新）。

### Merge 回 `develop`：MUST `--no-ff`，不得 fast-forward

- Feature branch 驗收後合入 `develop` **MUST** 用 `git merge --no-ff <feature-branch>`，明確建立
  一個 merge commit。**MUST NOT** fast-forward（不可 `--ff-only`、也不可讓預設行為變成 ff）。
- **理由**：ff 會把 Feature 的 commit 平接進 `develop`、失去「這批屬同一 Feature」的收尾點；
  `--no-ff` 讓 `git log --oneline --graph` 與 `git log develop --merges` 能清楚看出每次 Feature 完成點。
- 若因 git 判定為 ff 而未產生 merge commit，MUST 改用 `git merge --no-ff --no-edit` 確保產生非空
  merge commit。**merge commit 訊息**標 Feature 編號與名稱，例：`merge(001-foundation): 合併 F1 …`。
- 執行步驟：`git checkout develop` → `git merge --no-ff <feature-branch>` → `git push origin develop`。
- **merge 後的 push 屬影響共享的操作**：先確認再 push（除非使用者已明確授權）。
