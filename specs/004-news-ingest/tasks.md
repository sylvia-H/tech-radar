---
description: "Task list for 004-news-ingest implementation"
---

# Tasks: 新聞來源設定與零 LLM 過濾漏斗（階段 A · News Ingest & Zero-LLM Funnel）

**Input**: Design documents from `specs/004-news-ingest/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: 已明確要求（憲章 VIII「關鍵邏輯測試優先」＋ quickstart.md 測試表為完成判準）。所有純函式與抓取器
以並置 `*.spec.ts` 單測涵蓋；外部抓取（`fetch`／`rss-parser`）以 mock／注入 parser 測，時間以 `now` 注入。

**Organization**: 依 User Story 分組，各故事可獨立實作與驗證。路徑沿用現有「一模組一資料夾 ＋ `*.spec.ts` 並置」慣例。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可平行（不同檔、無未完成相依）
- **[Story]**: US1 / US2 / US3 / US4（對應 spec.md 四個 User Story）
- 每項含明確檔案路徑

## Path Conventions

- 單一專案 CLI，來源於 `src/`，測試並置為 `*.spec.ts`（非集中 `tests/`）
- 新聞為獨立資料流 → 自成 `src/news/`；來源設定依憲章 IV 放 `src/config/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 相依與模組骨架

- [X] T001 安裝 `rss-parser` 相依並記入 `package.json`（憲章技術釘死清單內；`npm i rss-parser`），確認 `npm run build`（tsc strict）通過
- [X] T002 建立新聞模組骨架 `src/news/news.module.ts`（空 `@Module`，之後逐步掛 provider），並確認 `src/config/` 目錄可放來源設定檔

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 所有故事共用的型別與 HTTP 抓取基座

**⚠️ CRITICAL**: 本階段完成前，任何 User Story 都不能開始

- [X] T003 建立 `src/news/news.types.ts`：定義 `NewsSource`、`RawItem`、`NewsCandidate`、`CandidateSet`／`FunnelResult` 型別與新聞 `Domain` 列舉（`ai|devops|frontend-backend|cross` 於來源設定、`ai|devops|frontend-backend` 於候選輸出）；**不复用** `board.types.ts` 的 `Domain`（data-model.md §領域列舉關係圖）
- [X] T004 建立 `src/news/news-http.ts`：`getText(url, conditional?)` 與 `getJson<T>(url)`，帶自訂 User-Agent、可選條件式請求（ETag／If-Modified-Since，304 回 notModified）、5xx/429/網路錯誤指數退避＋jitter（鏡射 `src/github/github-http.ts` 的 `requestWithRetry`/`backoffMs`）；**無 token、host 無關；錯誤訊息可含來源 URL**（feed 公開、不帶 token，利於定位失敗來源；research D3、FR-009）

**Checkpoint**: 型別與 HTTP 基座就緒 — 可開始 User Story 實作

---

## Phase 3: User Story 1 - 來源即設定：抓取與正規化只認一份清單 (Priority: P1) 🎯 MVP

**Goal**: 從**單一設定檔**讀取來源清單，依四種抓取類型逐源隔離抓取，正規化為統一 `NewsCandidate`；停用來源略過、新增同型別只改設定；任一來源 0 筆發帶 `id` 告警、單源失敗不斷全線；releases 濾除 pre-release／純 patch；`cross` 來源以關鍵字歸類。

**Independent Test**: 設定含四型各一的來源清單，執行抓取 → 輸出統一結構、`domain`/`tier` 取自設定；停用／新增來源僅改設定即改變抓取結果；以「回傳 0 筆」來源確認發帶識別碼告警。

### Tests for User Story 1 ⚠️

> **先寫測試並確認 FAIL，再實作**

- [X] T005 [P] [US1] 來源 schema 驗證測試 `src/config/news-source.schema.spec.ts`：重複 `id`／缺必填欄位／列舉不符擲帶 id 明確錯誤（FR-002）
- [X] T006 [P] [US1] 抓取器分派測試 `src/news/fetchers/fetcher.spec.ts`：依 `type` 正確分派、停用來源略過、新增同型別免改 code（FR-003/004）
- [X] T007 [P] [US1] HN Algolia 抓取快照測試 `src/news/fetchers/hn-algolia.fetcher.spec.ts`：近 7 天過濾、`points`→score、`url` 空退回 permalink（mock fetch；FR-005/010/015）
- [X] T008 [P] [US1] Reddit weekly 抓取快照測試 `src/news/fetchers/reddit-weekly.fetcher.spec.ts`：`/top/.rss?t=week`、`score` 記 `null`（注入 parser；research D5/D8）
- [X] T009 [P] [US1] 一般 RSS 抓取快照測試 `src/news/fetchers/rss.fetcher.spec.ts`：`title`/`link`/`contentSnippet` 截 ~500 字/`isoDate`（注入 parser；FR-005/007）
- [X] T010 [P] [US1] GitHub releases 抓取快照測試 `src/news/fetchers/github-releases.fetcher.spec.ts`：解析 `releases.atom` 並套版本過濾（注入 parser；FR-005/008）
- [X] T011 [P] [US1] releases 版本過濾測試 `src/news/release-filter.spec.ts`：drop pre-release（`-alpha/-beta/-rc/-pre/-dev/-canary`）與純 patch、keep major/minor 與 security 字樣、無法解析保守保留（FR-008、**SC-010**）
- [X] T012 [P] [US1] cross 歸類測試 `src/news/news-classify.spec.ts`：前後端項一律歸單一 `frontend-backend` 桶、含 devops、非 `cross` 不重歸類、詞界比對避免子字串誤命中（FR-006/027、US1-7）
- [X] T013 [US1] 編排容錯測試（US1 部分）`src/news/news-ingest.service.spec.ts`：任一來源 0 筆發帶 `id` 告警（含 Tier 2）、單源失敗不斷全線（mock `DiscordWebhookService`；FR-025/026、**SC-003/004**）

### Implementation for User Story 1

- [X] T014 [P] [US1] 建立來源清單 schema `src/config/news-source.schema.ts`：zod 逐筆 `newsSourceSchema`（`id/type/url/domain/tier/enabled?`）＋清單層 `validateNewsSources()` 唯一 `id` 檢查，違規擲帶 id 錯誤（research D1、FR-002）
- [X] T015 [P] [US1] 建立來源清單設定 `src/config/news-sources.ts`：匯出 `NEWS_SOURCES: NewsSource[]`（依 dev-guide §4.2 初始來源，四型齊備、含三個 DevOps 專屬來源），載入時經 `validateNewsSources()`（憲章 IV、FR-001）
- [X] T016 [P] [US1] 建立版本過濾純函式 `src/news/release-filter.ts`：`isNoisyRelease(tagOrTitle)` 依 research D6 判定（drop pre-release/純 patch，keep major/minor/security）
- [X] T017 [P] [US1] 建立新聞領域關鍵字 `src/news/news-domain-keywords.ts`：`ai|devops|frontend-backend` 三桶關鍵字集（含 devops；獨立於榜單 `domain-keywords`）
- [X] T018 [US1] 建立 cross 歸類純函式 `src/news/news-classify.ts`：以 `news-domain-keywords` 對 `cross` 來源標題/摘要歸類為三桶之一、前後端收斂單桶、詞界比對（依 T017；FR-006/027）
- [X] T019 [US1] 建立抓取器介面與分派 `src/news/fetchers/fetcher.ts`：`SourceFetcher = (source, ctx) => Promise<RawItem[]>`、`FetcherContext`（`now`/`http`/`parser`）、`type`→fetcher 的 `Record` 分派（research D2）
- [X] T020 [P] [US1] 實作 `src/news/fetchers/hn-algolia.fetcher.ts`：Algolia JSON、`created_at_i>7天前`、`points`→score、`url` 空退回 permalink（依 T004/T019；research D4）
- [X] T021 [P] [US1] 實作 `src/news/fetchers/reddit-weekly.fetcher.ts`：`rss-parser` 解析 `/top/.rss?t=week`、`score=null`（依 T004/T019；research D5）
- [X] T022 [P] [US1] 實作 `src/news/fetchers/rss.fetcher.ts`：`rss-parser` 通用 RSS/Atom、摘要截 ~500 字（依 T004/T019；research D5、FR-007）
- [X] T023 [P] [US1] 實作 `src/news/fetchers/github-releases.fetcher.ts`：`rss-parser` 解析 `releases.atom` ＋套 `release-filter`（依 T004/T016/T019；FR-008）
- [X] T024 [P] [US1] 建立候選觀測輸出 `src/news/news-log.ts`：印出候選清單（統一結構、`domain`/`tier`/`sources[]`/規模）作為本 Feature 唯一產出面
- [X] T025 [US1] 建立編排服務 `src/news/news-ingest.service.ts`（US1 部分）：`@Injectable`，載入設定→對每個 `enabled` 來源**獨立 try/catch** 抓取＋正規化為 `NewsCandidate`（填 `normalizedUrl`/`domain`/`sources=[sourceId]`）→ `cross` 歸類 → 0 筆／失敗經 `bestEffortFailureAlert` 發帶 `id` 告警 → 匯集後經 `news-log` 觀測（依 T014/T018/T019/T024；FR-005/006/025/026）
- [X] T026 [US1] 於 `src/news/news.module.ts` 掛入 `NewsIngestService` 及相依（import `DiscordModule`/`StateModule` 供告警與後續狀態存取），並在 `src/app.module.ts` 註冊 `NewsModule`

**Checkpoint**: US1 可獨立驗證 — 從設定檔抓到正規化候選、0 筆告警、來源隔離皆成立（尚未去重／過濾）

---

## Phase 4: User Story 2 - 跨來源去重：同一則新聞只留一筆 (Priority: P1)

**Goal**: 以正規化 target-URL 為鍵合併同一則（保留最高分為代表、併 `sources[]`），無共同 URL 者以標題 Jaccard 補漏；全程零 LLM、零向量檢索。

**Independent Test**: 餵入刻意含跨來源重複（同 URL 出現於 HN/Reddit/Lobste.rs ＋一組僅標題近似）的候選 → 同一則只留一筆、代表為最高分、`sources[]` 計數正確；不依賴 LLM／網路。

### Tests for User Story 2 ⚠️

- [X] T027 [P] [US2] target-URL 正規化測試 `src/news/url-normalize.spec.ts`：小寫 host、去 `www.`、去追蹤參數（`utm_*`/`ref`/`fbclid`/`gclid`/`mc_*`）、統一尾斜線、去 fragment、已知短網址單次解、指向同一資源得相同鍵（FR-011、**SC-009**）
- [X] T028 [P] [US2] 標題相似度測試 `src/news/title-similarity.spec.ts`：標題正規化（小寫/去標點/去 stop words）→ token Jaccard、門檻上下界行為（FR-013）
- [X] T029 [P] [US2] 去重合併測試 `src/news/dedup.spec.ts`：同 `normalizedUrl` 合併保留最高分代表＋`sources[]` 累積（**SC-001**）、**同分時代表以 `sourceId`→`originalUrl` 字典序確定性決勝**（FR-012 決定性，**SC-011**）、標題近似合併／低於門檻不誤合併、無目標連結以自身連結為鍵不崩潰（FR-012/013/015、Edge）

### Implementation for User Story 2

- [X] T030 [P] [US2] 建立 `src/news/url-normalize.ts`：純函式 `normalizeTargetUrl(raw)` 依 research D7（WHATWG `URL` 逐段處理、已知短網址 host 才單次解址、否則照原樣）
- [X] T031 [P] [US2] 建立 `src/news/title-similarity.ts`：純函式 標題正規化 ＋ `jaccard()`，`TITLE_JACCARD_THRESHOLD` 起始 0.6（可調常數；research D9）
- [X] T032 [US2] 建立 `src/news/dedup.ts`：URL 合併（同 `normalizedUrl` 取最高分為代表、併 `sources[]`）＋標題 Jaccard 補漏合併（依 T030/T031；FR-012/013/015）
- [X] T033 [US2] 於 `news-ingest.service.ts` 串接去重：正規化後 → URL 去重 → 標題 Jaccard 去重，並在 `news-ingest.service.spec.ts` 補跨來源同一則只一筆、`sources[]` 合併之整合斷言（依 T032；SC-001）

**Checkpoint**: US1＋US2 可並行驗證 — 跨來源同一則只出現一筆、`sources[]` 正確合併（M2 驗收核心）

---

## Phase 5: User Story 3 - 階段 A 過濾與加權：把候選收斂到可策展的規模 (Priority: P2)

**Goal**: 對有社群分數來源（Tier 1/3）套品質門檻、Tier 2／無分數不套門檻；交叉驗證（`sources.length>=2`）與榜單相關性加權（無榜單安全略過）；tier 差異化門檻與權重；全序決勝排序並收斂至約 15–25 則。

**Independent Test**: 餵入已去重、帶不同分數與 tier（含 Tier 2 一手來源、提到榜上 repo 者、低分口水文）的候選 → 低分 Tier1/3 被丟、Tier2 保留、交叉驗證與榜單相關加權、輸出規模落區間；確定性；不依賴 LLM。

### Tests for User Story 3 ⚠️

- [X] T034 [P] [US3] 漏斗測試 `src/news/funnel.spec.ts`：分數門檻僅作用有分數來源、**Tier 2／`score===null` 不被丟**（SC-005）、交叉驗證加權、榜單相關加權且空榜單安全略過（Edge）、tier 差異化門檻與權重（FR-019）、全序決勝（加權分↓→新鮮度↓→URL↑）與收斂規模、**相同輸入確定性**（FR-016~021、**SC-005/006/011**）

### Implementation for User Story 3

- [X] T035 [US3] 建立 `src/news/funnel.ts`：純函式 過濾（`SCORE_THRESHOLDS` 可調常數表、無分數不套門檻）＋加權（交叉驗證、榜單相關、tier 差異化）＋四層全序決勝排序 ＋收斂取前 N（稀少照實不硬湊）；榜單相關集（由 T036 傳入的榜上 repo 名 `Set`）為空集合時整段略過（research D8/D10/D11）
- [X] T036 [US3] 於 `news-ingest.service.ts` 串接漏斗：去重後 → 從 `state.board`（`StateStore.load()`）建榜單 repo 名 `Set` 傳入 `funnel` → 過濾/加權/排序/收斂；無榜單資料時傳空集合安全略過（依 T035；FR-018、Assumptions）

**Checkpoint**: US1＋US2＋US3 — 候選收斂至約 15–25 則、排序確定（SC-006/011）

---

## Phase 6: User Story 4 - 只推新出現：不跨天重複回報 (Priority: P3)

**Goal**: 以正規化 target-URL 比對 `seenNews` 排除已見；載入時修剪 `seenAt` 逾 7 天者；只消費與修剪，**不寫回**（寫回屬 F6/F7）。

**Independent Test**: 給定含保留期內與逾期的 `seenNews` ＋一批候選（部分已見）→ 逾 7 天被修剪、已見被排除、未見保留；時間可注入。

### Tests for User Story 4 ⚠️

- [X] T037 [P] [US4] seenNews 測試 `src/news/seen-news.spec.ts`：`pruneSeenNews` 剔除逾 7 天、保留期內留存（**SC-008**）；`excludeSeen` 以**正規化 URL**比對排除已見、帶不同追蹤參數同連結仍判已見（FR-022/023、**SC-007**）

### Implementation for User Story 4

- [X] T038 [P] [US4] 建立 `src/news/seen-news.ts`：純函式 `pruneSeenNews(entries, now, retentionDays=7)` 與 `excludeSeen(candidates, seenSet, now)`，比對套 `normalizeTargetUrl`（依 T030；research D12）
- [X] T039 [US4] 於 `news-ingest.service.ts` 串接：`StateStore.load()` 後記憶體修剪 `seenNews` → 漏斗排序後 `excludeSeen` 排除；**不寫回**（FR-024）；補整合斷言（依 T038；SC-007/008）

**Checkpoint**: 四個故事皆可獨立驗證 — 完整鏈路「設定檔→抓取→正規化→去重→過濾→排除 seen→候選觀測」成立

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: 收尾與跨故事驗證

- [X] T040 [US4] （可選）於 `src/main.cli.ts` 以觀測模式呼叫 `NewsIngestService.ingest(now, boardRepoNames)` 印出候選（不接推播；推播串接屬 F7）
- [X] T041 執行 quickstart.md 驗證：`npm run build`（tsc strict 無錯）＋ `npm test` 全綠，逐一對照 SC-001~SC-011
- [X] T042 勾選 `specs/004-news-ingest/tasks.md` 完成項，確認無跨故事破壞獨立性、無同檔衝突遺留

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 無相依，先行
- **Foundational (Phase 2)**: 依賴 Setup；**阻擋所有 User Story**（T003 types、T004 http 為共用基座）
- **User Stories (Phase 3–6)**: 皆依賴 Foundational
  - US1（P1）為 MVP，先行；US2/US3/US4 的服務串接（T033/T036/T039）依賴 US1 的 `news-ingest.service.ts`（T025）已建立
  - 各故事的**純函式**（url-normalize/title-similarity/dedup/funnel/seen-news）彼此獨立，可在 Foundational 後平行開發；僅「串接進 service」的任務有順序相依
- **Polish (Phase 7)**: 依賴所有目標故事完成

### User Story Dependencies

- **US1 (P1)**: Foundational 後即可開始 — 無其他故事相依（MVP）
- **US2 (P1)**: 純函式（T030–T032）可與 US1 平行；串接 T033 依賴 US1 的 T025
- **US3 (P2)**: `funnel.ts`（T035）為純函式、僅依賴 Foundational（型別），可與 US1／US2 平行開發；串接 T036 依賴 T033（去重輸出）與 T035，並由服務端從 `state.board` 建榜上 repo 名 `Set` 傳入
- **US4 (P3)**: `seen-news.ts`（T038）依賴 T030（url-normalize，US2）；串接 T039 依賴 T036（漏斗輸出）

### Within Each User Story

- 測試先寫且 FAIL → 純函式 → 抓取器／服務 → 串接整合
- `news-domain-keywords`（T017）先於 `news-classify`（T018）
- `url-normalize`（T030）先於 `dedup`（T032）與 `seen-news`（T038）

### Parallel Opportunities

- Setup 內 T001→T002 順序（T002 建目錄可於 T001 後）
- Foundational T003 與 T004 可平行（不同檔）
- US1 測試 T005–T013 全部 [P] 可平行；實作中 T014/T015/T016/T017 [P]、抓取器 T020–T023 [P]（皆不同檔）
- US2 純函式 T030/T031 [P]；US3 T034/T035；US4 T037/T038 [P]
- 跨故事：Foundational 完成後，US2/US3/US4 的純函式可與 US1 並行開發，最後依序串接 service

---

## Parallel Example: User Story 1

```bash
# 先平行寫測試（確認 FAIL）:
Task: "來源 schema 驗證測試 src/config/news-source.schema.spec.ts"
Task: "抓取器分派測試 src/news/fetchers/fetcher.spec.ts"
Task: "releases 版本過濾測試 src/news/release-filter.spec.ts"
Task: "cross 歸類測試 src/news/news-classify.spec.ts"

# 再平行實作獨立純函式/設定:
Task: "建立 src/config/news-source.schema.ts"
Task: "建立 src/news/release-filter.ts"
Task: "建立 src/news/news-domain-keywords.ts"

# 抓取器彼此獨立，可平行:
Task: "實作 src/news/fetchers/hn-algolia.fetcher.ts"
Task: "實作 src/news/fetchers/reddit-weekly.fetcher.ts"
Task: "實作 src/news/fetchers/rss.fetcher.ts"
Task: "實作 src/news/fetchers/github-releases.fetcher.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 Setup → Phase 2 Foundational
2. Phase 3 US1（來源即設定：抓取＋正規化＋隔離容錯＋0 筆告警）
3. **STOP & VALIDATE**：以四型各一來源觀測候選清單、驗證 0 筆告警與來源隔離
4. 此時已是可展示 MVP（憲章 IV 的直接實現）

### Incremental Delivery

1. Setup + Foundational → 基座就緒
2. US1 → 抓取正規化候選（MVP，觀測可印）
3. US2 → 跨來源去重（M2 驗收核心：同一則只一筆、`sources[]` 合併）
4. US3 → 過濾加權收斂至 15–25 則
5. US4 → 跨天排除 ＋ 7 天修剪（本 Feature 完成）

### Notes

- [P] = 不同檔、無未完成相依；[Story] 標籤對應可追溯性
- 全程**零 LLM、零 embeddings、不新增機密、不新增狀態欄位、不寫回 `seenNews`**（憲章 IV/V/VI/VII）；
  FR-014／FR-028 屬 MUST NOT 型負向約束，由**結構性保證**達成（research D14：F4 不新增 `@google/genai`／
  embeddings 相依）＋ plan Constitution Check 原則 V 閘門把關，刻意不另設守門測試（已知且有界的取捨：
  依 review 與憲章閘門，不加額外測試層）
- 時間一律以 `now` 注入；抓取以 mock／注入 parser 測；驗證 FAIL 後再實作
- 依 tasks.md 內聚主題分段 commit，scope 用 `004-news-ingest`，同段勾選併入該 commit
