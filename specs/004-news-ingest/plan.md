# Implementation Plan: 新聞來源設定與零 LLM 過濾漏斗（階段 A · News Ingest & Zero-LLM Funnel）

**Branch**: `004-news-ingest` | **Date**: 2026-07-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-news-ingest/spec.md`

## Summary

F4 交付新聞資料流的前半段：從**單一設定檔** `src/config/news-sources.ts` 讀取來源清單（憲章 IV），
以四種抓取器（`hn-algolia` / `reddit-weekly` / `rss` / `github-releases`）逐一抓取並隔離容錯，
正規化為統一 `NewsCandidate` 結構，再用**零 LLM 的結構性手段**（target-URL 正規化去重 ＋ 標題
Jaccard 補漏 ＋ 分數門檻／交叉驗證／榜單相關性／tier 差異化加權 ＋ `seenNews` 跨天排除與 7 天
修剪）把候選收斂到約 15～25 則、大致無重複、排序確定的清單，供 F6 單次 LLM 策展取用。

技術取向：延續現有 NestJS DI + 純函式抽出（利於憲章 VIII 單測）+ zod 邊界驗證的慣例；新增
`src/news/` 模組與 `rss-parser` 相依；**不呼叫 LLM、不新增機密、不新增狀態欄位**（`seenNews`
已存在於 `state.schema.ts`）。本 Feature 只產出候選供觀測（log），**不推播、不寫回 `seenNews`**
（屬 F6/F7）。

## Technical Context

**Language/Version**: TypeScript 5.7（strict）/ Node.js 24 / CommonJS module

**Primary Dependencies**: NestJS 11（`createApplicationContext` 一次性 CLI）、**`rss-parser`（新增；
解析 Reddit/Lobste.rs RSS 與 GitHub `releases.atom` Atom）**、`zod`（來源 schema 與 feed 邊界驗證）、
原生 `fetch`（HN Algolia JSON 與 feed 文字抓取，帶自訂 UA／條件式請求／指數退避）。**不含
`@google/genai`**（LLM 屬 F5/F6）；`cheerio` 本 Feature 不使用。

**Storage**: 唯一權威狀態 `state/board.json`，只經 `StateStore` 存取。本 Feature **只讀取並在記憶體
中修剪** `seenNews`（`{url, seenAt}[]`，schema 已於 F1 建立），**不寫回**（F6/F7 於推播成功後才寫）。
不新增狀態欄位、不建平行狀態。

**Testing**: Jest + ts-jest。抓取器對 `fetch`／`rss-parser` 以 mock 或注入 parser 測；解析走快照測試；
所有時間相關行為（近 7 天口徑、7 天修剪、新鮮度決勝）以注入的 `now: Date` 驅動，不依賴真實時間。

**Target Platform**: GitHub Actions 排程 runner（Linux）跑一次性 CLI，跑完即退。

**Project Type**: 單一專案 CLI（非 web／mobile）；沿用現有 `src/<module>/` 佈局。

**Performance Goals**: 無硬性延遲目標。抓取禮貌優先：自訂 UA、條件式請求、失敗指數退避＋jitter；
來源數量級 ~10–15，逐源隔離；輸出收斂至約 15–25 則。

**Constraints**: 零 LLM、零 embeddings／向量檢索（憲章 V）；全免費公開 feed、無新增機密（憲章 I/VII）；
相同輸入之輸出（成員與排序）須 100% 確定（SC-011，四層決勝全序、不依賴 sort 穩定性）。

**Scale/Scope**: 單次執行處理 ~10–15 個啟用來源、數百則原始項目 → 去重過濾後 ~15–25 則候選。

> 無殘留 NEEDS CLARIFICATION：`domain` 列舉（`ai|devops|frontend-backend|cross`）與主題降噪歸屬
> （留 F6 階段 B）已於 spec Clarifications Session 2026-07-16 定案。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原則 | 本 Feature 相關約束 | 判定 |
|------|--------------------|------|
| I. 零維運免費基礎設施 | 只用免費公開 RSS/JSON feed + 原生 fetch + `rss-parser` 函式庫；無常駐服務、無付費、**F4 零 LLM 呼叫**（用量遠低於任何免費上限） | ✅ PASS |
| II. 不自存星星歷史 | 不涉榜單星星；不建任何時序快照 | ✅ N/A |
| III. 只推變化、控制節奏 | F4 不推播；`seenNews` 跨天排除落實「只推新出現」；6 則配額／50-300 字數屬 F6/F7 | ✅ PASS |
| IV. 新聞來源設定即資料 | 來源全集中於 `src/config/news-sources.ts`；增刪修只改設定、不動 pipeline；schema 驗證擋重複 id／缺欄位；**任一來源 0 筆發帶 `id` 告警** | ✅ PASS（本 Feature 之核心） |
| V. 去重確實且節制 LLM | 去重主力為零 LLM 的 target-URL 正規化 ＋ 標題 Jaccard 補漏；**MUST NOT 引入 embeddings／向量檢索**；F4 全程不呼叫 LLM | ✅ PASS |
| VI. 冪等、快取、單一狀態 | 只經 `StateStore` 讀 `seenNews`、記憶體修剪、**不寫回**（F6/F7 推播成功後才寫）；不產生事實數據 | ✅ PASS |
| VII. 機密隔離與容錯 | 公開 feed 無需 token、**不新增機密**；逐源 try/catch 隔離，任一來源失敗不斷全線；失敗與 0 筆發告警（`bestEffortFailureAlert`） | ✅ PASS |
| VIII. 關鍵邏輯測試優先 | URL 正規化去重、標題 Jaccard、來源 schema／tier 加權、releases 版本過濾、`cross` 歸類、`seenNews` 修剪／排除、漏斗確定性——皆純函式可單測；外部抓取以 mock 測、另測 0 筆／失敗降級 | ✅ PASS |

**結論**：無違反非協商原則，Complexity Tracking 無需填寫。設計刻意最小化——沿用既有 HTTP 退避／
告警／狀態存取模式，不新增機密、不新增狀態欄位、不引入 LLM。

**Phase 1 後重新檢查（GATE re-check）**：設計產出（data-model／contracts／research）未新增任何違反
——新增相依僅 `rss-parser`（憲章技術釘死清單內）、無新機密、無新狀態欄位、無 LLM／embeddings、
去重全為零 LLM 純函式、逐源隔離容錯與 0 筆告警皆落實。✅ 通過，可進入 `/speckit-tasks`。

## Project Structure

### Documentation (this feature)

```text
specs/004-news-ingest/
├── plan.md              # 本檔（/speckit-plan 輸出）
├── research.md          # Phase 0：技術決策（抓取器、URL 正規化、Jaccard、版本過濾…）
├── data-model.md        # Phase 1：NewsSource / NewsCandidate / SeenNews / CandidateSet 實體
├── quickstart.md        # Phase 1：驗證情境（對照 SC-001…SC-011）
├── contracts/           # Phase 1：設定檔 schema、候選輸出、抓取器介面契約
│   ├── news-source-config.md
│   ├── news-candidate-output.md
│   └── fetcher-interface.md
└── tasks.md             # /speckit-tasks 產生（本指令不建立）
```

### Source Code (repository root)

```text
src/
├── config/
│   ├── news-sources.ts          # 【新增】唯一來源清單（NEWS_SOURCES）＋型別（憲章 IV，增刪修只改此檔）
│   └── news-source.schema.ts    # 【新增】來源清單 zod schema：唯一 id、必填欄位、tier/type/domain 列舉
├── news/                        # 【新增模組】
│   ├── news.module.ts
│   ├── news.types.ts            # NewsSource / NewsCandidate / RawItem / FunnelResult 型別
│   ├── news-http.ts             # 通用 GET（text/json）＋UA／條件式請求／指數退避＋jitter（host 無關，無 token）
│   ├── fetchers/
│   │   ├── fetcher.ts           # FetcherContext 介面 ＋ 依 type 分派
│   │   ├── hn-algolia.fetcher.ts        # Algolia JSON → RawItem[]（近 7 天、取 url 或退回 permalink）
│   │   ├── reddit-weekly.fetcher.ts     # /top/.rss?t=week（rss-parser）
│   │   ├── rss.fetcher.ts               # 一般 RSS/Atom（rss-parser）
│   │   └── github-releases.fetcher.ts   # releases.atom ＋ pre-release／純 patch 過濾
│   ├── release-filter.ts        # 純函式：版本判定（drop pre-release/patch，keep major/minor/security）
│   ├── url-normalize.ts         # 純函式：target-URL 抽取＋正規化（去重鍵，SC-009）
│   ├── title-similarity.ts      # 純函式：標題正規化＋Jaccard（SC-001 補漏）
│   ├── dedup.ts                 # 純函式：URL 合併（保留最高分、併 sources[]）＋標題近似合併
│   ├── news-classify.ts         # 純函式：cross 來源關鍵字歸類 → ai|devops|frontend-backend
│   ├── news-domain-keywords.ts  # 新聞領域關鍵字（含 devops；獨立於榜單 domain-keywords）
│   ├── funnel.ts                # 純函式：階段 A 過濾＋加權＋四層決勝排序＋收斂（SC-005/006/011）
│   ├── seen-news.ts             # 純函式：pruneSeenNews(7天) ＋ excludeSeen（正規化 URL 比對）
│   ├── news-ingest.service.ts   # @Injectable 編排：載入設定→抓取(隔離)→正規化→去重→歸類→漏斗→排除→候選＋log
│   └── news-log.ts              # 候選清單觀測 log（本 Feature 唯一產出面）
└── (既有：state/ github/ discord/ classify/ board/ diff/ …不動)

test：與各原始碼並置 `*.spec.ts`（沿用現有慣例，非集中 tests/ 目錄）
```

**Structure Decision**：沿用現有「一模組一資料夾 + 純函式抽出 + `*.spec.ts` 並置」慣例。新聞為獨立
資料流，故自成 `src/news/`；來源設定依憲章 IV 放 `src/config/`。**不复用榜單的 `ClassifyService`**
——榜單分類器是 2-way（`ai|frontend-backend`、以 repo topics/description 為輸入、無 devops），
新聞 `cross` 歸類需 3 桶（含 `devops`）且輸入為新聞標題/摘要，語意不同，故另立
`news-classify.ts` + `news-domain-keywords.ts`（沿用「關鍵字集與邏輯分離、增刪只改關鍵字檔」的模式）。
`news-http.ts` 鏡射 `github-http.ts` 的退避／UA／條件式請求邏輯但 host 無關且不帶 token；抓取失敗與
0 筆告警复用既有 `discord/best-effort-alert.ts` 與 `DiscordWebhookService.postFailureAlert`。

## Complexity Tracking

> 無 Constitution 違反，本表不需填寫。
