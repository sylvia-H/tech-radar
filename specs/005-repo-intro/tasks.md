---
description: "Task list for F5 — LLM 封裝與 repo 250 字簡介"
---

# Tasks: LLM 封裝與 repo 250 字簡介（LLM Wrapper & Repo Intro）

**Input**: Design documents from `specs/005-repo-intro/`

**Prerequisites**: plan.md ✅、spec.md ✅、research.md ✅、data-model.md ✅、contracts/（llm-service / intro-service / github-readme）✅

**Tests**: 本 Feature **含測試任務**——憲章 VIII 明列「簡介快取命中、250 收斂、README 去雜訊／截斷／
極短退回、429 退避與耗盡降級」須有單元測試方可視為完成；plan 與 quickstart 皆以 `*.spec.ts` 為主驗證。

**Organization**: 依 spec 的 4 個 User Story（US1/US2 為 P1，US3/US4 為 P2）分階段，各階段可獨立實作與測試。

## Format: `[ID] [P?] [Story] Description`

- **[P]**：可並行（不同檔案、無未完成相依）
- **[Story]**：US1 / US2 / US3 / US4（對應 spec User Story）
- 每個任務標明確切檔案路徑

## Path Conventions

單一專案 CLI，沿用現有 `src/<module>/` 佈局；`*.spec.ts` 與原始碼並置（非集中 tests/）。

---

## Phase 1: Setup（共用前置）

**Purpose**：安裝新相依、確認基線可建置。

- [ ] T001 安裝 `@google/genai` 相依：於 repo 根執行 `npm install @google/genai`（憲章技術釘死清單內；更新 package.json / package-lock.json）
- [ ] T002 確認基線：執行 `npm run build`（tsc strict 零 error）與 `npm test`（現有全綠），確保在既有基礎上疊加

---

## Phase 2: Foundational（阻塞所有 User Story 的前置）

**Purpose**：型別與常數契約——LlmService / IntroService 及其純函式皆依賴這兩個型別檔。

**⚠️ CRITICAL**：本階段完成前，任何 User Story 皆無法動工。

- [ ] T003 [P] 定義 LLM 側型別與常數於 [src/llm/llm.types.ts](src/llm/llm.types.ts)：`LlmError`（`name: 'LlmError'`、`reason: 'exhausted' | 'empty' | 'error'`）與具名常數 `GEMINI_MODEL = 'gemini-2.5-flash'`、`LLM_MAX_RETRIES = 4`、`LLM_BACKOFF_BASE_MS = 1000`、`LLM_MAX_BACKOFF_MS = 8000`（contracts/llm-service.md、research D5/D6）
- [ ] T004 [P] 定義簡介側型別與常數於 [src/intro/intro.types.ts](src/intro/intro.types.ts)：`IntroInput`（`repoId / fullName / description / language / topics / starsThisWeek`）、`IntroResult` discriminated union（`cached | generated | degraded`）、常數 `MAX_INTRO_CHARS = 250`、`MAX_README_CHARS = 6000`、`MIN_README_CHARS = 200`（data-model §1/§2、contracts/intro-service.md）

**Checkpoint**：型別契約就緒——各 User Story 可開始。

---

## Phase 3: User Story 1 - 新進榜 repo 的一次性繁中簡介（Priority: P1）🎯 MVP

**Goal**：快取未命中時，取 README → 去雜訊截斷 → 組 prompt → LLM 生成 → 收斂 ≤250 繁中 → 就地寫入 `state.intros`，回 `generated`。

**Independent Test**：以具代表性 README（快取未命中）的 repo 呼叫 `ensureIntro`，回傳 ≤250 字繁中、忠於 README（無杜撰數字/連結）、且 `state.intros[String(repoId)]` 已寫入含 `introAt`；README 與 LLM 全 mock、不連網。

### Tests for User Story 1 ⚠️（先寫、先失敗）

- [ ] T005 [P] [US1] `fetchReadme` 測試於 [src/github/github-readme.spec.ts](src/github/github-readme.spec.ts)：mock `GithubHttpService.getJson` 回 `{ content: base64(md), encoding: 'base64' }` → 斷言解碼正確（contracts/github-readme.md 測試契約）
- [ ] T006 [P] [US1] `stripMarkdownNoise` 測試於 [src/intro/markdown-noise.spec.ts](src/intro/markdown-noise.spec.ts)：斷言去除 HTML 註解／標籤、badge 與圖片 `![](...)`、連結收斂為顯示文字、程式碼圍欄、收斂多餘空白；保留標題與內文（research D10、FR-003）
- [ ] T007 [P] [US1] `clampTo250` / `countCodePoints` 測試於 [src/intro/intro-length.spec.ts](src/intro/intro-length.spec.ts)：以 code point 計數（surrogate pair/emoji 正確）；>250 於自然邊界（句號/問號/驚嘆號/換行）截斷加「…」，無邊界硬截 249+「…」（research D4、FR-006、SC-002）
- [ ] T008 [US1] IntroService 生成路徑測試於 [src/intro/intro.service.spec.ts](src/intro/intro.service.spec.ts)：快取未命中 + README 可取，mock LlmService/fetchReadme/`now` → 斷言回 `generated`、`intro` ≤250、`state.intros[key] = { intro, introAt }` 已寫入（contracts/intro-service.md、SC-002/FR-004）

### Implementation for User Story 1

- [ ] T009 [P] [US1] 實作 `fetchReadme(http, owner, name)` 於 [src/github/github-readme.ts](src/github/github-readme.ts)：`getJson<ReadmeEnvelope>('.../repos/{owner}/{name}/readme')` → `Buffer.from(content,'base64').toString('utf-8')`；404／其他 `GithubHttpError`／網路錯誤／`encoding !== 'base64'` 一律 catch 回 `''`（FR-010、research D1）
- [ ] T010 [P] [US1] 實作純函式 `stripMarkdownNoise(readme)` 於 [src/intro/markdown-noise.ts](src/intro/markdown-noise.ts)：正則管線移除/收斂 HTML 註解、HTML 標籤、圖片/badge、連結→顯示文字、程式碼圍欄、多餘空白（research D10）
- [ ] T011 [P] [US1] 實作純函式 `countCodePoints` 與 `clampTo250` 於 [src/intro/intro-length.ts](src/intro/intro-length.ts)：`[...str].length` 計數、超長截斷收斂加省略號、不重呼叫 LLM（research D4、FR-006）
- [ ] T012 [P] [US1] 實作純函式 `introPrompt(input, material)` 於 [src/intro/intro-prompt.ts](src/intro/intro-prompt.ts)：組出「繁體中文、≤250 字、結構為解決什麼→特色→適合誰、只依素材、不杜撰數字/名次/連結」的 prompt；事實數據（starsThisWeek/fullName）僅作語境不要求 LLM 產生（FR-007、contracts/intro-service.md 防幻覺契約）
- [ ] T013 [US1] 實作 `buildMaterial(input, readme)` 之 **README 分支** 於 [src/intro/intro-material.ts](src/intro/intro-material.ts)：`stripMarkdownNoise` 後 code points ≥ `MIN_README_CHARS` → `{ text: 截斷至 MAX_README_CHARS, source: 'readme', sparse: false }`（依賴 T010；fallback 分支於 US3 補上，FR-003）
- [ ] T014 [US1] 實作 `LlmService.generate(prompt)` **happy-path** 於 [src/llm/llm.service.ts](src/llm/llm.service.ts)：`@Injectable`、以 `ConfigService.get('GEMINI_API_KEY')` 建 `new GoogleGenAI(...)`、`generateContent({ model: GEMINI_MODEL, contents: prompt })` 取 `response.text`（trim）；空 prompt／空回應 → 擲 `LlmError('empty')`；不記錄 prompt/回應全文（依賴 T003；退避重試於 US4 補上，contracts/llm-service.md、FR-013）
- [ ] T015 [US1] 建立 `LlmModule` 於 [src/llm/llm.module.ts](src/llm/llm.module.ts)：provide 並 export `LlmService`（ConfigModule 為全域，直接注入 ConfigService）（依賴 T014、FR-011）
- [ ] T016 [US1] 實作 `IntroService.ensureIntro(input, state, now?)` **生成路徑** 於 [src/intro/intro.service.ts](src/intro/intro.service.ts)：拆 `fullName` 取 owner/name → `fetchReadme` → `buildMaterial` → `introPrompt` → `llm.generate` → `clampTo250` → 就地寫 `state.intros[String(repoId)] = { intro, introAt: now().toISOString() }` → 回 `{ status: 'generated', ... }`；**不呼叫 StateStore.save()**（依賴 T009–T014、research D9、FR-004）
- [ ] T017 [US1] 建立 `IntroModule` 於 [src/intro/intro.module.ts](src/intro/intro.module.ts)（imports `LlmModule`、provide `GithubHttpService` 與 `IntroService`）並於 [src/app.module.ts](src/app.module.ts) 註冊 `IntroModule`（依賴 T015、T016）

**Checkpoint**：US1 可獨立驗證——給定未快取 repo 即得可貼卡片的 ≤250 繁中簡介並寫入 state。

---

## Phase 4: User Story 2 - 簡介必快取：一生只生成一次（Priority: P1）

**Goal**：`ensureIntro` 進入時先查快取；命中（存在且 intro 非空）直接回 `cached`，**不呼叫 LLM、不取 README**；掉出後重進榜仍命中、不重生成。

**Independent Test**：預置 `state.intros[key]` 呼叫 `ensureIntro`，斷言回 `cached` 且 LlmService/fetchReadme 呼叫次數 = 0；再模擬掉出後重進榜仍命中；空字串快取不算命中。

### Tests for User Story 2 ⚠️

- [ ] T018 [US2] 於 [src/intro/intro.service.spec.ts](src/intro/intro.service.spec.ts) 新增快取命中測試：預置 `state.intros[key]` → 回 `cached`、**斷言 `llm.generate` 與 `fetchReadme` 呼叫次數 = 0**（SC-001/FR-002）；掉出後重進榜仍 `cached`、0 次重生成（SC-006/FR-005）；`intro === ''` 視為未命中並重新生成（Edge Case）

### Implementation for User Story 2

- [ ] T019 [US2] 於 [src/intro/intro.service.ts](src/intro/intro.service.ts) `ensureIntro` 最前端加入快取短路守衛：`state.intros[String(input.repoId)]?.intro` 非空 → 立即回 `{ status: 'cached', intro }`，在任何 README/LLM 呼叫之前（FR-002、依賴 T016）

**Checkpoint**：US1＋US2 皆可獨立運作——未命中生成、命中零呼叫。

---

## Phase 5: User Story 3 - 無 README 或內容過少時的保守簡介（Priority: P2）

**Goal**：README 取不到／空／去雜訊後 < `MIN_README_CHARS` → 退回以 description + topics 為素材；素材近乎空時標記 `sparse`，prompt 末要求標「（資訊有限）」；仍 ≤250 繁中、不杜撰。

**Independent Test**：以「README 取不到」與「README 極短（<200）」兩情境呼叫，斷言 `buildMaterial` 走 fallback、簡介仍 ≤250 繁中、資訊明顯不足時帶「資訊有限」標註；全程 mock。

### Tests for User Story 3 ⚠️

- [ ] T020 [P] [US3] `buildMaterial` fallback/sparse 測試於 [src/intro/intro-material.spec.ts](src/intro/intro-material.spec.ts)：README 空／去雜訊後 <200 → `source='fallback'`、`text` 由 description+topics 組成；description 與 topics 近乎空 → `sparse=true`（FR-008、US3、research D3）
- [ ] T021 [US3] 於 [src/intro/intro.service.spec.ts](src/intro/intro.service.spec.ts) 新增退回路徑測試：README 取不到／極短 → 仍回 `generated`、`intro` ≤250 繁中（US3、SC-002）

### Implementation for User Story 3

- [ ] T022 [US3] 於 [src/intro/intro-material.ts](src/intro/intro-material.ts) 補上 `buildMaterial` **fallback 分支**：去雜訊後 code points < `MIN_README_CHARS`（含空）→ `source='fallback'`、`text` = description + topics 拼接；description/topics 皆近乎空 → `sparse=true`（依賴 T013、FR-008、US3-3 最小可用）
- [ ] T023 [US3] 於 [src/intro/intro-prompt.ts](src/intro/intro-prompt.ts) 擴充 `introPrompt`：當 `material.sparse` 為真時，於指示加入「末尾標註（資訊有限）」（依賴 T012、FR-009）

**Checkpoint**：US1–US3 皆可獨立運作——素材不足的 repo 仍得保守可用簡介。

---

## Phase 6: User Story 4 - LLM 容錯與退避：單筆失敗不阻斷整批（Priority: P2）

**Goal**：LlmService 遇 429/503/網路錯誤以指數退避 + jitter 重試至 `LLM_MAX_RETRIES`，耗盡擲 `LlmError('exhausted')`；400/401/403 不重試擲 `LlmError('error')`。IntroService 對任何生成失敗降級為 `degraded`＋description、warn 記錄、**不寫快取**、不阻斷其餘 repo。

**Independent Test**：mock LLM 首次 429 隨後成功 → 斷言退避後回正常；持續 429 → 耗盡擲 `LlmError` 且重試次數 = `LLM_MAX_RETRIES`；某 repo 持續失敗 → 該筆 `degraded`、未寫快取、其餘照常。

### Tests for User Story 4 ⚠️

- [ ] T024 [US4] `LlmService` 退避測試於 [src/llm/llm.service.spec.ts](src/llm/llm.service.spec.ts)：注入 mock `@google/genai` 客戶端與 `sleep`；首次 429→成功（斷言有退避、回正常文字，SC-007）；持續 429→擲 `LlmError('exhausted')`、重試次數 = `LLM_MAX_RETRIES`；503/網路錯誤→重試；空回應→`LlmError('empty')`；400/403→不重試、`LlmError('error')`（contracts/llm-service.md、FR-012）
- [ ] T025 [US4] 於 [src/intro/intro.service.spec.ts](src/intro/intro.service.spec.ts) 新增降級測試：LlmService 持續失敗 → 回 `{ status: 'degraded', description }`、**`state.intros` 未新增鍵**、`logger.warn` 有呼叫、**`ensureIntro` 不擲錯**（呼叫端得以續跑其餘 repo；批次層非中斷屬 F7 範圍、不在 F5 單測驗證）（SC-004、FR-014/015/016）

### Implementation for User Story 4

- [ ] T026 [US4] 於 [src/llm/llm.service.ts](src/llm/llm.service.ts) 加入重試迴圈：可注入 `sleep(ms)`；`base × 2^(attempt-1) + random[0, base)` 上限 `LLM_MAX_BACKOFF_MS`；429/503/網路錯誤重試至 `LLM_MAX_RETRIES` → `LlmError('exhausted')`；400/401/403 → `LlmError('error')` 不重試（依賴 T014、research D6、FR-012）
- [ ] T027 [US4] 於 [src/intro/intro.service.ts](src/intro/intro.service.ts) 以 try-catch 包裹生成流程：任一失敗（`LlmError`、空/無效回應）→ `logger.warn`（含 repoId/fullName、**不含 prompt 全文**）→ 回 `{ status: 'degraded', description: input.description }`、**不寫 state.intros**、不擲錯（依賴 T016、FR-014/015/016、research D8）

**Checkpoint**：全部 4 個 User Story 皆可獨立運作——退避重試與單筆降級隔離就位。

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**：最終整合驗證（對照 quickstart 與 SC-001…SC-007）。

- [ ] T028 [P] 執行 `npm run build`（tsc strict 零 error，避免 `any` 逃逸）
- [ ] T029 執行 `npm test`（全綠）；重點確認快取命中測試以 mock 斷言呼叫次數 0（額度安全核心護欄）
- [ ] T030 依 [specs/005-repo-intro/quickstart.md](specs/005-repo-intro/quickstart.md) 對照表逐項驗證測試→SC/FR 覆蓋齊全（可選：具 `GEMINI_API_KEY`/`GH_API_TOKEN` 的本機做一次性真實生成人工抽驗品質，不納入 CI、不推播、不寫入 repo 內 state）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup（Phase 1）**：無相依，可立即開始。
- **Foundational（Phase 2）**：依賴 Setup；**阻塞所有 User Story**。
- **User Stories（Phase 3–6）**：皆依賴 Foundational 完成。
  - US1（P1）為 MVP，須先完成——US2 的守衛、US3 的 fallback、US4 的降級皆疊加於 US1 建立的 `intro.service.ts` / `intro-material.ts` / `intro-prompt.ts` / `llm.service.ts`。
  - US2 依賴 T016（IntroService 生成路徑已存在）；US3 依賴 T012/T013；US4 依賴 T014/T016。
- **Polish（Phase 7）**：依賴所有欲交付的 User Story 完成。

### User Story Dependencies

- **US1（P1）**：Foundational 後即可開始，MVP，無跨 story 相依。
- **US2（P1）**：於 US1 的 `intro.service.ts` 加前置守衛（T019 依賴 T016）。
- **US3（P2）**：擴充 US1 的 `intro-material.ts`（T022 依賴 T013）與 `intro-prompt.ts`（T023 依賴 T012）。
- **US4（P2）**：擴充 US1 的 `llm.service.ts`（T026 依賴 T014）與 `intro.service.ts`（T027 依賴 T016）。

### Within Each User Story

- 測試先寫、先失敗，再實作。
- 純函式（markdown-noise / intro-length / intro-prompt）先於使用它們的 `buildMaterial` / `IntroService`。
- `LlmService` 先於 `LlmModule`；服務齊備後再做 `IntroModule` 與 app.module 註冊。

### Parallel Opportunities

- T003、T004（兩個型別檔）可並行。
- US1 測試 T005、T006、T007 可並行（不同檔）；T008 需 IntroService 型別。
- US1 實作 T009、T010、T011、T012 可並行（各自獨立檔）；T013 依賴 T010、T016 依賴 T009–T014。
- 跨 story 的純函式測試 T020 可與其他 P 任務並行。

---

## Parallel Example: User Story 1

```bash
# US1 測試（先寫先失敗）並行：
Task: "fetchReadme 測試 in src/github/github-readme.spec.ts"
Task: "stripMarkdownNoise 測試 in src/intro/markdown-noise.spec.ts"
Task: "clampTo250 測試 in src/intro/intro-length.spec.ts"

# US1 純函式實作並行：
Task: "fetchReadme in src/github/github-readme.ts"
Task: "stripMarkdownNoise in src/intro/markdown-noise.ts"
Task: "countCodePoints/clampTo250 in src/intro/intro-length.ts"
Task: "introPrompt in src/intro/intro-prompt.ts"
```

---

## Implementation Strategy

### MVP First（僅 User Story 1）

1. 完成 Phase 1 Setup。
2. 完成 Phase 2 Foundational（阻塞所有 story）。
3. 完成 Phase 3 US1。
4. **STOP & VALIDATE**：獨立驗證 US1（未命中 → ≤250 繁中簡介並寫入 state）。

### Incremental Delivery

1. Setup + Foundational → 基礎就緒。
2. US1 → 獨立驗證 → MVP（可貼卡片的簡介）。
3. US2 → 快取命中零呼叫（額度護欄）。
4. US3 → 素材不足退回 description+topics。
5. US4 → 429 退避與單筆降級隔離。
6. 每個 story 疊加價值且不破壞前一個。

### 分段 commit 建議（依 CLAUDE.md）

- 各段標 `feat(005-repo-intro): …`（測試段可標 `test(005-repo-intro): …`、建置段 `build(005-repo-intro): …`），同段 tasks.md 勾選併入該段 commit；開發全程於 `005-repo-intro` branch、不在 `develop` 直接 commit。

---

## Notes

- [P] = 不同檔、無相依。
- 每個 User Story 應可獨立完成並測試。
- 實作前確認測試會失敗。
- F5 **不做**榜單 diff、不組版、不推播、不 commit、不呼叫 `StateStore.save()`（屬 F3/F7）。
- 秘密永不入庫（`GEMINI_API_KEY` 只從 env 讀）；不新增機密、不新增狀態欄位、不引入 embeddings/向量檢索。
