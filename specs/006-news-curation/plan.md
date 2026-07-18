# Implementation Plan: 每日晨報單次 LLM 策展與降級備援（News Curation & Graceful Fallback）

**Branch**: `006-news-curation` | **Date**: 2026-07-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-news-curation/spec.md`

## Summary

F6 建立新聞資料流的後半段（階段 B）＋榜單日封面摘要，交付三塊能力，皆為**單次執行的記憶體純函式／服務**，不落檔、不推播、不寫 `seenNews`（交 F7）：

1. **每日單次策展** `NewsCurationService.curate()`——把 F4 的 `CandidateSet` 投影為公開脈絡視圖，以**單一** `LlmService.generate()` 呼叫完成「殘留語意去重 → 依開發者重要性挑 ≤6 → 每則繁中標題 ≤50／內容 ≤300」，再以程式硬驗證（剔除幻覺項→夾非 AI ≤2→截 ≤6→收斂字數）產出**恆合規**的精選集。
2. **策展失敗降級備援**——LLM 呼叫或解析失敗時**不擲錯**，退回純程式排序：沿用 F4 `weightedScore` 排序（`CandidateSet` 已排序，直接取前段）套同一配額，每則呈現原文標題＋連結，標 `degraded`。
3. **榜單日「本次變化」TL;DR** `BoardSummaryService.summarize()`——把榜單 diff 的計數／領域分布交給 `LlmService` 摘成一句繁中封面文案（§10 第 (2) 種呼叫、僅榜單日），失敗退回程式產生的事實型摘要。

技術取向：**零新依賴、零新基礎設施**，全部重用既有 `LlmService`（含 429/503 退避）、`weightedScore`/`mentionsBoardRepo`（F4 funnel）、`countCodePoints` 字數口徑（F5）。新增一個 `src/curation/` 模組，fine-grained 檔案切分沿用 `src/intro/` 慣例。

## Technical Context

**Language/Version**: TypeScript 5.x（strict，禁 `any` 逃逸）on Node.js 24

**Primary Dependencies**: NestJS（`@nestjs/common` DI；`NestFactory.createApplicationContext()` 一次性 CLI job）、`@google/genai`（**僅透過** F5 `LlmService` 間接使用，F6 不直接依賴）。**無新增 npm 依賴。**

**Storage**: N/A——F6 只產出記憶體結構；**MUST NOT** 呼叫 `StateStore.save()`、**MUST NOT** 寫 `seenNews`、**MUST NOT** git commit（FR-019，持久化屬 F7）。

**Testing**: Jest（`*.spec.ts`）；外部 LLM 以 mock `LlmService` 測（成功／空／擲錯三態），降級路徑另測（憲章 VIII）。

**Target Platform**: GitHub Actions 排程 workflow 內的 run-once CLI（跑完即退）。

**Project Type**: 單一 TypeScript 專案（非 monorepo、非 web）。

**Performance Goals**: 新聞策展對 LLM 用量**恆為每日 1 次**（候選為空時 0 次），與候選數（15／25／更多）無關（SC-001）；榜單 TL;DR 為僅榜單日的**獨立** 1 次呼叫（FR-017），不使新聞策展變多次。

**Constraints**: 免費層額度安全（憲章 I）——禁 embeddings／向量檢索、禁為策展發起多於一次呼叫（憲章 V）；字以 **Unicode code point** 計數（與 F5／憲章 50/300/250 同口徑）；只送公開資料給 LLM（FR-007）；LLM 不得產生連結／分數等事實數據（憲章 VI）。

**Scale/Scope**: 輸入 ~15–25 則候選 → 輸出 ≤6 則精選；榜單 diff ≤10 項 → 一句 TL;DR。

## Constitution Check

*GATE: 通過方可進入 Phase 0；Phase 1 設計後複查。*

| 原則 | 相關性 | F6 遵循方式 | 結論 |
|------|--------|-------------|------|
| I. 零維運免費基礎設施 | 高 | 重用 Gemini 免費層（經 `LlmService`），無新常駐服務／付費／新依賴 | ✅ PASS |
| III. 只推變化、控制節奏 | 高 | 配額 AI ≥4／非 AI ≤2／總數 ≤6、繁中、標題 ≤50／內容 ≤300、依重要性排序（分數僅提示），皆程式硬驗證 | ✅ PASS |
| V. 去重確實且節制 LLM | 高 | 策展**單一** LLM 呼叫、殘留語意去重由該次順手完成、**禁 embeddings**；候選為空不呼叫（FR-002/020） | ✅ PASS |
| VI. 冪等、快取、單一狀態、防幻覺 | 高 | 連結／分數由程式提供（候選參照對回）、LLM 只選擇/去重/改寫；**不 `save()`、不寫 `seenNews`**（FR-019） | ✅ PASS |
| VII. 機密隔離與容錯 | 高 | 任一 LLM 失敗降級不中止、**不無聲**（`logger.warn` 含脈絡）；**不發 Discord**（推播層屬 F7，FR-014） | ✅ PASS |
| VIII. 關鍵邏輯測試優先 | 高 | 配額、字數上限、URL/標題去重（沿用 F4）、語意去重、幻覺剔除、降級備援、TL;DR 備援皆單元測試；LLM mock | ✅ PASS |
| II. 不自存星星歷史 | 無關 | F6 不碰星星資料 | N/A |
| IV. 新聞來源設定即資料 | 無關 | F6 不碰來源抓取／設定（F4） | N/A |

**Gate 結論**：無違反，Complexity Tracking 留空。榜單 TL;DR 為 §10 明列的第 (2) 種 LLM 呼叫、僅榜單日發生，與新聞策展的「每日 1 次」相互獨立（FR-017），**不**構成憲章 V「每日 1 次」的違反。

**Post-Design 複查（Phase 1 後）**：research.md（D1~D6）與 data-model／contracts 未引入任何新依賴、新基礎設施或新 LLM 呼叫路徑——策展仍為單次呼叫（空候選 0 次）、TL;DR 仍為僅榜單日獨立一次；`clampToLimit` 為 F5 邊界邏輯的參數化（不改 F5 簽名，research D5 已記其取捨）；解析分層（parse／validate）與降級路徑皆對應憲章 V/VI/VII/VIII 的既有約束。**無新違反，Gate 維持 PASS**。

## Project Structure

### Documentation (this feature)

```text
specs/006-news-curation/
├── plan.md              # 本檔（/speckit-plan 產出）
├── spec.md              # 功能規格（已含 Clarifications 2026-07-18）
├── research.md          # Phase 0 產出——解掉三個 plan-deferred 未知
├── data-model.md        # Phase 1 產出——記憶體型別與不變式
├── quickstart.md        # Phase 1 產出——驗收與跑測指引
├── contracts/           # Phase 1 產出——服務介面契約
│   ├── news-curation.contract.md
│   ├── board-summary.contract.md
│   └── llm-response.schema.md
├── checklists/
│   └── requirements.md  # 既有（clarify 後 16/16）
└── tasks.md             # /speckit-tasks 產出（本命令不建立）
```

### Source Code (repository root)

新增 `src/curation/` 模組（fine-grained 檔案切分沿用 `src/intro/` 慣例）；**不改動** F4/F5 既有檔案（只 import 其匯出項，實踐「引用既有的尺、不另發明」）。

```text
src/
├── curation/                         # ★ F6 新增
│   ├── curation.module.ts            # NewsCurationService + BoardSummaryService；imports LlmModule
│   ├── curation.types.ts             # CurationItemView / CuratedNewsItem / CuratedDigest / CurationContext
│   ├── curation.service.ts           # NewsCurationService.curate()：投影→prompt→LLM→解析→硬驗證；失敗降級
│   ├── curation-prompt.ts            # buildCurationPrompt()（含主題降噪、重要≠熱門、配額、50/300、JSON schema 指示）
│   ├── curation-parse.ts             # parseCurationResponse()：去 fence→JSON.parse→schema 驗證（壞則擲錯→降級）
│   ├── curation-validate.ts          # 硬驗證管線：剔除幻覺+參照去重→夾非 AI ≤2→截 ≤6→字數收斂（FR-008~010）
│   ├── curation-quota.ts             # 配額常數與夾制（AI/非 AI 分類用 candidate.domain；純函式）
│   ├── curation-length.ts            # clampToLimit(text,max)（一般化 F5 clampTo250 的邊界收斂邏輯）
│   ├── curation-fallback.ts          # 降級精選：CandidateSet 前段（weightedScore 序）套配額→原文標題+連結
│   ├── board-summary.types.ts        # BoardChangeDigest（輸入）/ BoardChangeSummary（輸出）
│   ├── board-summary.service.ts      # BoardSummaryService.summarize()：LLM 一句 TL;DR；失敗退事實摘要
│   ├── board-summary-prompt.ts       # buildBoardSummaryPrompt()
│   └── board-summary-fallback.ts     # factSummary(digest)：程式產生的事實型摘要（含「無變化」情形）
│   └── *.spec.ts                     # 對應單元測試（憲章 VIII）
│
├── news/            # F4（既有，只讀取匯出）：news.types(CandidateSet/NewsCandidate)、funnel(mentionsBoardRepo)
├── intro/           # F5（既有，只讀取匯出）：intro-length(countCodePoints)
├── llm/             # F5（既有，只注入）：LlmService / LlmModule / LlmError
└── diff/            # F3（既有，只讀取型別）：diff.types(BoardChange/BoardDiff)（F7 據此組 BoardChangeDigest）
```

**Structure Decision**：單一專案內新增 `src/curation/` 模組。切分理由——(1) F6 是「LLM 策展／摘要層」的獨立關注點，與 F4「零 LLM 攝取漏斗」職責分離；(2) 兩服務（新聞策展、榜單 TL;DR）雖領域不同但**皆為 F6 對 `LlmService` 的消費者**，共置於一模組利於一次注入與測試；(3) fine-grained 檔案（prompt／parse／validate／length／fallback 各一檔）沿用 `src/intro/` 既定慣例，使每個純函式可獨立單元測試（憲章 VIII）。**不改 F4/F5**：`countCodePoints`、`mentionsBoardRepo`、`weightedScore`、`LlmService` 皆以 import 重用，不複製、不改簽名。

## Complexity Tracking

> 無憲章違反，本節留空。
