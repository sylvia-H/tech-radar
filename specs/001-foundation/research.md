# Phase 0 Research: 001-foundation

範圍內的技術多已由開發指南 §11.2「技術釘死」與憲章預先決定；本檔將 F1 相關決策連同理由與替代方案彙整，並解掉 Technical Context 中的待確認項。**無殘留 NEEDS CLARIFICATION。**

---

## D1. 執行模型：NestJS application context CLI

- **Decision**: 以 `NestFactory.createApplicationContext(AppModule)` 建立 DI 容器 → 取得 `PipelineService` 執行一次 → `app.close()` 後結束程序。不啟動 HTTP server。
- **Rationale**: 保留 NestJS 的模組化/DI（利於 F2–F8 掛新元件），但符合「跑完即退、零常駐」（憲章 I、spec FR-001）。開發指南 §0、§9 明示此角色。
- **Alternatives considered**:
  - 純腳本（無框架）→ 省依賴，但後續 8 個 Feature 的服務組裝會失去 DI 結構、重構成本高。
  - `NestFactory.create()`（完整 HTTP app）→ 會啟 server、與批次 job 不符。

## D2. 語言 / Runtime / 套件管理

- **Decision**: TypeScript 5.x、**Node.js 24 LTS**（本機 nvm 24.18.0）、npm（`npm ci` + `npm run build`）。
- **Rationale**: 與本機 nvm 版本一致（24.18.0），避免本機/CI 版本落差；Node 24 內建全域 `fetch`（免額外 HTTP 套件）、原生 ESM/TS 工具鏈更完整。workflow `setup-node@v4` 設 `node-version: "24"`、`cache: "npm"`。
- **Alternatives**: Node 20 → 較舊，且與本機 nvm 24.18.0 不一致，已否決；pnpm/yarn → 與 `npm ci` 不一致，無必要偏離。
- **Note**: 開發指南 §8 的 workflow 範例原寫 `node-version: "20"`，已同步更新為 `"24"` 以免文件矛盾。

## D3. HTTP 客戶端（Discord webhook）

- **Decision**: 使用 Node 24 內建全域 `fetch`（底層 undici）。
- **Rationale**: 零額外依賴即可 `POST` webhook；開發指南技術釘死列 `undici`/`fetch`。Discord webhook 成功回應為 `204 No Content`。
- **Alternatives**: axios / node-fetch → 多餘依賴；`@nestjs/axios` → 為 F1 單一 POST 過重。

## D4. 環境變數載入與驗證

- **Decision**: `@nestjs/config` 的 `ConfigModule.forRoot({ validate })`，以 **zod** schema 驗證三項機密（`GH_API_TOKEN`、`GEMINI_API_KEY`、`DISCORD_WEBHOOK_URL`）。任一缺失或明顯無效 → 啟動即擲錯、fail-fast、且在推播前結束（spec FR-002/FR-003）。
- **Rationale**: 啟動期驗證能保證「缺機密不會送半套推播」；zod 同時用於狀態 schema（D6），一套驗證庫。`DISCORD_WEBHOOK_URL` 以樣式 `^https://(ptb.|canary.)?discord(app)?.com/api/webhooks/` 做基本格式檢查（容許 discord.com / discordapp.com 及 ptb/canary 變體，與 T005 一致）。
- **Alternatives**: `class-validator` + `class-transformer` → 需要 class 樣板；Joi → 另一套風格。zod 型別推導最順、體積小。
- **Note**: `GEMINI_API_KEY` 在 F1 未使用，但仍納入必填驗證，以確保部署環境在進入 F5/F6 前即完整（可於實作時決定設為必填或「存在即驗證」；預設必填以保部署一致性——記錄於 data-model 假設）。

## D5. 測試框架

- **Decision**: Jest + `ts-jest` + `@nestjs/testing`，`*.spec.ts` 與原始碼同目錄。
- **Rationale**: NestJS 官方預設，`Test.createTestingModule` 可注入替身；符合憲章 VIII 對關鍵邏輯的單元測試要求。Discord POST 以 mock（不打真實網路）測試。
- **Alternatives**: Vitest → 更快，但偏離 NestJS 預設工具鏈，F1 無此需求。

## D6. 狀態儲存與 schema

- **Decision**: 單一 JSON 檔 `state/board.json`，由 `StateStore` 讀寫；讀取時以 zod schema 驗證並在缺檔時回退到空骨架；寫入前亦驗證。狀態結構見 [data-model.md](data-model.md)。
- **Rationale**: 憲章 VI「單一權威狀態來源」；zod 驗證確保跨執行不寫入壞結構、且 round-trip 不遺失欄位（spec US2）。repo 內 seed 一份合法空骨架（FR-015）。
- **Alternatives**: SQLite/DB → 違反零維運；多檔拆分 → 破壞「單一權威來源」。

## D7. 狀態 commit 的責任切分（app vs workflow）

- **Decision**: **app 只負責寫檔**（`state/board.json`）；**commit/push 由 workflow 步驟負責**——`git add state/board.json` 後以 `git diff --cached --quiet` 判斷，有變更才 commit（`[skip ci]`）並以 `pull --rebase --autostash` 重試 push，失敗則報錯。
- **Rationale**: 沿用開發指南 §8；符合澄清「僅在狀態實際變更時 commit」（憲章 v1.0.1、spec FR-007）。app 無需感知 git，職責單純、易測。
- **Alternatives**: app 內呼叫 git → 讓應用程式耦合版本控制、難測、且與 Actions 權限模型重疊。

## D8. 失敗告警：兩層

- **Decision**:
  - **App 內**（spec FR-010）：`main.cli.ts` 以 try/catch 包住 `PipelineService.run()`，捕獲即呼叫 `DiscordWebhookService.postFailureAlert()`（紅色 embed `0xE74C3C`）；**成功送出後寫 marker 檔 `.radar-alert-sent`**，再以非零 exit code 結束。
  - **Workflow 層**（spec FR-014）：`if: failure()` 步驟先檢查 marker——存在即跳過（CLI 已告警），缺席才用 `curl` POST 一則紅色 embed。涵蓋 app 啟動前（checkout / `npm ci` / build）、app 啟動中（機密載入/env 驗證、DI）、CLI 告警送出失敗、與狀態 commit/push 失敗。
- **Rationale**: 保證任何層級失敗都不無聲（憲章 VII）。兩層都送同一 `DISCORD_WEBHOOK_URL`。去重以「CLI 明確回報已送出」為準——早期版本以 `steps.run-app.outcome != 'failure'` 推測，會把「app 啟動失敗（未告警）」誤判為「app 內已告警」而兩邊沉默。
- **Alternatives**: 只靠 workflow 層 → 失去 app 內可帶的錯誤脈絡；只靠 app 內 → build 失敗時 app 根本沒跑、會無聲；以 outcome 推測去重 → 存在啟動失敗與告警送出失敗兩個沉默缺口。

## D9. 排程與冪等（F1 範圍界線）

- **Decision**: workflow 設雙 cron（`7 22 * * *`、`37 22 * * *`，UTC＝台北 06:07 / 06:37）+ `workflow_dispatch` + `concurrency` group（`cancel-in-progress: false`）。F1 **不**實作 `lastNewsPushAt` / `lastBoardPushAt` 的 guard 邏輯（屬 F3/F7）；F1 只需確保兩個觸發各自能完整跑通並各自推一則測試 embed。
- **Rationale**: spec 假設與 FR-011；冪等去重明列為後續 Feature。concurrency 避免手動觸發撞排程造成 push 衝突（§8）。
- **Alternatives**: F1 就做 guard → 超出 M0 範圍、且無 news 狀態可 guard。

## D10. 測試 embed 的內容（暫時性）

- **Decision**: F1 的 `PipelineService.run()` 推一則橙色資訊 embed：標題如「📡 Tech Radar 連通測試」、內容含執行時間戳與環境標記。屬暫時性連通驗證，後續 Feature 以真實晨報/榜單取代（spec 假設）。
- **Rationale**: 提供可觀察的 M0 成功訊號（SC-001），且不觸及真實內容原則（憲章 III）。

---

## 未決 / 移交後續

- 榜單/新聞相關的 threshold、關鍵字集合、來源清單 → F2–F6，不在 F1。
- `GEMINI_API_KEY` 是否於 F1 設「必填」或「選填」→ 預設必填以保部署一致；若增加本機測試摩擦，可於實作 clarify 調整（低影響）。
