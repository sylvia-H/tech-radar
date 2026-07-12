# Contract: GitHub 榜單來源（Trending HTML + Search API + repos）

F2 對外倚賴的三個 GitHub 介面。所有請求走共用 `src/github/github-http.ts`（UA、Auth、條件式請求、退避、有限並發，見 research D9）。

---

## 1. 主力：Trending weekly（HTML 爬取）

- **端點**：`GET https://github.com/trending?since=weekly`；語言頁 `GET https://github.com/trending/{lang}?since=weekly`，`{lang}` ∈ `typescript`／`javascript`／`python`／`rust`／`shell`（＋全站，共 6 次）。
- **認證**：不需 token（公開網頁）；仍送自訂 `User-Agent`、支援 `If-None-Match`（ETag）。
- **解析**（`cheerio`）：逐 `article.Box-row`：
  - `fullName` ← `h2 a` 文字去空白（`owner/name`）
  - `description` ← `p` 文字
  - `language` ← `[itemprop="programmingLanguage"]` 文字（可空）
  - `starsThisWeek` ← `.float-sm-right` 文字取數字
- **輸出**：`RawTrendingRepo[]`（見 data-model）。跨 6 頁先以 `fullName` 去重。
- **topics 補抓**：Trending HTML 不含 topics → 每個唯一候選再打「§3 repos」。
- **失敗與 0 筆**（FR-009）：HTTP 失敗按退避重試；重試耗盡或**解析結果 0 列/欄位抽不到** → 送告警 `source=github-trending`，**不**視為「本週無熱門」，主力候選當空、補位仍續行。
- **回歸保護**（FR-009、憲章 VIII）：以 `tests/fixtures/trending-weekly.html` 快照測試鎖住選擇器；GitHub 改版導致解析漂移時測試先紅。

## 2. 補位：Search API（新崛起）

- **端點**：`GET https://api.github.com/search/repositories`
- **認證**：`Authorization: Bearer $GH_API_TOKEN`；`Accept: application/vnd.github+json`。
- **查詢**（三組，各一次；門檻 clarify 已定）：

  | Domain | `q` | 備註 |
  |--------|-----|------|
  | `ai` | `(llm OR rag OR agent OR gpt) created:>{today-7d} stars:>30` | `sort=stars&order=desc&per_page=30` |
  | `devops` | `(kubernetes OR terraform OR gitops) created:>{today-7d} stars:>20` | 同上 |
  | `frontend-backend` | `(nextjs OR react OR svelte OR nodejs OR golang) created:>{today-7d} stars:>20` | 同上 |

- **回應取用欄位**：`id`(→`repoId`)、`full_name`、`description`、`language`、`topics`、`stargazers_count`(→`totalStars`)、`created_at`。**topics 隨回應返回**，補位候選免再打 /repos。
- **限額**：Search 30/min；F2 僅 3 次。逼近 `X-RateLimit-Remaining` 時退避。
- **失敗與 0 筆**（FR-007）：某組查詢失敗 → 告警 `source=github-search:{domain}`，其餘組與主力續行；三組皆 0 筆屬正常（可能該週無新星），不告警（與「解析失敗」區分）。

## 3. topics 補抓：`GET /repos/{owner}/{repo}`

- **端點**：`GET https://api.github.com/repos/{owner}/{repo}`
- **認證**：同上 Bearer token。
- **對象**：僅 **Trending 唯一候選**（Search 候選已有 topics）。
- **取用欄位**：`id`(→`repoId`)、`topics`、`stargazers_count`、`created_at`。
- **禮貌**：有限並發 ≤6、條件式請求；讀 `X-RateLimit-Remaining`。預算見 research D2（≤~120 次）。
- **失敗**：單一 repo 的 `GET /repos` 失敗（重試耗盡）→ 因 Trending HTML 不含 `repoId`，該候選**無法取得 `repoId`**，MUST **略過該筆**（無 `repoId` 無法去重與穩定入榜，見 board-output／data-model「`repoId` 必填」），**不**中斷全流程。**告警門檻**（`source=github-repo`）：出現 **401/403** 即告警一次（憑證／權限層級問題）；其餘錯誤於該批次**失敗率 > 50%** 時告警一次；未達門檻的零星失敗僅略過、不告警。

---

## 通用要求

- **User-Agent**：固定自訂字串（如 `tech-radar/1.0 (+github-actions; personal)`）。
- **條件式請求**：`github-http` 介面支援「有快取值（ETag／Last-Modified）才帶對應 header」。**F2 屬機制骨架（no-op）**：F2 不持久化任何狀態、單次執行內同一 URL 只請求一次，執行期無前值可帶；不得為此另建快取檔（違「不引入新狀態」）。測試以注入快取值驗證 header 送出即可；實際生效留待 F5+ 有跨請求快取的情境。
- **退避**：5xx / 429 / 網路錯誤 → 指數退避＋jitter（憲章 VII、§12）。
- **機密**：`GH_API_TOKEN` 只從 env 讀、**絕不**寫入 log／`CurrentBoard`／任何產物（憲章 VII）。
- **只讀公開資料**：不觸及私有 repo（FR-008）。
