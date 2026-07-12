# Tasks: 榜單來源與三領域歸類（Board Sources / F2）

**Input**: Design documents from `/specs/002-board-sources/`

**Prerequisites**: plan.md ✅、spec.md ✅、research.md ✅、data-model.md ✅、contracts/（github-sources.md、board-output.md）✅

**Tests**: **包含測試任務**。憲章 VIII「關鍵邏輯測試優先」為非協商原則，且 spec（FR-009）、quickstart §1 明確要求 Trending 快照、分類、去重、排序、容錯等單元測試——故本 Feature 的關鍵邏輯採**測試先行**。

**Organization**: 依 spec 的四個 User Story（US1 P1 / US2 P2 / US3 P2 / US4 P3）分階段，各階段可獨立實作與驗證。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可平行（不同檔案、無未完成依賴）
- **[Story]**: 對映 spec User Story（US1–US4）；Setup／Foundational／Polish 無 Story 標籤
- 每個任務含明確檔案路徑

## Path Conventions

單一專案（沿用 F1）：`src/`、`tests/` 於 repo 根目錄。F2 新增模組：`src/github/`、`src/sources/`、`src/classify/`、`src/board/`；擴充 `src/pipeline/`。**不觸碰** F1 既有 `config/`、`state/`、`discord/`（只復用 `discord/failure-alert` 與 `DiscordWebhookService`）。

---

## Phase 1: Setup（共用基礎）

**Purpose**: 引入本 Feature 相依與模組骨架

- [ ] T001 於 `package.json` 新增相依 `cheerio` 與 `@types/*`（如需），執行 `npm install` 並確認 `npm run build`（`tsc`）通過；**不**引入 `rss-parser`／`@google/genai`／axios／Octokit（plan Technical Context、research D9）
- [ ] T002 [P] 建立 F2 模組目錄骨架 `src/github/`、`src/sources/`、`src/classify/`、`src/board/`（以 `New-Item -ItemType Directory -Force`）與 `tests/fixtures/`（Windows PowerShell）

---

## Phase 2: Foundational（阻塞前置，所有 User Story 之前 MUST 完成）

**Purpose**: 全部 Story 共用的型別與 GitHub HTTP 客戶端

**⚠️ CRITICAL**: 本階段完成前，任何 User Story 不得開始

- [ ] T003 建立記憶體型別 `src/board/board.types.ts`：`Domain = "ai"|"devops"|"frontend-backend"`、`RawTrendingRepo`、`RawSearchRepo`、`RepoMeta`、`CandidateRepo`、`BoardRow`、`DomainBoard`、`CurrentBoard`（欄位依 data-model.md；含 `apiCalls: { core; search }`）；型別即 F3 `buildCurrentBoard()` 契約來源（contracts/board-output.md）
- [ ] T004 建立共用 `src/github/github-http.ts`：自訂 `User-Agent`（`tech-radar/1.0 (+github-actions; personal)`）、`Authorization: Bearer $GH_API_TOKEN`（僅 API 端點帶、Trending 網頁不帶）、條件式請求（ETag／If-None-Match、If-Modified-Since；**F2 為機制骨架**——F2 不持久化、單次執行內同 URL 只抓一次，執行期**無前值可帶**、實為 no-op，介面保留供 F5+ 有快取值時復用，**不得**為此另建快取檔）、失敗（5xx／429／網路）**指數退避＋jitter**、`GET /repos` 批次**有限並發 ≤6**、讀 `X-RateLimit-Remaining` 逼近時退避、core／search 呼叫**計數**；**token 絕不寫入 log／產物**（research D9、contracts §通用要求、憲章 VII）
- [ ] T005 [P] 撰寫 `src/github/github-http.spec.ts`：退避行為、並發上限 ≤6、逼近 rate-limit 退避、呼叫計數、條件式請求（**注入快取值**時帶 `If-None-Match`／`If-Modified-Since`、無前值不帶）、錯誤訊息／log **不含 token/URL**（憲章 VII）

**Checkpoint**: 型別與 HTTP 客戶端就緒，US1–US4 可開始

---

## Phase 3: User Story 1 - 三領域週增星榜可被觀測（Priority: P1）🎯 MVP

**Goal**: 執行一次任務後，log 印出 AI / DevOps / 前後端三領域當前榜（每筆含 `owner/name`、本週增星、領域、名次），資料來自主力 Trending。此即 M1 核心價值。

**Independent Test**: 備妥 `GH_API_TOKEN` 執行一次 → log 印出三領域榜、欄位齊備、開頭 `api: core=…, search=…`；人工抽查歸類與週增星合理；不依賴 Search／狀態／Discord 即可驗收（spec US1 Independent Test、quickstart §2/§3）。

### Tests for User Story 1（測試先行，先寫且先失敗）⚠️

- [ ] T006 [P] [US1] 建立 Trending 頁面快照 fixture `tests/fixtures/trending-weekly.html`（保留 `article.Box-row` 結構，作為解析回歸基準；FR-009、research D1）
- [ ] T007 [P] [US1] 撰寫 `src/sources/github-trending.service.spec.ts`：以 fixture 快照比對解析出 `fullName`/`description`/`language`/`starsThisWeek`；**解析 0 列或欄位抽不到 → 觸發告警**（FR-009、contracts §1）
- [ ] T008 [P] [US1] 撰寫 `src/classify/classify.service.spec.ts`：topics 命中歸對領域（**topics 子字串**）；無 topics 改用 description（**description 詞界比對**：`ai` 不命中 `domain`／`chain`、但 `AI-powered` 命中）；只有語言相符但無關鍵字命中 → 不歸類（排除）；跨領域命中 → 依**固定優先序**擇一主領域（AI>DevOps>前後端，language **不參與**決勝）；topics 與 description 皆無命中 → 排除（FR-003/FR-011、data-model 分類規則）
- [ ] T009 [P] [US1] 撰寫 `src/board/weekly-stars.spec.ts`：Trending 候選 `weeklyStarsEstimate = starsThisWeek`；`ageDays=0`（今日新建）不除以零、結果有限非 NaN/Infinity（FR-005、Edge Case）
- [ ] T010 [P] [US1] 撰寫 `src/board/board-builder.service.spec.ts`（Trending-only 路徑）：Trending 候選經分類後每領域以 `weeklyStarsEstimate` 排序取 top 15、`rank` 連號、不足 15 照實呈現；`CurrentBoard.boards` 恰三領域；`apiCalls` 計數正確（SC-001、FR-005/FR-006）

### Implementation for User Story 1

- [ ] T011 [P] [US1] 建立 `src/classify/domain-keywords.ts`：三領域關鍵字種子集 v1 canonical（AI／DevOps／前後端，見 data-model「領域關鍵字種子集」）；增刪只改此檔（憲章 IV 精神）
- [ ] T012 [US1] 實作 `src/classify/classify.service.ts`：對候選依序比對 topics（**小寫子字串**）→ 無 topics 則 description（**小寫詞界**）；language 僅為輔助訊號（不單獨定領域、**不參與跨領域決勝**）；命中多領域依**固定優先序**擇一主領域（AI>DevOps>前後端），皆無命中回 `null`（排除）；寬鬆傾向（依賴 T011；FR-003/FR-011）
- [ ] T013 [P] [US1] 實作純函式 `src/board/weekly-stars.ts`：Trending 候選 `= starsThisWeek`；純 Search 候選 `= round(totalStars / max(ageDays,1) × 7)`（**兩分支一次寫齊**，供 US3 沿用；FR-005、research D5）
- [ ] T014 [US1] 實作 `src/sources/github-trending.service.ts`：以 `github-http` 抓全站＋`typescript`/`javascript`/`python`/`rust`/`shell` 共 6 頁 `?since=weekly`，`cheerio` 逐 `article.Box-row` 解析 → `RawTrendingRepo[]`，跨頁先以 `fullName` 去重；解析 0 筆/欄位抽不到擲可辨識錯誤（依賴 T004、T003；contracts §1、research D1）
- [ ] T015 [US1] 實作 `src/sources/github-repo.service.ts`：對 Trending **唯一候選**呼叫 `GET /repos/{owner}/{repo}` 取 `id(→repoId)`/`topics`/`stargazers_count`/`created_at` → `RepoMeta`，有限並發 ≤6、條件式請求；**單筆失敗（重試耗盡）→ 該候選無 `repoId`，MUST 略過**、不中斷全線（U1；依賴 T004、T003；contracts §3、research D2）
- [ ] T016 [US1] 實作 `src/board/board-builder.service.ts` 的 `build(): Promise<CurrentBoard>`（**Trending-only 路徑**）：Trending → `github-repo` 補 `repoId`/`topics`（**取不到 `repoId` 者略過該候選**，U1）→ `classify` 歸類 → 每領域以 `weekly-stars` 計 `weeklyStarsEstimate` 排序取 top 15、`rank` 連號 → 組 `CurrentBoard`（含 `builtAt`、三領域 `boards`、`apiCalls`）；記錄 core/search 呼叫數（依賴 T012–T015）
- [ ] T017 [US1] 建立 `src/board/board.module.ts` 註冊 `GithubTrendingService`／`GithubRepoService`／`ClassifyService`／`BoardBuilderService`（及 `github-http` provider），並於 `src/app.module.ts` 匯入 `BoardModule`
- [ ] T018 [US1] 擴充 `src/pipeline/pipeline.service.ts`：呼叫 `BoardBuilderService.build()` 並以結構化 log 印三領域榜（每筆：名次、`owner/name`、`~weeklyStarsEstimate/wk`、`[sources]`、領域；開頭 `api: core=…, search=…`），格式見 contracts/board-output.md；**不 diff／不推播／不寫 `state/board.json`**；於 `src/pipeline/pipeline.module.ts` 匯入 `BoardModule`（FR-006、research D8）

**Checkpoint**: US1 完成 → 執行即在 log 看到 Trending 主力的三領域榜（M1 最小可用），可獨立驗收

---

## Phase 4: User Story 2 - 新崛起 repo 被補位收錄（Priority: P2）

**Goal**: 以 GitHub Search 補位「近 7 天新建、已累積相當星數」的新星，經三領域歸類後併入榜單候選。

**Independent Test**: 只啟用補位來源執行一次，確認取得 `created:>7天` 且達星數門檻的 repo，並能被歸入三領域（spec US2 Independent Test、quickstart §3）。

### Tests for User Story 2 ⚠️

- [ ] T019 [P] [US2] 撰寫 `src/sources/github-search.service.spec.ts`：三組領域查詢 `q`（AI `(llm OR rag OR agent OR gpt) stars:>30`、DevOps `(kubernetes OR terraform OR gitops) stars:>20`、前後端 `(nextjs OR react OR svelte OR nodejs OR golang) stars:>20`，皆帶 `created:>{today-7d}`、`sort=stars&order=desc`）；回應欄位映射為 `RawSearchRepo`（含 `topics`）；**某組 0 筆屬正常、不告警**（FR-002、contracts §2）

### Implementation for User Story 2

- [ ] T020 [US2] 實作 `src/sources/github-search.service.ts`：對三領域各發一次 `GET /search/repositories`（門檻與 `q` 見 T019／FR-010），解析 `id`/`full_name`/`description`/`language`/`topics`/`stargazers_count`/`created_at` → `RawSearchRepo[]`（`topics` 隨回應返回，免再打 /repos）；依賴 T004、T003（research D3、contracts §2）
- [ ] T021 [US2] 於 `src/board/board-builder.service.ts` 併入 Search 來源：`build()` 同時取 Search 候選、經 `classify`（`queriedDomain` 為提示、仍以 topics/description 為準）納入各領域候選池，並於 `board.module.ts` 註冊 `GithubSearchService`（依賴 T016、T020）

**Checkpoint**: US1＋US2 → 榜單同時涵蓋熱門主力與新崛起補位（合併去重於 US3 完成）

---

## Phase 5: User Story 3 - 跨來源合併、去重與穩定排序（Priority: P2）

**Goal**: 兩來源以 GitHub 數字 `repoId` 合併去重（抗改名），每領域以統一排序鍵穩定取 top 15，交給 F3 可正確 diff。

**Independent Test**: 餵入「同 repo 兩來源」與「改名」樣本 → 合併後只一筆、以 `repoId` 判同一性；每領域恰為排序後前 15（spec US3 Independent Test）。

### Tests for User Story 3 ⚠️

- [ ] T022 [P] [US3] 撰寫（或補充 `board-builder.service.spec.ts`）合併去重測試：同一 `repoId` 同時來自 trending＋search → 只保留一筆、**保留主力 `starsThisWeek`** 作 `weeklyStarsEstimate` 依據、`sources` 同時含 `trending`+`search`；改名（fullName 變、repoId 同）視為同一筆（FR-004、SC-003）
- [ ] T023 [P] [US3] 補充 `weekly-stars.spec.ts` 純 Search 分支：`= round(totalStars / max(ageDays,1) × 7)`，並驗證同時來自兩來源者以 `starsThisWeek` 為準（FR-005、research D5）
- [ ] T024 [P] [US3] 撰寫排序穩定性測試：打亂來源處理順序 → 各領域名次不變；tie-break 為 `weeklyStarsEstimate desc, repoId asc`；超過 15 只留前 15、`rank` 1..n 連號（SC-005、FR-005）

### Implementation for User Story 3

- [ ] T025 [US3] 於 `src/board/board-builder.service.ts` 實作 union（trending＋search）後以 `repoId` 去重：同一 repo 合併 `sources`、依 FR-004 保留主力 `starsThisWeek`／補位 `totalStars`+`createdAt`，再以 `weekly-stars` 計 `weeklyStarsEstimate`（依賴 T021、T013）
- [ ] T026 [US3] 於 `board-builder` 實作每領域穩定排序 `(weeklyStarsEstimate desc, repoId asc)` → top 15 → `rank` 連號；確保相同輸入必得相同順序、不受來源順序影響（依賴 T025；SC-005/FR-005）

**Checkpoint**: 三領域榜去重乾淨、排序可重現，具備 F3 diff 前提

---

## Phase 6: User Story 4 - 單一來源失敗不拖垮整體（Priority: P3）

**Goal**: 主力／補位任一失敗或主力解析 0 筆時，另一來源仍出榜，並發帶**來源識別**的紅色告警；皆正常則無告警。

**Independent Test**: 分別讓（a）主力失敗/0 筆、（b）補位某組失敗 → 另一來源仍出榜且各發一則帶來源 id 的告警；兩者皆正常無任何來源告警（spec US4、quickstart §4、SC-004）。

### Tests for User Story 4 ⚠️

- [ ] T027 [P] [US4] 撰寫（或補充 `board-builder.service.spec.ts`）容錯測試：mock 主力 Trending 失敗或**解析 0 筆** → 補位仍出榜、送告警 `source=github-trending`；mock 補位某組失敗 → 主力仍出榜、送告警 `source=github-search:{domain}`；**Search 某組 0 筆不告警**（與主力 0 筆區分）；mock `GET /repos` 出現 **401/403** 或批次**失敗率 > 50%** → 送告警 `source=github-repo`（未達門檻的零星失敗僅略過該候選、不告警）；兩來源皆正常 → 不發任何來源告警（FR-007/FR-009、SC-004、Edge Case「Trending 候選補 topics 失敗」）

### Implementation for User Story 4

- [ ] T028 [US4] 於 `src/board/board-builder.service.ts` 對主力 Trending 與補位 Search（每組）以 try/catch 隔離：任一拋錯或主力 0 筆 → 呼叫 F1 `DiscordWebhookService.postFailureAlert`（或 `tryPostFailureAlert`）送**帶來源 id**（`github-trending`／`github-search:{domain}`／`github-repo`）紅色告警，另一來源續行；Search 0 筆視為正常不告警；`github-repo` 依門檻告警（401/403 即告警一次、其餘批次失敗率 > 50% 告警一次，零星失敗僅略過）（依賴 T025；research D6、contracts §1/§2/§3）

**Checkpoint**: 所有 User Story 完成，具備無人值守容錯護欄

---

## Phase 7: Polish & Cross-Cutting

**Purpose**: 收尾驗證與跨 Story 一致性

- [ ] T029 [P] 執行 `npm test` 全綠：涵蓋 Trending 快照、分類、去重、排序穩定、`weeklyStarsEstimate`、容錯告警（quickstart §1、憲章 VIII）
- [ ] T030 依 quickstart §2 本機實跑 `node dist/main.cli.js`（三機密以 env 提供）：確認 log 印出欄位齊備的三領域榜與 `api: core=…, search=…`（core ≤ ~150 安全上限、單次典型約 120；search ≤ 3）、且 `git status` 無 `state/` 變更（SC-001/SC-006、FR-006）
- [ ] T031 [P] 依 quickstart §4 抽驗容錯情境（主力/補位擇一模擬失敗）→ 告警帶來源 id、另一來源仍出榜（SC-004）
- [ ] T032 [P] 依 quickstart §3 抽查 SC-002：隨機挑 **≥10 筆**（跨三領域）開 GitHub 頁核對領域歸類，記錄歸對率 **MUST ≥90%**；並確認補位來源確有 `[search]` 標記的近 7 天新星（SC-002）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup（Phase 1）**：無依賴，可立即開始
- **Foundational（Phase 2）**：依賴 Setup；**阻塞所有 User Story**（型別 T003、HTTP 客戶端 T004 為全體共用）
- **User Stories（Phase 3+）**：皆依賴 Foundational
  - US1（P1）為 MVP，先行；US2/US3/US4 在其上**增量擴充同一 `board-builder.service.ts`**（見下）
- **Polish（Phase 7）**：依賴所有目標 Story 完成

### User Story Dependencies

- **US1（P1）**：Foundational 後即可開始；自成 MVP（Trending-only 路徑）
- **US2（P2）**：新增 `github-search.service.ts`；**T021 擴充 `board-builder`（承 US1 T016）**
- **US3（P2）**：合併去重＋穩定排序；**T025/T026 擴充 `board-builder`（承 US2 T021）**——US3 的合併語意以 US2 已注入 Search 候選為前提
- **US4（P3）**：容錯隔離；**T028 擴充 `board-builder`（承 US3 T025）**

> **注意（共享檔案）**：`src/board/board-builder.service.ts` 為編排器，被 US1→US2→US3→US4 **順序**擴充（非平行），故這些擴充任務彼此有序、不可標 [P]。各 Story 的 `board-builder.service.spec.ts` 聚焦該 Story 行為，可獨立驗收。

### Within Each User Story

- 測試先寫且先失敗（憲章 VIII）→ 再實作
- 純函式/型別（`domain-keywords`、`weekly-stars`、`board.types`）先於服務
- 服務（`sources/*`、`classify`）先於編排器（`board-builder`）
- 編排器先於 pipeline log 接線

### Parallel Opportunities

- Setup 的 T002 可與 T001 後續平行
- Foundational T005（spec）與 T004 可並行撰寫（測試先行）
- US1 測試群 T006–T010 全部 [P] 可並行；實作 T011（keywords）、T013（weekly-stars）為 [P]
- US2 的 T019、US3 的 T022–T024、US4 的 T027 皆 [P]（測試檔獨立）
- **跨 Story 的 `board-builder` 實作任務（T016/T021/T025/T028）不可並行**（同檔順序擴充）

---

## Parallel Example: User Story 1（測試先行）

```bash
# 先並行寫 US1 測試（先失敗）：
Task: "trending fixture in tests/fixtures/trending-weekly.html"                 # T006
Task: "github-trending.service.spec.ts"                                          # T007
Task: "classify.service.spec.ts"                                                 # T008
Task: "weekly-stars.spec.ts"                                                     # T009
Task: "board-builder.service.spec.ts (Trending-only)"                            # T010

# 再並行寫無依賴的純檔：
Task: "domain-keywords.ts"                                                       # T011
Task: "weekly-stars.ts"                                                          # T013
```

---

## Implementation Strategy

### MVP First（僅 User Story 1）

1. 完成 Phase 1 Setup
2. 完成 Phase 2 Foundational（型別＋github-http，阻塞全體）
3. 完成 Phase 3 US1（Trending-only → 三領域榜 → log）
4. **STOP & VALIDATE**：依 quickstart §2/§3 獨立驗收 US1（M1 即達成）
5. 可 demo：log 印出主力三領域週增星榜

### Incremental Delivery

1. Setup ＋ Foundational → 地基就緒
2. US1 → 獨立驗收 → M1 里程碑（Trending 主力榜）
3. US2 → 補位 Search 收錄新星
4. US3 → 合併去重＋穩定排序（F3 diff 前提）
5. US4 → 容錯告警護欄
6. Polish → 全測試綠 ＋ quickstart 驗證

---

## Notes

- [P] = 不同檔案、無未完成依賴；`board-builder` 的跨 Story 擴充**不是** [P]
- 每個 [Story] 標籤對映 spec User Story，利於追溯
- 依憲章 VIII，關鍵邏輯**先寫測試並確認先失敗**再實作
- F2 **不寫回 `state/board.json`**、不 diff、不推播、不生成簡介（分屬 F3/F5/F7）
- 機密只走 env（`GH_API_TOKEN`），絕不入 log／`CurrentBoard`／任何產物（憲章 VII）
- `/speckit-implement` 期間可依 tasks 內聚主題分段 commit，scope 標 `002-board-sources`
