# Implementation Plan: 榜單來源與三領域歸類（Board Sources）

**Branch**: `002-board-sources` | **Date**: 2026-07-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-board-sources/spec.md`

## Summary

在 F1 骨架上新增「榜單來源與三領域歸類」：以 `cheerio` 爬 GitHub Trending weekly（全站＋5 語言頁）解析「stars this week」為主力候選，並以 GitHub Search API（`created:>7天` 三組領域查詢）補位新崛起 repo；對每個候選以 **topics 為主、description 為輔**（language 僅輔助訊號、不單獨定領域、不參與跨領域決勝）歸入 **AI / DevOps / 前後端** 三領域（跨領域擇一主領域，優先序 AI > DevOps > 前後端），以 **GitHub 數字 `repoId`** 合併去重，計算統一排序鍵 **`weeklyStarsEstimate`**，每領域取 **top 15** 產出**當前榜單並印到 log**。本 Feature **只產出可觀測榜單、不寫回 `state/board.json`、不做 diff／推播／簡介／新聞**（分屬 F3/F5/F7）。M1 驗收＝本機／Actions log 印出正確的三領域週增星榜。

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 24 LTS（沿用 F1；workflow `actions/setup-node@v4` `node-version: "24"`）

**Primary Dependencies**: 沿用 F1 的 NestJS（application context）、`zod`、Node 24 內建 `fetch`（undici）。**本 Feature 新增 `cheerio`**（解析 Trending HTML）。**不**引入 `rss-parser`（F4）、`@google/genai`（F5）。GitHub REST 直接以 `fetch` 呼叫（Search / repos），不引入 Octokit。

**Storage**: 無新增持久化。F2 **不讀不寫** `state/board.json`；當前榜單僅存在單次執行的記憶體與 log（spec Assumptions「不引入新狀態」）。

**Testing**: Jest + `ts-jest`（沿用 F1）。Trending 解析以**快照測試**守著頁面改版（存 HTML fixture）；classify／merge-dedup／per-domain 排序與 top 15／`weeklyStarsEstimate`／「0 筆告警」以純函式單元測試。GitHub API 呼叫以 mock/fixture 測，不打真實網路。

**Target Platform**: GitHub Actions `ubuntu-latest`、Node 24；亦可本機 `node dist/main.cli.js`（或除錯進入點）觀察 log。

**Project Type**: 單一專案（CLI／批次 job），沿用 F1 結構，新增 `sources/`、`classify/`、`board/` 模組。

**Performance Goals**: 單次執行 1–3 分鐘內完成；外部呼叫維持在免費上限安全範圍（見 Constraints 與 research D2）。

**Constraints**:
- **GitHub API 限額**（憲章 I）：authenticated core 5,000/hr、Search 30/min。F2 單次估算：Trending HTML 6 次（github.com 網頁、非 API 計費）＋ 每個 Trending 唯一候選 1 次 `GET /repos`（取 topics）≈ ≤120 次 core（估算；SC-006 安全上限 ~150）＋ Search 3 次。遠低於上限。
- **抓取禮貌**（憲章 VII）：自訂 User-Agent、條件式請求（ETag / If-Modified-Since，尤其 Trending 頁）、失敗指數退避；`GET /repos` 以有限並發（≤6）避免 secondary rate limit。
- **來源隔離容錯**（憲章 VII）：主力／補位任一失敗或解析到 0 筆，發**帶來源 id** 的紅色告警並讓另一來源照常產出，不使整條 pipeline 失敗。
- 機密只走 F1 已驗證的 `GH_API_TOKEN`（Actions Secrets），不入庫、不入任何產物。

**Scale/Scope**: Trending 去重後約 80–120 個 unique 候選 ＋ 補位每領域數個；分類排除非三領域雜訊後，每領域 top 15、合計 ≤45 筆為榜單輸出。

## Constitution Check

*GATE: 須在 Phase 0 前通過，Phase 1 設計後複查。*（憲章 **v1.1.0**）

| # | 原則 | F2 是否觸及 | 判定 |
|---|------|------------|------|
| I | 零維運免費基礎設施 | 是（GitHub API + Trending HTML） | ✅ 用量估算遠低於 core 5000/hr、Search 30/min；只加免費 lib `cheerio`，無常駐/付費（research D2） |
| II | 不自存星星歷史 | 是（榜單來源） | ✅ 週增星取自 Trending weekly 官方週增量；補位用 Search `created:>7天` 當前總星數；**不自建每日快照/day-over-day** |
| III | 只推變化、控制節奏 | 否（F2 不推播、不 diff） | ✅ 只產出可觀測榜單、log 輸出；推播/節奏屬 F3/F7 |
| IV | 新聞來源設定即資料 | 否（F2 非新聞來源） | ✅ 榜單來源（Trending/Search）為憲章 II 釘死之資料來源，非 `news-sources.ts`；三領域關鍵字種子集獨立於分類模組設定 |
| V | 去重確實且節制 LLM | 是（跨來源去重） | ✅ 去重以 `repoId` 正規化、**零 LLM**；F2 不呼叫 Gemini |
| VI | 冪等、快取與單一狀態來源 | 部分（讀狀態？） | ✅ F2 **不讀不寫** `state/board.json`、不變更任何狀態，天然冪等；無半套狀態風險 |
| VII | 機密隔離與容錯發佈 | 是（token、來源隔離） | ✅ `GH_API_TOKEN` 走 env、不入產物；來源失敗/0 筆帶 id 告警、不斷全線（FR-007/FR-009，沿用 F1 `failure-alert`） |
| VIII | 關鍵邏輯測試優先 | 是 | ✅ Trending 解析快照測試、三領域歸類、merge/`repoId` 去重、per-domain top 15 排序、`weeklyStarsEstimate`、0 筆告警皆納入交付（FR 對映見 tasks 階段） |

**結論**：無違反、無需正當化的複雜度 → Complexity Tracking 留空。設計後複查（見文末）維持通過。

## Project Structure

### Documentation (this feature)

```text
specs/002-board-sources/
├── plan.md              # 本檔（/speckit-plan 輸出）
├── research.md          # Phase 0 輸出（技術決策）
├── data-model.md        # Phase 1 輸出（記憶體實體 + 分類規則 + 排序鍵）
├── quickstart.md        # Phase 1 輸出（M1 驗證指引）
├── contracts/           # Phase 1 輸出（外部介面契約）
│   ├── github-sources.md    # Trending HTML 爬取 + Search API + GET /repos topics
│   └── board-output.md      # F2 產出的 CurrentBoard 結構（供 log 與 F3 取用）
├── checklists/
│   ├── requirements.md  # /speckit-specify 已產出
│   └── board-sources.md # /speckit-checklist 已產出
└── tasks.md             # /speckit-tasks 產出（本命令不建立）
```

### Source Code (repository root)

```text
src/
├── main.cli.ts                    # 沿用 F1；M1 期間經 PipelineService 觸發榜單建置並印 log
├── pipeline/
│   └── pipeline.service.ts        # 擴充：呼叫 BoardBuilderService.build() → 印三領域榜（不 diff/不推播/不寫狀態）
├── github/
│   ├── github-http.ts             # GitHub REST 共用薄客戶端：Auth(GH_API_TOKEN)+UA+條件式請求+指數退避+有限並發
│   └── github-http.spec.ts
├── sources/
│   ├── github-trending.service.ts # 爬 weekly 全站+5 語言頁（cheerio），解析 stars this week → RawTrendingRepo[]
│   ├── github-trending.service.spec.ts        # 快照測試（HTML fixture）+ 0 筆/解析失敗告警
│   ├── github-search.service.ts   # 三組領域 Search（created:>7d、stars 門檻、sort=stars）→ RawSearchRepo[]
│   ├── github-search.service.spec.ts
│   ├── github-repo.service.ts     # GET /repos/{o}/{r} 取 topics/metadata（給 Trending 候選補 topics）
│   └── github-repo.service.spec.ts
├── classify/
│   ├── classify.service.ts        # 三領域歸類：topics→description（language 僅輔助、不參與決勝）；跨領域擇一主領域
│   ├── classify.service.spec.ts
│   └── domain-keywords.ts         # 三領域關鍵字種子集（v1 canonical，增刪只改此檔）
├── board/
│   ├── board-builder.service.ts   # 編排：sources→classify→merge(repoId 去重)→weeklyStarsEstimate→每領域 top 15
│   ├── board-builder.service.spec.ts
│   ├── board.types.ts             # Domain(3-way)/CandidateRepo/DomainBoard/CurrentBoard
│   └── weekly-stars.ts            # weeklyStarsEstimate 純函式（Trending=starsThisWeek；Search=min((總星/建立天數)×7, 總星)）
└── (F1 既有 config/ state/ discord/ 不動；F2 沿用 discord/failure-alert 發來源告警)

tests/fixtures/
└── trending-weekly.html           # Trending 頁面快照（解析回歸基準）
```

**Structure Decision**：沿用 F1 單一專案（Option 1）與開發指南 §9 模組切分，**只落地 F2 子集**（`github/`、`sources/`、`classify/`、`board/`）並擴充 `pipeline/`。新增共用 `github/github-http.ts` 承載抓取禮貌與退避，供 `sources/*` 與日後 F5 `github-readme` 共用。`diff/`、`intro/`、`summary/`、`llm/`、`news-filter/` 留待 F3–F7；F2 不改動 `state/`、`config/env`、`discord/webhook` 骨架（只復用 `failure-alert`）。

## Complexity Tracking

> 無違反憲章之處，本表留空。

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| —         | —          | —                                    |

## Post-Design Constitution Re-Check

Phase 1 設計（research / data-model / contracts / quickstart）完成後複查：

- **I 免費基礎設施**：research D2 明列單次 API 預算（估算 ≤~120 core／安全上限 ~150 + 3 search + 6 HTML），含有限並發與條件式請求，遠離免費上限；`cheerio` 為唯一新增免費相依。✅
- **II 不自存星星歷史**：`weeklyStarsEstimate` 僅由**單次執行**當下的 Trending 週增量與 Search 當前總星數/建立日期計算，不落地、不做 day-over-day。✅
- **V/VI 去重與狀態**：merge 去重以 `repoId`、零 LLM；F2 不觸碰 `state/board.json`（`board-output.md` 明示產出僅記憶體＋log），無半套狀態。✅
- **VII 機密與容錯**：`github-http` 由 env 取 `GH_API_TOKEN`、不入產物；`board-builder` 對主力/補位以 try/catch 隔離，任一失敗或 0 筆→`failure-alert` 帶來源 id、另一來源續行（contracts/github-sources.md「失敗與 0 筆」）。✅
- **VIII 測試優先**：Trending 快照、classify、merge/去重、top 15 排序、`weeklyStarsEstimate`、0 筆告警皆有對映測試（data-model「驗證規則」與 quickstart）。✅

**跨 Feature 一致性註記**：F1 `BoardEntry.domain` 為 4-way 佔位（`ai|devops|backend|frontend`），F2 clarify 定案榜單為 **3-way**（前後端合併）。F2 **不持久化**，故其記憶體型別 `Domain = "ai"|"devops"|"frontend-backend"` 為分類輸出的權威定義；`state.schema.ts` 之 `BoardEntry.domain` 對齊為 3-way 屬**持久化層**、留待 **F3**（首次寫回 board 時）refine——已於 data-model 標記，符合 F1「enum 值在 F2 clarify 定案」之預期，非本 Feature 破壞性變更。

無新增違反 → Gate 維持 PASS。
