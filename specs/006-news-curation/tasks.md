---
description: "Task list for F6 — 每日晨報單次 LLM 策展與降級備援"
---

# Tasks: 每日晨報單次 LLM 策展與降級備援（News Curation & Graceful Fallback）

**Input**: Design documents from `specs/006-news-curation/`

**Prerequisites**: plan.md ✅、spec.md ✅、research.md ✅、data-model.md ✅、
contracts/（news-curation / board-summary / llm-response.schema）✅

**Tests**: 本 Feature **含測試任務**——憲章 VIII 明列「新聞配額、50/300 字數上限、URL/標題去重（沿用
F4）、殘留語意去重、幻覺剔除、策展失敗降級備援、榜單 TL;DR 備援、晨報單次呼叫」須有單元測試方可
視為完成；外部 LLM 以 mock `LlmService` 測（成功／空／擲錯三態）。plan 與 quickstart 皆以 `*.spec.ts`
為主要驗證。

**Organization**: 依 spec 的 4 個 User Story（US1/US2 為 P1，US3 為 P2，US4 為 P3）分階段，各階段可
獨立實作與測試。

## Format: `[ID] [P?] [Story] Description`

- **[P]**：可並行（不同檔案、無未完成相依）
- **[Story]**：US1 / US2 / US3 / US4（對應 spec User Story）
- 每個任務標明確切檔案路徑

## Path Conventions

單一專案 CLI，沿用現有 `src/<module>/` 佈局；新增 `src/curation/` 模組，`*.spec.ts` 與原始碼並置
（非集中 tests/）。**不改動 F4/F5 既有檔案**，只 `import` 其匯出項（`NewsCandidate`/`weightedScore`/
`mentionsBoardRepo`、`LlmService`/`LlmError`、`countCodePoints` 口徑）。**無新增 npm 依賴。**

---

## Phase 1: Setup（共用前置）

**Purpose**：確認基線可建置、無需新增相依（F6 零新依賴，全部重用既有模組）。

- [X] T001 確認基線與依賴邊界：於 repo 根執行 `npm run build`（tsc strict 零 error）與 `npm test`（現有全綠），並確認 `package.json` **無需新增相依**（F6 只 import F4/F5 既有匯出，plan Technical Context）

---

## Phase 2: Foundational（阻塞所有 User Story 的前置）

**Purpose**：記憶體型別契約——策展與榜單摘要兩服務及其純函式皆依賴這兩個型別檔。

**⚠️ CRITICAL**：本階段完成前，任何 User Story 皆無法動工。

- [X] T002 [P] 定義策展側型別於 [src/curation/curation.types.ts](src/curation/curation.types.ts)：`CurationItemView`（`ref/title/domain/tier/score/sourceCount/onBoard/summaryExcerpt`）、`CurationLlmPick`（`ref/title/content`）、`CurationLlmResponse`（`{ picks }`）、`CuratedNewsItem`（含 `content: string|null`、程式提供之 `url/domain/sourceCount/weightedScore`、`degraded`）、`CuratedDigest`（`{ items; degraded }`）（data-model §1、只 import F4 `NewsDomain3` 型別語意，不改 F4）。**注**：`domain` 欄位型別為 `NewsDomain3`（不含 `cross`）；自 `candidate.domain: NewsDomain` 的收窄於投影／對回層（T013/T014）以 `as NewsDomain3`＋F4 不變式註解處理（I1 決策 B），型別檔本身不做執行期收窄
- [X] T003 [P] 定義榜單摘要側型別於 [src/curation/board-summary.types.ts](src/curation/board-summary.types.ts)：`BoardChangeDigest`（`newcomers/climbed/declined/domainCounts{ai,'frontend-backend'}/topName`）、`BoardChangeSummary`（`{ summary; degraded }`）（data-model §2.1/2.2）

**Checkpoint**：型別契約就緒——各 User Story 可開始。

---

## Phase 3: User Story 1 - 每日單次策展：候選集 → 合規繁中精選（Priority: P1）🎯 MVP

**Goal**：把 F4 候選集投影為公開脈絡視圖，以**單一** `LlmService.generate()` 完成「殘留語意去重 →
依開發者重要性挑 ≤6 → 每則繁中標題 ≤50／內容 ≤300」，再經硬驗證管線（剔幻覺＋去重 → 夾非 AI ≤2 →
截 ≤6 → 字數收斂）產出**恆合規**的精選集；空候選短路不呼叫 LLM。

**Independent Test**：以一份 ~15–25 則、含跨領域＋一組僅語意重複＋足量 AI＋少量非 AI 的候選，mock
`LlmService` 回一段合規選擇結果，斷言回傳 ≤6 則、每則繁中且標題 ≤50／內容 ≤300、配額被遵守、每則
連結/分數對得回輸入候選（無杜撰）、殘留事件 ≤1 則、且 **`llm.generate` 恰呼叫 1 次**；空候選 → 空
digest 且呼叫 0 次。全程 mock、不連網。

### Tests for User Story 1 ⚠️（先寫、先失敗）

- [X] T004 [P] [US1] `clampToLimit` / `countCodePoints` 測試於 [src/curation/curation-length.spec.ts](src/curation/curation-length.spec.ts)：以 code point 計數（surrogate pair/emoji 正確）；`clampToLimit(text,50)` 與 `(text,300)` 皆於自然邊界截斷加「…」、無邊界硬截 `max-1`+「…」；≤max 原樣返回（research D5、FR-008、SC-002）
- [X] T005 [P] [US1] 配額工具測試於 [src/curation/curation-quota.spec.ts](src/curation/curation-quota.spec.ts)：`isAi(domain)` 分類（`ai` → AI；`devops`/`frontend-backend` → 非 AI）；`clampNonAi(items, ≤2)` 依領域優先序（DevOps 優先）保留前 2、其餘剔除、AI 不受限（research D4、FR-004/010、SC-003）
- [X] T006 [P] [US1] 解析測試於 [src/curation/curation-parse.spec.ts](src/curation/curation-parse.spec.ts)：合法 JSON（含/不含 ```json fence）→ 正確 `picks`；非 JSON／截斷／`picks` 非陣列／`ref` 為字串 → 擲 `CurationParseError`；**越界 `ref`（如 99）解析通過**（留給硬驗證剔除）（contracts/llm-response.schema §2/5、research D2）
- [X] T007 [P] [US1] 硬驗證管線測試於 [src/curation/curation-validate.spec.ts](src/curation/curation-validate.spec.ts)：以合規 picks 斷言「以 `ref` 對回候選附上程式提供的 `url/domain/sourceCount/weightedScore`」、重複 `ref` 去重為一則、picks 順序（重要性序）保留（FR-006/009、SC-005）
- [X] T008 [US1] `NewsCurationService.curate()` **成功路徑**測試於 [src/curation/curation.service.spec.ts](src/curation/curation.service.spec.ts)：代表性候選＋mock 合規回應 → ≤6 則、繁中、字數/配額合規、對回候選（無杜撰）、殘留語意重複事件 ≤1（mock 只選一次）、**`llm.generate` 呼叫次數 = 1**；空候選 → 空 `items`、`degraded:false`、**呼叫次數 = 0**；並以 spy 取 `llm.generate` 收到的 prompt，斷言其**僅由 `CurationItemView` 公開欄位組成、不含任何機密**（C1、FR-007）（contracts/news-curation §測試點、SC-001/006）

### Implementation for User Story 1

- [X] T009 [P] [US1] 實作純函式 `countCodePoints` 與 `clampToLimit(text, max)` 於 [src/curation/curation-length.ts](src/curation/curation-length.ts)：一般化 F5 `clampTo250` 的自然邊界收斂（`BOUNDARY_CHARS` 於本檔定義、上限參數化），不重呼叫 LLM（research D5，**不改 F5**）
- [X] T010 [P] [US1] 實作配額常數與純函式於 [src/curation/curation-quota.ts](src/curation/curation-quota.ts)：`MAX_ITEMS=6`、`MAX_NON_AI=2`、`MIN_AI=4`；`isAi(domain)`、`clampNonAi(items, keyFn)` 依領域優先序夾非 AI ≤2（分類用 `candidate.domain`，research D4、FR-004/010）。**注**：`MIN_AI` 的唯一消費者是 T012 prompt（AI ≥4 為 prompt 驅動的軟下限，硬驗證管線刻意**不**強制填 AI，見 FR-004/005）；於此註明其消費者，避免成為無引用的死常數（U2）
- [X] T011 [P] [US1] 實作 `stripJsonFence(raw)`、`parseCurationResponse(raw)` 與 `CurationParseError` 於 [src/curation/curation-parse.ts](src/curation/curation-parse.ts)：去 code fence → `JSON.parse` → 形狀淺驗證（`picks` 陣列、每項 `ref:number`/`title,content:string`）；任一步失敗擲 `CurationParseError`，不局部搶救（research D2、contracts/llm-response.schema §2/3）
- [X] T012 [P] [US1] 實作 `buildCurationPrompt(items)` 於 [src/curation/curation-prompt.ts](src/curation/curation-prompt.ts)：候選以 `[0] …／[1] …` 逐行編號，**每行納入 `onBoard` 標記**（如命中榜上 repo 標「★在榜」，使 FR-001 的榜單相關性脈絡實際進入 prompt、成為重要性提示；U1）；明列「重要 ≠ 熱門」優先類別、主題降噪優先序（DevOps 優先／後端 Node.js·Python／前端 TypeScript 為主·Vue·React 最低／不收 CSS）、配額（**AI ≥4（門檻由 `curation-quota` 的 `MIN_AI` 常數帶出，勿硬編字面）＝有≥4則合格AI候選時的軟性下限、不足照實不硬湊**，回應 CHK008）、繁中 50/300、殘留語意去重、只回 `{picks:[{ref,title,content}]}` 且不得產生連結/分數（FR-003/004/006/007、research D1）
- [X] T013 [US1] 實作硬驗證管線 `validateCuration(picks, candidates)` 於 [src/curation/curation-validate.ts](src/curation/curation-validate.ts)：固定順序 (1) 剔除 `ref` 越界/非整數＋重複 `ref` 去重 → (2) `clampNonAi` 夾非 AI ≤2 → (3) 依 picks 序截總數 ≤6 → (4) `clampToLimit` 收斂 title≤50/content≤300；每則以 `ref` 對回候選附程式事實（`url=originalUrl`/`domain`（`candidate.domain as NewsDomain3`，同 T014 收窄、附註解引用 F4 不變式，I1）/`sourceCount=sources.length`/`weightedScore`）、`degraded:false`；**不遞補未改寫候選**（依賴 T009/T010、FR-008/009/010、SC-002/003/005）
- [X] T014 [US1] 實作 `NewsCurationService.curate(candidates, boardRepoNames)` **成功路徑＋空候選短路** 於 [src/curation/curation.service.ts](src/curation/curation.service.ts)：`@Injectable`、注入 `LlmService`；`candidates.length===0` → 直接回空 `CuratedDigest`（不呼叫 LLM）；否則投影 `CurationItemView[]`（`onBoard` 以 F4 `mentionsBoardRepo(candidate, boardRepoNames)` 判定；`domain` 以 `candidate.domain as NewsDomain3` 收窄，**MUST 附一行註解引用 F4 `CandidateSet` 輸出不變式 `domain !== 'cross'`**——信任已驗收上游契約、不另加執行期防衛過濾，I1 決策 B）→ **單次** `llm.generate(buildCurationPrompt(...))` → `parseCurationResponse` → `validateCuration` → 回 `{items, degraded:false}`（依賴 T011–T013、FR-001/002/020、SC-001；降級 try/catch 於 US2 補上）
- [X] T015 [US1] 建立 `CurationModule` 於 [src/curation/curation.module.ts](src/curation/curation.module.ts)：imports `LlmModule`、provide 並 export `NewsCurationService`；並於 [src/app.module.ts](src/app.module.ts) 註冊 `CurationModule`（依賴 T014；`BoardSummaryService` 於 US4 加入）

**Checkpoint**：US1 可獨立驗證——給定候選集即得 ≤6 則合規繁中精選、單次呼叫、空候選 0 次。

---

## Phase 4: User Story 2 - 策展失敗的降級備援：晨報永不因 LLM 中斷（Priority: P1）

**Goal**：策展的 LLM 呼叫或解析失敗時**不擲錯、不中止晨報**，退回純程式排序：沿用 F4 `weightedScore`
（`CandidateSet` 已排序，取前段）套同一配額，每則呈現原文標題＋連結、標 `degraded`；失敗以
`logger.warn` 記錄（含原因與候選規模、不含 prompt/回應全文），不無聲、不發 Discord。

**Independent Test**：以 mock `LlmService` 讓策展呼叫擲 `LlmError`（`exhausted`/`empty`）或回不可解析
內容，呼叫 `curate()`，斷言回傳 `degraded:true` 的精選集（`weightedScore` 前 6、尊重配額、原文標題＋
連結、`content:null`）、**未擲錯**、且 `logger.warn` 被呼叫。全程 mock。

### Tests for User Story 2 ⚠️（先寫、先失敗）

- [X] T016 [P] [US2] 降級精選測試於 [src/curation/curation-fallback.spec.ts](src/curation/curation-fallback.spec.ts)：`fallbackDigest(candidates)` 以 `weightedScore` 序（已排序候選取前段）套配額（非 AI ≤2、≤6）→ 每則 `title=原文標題`（**不套 50 字收斂**）、`content:null`、程式提供**全部事實欄位 `url/domain/sourceCount/weightedScore`**、`degraded:true`（U3、FR-012/013、Edge、SC-004）
- [X] T017 [US2] `curate()` **降級路徑**測試於 [src/curation/curation.service.spec.ts](src/curation/curation.service.spec.ts)：mock `llm.generate` 擲 `LlmError('exhausted')`、`LlmError('empty')`、以及回不可解析字串（`CurationParseError`）三態 → 皆回 `degraded:true` digest、**未擲錯**、`logger.warn` 被呼叫（以 spy 斷言，且訊息不含 prompt/回應全文）（FR-011/014、SC-004）

### Implementation for User Story 2

- [X] T018 [P] [US2] 實作 `fallbackDigest(candidates)` 於 [src/curation/curation-fallback.ts](src/curation/curation-fallback.ts)：沿用候選既有 `weightedScore` 序（不重寫排序公式）套 `clampNonAi`＋截 ≤6 → 映射為 `CuratedNewsItem`（原文標題不收斂、`content:null`、**附回全部程式事實欄位 `url=originalUrl`/`domain`（`as NewsDomain3`，同 T014 收窄）/`sourceCount=sources.length`/`weightedScore`**、`degraded:true`）（U3、依賴 T010、FR-012/013）
- [X] T019 [US2] 於 [src/curation/curation.service.ts](src/curation/curation.service.ts) 為 `curate()` 加降級包覆：`try { …成功路徑… } catch (err)` 捕捉 `LlmError`／`CurationParseError` → `logger.warn`（含失敗原因與候選規模、**不含** prompt/回應全文）→ 回 `fallbackDigest(candidates)`；空候選短路仍在 try 之前（依賴 T018、FR-011/014，**不發 Discord**——屬 F7）

**Checkpoint**：US1＋US2 皆可獨立驗證——成功得繁中精煉版、任一 LLM 失敗得降級原文版且晨報不中止。

---

## Phase 5: User Story 3 - 配額與字數以程式硬驗證：不信任 LLM 自律（Priority: P2）

**Goal**：以**故意違規**的 mock LLM 回應，證明 US1 建立的硬驗證管線（`validateCuration`）在對抗性輸入
下仍輸出恆合規精選集：超量截 ≤6、超長收斂 ≤50/≤300、幻覺項剔除、配額夾至非 AI ≤2、不遞補未改寫候選。

**Independent Test**：mock 回傳 7 則、某則標題 60 字/內容 400 字、含一個越界 `ref`（幻覺）、AI 僅 3 則
但塞 3 則非 AI，呼叫 `curate()`，斷言輸出總數 ≤6、超長收斂至 ≤50/≤300、幻覺項被剔除、非 AI 被夾至
≤2、夾制後不足 6 則照實輸出（不遞補）。全程 mock。

### Tests for User Story 3 ⚠️（對抗性違規回應）

- [X] T020 [US3] 護欄對抗性測試（截總數／超長收斂）於 [src/curation/curation-validate.spec.ts](src/curation/curation-validate.spec.ts)：mock 7 則 → 依重要性序截前 6；標題 60 字/內容 400 字 → 收斂至 ≤50/≤300（字以 code point 計）（FR-008、SC-002/003）
- [X] T021 [US3] 護欄對抗性測試（幻覺剔除／配額夾制）於 [src/curation/curation-validate.spec.ts](src/curation/curation-validate.spec.ts)：越界/無法對應 `ref` → 剔除；非 AI 3 則 → 依領域優先序夾至 ≤2；夾制後不足 6 → 照實輸出較少則數、**不從未改寫候選遞補**（FR-009/010、SC-003/005、SC-002）

### Implementation for User Story 3

- [X] T022 [US3] 依 T020/T021 若發現缺口，於 [src/curation/curation-validate.ts](src/curation/curation-validate.ts) 補強護欄邊界（如空 picks、全幻覺、單一 `ref` 多次交錯重複）使管線在對抗性輸入下恆合規；若 US1 的 `validateCuration` 已全數涵蓋則僅補測試、不改實作（FR-008/009/010）

**Checkpoint**：US1–US3 皆可獨立驗證——對任意（含違規）LLM 回應，外流精選集恆合規。

---

## Phase 6: User Story 4 - 榜單日「本次變化」TL;DR：一句話封面摘要（Priority: P3）

**Goal**：把榜單 diff 投影（計數＋領域分布）交給 `LlmService` 摘成一句繁中封面 TL;DR（重用 F5
`LlmService`、僅榜單日、獨立一次呼叫）；失敗退回程式產生的事實型摘要，不擲錯、不阻斷榜單推播、記錄失敗。

**Independent Test**：以一組 `BoardChangeDigest` 呼叫 `summarize()`，mock 回一句繁中摘要 → 斷言只依
diff 事實、不杜撰；再讓 `LlmService` 擲錯 → 回 `factSummary`（依計數）、`degraded:true`、未擲錯、
`logger.warn` 被呼叫；全 0 diff → 「無變化」摘要。全程 mock。

### Tests for User Story 4 ⚠️（先寫、先失敗）

- [ ] T023 [P] [US4] 事實型摘要測試於 [src/curation/board-summary-fallback.spec.ts](src/curation/board-summary-fallback.spec.ts)：`factSummary(digest)` → 「本週 N 個新進、M 個竄升、K 個下降」（計數為 0 的子句省略）；三者皆 0 → 「本週榜單無變化」；數字 100% 取自 `digest`（FR-016、SC-007、US4-3）
- [ ] T024 [P] [US4] `BoardSummaryService.summarize()` 測試於 [src/curation/board-summary.service.spec.ts](src/curation/board-summary.service.spec.ts)：mock 成功 → `degraded:false` 一句繁中；mock `LlmService` 擲 `LlmError` → 回 `factSummary`、`degraded:true`、**未擲錯**、`logger.warn` 被呼叫；全 0 diff → 「無變化」（contracts/board-summary §測試點、FR-015/016、SC-007）

### Implementation for User Story 4

- [ ] T025 [P] [US4] 實作 `factSummary(digest)` 於 [src/curation/board-summary-fallback.ts](src/curation/board-summary-fallback.ts)：依計數組事實句、含「無變化」情形，數字只取自 `digest`（FR-016、SC-007）
- [ ] T026 [P] [US4] 實作 `buildBoardSummaryPrompt(digest)` 於 [src/curation/board-summary-prompt.ts](src/curation/board-summary-prompt.ts)：要求一句繁中 TL;DR、只依提供的計數與領域分布、不杜撰未提供的數字/名稱（FR-015、憲章 VI）
- [ ] T027 [US4] 實作 `BoardSummaryService.summarize(digest)` 於 [src/curation/board-summary.service.ts](src/curation/board-summary.service.ts)：`@Injectable`、注入 `LlmService`；**單次** `llm.generate(buildBoardSummaryPrompt(...))` → `{summary, degraded:false}`；catch `LlmError` → `logger.warn`（不含 prompt/回應全文）→ 回 `{summary: factSummary(digest), degraded:true}`，不擲錯（依賴 T025/T026、FR-015/016/017、SC-007）
- [ ] T028 [US4] 於 [src/curation/curation.module.ts](src/curation/curation.module.ts) 追加 provide 並 export `BoardSummaryService`（與 `NewsCurationService` 同模組、共用注入的 `LlmModule`）（依賴 T027、FR-018）

**Checkpoint**：US1–US4 皆可獨立驗證——榜單日封面得繁中 TL;DR，LLM 失敗仍得事實型摘要且推播不中止。

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**：全套驗證與憲章邊界複查。

- [ ] T029 全套建置與測試：`npm run build`（tsc strict 零 error、無 `any` 逃逸）與 `npm test` 全綠（含 F1–F5 未回歸）
- [ ] T030 執行 [quickstart.md](specs/006-news-curation/quickstart.md) 的 US1–US4＋Edge 驗收情境，逐項對照契約/憲章/SC 速查表確認通過
- [ ] T031 憲章邊界複查（grep `src/curation/`）：確認**無** `StateStore`/`.save(`/`seenNews`/`commit`/Discord/`webhook` 呼叫、**無**新增 npm 依賴、**未改動** F4/F5 既有檔案（只 import）（FR-019、plan Structure Decision）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup（Phase 1）**：無相依，可立即開始。
- **Foundational（Phase 2）**：依賴 Setup；**阻塞所有 User Story**（型別契約）。
- **User Stories（Phase 3–6）**：皆依賴 Foundational 完成。
  - US1（P1）為 MVP，建立完整成功路徑＋硬驗證管線＋共用純函式（length/quota/parse/validate）。
  - US2（P1）依賴 US1 的 `curate()` 與 `curation-quota`（降級套同一配額）。
  - US3（P2）依賴 US1 的 `validateCuration`（以對抗性輸入驗證同一管線）。
  - US4（P3）僅依賴 Foundational 型別與 F5 `LlmService`，**與 US1–US3 資料流獨立**，可與其並行。
- **Polish（Phase 7）**：依賴所有欲交付的 User Story 完成。

### User Story Dependencies

- **US1**：Foundational 後即可開始，不依賴其他 story。
- **US2**：需 US1 的 `curate()`（加降級包覆）與 `curation-quota`/`curation-length`（fallback 套配額）。
- **US3**：需 US1 的 `curation-validate`（新增對抗性測試、必要時補強邊界）。
- **US4**：僅需 Foundational；與 US1–US3 獨立（吃榜單 diff、不吃新聞候選）。

### Within Each User Story

- 測試（憲章 VIII 必測）先寫、先失敗，再實作。
- 純函式（length/quota/parse/prompt/fallback）先於服務；服務先於模組註冊。
- 同檔案任務不可並行（如 US1/US2 皆改 `curation.service.ts`、US1/US3 皆改 `curation-validate.spec.ts`）。

### Parallel Opportunities

- Foundational 兩型別檔 T002/T003 可並行。
- US1 純函式測試 T004–T007（不同檔案）可並行；純函式實作 T009–T012（不同檔案）可並行。
- US4 全部 T023–T027（board-summary 各檔）可與 US1–US3 並行開發。
- 跨 story：US4 可與 US1/US2/US3 由不同人並行。

---

## Parallel Example: User Story 1

```bash
# 先並行寫測試（不同檔案）：
Task: "clampToLimit/countCodePoints 測試 in src/curation/curation-length.spec.ts"
Task: "配額工具測試 in src/curation/curation-quota.spec.ts"
Task: "解析測試 in src/curation/curation-parse.spec.ts"
Task: "硬驗證管線測試 in src/curation/curation-validate.spec.ts"

# 再並行實作純函式（不同檔案）：
Task: "clampToLimit/countCodePoints in src/curation/curation-length.ts"
Task: "配額常數與 clampNonAi in src/curation/curation-quota.ts"
Task: "stripJsonFence/parseCurationResponse in src/curation/curation-parse.ts"
Task: "buildCurationPrompt in src/curation/curation-prompt.ts"
```

---

## Implementation Strategy

### MVP First（僅 User Story 1）

1. 完成 Phase 1 Setup。
2. 完成 Phase 2 Foundational（型別契約，阻塞所有 story）。
3. 完成 Phase 3 US1：候選集 → 合規繁中精選（單次呼叫、空候選短路、硬驗證恆合規）。
4. **STOP and VALIDATE**：以 mock 獨立驗證 US1（含 SC-001/002/003/005/006）。
5. 此時即為可展示的最小可用產出：給候選集就得一份可貼 Discord 的繁中精選集。

### Incremental Delivery

1. Setup ＋ Foundational → 型別就緒。
2. ＋US1 → 獨立驗證 → MVP（合規繁中精選）。
3. ＋US2 → 獨立驗證 → 降級備援（晨報永不因 LLM 中斷）。
4. ＋US3 → 獨立驗證 → 對抗性硬驗證（恆合規保證）。
5. ＋US4 → 獨立驗證 → 榜單日封面 TL;DR（含事實型降級）。
6. 每個 story 各自加值、不破壞前面 story。

---

## Notes

- [P] 任務＝不同檔案、無未完成相依。
- [Story] 標籤把任務對回 spec User Story，利於追溯。
- 每個 User Story 皆應可獨立完成與測試。
- 實作前先確認測試失敗（憲章 VIII）。
- **分段 commit（`/speckit-implement` 期間 MUST）**：每完成一個 Phase 或 User Story 的實作＋測試即建立
  一個 commit，標 `feat/test/refactor(006-news-curation): …`，該段 `tasks.md` 勾選併入同一 commit。
- 邊界紅線：F6 **不** `StateStore.save()`／**不**寫 `seenNews`／**不** git commit／**不**發 Discord／
  **不**自行抓榜單或新聞來源（皆屬 F7）；**不**改動 F4/F5 既有檔案（只 import）。
