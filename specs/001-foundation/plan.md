# Implementation Plan: 專案骨架與推播通道（Foundation）

**Branch**: `001-foundation` | **Date**: 2026-07-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-foundation/spec.md`

## Summary

以 NestJS `NestFactory.createApplicationContext()` 建立一支跑完即退的一次性 CLI job，打通「排程執行環境 → Discord 私人頻道」的推播通道，並建立唯一權威狀態 `state/board.json` 的讀寫與 schema 骨架。範圍嚴守 spec FR-012：不含任何資料來源抓取、LLM 或新聞漏斗。M0 驗收＝手動觸發後手機收到測試 embed，且狀態變更能 commit 回 repo；失敗（含 app 啟動前）皆有紅色告警。

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 24 LTS（本機 nvm 24.18.0；workflow `actions/setup-node@v4` 設 `node-version: "24"`）

**Primary Dependencies**: NestJS（`@nestjs/core`、`@nestjs/common`、`@nestjs/config`、`reflect-metadata`、`rxjs`）；狀態與環境驗證用 `zod`；HTTP 用 Node 24 內建全域 `fetch`（undici），不引入 axios。F1 **不**需要 `cheerio` / `rss-parser` / `@google/genai`（屬 F2+，屆時於各自 plan 引入）。

**Storage**: 單一 JSON 檔 `state/board.json`（commit 回同一 repo）；無資料庫。

**Testing**: Jest + `ts-jest` + `@nestjs/testing`（NestJS 預設；單元測試與 `*.spec.ts` 同目錄）。

**Target Platform**: GitHub Actions `ubuntu-latest`、Node 24；亦可本機 `node dist/main.cli.js` 執行。

**Project Type**: 單一專案（CLI／批次 job，無前後端拆分）。

**Performance Goals**: 單次執行 1–3 分鐘內完成（§2.1）；非延遲敏感任務。

**Constraints**: 零常駐、零付費、跑完即退、不啟 HTTP server；機密只走 Actions Secrets、不入庫；狀態僅在實際變更時 commit（no-diff 早退）。

**Scale/Scope**: 純自用，單一 Discord 頻道；狀態檔數十 KB 等級。

## Constitution Check

*GATE: 須在 Phase 0 前通過，Phase 1 設計後複查。*（憲章 v1.0.1）

| # | 原則 | F1 是否觸及 | 判定 |
|---|------|------------|------|
| I | 零維運免費基礎設施 | 是（Actions + Discord Webhook；F1 不用 Gemini） | ✅ 未引入常駐/付費 infra |
| II | 不自存星星歷史 | 否（F1 無榜單來源） | ✅ 不適用、無違反 |
| III | 只推變化、控制節奏 | 部分（測試 embed 為暫時性連通驗證，非真實內容） | ✅ 不產生真實榜單/新聞，後續 Feature 取代 |
| IV | 新聞來源設定即資料 | 否 | ✅ 不適用 |
| V | 去重確實且節制 LLM | 否（F1 無 LLM/新聞） | ✅ 不適用 |
| VI | 冪等、快取與單一狀態來源 | 是（本 Feature 建立 `state/board.json` 單一權威狀態、推播成功後才寫回、commit-on-change） | ✅ 由 StateStore + Pipeline 設計落實 |
| VII | 機密隔離與容錯發佈 | 是（secrets 走 Actions Secrets、兩層失敗告警） | ✅ 由 ConfigModule 驗證 + app/workflow 兩層告警落實 |
| VIII | 關鍵邏輯測試優先 | 是（StateStore 讀寫/schema 驗證/缺檔容錯、embed 組版、env 驗證） | ✅ 單元測試納入本 Feature 交付 |

**結論**：無違反、無需正當化的複雜度 → Complexity Tracking 留空。設計後複查（見文末）維持通過。

## Project Structure

### Documentation (this feature)

```text
specs/001-foundation/
├── plan.md              # 本檔（/speckit-plan 輸出）
├── research.md          # Phase 0 輸出
├── data-model.md        # Phase 1 輸出（狀態 schema + 實體）
├── quickstart.md        # Phase 1 輸出（M0 驗證指引）
├── contracts/           # Phase 1 輸出（外部介面契約）
│   ├── discord-webhook.md
│   ├── state-file.md
│   └── cli-and-workflow.md
├── checklists/
│   └── requirements.md  # /speckit-specify 已產出
└── tasks.md             # /speckit-tasks 產出（本命令不建立）
```

### Source Code (repository root)

```text
src/
├── main.cli.ts                 # createApplicationContext → PipelineService.run() → app.close()（try/catch 發紅色告警）
├── app.module.ts               # 組裝 ConfigModule + StateModule + DiscordModule + PipelineModule
├── config/
│   ├── config.module.ts        # @nestjs/config，載入 + 以 zod 驗證環境變數（缺失即 fail-fast）
│   └── env.schema.ts           # GH_API_TOKEN / GEMINI_API_KEY / DISCORD_WEBHOOK_URL 的 zod schema
├── state/
│   ├── state.store.ts          # 讀寫 state/board.json；缺檔容錯回空骨架；只回傳/寫入驗證過的物件
│   ├── state.schema.ts         # BoardState 及子實體的 zod schema（board/intros/seenNews/lastBoardPushAt/lastNewsPushAt）
│   └── state.store.spec.ts
├── discord/
│   ├── discord.webhook.service.ts  # 組 embed → POST（fetch）；提供 postTestEmbed 與 postFailureAlert
│   ├── discord.embed.ts        # embed 組版純函式（可單測）
│   ├── failure-alert.ts        # best-effort 送失敗告警；成功後寫 .radar-alert-sent marker 供 workflow 去重
│   └── discord.webhook.service.spec.ts
└── pipeline/
    └── pipeline.service.ts     # F1 最小編排：載入設定 → 載入狀態 → 推測試 embed → 成功後寫回狀態

state/
└── board.json                  # seed 的合法空骨架（FR-015）

.github/workflows/
└── radar.yml                   # 雙 cron + workflow_dispatch + concurrency + state commit(rebase 重試) + if:failure() 告警（依 marker 去重）

package.json / tsconfig.json / jest 設定 / .gitignore（.env 等機密不入庫）
```

**Structure Decision**：採單一專案（Option 1）。目錄沿用開發指南 §9 的模組切分，但**只落地 F1 子集**（config / state / discord / pipeline 與 CLI 進入點）；sources / classify / news-filter / diff / intro / summary / llm 等模組留待 F2–F8 各自新增，不需重構骨架（滿足 FR-013）。

## Complexity Tracking

> 無違反憲章之處，本表留空。

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| —         | —          | —                                    |

## Post-Design Constitution Re-Check

Phase 1 設計（data-model / contracts / quickstart）完成後複查：

- **VI 單一狀態來源**：`state.store.ts` 為唯一讀寫 `state/board.json` 之處；`pipeline.service.ts` 在**推播成功後**才呼叫 `save()`（防半套狀態）；實際 commit 由 workflow 於 `git diff --cached --quiet` 判斷、僅變更時進行。✅
- **VII 機密隔離／容錯**：env schema 於啟動時驗證、缺失 fail-fast 且不推播（FR-003）；`main.cli.ts` try/catch → `postFailureAlert`（app 內失敗）；workflow `if: failure()` curl（app 啟動前失敗）。機密無一寫入 `state/board.json` 或任何產物。✅
- **VIII 測試優先**：StateStore（seed 讀入、缺檔容錯、schema 驗證、round-trip 不遺失欄位）、embed 組版、env 驗證皆有 `*.spec.ts`。✅

無新增違反 → Gate 維持 PASS。
