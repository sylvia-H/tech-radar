# Implementation Plan: LLM 封裝與 repo 250 字簡介（LLM Wrapper & Repo Intro）

**Branch**: `005-repo-intro` | **Date**: 2026-07-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-repo-intro/spec.md`

## Summary

F5 交付簡介資料流與其底層 LLM 封裝，共三塊：

1. **LlmService（通用 LLM 封裝）**：所有 LLM 呼叫的唯一入口，以 `@google/genai` 對 Gemini
   免費層 Flash 系（`gemini-2.5-flash`）發 `generateContent`，內建 **429 指數退避 + jitter** 重試
   與失敗容錯；只送公開資料。F6 新聞策展 MUST 重用此封裝。
2. **README 取得**：沿用 F1 的 `GithubHttpService`（不另建請求層，FR-010），以
   `GET /repos/{o}/{r}/readme` 取回 base64 內容並解碼；取不到／404 即回空、走退回素材。
3. **IntroService（簡介服務）**：`ensureIntro(input, state)`——先查 `state.intros[repoId]` 快取
   （命中即回、不呼叫 LLM 亦不取 README）；未命中才取 README → `stripMarkdownNoise` 去雜訊並截斷
   → 組 prompt → LlmService 生成 → 驗長並收斂至 ≤250 字 → 就地寫入 `state.intros`。README 不足
   （取不到／空／去雜訊後 < 門檻）退回 description + topics；單筆失敗**降級**為 description、warn
   記錄、**不寫快取**、不阻斷整批。

技術取向：延續現有 NestJS DI + 純函式抽出（利於憲章 VIII 單測）+ zod／型別邊界的慣例。新增
`@google/genai` 相依（憲章技術釘死清單內）；**不新增機密**（`GEMINI_API_KEY` 已於 F1 `env.schema`
驗證）、**不新增狀態欄位**（`state.intros` 與 `introCacheSchema` 已於 F1 建立）。F5 只提供「給定
repo → 快取或生成的簡介」，**不做榜單 diff、不組版、不推播、不 commit**（屬 F3/F7）；持久化由
呼叫端（F7）於推播成功後經 `StateStore.save()` 落檔。

## Technical Context

**Language/Version**: TypeScript 5.7（strict）/ Node.js 24 / CommonJS module

**Primary Dependencies**: NestJS 11（`createApplicationContext` 一次性 CLI）、**`@google/genai`（新增；
Gemini Flash 系 `generateContent`）**、既有 `GithubHttpService`（README 取得，帶 UA／退避／認證）。
不使用 `cheerio`（README 去雜訊以純函式正則處理，不需 DOM 解析）、不使用 `rss-parser`。

**Storage**: 唯一權威狀態 `state/board.json`，只經 `StateStore` 存取。本 Feature **就地寫入記憶體中
的** `state.intros[repoId] = { intro, introAt }`（`introCacheSchema` 已於 F1 建立），**不自行呼叫
`StateStore.save()`**（持久化由 F7 於推播成功後落檔，憲章 VI）。不新增狀態欄位、不建平行狀態。

**Testing**: Jest + ts-jest。README 取得對 `GithubHttpService.getJson` 以 mock 測；LlmService 對
`@google/genai` 客戶端注入 mock（斷言 429 退避重試、成功、耗盡失敗）；IntroService 對 LlmService 與
README 取得注入 mock，斷言**快取命中路徑呼叫次數為 0**、生成路徑寫入 state、降級不寫快取。所有退避
以可注入的 `sleep` 或 fake timers 驅動，時間戳以注入的 `now` 驅動，不依賴真實時間／網路。

**Target Platform**: GitHub Actions 排程 runner（Linux）跑一次性 CLI，跑完即退。

**Project Type**: 單一專案 CLI（非 web／mobile）；沿用現有 `src/<module>/` 佈局。

**Performance Goals**: 無硬性延遲目標。LLM 用量為要害：快取命中 0 呼叫；冷啟動 ≤10 新進 → ≤10 次
呼叫（SC-003），遠低於 ~1,500 RPD 免費上限。README 截斷 6,000 code points 控 token。

**Constraints**: 節制 LLM（憲章 V）：每 repo 一生一次、禁 embeddings／向量檢索；只送公開資料
（憲章 I/VII）；輸出 100% 繁中且 ≤250 字（SC-002）；LLM 不產生事實數據（星數／連結／名次，
憲章 VI）；單筆失敗不阻斷整批、不無聲（憲章 VII）。

**Scale/Scope**: 單次執行處理 0～10 個「需簡介」的 repo（新進＋竄升）；穩定態每七天 0～數個。

> 無殘留 NEEDS CLARIFICATION：spec Clarifications Session 2026-07-18 已定輸入契約（呼叫端傳入
> metadata）、降級回傳形態（可區別結果物件）、README 極短門檻（去雜訊後字元數 < ~200）；本 plan
> 於 research.md 釘定其餘數值（README 上限 6,000、429 退避參數、250 收斂手段、Gemini 型號）。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原則 | 本 Feature 相關約束 | 判定 |
|------|--------------------|------|
| I. 零維運免費基礎設施 | 只用 Gemini 免費層 Flash（`gemini-2.5-flash`）+ 既有 GitHub API；無常駐、無付費；每 repo 一生一次呼叫、冷啟動 ≤10 次，遠低於 ~1,500 RPD | ✅ PASS |
| II. 不自存星星歷史 | 不涉星星時序；`starsThisWeek` 僅由呼叫端轉遞作 prompt 語境，不快照 | ✅ N/A |
| III. 只推變化、控制節奏 | F5 不推播；落實 repo 簡介 **≤250 字繁中**（FR-006/007、SC-002）；「哪些 repo 需簡介」由 F3/F7 決定 | ✅ PASS |
| IV. 新聞來源設定即資料 | 不涉新聞來源；不動 pipeline 設定 | ✅ N/A |
| V. 去重確實且節制 LLM | 快取命中 0 呼叫（FR-002/005、SC-001/006）；**MUST NOT 引入 embeddings／向量檢索**；每 repo 一生一次 | ✅ PASS |
| VI. 冪等、快取、單一狀態 | 簡介一生一次、快取獨立於榜單快照、跌出榜不清除（FR-004/005）；只經 `state.intros`、不建平行狀態；生成失敗**不寫空快取**（FR-016）；**LLM 不產生事實數據**（FR-007）；持久化由 F7 推播成功後才 save | ✅ PASS |
| VII. 機密隔離與容錯 | `GEMINI_API_KEY` 只從 env 讀、不入庫不入產物；只送公開 README/metadata（FR-013）；單筆簡介失敗降級為 description、warn 記錄不無聲、不阻斷整批（FR-014/015） | ✅ PASS |
| VIII. 關鍵邏輯測試優先 | 簡介快取命中、250 字上限收斂、README 去雜訊／截斷／極短退回、429 退避重試與耗盡降級——皆純函式或可注入 mock 單測；外部 LLM 以 mock 測、另測降級路徑 | ✅ PASS |

**結論**：無違反非協商原則，Complexity Tracking 無需填寫。設計刻意最小化——沿用既有
`GithubHttpService`（不另建請求層）、既有 `state.intros` schema（不新增狀態）、既有 `GEMINI_API_KEY`
（不新增機密）；LLM 呼叫收斂為單一封裝，退避／收斂／去雜訊全為純函式。

**Phase 1 後重新檢查（GATE re-check）**：設計產出（research／data-model／contracts）未新增任何違反
——新增相依僅 `@google/genai`（憲章技術釘死清單內）、無新機密、無新狀態欄位、無 embeddings／向量
檢索、快取命中 0 呼叫與降級不寫快取皆落實、事實數據不經 LLM。✅ 通過，可進入 `/speckit-tasks`。

## Project Structure

### Documentation (this feature)

```text
specs/005-repo-intro/
├── plan.md              # 本檔（/speckit-plan 輸出）
├── research.md          # Phase 0：技術決策（README 取得、去雜訊、6000 截斷、200 門檻、250 收斂、Gemini 封裝、退避參數）
├── data-model.md        # Phase 1：IntroInput / IntroResult / IntroCache / ReadmeEnvelope 實體
├── quickstart.md        # Phase 1：驗證情境（對照 SC-001…SC-007）
├── contracts/           # Phase 1：LlmService／IntroService／README 取得 介面契約
│   ├── llm-service.md
│   ├── intro-service.md
│   └── github-readme.md
└── tasks.md             # /speckit-tasks 產生（本指令不建立）
```

### Source Code (repository root)

```text
src/
├── github/
│   └── github-readme.ts        # 【新增】fetchReadme(http, owner, name)：GET /repos/{o}/{r}/readme → base64 解碼；404/取不到回 ''（用既有 GithubHttpService.getJson，FR-010）
├── llm/                        # 【新增模組】通用 LLM 封裝（F6 重用）
│   ├── llm.module.ts           #   provide LlmService（imports ConfigModule 全域）
│   ├── llm.types.ts            #   LlmError / 退避參數常數型別
│   └── llm.service.ts          #   @Injectable：@google/genai 客戶端 + generate(prompt) + 429 指數退避+jitter + 只送公開資料
├── intro/                      # 【新增模組】repo 簡介資料流
│   ├── intro.module.ts         #   imports LlmModule + GithubHttpService；provide IntroService
│   ├── intro.types.ts          #   IntroInput / IntroResult（discriminated union）型別
│   ├── markdown-noise.ts       #   純函式：stripMarkdownNoise（去 badge/圖片/HTML/comment/多餘空白）
│   ├── intro-material.ts       #   純函式：buildMaterial（README 去雜訊→截斷 6000；不足退回 description+topics；極短門檻 200）
│   ├── intro-prompt.ts         #   純函式：introPrompt(repo, material)（繁中/≤250/結構/不杜撰約束）
│   ├── intro-length.ts         #   純函式：countCodePoints + clampTo250（自然邊界+省略號）
│   ├── intro.service.ts        #   @Injectable 編排：查快取→取README→組素材→LLM→驗長收斂→寫 state.intros；失敗降級
│   ├── markdown-noise.spec.ts
│   ├── intro-material.spec.ts
│   ├── intro-length.spec.ts
│   └── intro.service.spec.ts
└── (既有：state/ github/github-http.ts config/ discord/ board/ diff/ …不動)

llm/llm.service.spec.ts、github/github-readme.spec.ts 與原始碼並置（沿用現有慣例，非集中 tests/ 目錄）
```

**Structure Decision**：沿用現有「一模組一資料夾 + 純函式抽出 + `*.spec.ts` 並置」慣例。**LlmService
自成 `src/llm/` 通用模組**（非塞進 `intro/`）——因它是 F5 簡介與 F6 新聞策展的**共用入口**（FR-011），
獨立模組讓 F6 直接 import 而不依賴 intro。**README 取得放 `src/github/github-readme.ts`**——它是既有
`GithubHttpService` 的薄包裝（複用退避／UA／認證，FR-010），歸屬 github 模組而非 intro。簡介的組素材／
去雜訊／收斂全抽為 `src/intro/` 下純函式，`IntroService` 只做編排與 state 寫入，最大化憲章 VIII 的可測面。

## Complexity Tracking

> 無 Constitution 違反，本表不需填寫。
