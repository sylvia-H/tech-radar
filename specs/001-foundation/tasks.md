---
description: "Task list for 001-foundation implementation"
---

# Tasks: 專案骨架與推播通道（Foundation）

**Input**: Design documents from `/specs/001-foundation/`

**Prerequisites**: [plan.md](plan.md)、[spec.md](spec.md)、[research.md](research.md)、[data-model.md](data-model.md)、[contracts/](contracts/)、[quickstart.md](quickstart.md)

**Tests**: 納入（憲章 VIII 要求 StateStore、embed 組版、env 驗證等關鍵邏輯須單元測試）。

**Organization**: 依 User Story 分組，每個 Story 可獨立實作與驗證。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可平行（不同檔案、無未完成相依）
- **[Story]**: US1/US2/US3；Setup / Foundational / Polish 無 Story 標籤
- 每個任務含明確檔案路徑

## Path Conventions

單一專案（plan §Project Structure）：`src/`、`state/`、`.github/workflows/` 於 repo 根目錄；測試以 `*.spec.ts` 與原始碼同目錄。

---

## Phase 1: Setup（共用基礎）

**Purpose**: 專案初始化與工具鏈

- [ ] T001 建立 `package.json`（deps：`@nestjs/core`、`@nestjs/common`、`@nestjs/config`、`reflect-metadata`、`rxjs`、`zod`；devDeps：`typescript`、`jest`、`ts-jest`、`@nestjs/testing`、`@types/node`、`@types/jest`；`engines.node >= 24`；scripts：`build`/`start:cli`/`test`）於 repo 根目錄
- [ ] T002 [P] 建立 `tsconfig.json`（Node 24 目標、`experimentalDecorators`、`emitDecoratorMetadata`、`outDir dist`）於 repo 根目錄
- [ ] T003 [P] 建立 `jest.config.cjs`（`ts-jest` preset、`testRegex` `.*\.spec\.ts$`）於 repo 根目錄
- [ ] T004 [P] 建立 `.gitignore`（`node_modules`、`dist`、`.env`、`*.local`）於 repo 根目錄

---

## Phase 2: Foundational（阻擋性前置）

**Purpose**: 所有 User Story 都依賴的核心骨架（env 驗證、DI、CLI 進入點）

**⚠️ CRITICAL**: 本階段完成前，任何 User Story 不能開始

- [ ] T005 實作環境變數 zod schema 於 `src/config/env.schema.ts`（`DISCORD_WEBHOOK_URL` 非空且符合 Discord webhook URL 樣式 `^https://(ptb\.|canary\.)?discord(app)?\.com/api/webhooks/`（容許 discord.com / discordapp.com 及 ptb/canary 變體）；`GH_API_TOKEN`、`GEMINI_API_KEY` 非空；三者皆必填）
- [ ] T006 [P] 單元測試 env schema（合法／缺任一機密／URL 格式錯；含 discordapp.com / ptb / canary 合法變體可通過）於 `src/config/env.schema.spec.ts`
- [ ] T007 實作 `ConfigModule` 於 `src/config/config.module.ts`（`ConfigModule.forRoot({ isGlobal: true, validate })` 套用 T005 schema，缺失即 fail-fast）
- [ ] T008 建立 `PipelineService` 骨架與 `PipelineModule` 於 `src/pipeline/pipeline.service.ts`、`src/pipeline/pipeline.module.ts`（`run()` 佔位）
- [ ] T009 建立 `AppModule` 於 `src/app.module.ts`（匯入 `ConfigModule`、`PipelineModule`；後續 Story 追加 Discord/State 模組）
- [ ] T010 建立 CLI 進入點於 `src/main.cli.ts`（`createApplicationContext(AppModule)` → `get(PipelineService).run()` → `finally app.close()`；try/catch 骨架先 rethrow，告警於 US3 接上）

**Checkpoint**: 骨架可 `npm run build` 且 `node dist/main.cli.js` 在缺機密時 fail-fast、不推播。

---

## Phase 3: User Story 1 - 一鍵驗證推播管道打通（Priority: P1）🎯 MVP

**Goal**: 手動觸發後手機 Discord 收到測試 embed，證明「執行環境 → Discord 通道」端到端可用。

**Independent Test**: 設好 secrets，以 `workflow_dispatch`（或本機帶 env 執行）觸發一次，5 分鐘內手機收到橙色「📡 Tech Radar 連通測試」embed；缺機密時快速失敗且無推播。

### Tests for User Story 1 ⚠️（先寫、先失敗）

- [ ] T011 [P] [US1] 單元測試 embed 組版 `buildTestEmbed`（橙色 `0xF5A623`、標題、時間戳、`embeds` 結構）於 `src/discord/discord.embed.spec.ts`
- [ ] T012 [P] [US1] 單元測試 `DiscordWebhookService.postTestEmbed`（mock `fetch`：204 成功、429 有限退避、失敗擲錯；斷言不含機密）於 `src/discord/discord.webhook.service.spec.ts`

### Implementation for User Story 1

- [ ] T013 [P] [US1] 實作 embed 組版純函式 `buildTestEmbed` 於 `src/discord/discord.embed.ts`（依 contracts/discord-webhook）
- [ ] T014 [US1] 實作 `DiscordWebhookService` 於 `src/discord/discord.webhook.service.ts`（`postTestEmbed`：內建 `fetch` POST、204 判定、429 有限退避、絕不記錄機密）（依 T013）
- [ ] T015 [US1] 建立 `DiscordModule` 於 `src/discord/discord.module.ts`，並在 `src/app.module.ts` 匯入
- [ ] T016 [US1] 於 `src/pipeline/pipeline.service.ts` 串接 `run()`：呼叫 `postTestEmbed`（帶執行時間戳與 `env=ci|local` 標記）
- [ ] T017 [US1] 建立 `.github/workflows/radar.yml` 基底：`workflow_dispatch` + 雙 `schedule` cron（`7 22 * * *`、`37 22 * * *`）+ `concurrency: { group: tech-radar, cancel-in-progress: false }` + `permissions: contents: write` + `checkout@v4` + `setup-node@v4`（`node-version: 24`、`cache: npm`）+ `npm ci` + `npm run build` + `node dist/main.cli.js`（此執行步驟設 `id: run-app`，供 T029 告警條件辨識 app 內失敗；帶 `DISCORD_WEBHOOK_URL`/`GH_API_TOKEN`/`GEMINI_API_KEY` 三 secrets）

**Checkpoint**: US1 可獨立展示 M0 核心（SC-001、SC-003）——收到測試 embed；缺機密 fail-fast 不推播。

---

## Phase 4: User Story 2 - 執行狀態持久化並可跨執行沿用（Priority: P2）

**Goal**: 建立唯一權威狀態 `state/board.json` 的讀寫與 seed 骨架；狀態實際變更時 commit+push 回 repo，無變更則不 commit。

**Independent Test**: 一次會改變狀態的執行 → 變更被 commit+push；一次無變更的執行 → 無 commit；seed 骨架能被正確讀入且欄位齊備。

### Tests for User Story 2 ⚠️（先寫、先失敗）

- [ ] T018 [P] [US2] 單元測試 `StateStore`（缺檔→回空骨架不擲錯；合法檔 round-trip 不遺失既有欄位；壞檔/結構不合法→擲錯且不覆寫；`save` 前驗證＋穩定鍵序＋結尾換行）於 `src/state/state.store.spec.ts`
- [ ] T019 [P] [US2] 單元測試狀態 schema（`BoardState` 五欄位＋子實體型別）於 `src/state/state.schema.spec.ts`

### Implementation for User Story 2

- [ ] T020 [P] [US2] 實作狀態 zod schema 於 `src/state/state.schema.ts`（`BoardState`＋`BoardEntry`/`IntroCache`/`SeenNewsEntry`，依 data-model）
- [ ] T021 [US2] 實作 `StateStore` 於 `src/state/state.store.ts`（`load`/`save` 依 contracts/state-file：缺檔→骨架、壞檔→擲錯、穩定鍵序序列化）（依 T020）
- [ ] T022 [US2] 建立 `StateModule` 於 `src/state/state.module.ts`，並在 `src/app.module.ts` 匯入
- [ ] T023 [US2] 於 `src/pipeline/pipeline.service.ts` 串接：`run()` 開頭 `StateStore.load()`；**推播成功後**才 `StateStore.save()`（FR-008，防半套狀態）
- [ ] T024 [P] [US2] 建立 seed 空骨架檔 `state/board.json`（`{ lastBoardPushAt:null, lastNewsPushAt:null, board:{}, intros:{}, seenNews:[] }`，FR-015）
- [ ] T025 [US2] 於 `.github/workflows/radar.yml` 加入狀態 commit 步驟：`git add state/board.json` → `git diff --cached --quiet` 早退（不 commit）→ 否則先設 committer 身分 `git config user.name "radar-bot"` / `git config user.email "radar-bot@users.noreply.github.com"`（與 quickstart 的 `radar-bot` commit 作者一致）→ `commit -m "chore: update board state [skip ci]"` → `pull --rebase --autostash` + `push`，重試至多 3 次，最終失敗 `::error::` 讓 job 失敗

**Checkpoint**: US1 + US2 皆可獨立運作（M2 半，SC-002）。

---

## Phase 5: User Story 3 - 失敗看得見（Priority: P3）

**Goal**: 兩層失敗告警——app 內任一步失敗發紅色 embed；app 自身邏輯以外（啟動前＋狀態 commit/push）失敗由 workflow 層補送。

**Independent Test**: 注入 app 內失敗 → 收到紅色告警並 exit≠0；讓 build 失敗（app 未啟動）或 push 失敗 → workflow 層仍送紅色告警；全程成功則無告警。

### Tests for User Story 3 ⚠️（先寫、先失敗）

- [ ] T026 [US3] 單元測試 `buildFailureAlert`（紅色 `0xE74C3C`、description 不含 token/URL/金鑰）於 `src/discord/discord.embed.spec.ts`（追加）

### Implementation for User Story 3

- [ ] T027 [US3] 實作 `buildFailureAlert` 於 `src/discord/discord.embed.ts` 並在 `src/discord/discord.webhook.service.ts` 加 `postFailureAlert`（紅色 embed、帶不含機密的錯誤摘要）
- [ ] T028 [US3] 於 `src/main.cli.ts` 的 try/catch 串接：app 內失敗時呼叫 `postFailureAlert` 後以非零 exit code 結束（FR-010）
- [ ] T029 [US3] 於 `.github/workflows/radar.yml` 加入告警步驟，條件為 `if: failure() && steps.run-app.outcome != 'failure'`（`curl` POST 紅色 embed）——只補送 **app 自身邏輯以外**的失敗：app 啟動前（checkout/build/機密載入，`run-app` 被跳過→`outcome == 'skipped'`）與 app 成功後的狀態 commit/push 失敗（`run-app` `outcome == 'success'`）；app 內失敗（`run-app` `outcome == 'failure'`）已由 T028 送紅色告警，此步跳過以免**重複告警**（FR-014）

**Checkpoint**: 三個 Story 皆獨立可驗；M0 全綠。

---

## Phase 6: Polish & Cross-Cutting

**Purpose**: 跨 Story 收尾與驗收

- [ ] T030 [P] （DX/Polish，非 spec 需求）撰寫本機執行與 secrets 設定說明（`README.md` 或 `docs/` 內，引用 [quickstart.md](quickstart.md)）
- [ ] T031 依 [quickstart.md](quickstart.md) 逐項跑驗證（A 本機、B Actions），確認 **SC-001..005** 單次可驗項對映成立；SC-006（成本護欄）屬跨月營運指標，以**設計檢查**確認（每日兩次 cron、單次 1–3 分鐘、無資料/LLM 呼叫）而非單次實測
- [ ] T032 [P] 機密不外洩複查：檢視 log／embed／`state/board.json` 皆無 token/URL/金鑰（憲章 VII）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup（Phase 1）**：無相依，可立即開始。
- **Foundational（Phase 2）**：依賴 Setup；**阻擋所有 User Story**。
- **User Stories（Phase 3–5）**：皆依賴 Foundational 完成。
  - US1 為 MVP；US2、US3 建議依序（P1→P2→P3），因共用 `radar.yml`、`app.module.ts`、`pipeline.service.ts`、`main.cli.ts` 等檔案。
  - US3 的 `postFailureAlert` 重用 US1 的 `DiscordWebhookService`（US3 依賴 US1）。
  - **FR-009 的告警環節落在 US3**：FR-009（狀態寫回衝突重試耗盡→視為失敗並觸發告警）中，T025（US2）僅以 `::error::` 讓 job 失敗，真正送出紅色告警的是 T029（US3）的 workflow `if: failure()` 步驟。故增量交付若停在 US1+US2，FR-009 的「告警」義務要到 US3 完成後才達成。
- **Polish（Phase 6）**：依賴所有目標 Story 完成。

### 共用檔案（跨 Story 序列化、非平行）

- `.github/workflows/radar.yml`：T017（US1 基底）→ T025（US2 commit 步驟）→ T029（US3 failure 步驟）
- `src/app.module.ts`：T009 → T015（+Discord）→ T022（+State）
- `src/pipeline/pipeline.service.ts`：T008 → T016（US1 推播）→ T023（US2 狀態）
- `src/main.cli.ts`：T010 → T028（US3 告警）
- `src/discord/discord.embed.ts` / `discord.embed.spec.ts` / `discord.webhook.service.ts`：US1 建立 → US3 追加失敗告警

### Within Each User Story

- 測試先寫、先失敗 → 再實作。
- schema/model 先於 service；service 先於串接（pipeline/CLI/workflow）。

### Parallel Opportunities

- Setup：T002、T003、T004 可平行（T001 先）。
- Foundational：T006 可與 T005 之後的 T007/T008 平行（不同檔案）。
- US1：T011、T012（測試）與 T013 可平行；T014 依 T013。
- US2：T018、T019、T020、T024 可平行（不同檔案）；T021 依 T020，T023 依 T021。
- Polish：T030、T032 可平行。

---

## Parallel Example: User Story 1

```bash
# 先啟動 US1 測試（不同檔案）：
Task: "T011 單元測試 buildTestEmbed 於 src/discord/discord.embed.spec.ts"
Task: "T012 單元測試 DiscordWebhookService.postTestEmbed 於 src/discord/discord.webhook.service.spec.ts"

# 實作可平行者：
Task: "T013 實作 buildTestEmbed 於 src/discord/discord.embed.ts"
```

---

## Implementation Strategy

### MVP First（僅 US1）

1. Phase 1 Setup → 2. Phase 2 Foundational（阻擋性）→ 3. Phase 3 US1。
4. **STOP & VALIDATE**：`workflow_dispatch` 觸發，手機收到測試 embed（SC-001）；缺機密 fail-fast（SC-003）。
5. 這即是 M0 的可展示核心。

### Incremental Delivery

1. Setup + Foundational → 骨架就緒。
2. + US1 → 收得到測試 embed（MVP / M0 核心）。
3. + US2 → 狀態持久化、commit-on-change。
4. + US3 → 兩層失敗告警。
5. Polish → quickstart 全驗、機密複查。

### 對映里程碑與需求

- US1 → SC-001/003、FR-001/002/003/004/011
- US2 → SC-002、FR-005/006/007/008/009/015
- US3 → SC-004、FR-010/014
- 全體 → SC-005、FR-012/013；FR-012（不含資料來源/LLM 的範圍邊界）為否向約束，由 T031/SC-005 執行紀錄驗證，無需建構任務。
- SC-006（成本護欄）→ 跨月營運指標，以 T017 雙 cron 频率的設計檢查佐證（見 T031），不納入單次 quickstart 驗證。

---

## Notes

- [P] = 不同檔案、無相依；共用檔案任務刻意不標 [P]。
- 每個 Story 可獨立完成與驗證；驗證測試先失敗再實作。
- 建議每個任務或邏輯群組完成即 commit（feature 分支 `001-foundation`，依憲章分支策略合回 `develop`）。
- 避免：模糊任務、同檔平行衝突、破壞 Story 獨立性的跨 Story 相依（US3→US1 的 Discord 重用為刻意且已標示）。
