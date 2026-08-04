# Implementation Plan: GitHub Pages 儀表板 + RSS/Atom 發佈

**Branch**: `008-pages-publish` | **Date**: 2026-08-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/008-pages-publish/spec.md`

## Summary

F8 把已推去 Discord 的同一批榜單快照與新聞精選，額外發佈成一個公開靜態儀表板
（`index.html`）與一份可訂閱的 Atom feed（`feed.xml`），讓雷達的產出不再鎖在單一 Discord
伺服器內。發佈是**完全隔離的末段**：獨立的 GitHub Actions job（`publish`，`needs: radar`），
對 `state/board.json` **只讀**，僅在 repo 為 public 時啟用，切成 private 自動靜默停用。

技術取向：核心推播段（`board-segment.service.ts`／`news-segment.service.ts`）在既有
push-then-commit 節點**加法式**寫入三個新的選用狀態欄位（最近一次新聞全文、最近一次榜單變化
摘要、上限 50 筆的滾動 feed 歷史）；新增 `src/publish/` 模組（可見性查詢 + 兩個純渲染函式），
沿用既有 `main.cli.ts` 單一入口＋環境變數旗標分派慣例（比照 `NEWS_INGEST_OBSERVE` 先例）。
不新增 LLM 呼叫、不新增自存星星歷史、不新增第二個編譯產物。詳細決策見 `research.md` D1–D10。

## Technical Context

**Language/Version**: TypeScript（strict）on Node.js 24

**Primary Dependencies**: NestJS（沿用既有 `createApplicationContext` 單一 CLI 入口，新增
`PUBLISH_MODE=1` 分派分支）、`feed`（憲章/dev-guide §14 已釘死，本 Feature 首次引入此
runtime 相依）、既有 `GithubHttpService`（重用，供可見性查詢）、`zod`（狀態 schema 擴充，沿用
F1）。**不新增 LLM 客戶端、不新增第二個 HTTP 客戶端**（憲章 I／V，FR-010）。

**Storage**: `state/board.json`（唯一權威狀態，仍只經 `StateStore` 讀寫；憲章 VI）。**新增三個
選用根層巢狀欄位**（`publish.news`／`publish.boardSummary`／`publish.feed`，見 data-model.md
§1）——由核心推播段寫入，發佈段唯讀，全鏈可選以保既有檔案向後相容（FR-013/014）。

**Testing**: Jest（單元測試 + 快照）。`RepoVisibilityService` 以 mock `GithubHttpService` 測
public/private/查詢失敗三分支，另加 `GITHUB_REPOSITORY` 缺失／格式不符 → `'unknown'` 且不發請求；
`renderPage`/`renderFeed` 快照測試（含空狀態、HTML escape、`content: null` 的降級新聞）；
`PublishService` 測 `load()` 擲錯不 throw 而改發告警（FR-017）、核心段本次跳過時仍正常產出
（FR-012）；`commitBoardPush` 擴充後的快照測試；狀態 schema 向後相容測試（不含 `publish` 鍵的
舊 fixture）。

**Target Platform**: 新增一個獨立 GitHub Actions job（`publish`，`needs: radar`，
ubuntu-latest，`workflow_dispatch`/排程觸發時皆會 `needs` 到），使用 `actions/configure-pages`／
`actions/upload-pages-artifact`／`actions/deploy-pages`（GitHub 官方 action，部署到
`environment: github-pages`）。

**Project Type**: Single project（純自用 CLI，非 web／mobile；發佈的網頁是**產物**，不是本專案
本身的 web 服務）。

**Performance Goals**: N/A（批次 job，無延遲/吞吐目標）。硬約束是**用量**：`publish` job 每次
執行新增 1 次 GitHub API 呼叫（可見性查詢，走既有節流客戶端），**0 次 LLM 呼叫**（FR-010/SC-005），
**0 次額外 Discord 推播**（除非發佈本身失敗才觸發告警，FR-017）。

**Constraints**:
- **發佈段對 state 唯讀**，寫入權限完全屬於核心推播段（FR-007，見 research D1、
  contracts/publish-orchestration.md）。
- **feed 歷史上限 50 筆**，超出移除最舊（FR-005）。
- **feed entry MUST NOT 帶星數**等數值指標（FR-016）。
- **發佈產物 MUST NOT 含機密**（FR-008，憲章 VII；`public/` 內容只來自 `state` 已公開過的欄位）。
- **新增狀態欄位 MUST 為選用**，既有 state 檔須無錯載入（FR-014）。
- **私有時靜默、查詢失敗與發佈失敗才告警**（FR-017，見 research D10）。

**Scale/Scope**: 單一使用者（自用）；儀表板單頁（非分頁）、feed 上限 50 entries；每日執行一次
`publish` job（跟隨核心排程節奏，不獨立排程）。

## Constitution Check

*GATE：Phase 0 前必過；Phase 1 設計後複查。*

| 原則 | F8 落地 | 判定 |
|------|---------|------|
| **I. 零維運免費基礎設施** | 不新增付費服務；GitHub Pages 免費（public repo）；`publish` job 每次執行新增 1 次 GitHub API 呼叫（可見性查詢），走既有節流客戶端，遠低於限額 | ✅ Pass |
| **II. 不自存星星歷史** | `state.publish.feed` entry 不帶星數（FR-016，型別層面禁止）；`state.board` 沿用既有唯一快照，不新增歷史時序 | ✅ Pass |
| **III. 只推變化、控制節奏** | 發佈不獨立排程、不引入新節奏；沿用核心段既有 162h／~18h guard 節奏，發佈只是「把已決定好的內容多發一份」 | ✅ Pass |
| **IV. 新聞來源設定即資料** | 發佈段不碰新聞來源，不新增/修改 `news-sources.ts` | ✅ Pass |
| **V. 去重確實、節制 LLM** | 發佈段 0 LLM 呼叫（FR-010）；feed 去重靠 reader 端對穩定 GUID 的既有機制，不新增去重邏輯 | ✅ Pass |
| **VI. 冪等、單一狀態、防幻覈** | `state/board.json` 仍是唯一權威狀態；新欄位由核心段「推播成功後才寫回」的既有時機寫入，同一次原子 `save()`（FR-013，見 contracts/state-write-contract.md）；發佈段唯讀，不產生第二個狀態來源 | ✅ Pass |
| **VII. 機密隔離與容錯** | 發佈產物只含已透過 Discord 公開過的欄位（FR-008）；`GH_API_TOKEN`/webhook 只走 Actions Secrets；發佈失敗 best-effort 告警、不影響核心段（FR-007/017，獨立 job 天然隔離） | ✅ Pass |
| **VIII. 關鍵邏輯測試優先** | 新增純函式（`trimFeed`／`makeBoardFeedEntries`／`makeNewsFeedEntries`／GUID 構成／`renderPage`／`renderFeed`）皆單測；`RepoVisibilityService` 以 mock 測 public／private／查詢失敗／缺 `GITHUB_REPOSITORY` 四分支；`PublishService` 測載入失敗告警與核心段跳過仍產出；`commitBoardPush` 擴充後快照測試；schema 向後相容測試 | ✅ Pass |

**Gate 結論**：無未正當化的違反。**PASS**（可進入 Phase 0）。

**Phase 1 設計後複查**：上表已依 `research.md`（D1–D10）、`data-model.md`、`contracts/*.md` 的
實際設計內容填寫（非 Phase 0 前的預先猜測），三項需要正當化的設計選擇已列於下方 Complexity
Tracking。**複查結論不變：PASS**，無新增違反。

## Project Structure

### Documentation (this feature)

```text
specs/008-pages-publish/
├── plan.md                          # 本檔
├── research.md                      # Phase 0：D1~D10 決策
├── data-model.md                    # Phase 1：狀態擴充 + 發佈段型別/函式簽章
├── quickstart.md                    # Phase 1：四個端到端驗證情境
├── contracts/                       # Phase 1：F8 內部契約
│   ├── publish-orchestration.md
│   ├── state-write-contract.md
│   └── feed-page-contract.md
└── tasks.md                         # Phase 2（/speckit-tasks 產出，非本命令）
```

### Source Code (repository root)

F8 新增一個模組 `src/publish/`（可見性查詢＋純渲染函式＋編排），**加法式**擴充既有
`src/state/state.schema.ts`（新增選用欄位）、`src/diff/board-commit.ts`（`commitBoardPush`
新增兩個參數）、`src/pipeline/board-segment.service.ts`／`news-segment.service.ts`（既有
push-then-commit 節點新增賦值）、`src/config/env.schema.ts`（新增選用的 `GITHUB_REPOSITORY`）、
`src/main.cli.ts`（新增 `PUBLISH_MODE` 分派分支）、`.github/workflows/radar.yml`（新增
`publish` job）。上游 F1–F7 判定邏輯（cadence／diff／dedup／curate／intro／push-then-commit
的既有次序）**不改語意**。

```text
src/
├── publish/                             # 【新增模組】
│   ├── publish.module.ts                # imports: StateModule, GithubModule, DiscordModule, ConfigModule(全域)
│   ├── publish.service.ts               # 編排（contracts/publish-orchestration.md C2）
│   ├── repo-visibility.service.ts       # research D3
│   ├── render-page.ts                   # 【純函式】research D5, contracts/feed-page-contract.md C1
│   ├── render-feed.ts                   # 【純函式】research D4, contracts/feed-page-contract.md C2
│   ├── feed-entry.ts                    # 【純函式】trimFeed/makeBoardFeedEntries/makeNewsFeedEntries/GUID（research D8/D9）
│   ├── html-escape.ts                   # 【純函式】research D5
│   └── publish.types.ts                 # RepoVisibility 等發佈段專屬型別
├── state/
│   └── state.schema.ts                  # 【擴充】feedEntrySchema/publishNewsSchema/publishBoardSummarySchema/
│                                         #   publishStateSchema/curatedNewsItemSchema；boardStateSchema 加 publish?
├── diff/
│   └── board-commit.ts                  # 【擴充】commitBoardPush 新增 diff/summary 參數（見 data-model.md §2.4）
├── curation/
│   └── curation.types.ts                # 不動（CuratedNewsItem 原樣重用，state.schema.ts 另立對應 zod schema）
├── pipeline/
│   ├── board-segment.service.ts         # 【擴充】commitBoardPush 呼叫點多帶兩個既有變數
│   ├── news-segment.service.ts          # 【擴充】push-then-commit 區塊新增 state.publish 賦值
│   └── pipeline.module.ts               # 不動（publish 不掛在 PipelineService 下，見 research D1）
├── config/
│   └── env.schema.ts                    # 【擴充】新增選用欄位 GITHUB_REPOSITORY（非機密，供可見性查詢）
├── main.cli.ts                          # 【擴充】新增 PUBLISH_MODE=1 分派分支（比照既有 NEWS_INGEST_OBSERVE）
└── app.module.ts                        # 【擴充】imports 新增 PublishModule

.github/workflows/
└── radar.yml                            # 【擴充】新增 publish job（needs: radar），見 contracts/publish-orchestration.md C1/C4
```

**Structure Decision**：沿用既有 single-project 分層（`src/<domain>/`，`@Injectable` 服務 +
純函式旁置）。發佈段的**編排**與**可見性查詢**集中在新模組 `src/publish/`；**純渲染/組裝函式**
（`render-page.ts`／`render-feed.ts`／`feed-entry.ts`／`html-escape.ts`）皆為無 I/O 純函式，
利於無 mock 快照測試（憲章 VIII）。對既有模組的改動全數是**加法式**（新增選用參數/欄位/分支），
不改變任何既有判定邏輯的語意，延續 F7 `plan.md` 立下的「上游模組以 DI 重用、不複製其邏輯」原則。

## Complexity Tracking

> 僅記錄需要正當化的設計選擇（非憲章違反，是「為何選這個而非更直覺的替代方案」）。

| 決策 | 為何需要 | 為何不採更簡替代 |
|------|----------|------------------|
| 沿用單一 `main.cli.ts` 入口＋`PUBLISH_MODE` 環境變數分派，不開第二個編譯入口 | `publish` job 需要一個可執行的 Node 進入點；專案只有一組 `tsc`/`npm run build` 產物與一個 `start:cli` script | 開 `main.publish.cli.ts`：關注點分離更「教科書」，但要多一組建置輸出路徑與 `package.json` script，對單人自用專案是不必要的重複（一切從簡；已有 `NEWS_INGEST_OBSERVE` 先例採同一模式，維持一致性） |
| `commitBoardPush` 簽章新增 `diff`/`summary` 兩個參數，而非另立一個「組裝 publish 欄位」的新純函式 | `publish.boardSummary`/`publish.feed`（榜單那半）的寫入時機與 `board`/`lastBoardPushAt` 完全同源同次（FR-013 要求同一次原子寫入） | 另立函式：會製造「兩個純函式各自算一部分新 `BoardState`，呼叫端手動合併」的模式，違反 `commitBoardPush` 現有 docstring 承諾的「唯一狀態寫回轉換點」性質，且要多一層合併邏輯與對應測試 |
| `publish` 為獨立 GitHub Actions job，不是 `PipelineService` 第三個 segment | Pages 部署 action（`upload-pages-artifact`/`deploy-pages`）只能在 workflow 層執行；job 級隔離讓「發佈唯讀」在架構上自然成立，不需額外程式碼保證（FR-007） | 併入 `PipelineService` 第三段：省一次 `checkout`/`npm ci`，但拿掉了「Pages 部署動作只能在 workflow 層」帶來的天然邊界，得自己在程式碼裡另造一層紀律，且 Actions UI 會把核心推播與發佈兩種語意的失敗混在同一個 job 裡，不利於維運判讀（見 research D1） |
