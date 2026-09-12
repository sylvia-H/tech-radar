# 新聞來源與篩選機制調校計畫（2026-09-12 評估）

依 2026-09-12 對上線一個多月（2026-08-27～09-12 推播 117 則、近 34 次 Actions 執行、離線重播漏斗）
的評估結果，分四支修正分支依序進行；每支分支獨立 `--no-ff` 合回 `develop` 後才開下一支。
本檔為執行勾選清單，**設計細節以 dev-guide §4.2／§4.4 為真實來源**，每支分支合併前 MUST 同步修訂。

流程約定（2026-09-12 使用者決策）：
- 不另開 Spec Kit Feature；比照既有 `fix/*`／`chore/*`／`feat/*` 調校分支慣例。
- 每支分支：可切分的任務交背景 agent 並行 → 全量 `npm run build` + `npm test` → Opus review agent
  交叉審查 → 修正 findings → 依性質分段 commit → `git merge --no-ff` → **直接 push `origin/develop`**
  （已授權，不逐次詢問）。
- 需使用者決策之處停下詢問，釐清後才繼續。

已定案的決策：
- 來源變更：停用 vue-blog、simonwillison 改 entries feed、cloudflare-blog 降 tier 3、新增 GitHub Changelog
  Copilot 標籤 feed（ai/tier2）與 kubernetes.io blog（devops/tier2）。**不再添加其他來源**（實測 30 餘個
  候補 feed 皆不合格）。
- HN 抓取視窗 7 天 → **4 天**。
- 非 AI 動態放寬上限**維持 7**、憲章不動，先觀察。

---

## 分支 1：`fix/dedup-freshness`（去重污染根因）

證據：openai-blog feed 含整站封存 1192 篇；離線重播 108 次標題合併中 76 次為其舊文互吞，另有 2 次跨來源
誤吞（Simon 4 天前「ChatGPT Images 2.5」被 144 天前「Images 2.0」吞掉後整則消失；HN「OpenAI Agents API」
與 2020 年「OpenAI API」合併得到不實交叉驗證 +100）。根因：新鮮度視窗套在漏斗末端，去重時舊文仍在場。

- [x] T1 新鮮度視窗提前：`NewsIngestService` 在 URL 去重**之後、標題去重之前**（review F3：URL 精確合併不可能誤吞，且須保留低分 HN＋同 URL 官方舊文的交叉驗證豁免）對 `score === null` 候選套用
      `freshnessWindowDays`（30 天，HN 有分數者豁免）；漏斗內既有檢查保留為結構性保險（同一判定、目前不可達，review F5）；新增
      `[漏斗 A] 新鮮度視窗後：N 則` log。
- [x] T2 標題合併日期差上限：`dedupByTitle` 新增 `maxPublishedGapDays`（預設 14，`TITLE_MERGE_MAX_GAP_DAYS`）；
      比對對象為**群組最早／最晚日期範圍**而非當前代表項（review F1/F2：無日期高分 HN 代表項會抹掉群組日期、
      三則相似標題可鏈式漂移出 28 天）；候選缺日期者維持可合併（向後相容）。
- [x] T3 觀測：`collect()` 逐來源 log 原始則數（`parsedCount` 與過濾後 `items` 數），含 0 筆來源（review F4）。
- [x] T4 `seenNews` 條目新增可選欄位 `sourceId`、`sources`（review 裁決：只記代表項會低估一手來源）、`domain`（schema `.optional()` 向後相容）；
      `CuratedNewsItem` 帶 `sourceId`（代表項來源）；`news-segment` 寫回時填入；`publish.news` 持久化
      schema 同步加可選欄位。
- [x] T5 單元測試：T1（ingest spec：舊文於去重前被丟、HN 豁免）、T2（dedup spec：日期差超限不合併、
      缺日期仍合併、既有案例不變）、T4（schema 向後相容、寫回含欄位）。
- [x] T6 dev-guide §4.4 階段 A 第 2、6、7 點與 §5.1 `seenNews` 結構同步；README 測試數量同步。
- [x] Opus review（6 findings：F1/F2 中、F3 中低、F4/F5/F6 低，全部採納）→ 修正 → 全量 523 測試通過 → 分段 commit → merge --no-ff → push。

## 分支 2：`chore/news-sources-2026-09`（純設定檔）

- [ ] 停用 `vue-blog`（feed 最新 741 天前，比照 web-dev 註記「停用觀察」）。
- [ ] `simonwillison` URL 改 `https://simonwillison.net/atom/entries/`（註記 blogmark 重複推播證據：
      2026-09-05 collusion.wiki 與 rogue-agent-wikis 同事兩推）。
- [ ] `cloudflare-blog` tier 2 → 3（註記：117 則推播中佔 24 則、含公關文）。
- [ ] 新增 `github-changelog-copilot`（`https://github.blog/changelog/label/copilot/feed/`，ai，tier 2）。
- [ ] 新增 `kubernetes-blog`（`https://kubernetes.io/feed.xml`，devops，tier 2）。
- [ ] 上線前以 `NewsHttp` 同一 UA 實測兩個新 feed 200 且量體正常；`news-source.schema.spec` 通過。
- [ ] dev-guide §4.2 三層表格同步；一個來源一個 commit。
- [ ] Opus review → merge --no-ff → push。

## 分支 3：`fix/hn-noise`（HN 候選品質）

證據：今日候選池 24/50 席為 HN，含 1 則 2025 舊文（標題尾綴「(2025)」，HN 豁免新鮮度）、3 則
twitter/mastodon 貼文（摘要 null）、2 則 Ask/Tell HN；同一批未入選候選被 LLM 重複評估最多 7 次。

- [ ] HN 視窗 7 天 → 4 天（`hn-algolia.fetcher`，dev-guide §4.3「本週口徑」需改寫說明）。
- [ ] HN 標題尾綴 `(YYYY)` 且 YYYY < 當年 → 丟（fetcher 層，`now` 注入）。
- [ ] 社群平台 host 過濾：`twitter.com`／`x.com`／`bsky.app`／`threads.net`／`*.mastodon.*` 與已知
      Mastodon 實例（`mathstodon.xyz`、`fosstodon.org`、`hachyderm.io`、`mastodon.social`）→ 丟；
      清單獨立為資料檔（比照 `news-domain-keywords.ts`，增刪不動邏輯）。
- [ ] 單元測試：舊年份尾綴、社群 host、視窗邊界。
- [ ] dev-guide §4.3／§4.4 同步。
- [ ] Opus review → merge --no-ff → push。

## 分支 4：`feat/curation-community-criteria`（策展判準）

證據：8/4 把「高信度社群任何形式內容」列為重大後，實際推出訴訟、當機、募資、Amiga 遊戲移植、
Apple Mac Mini 需求等「熱門非重要」內容（dev-guide §12 已警告的風險）。

- [ ] prompt「(2)【社群熱度】」限縮為「社群熱度**且**內容具技術／實作／工具面向」；明列排除：
      募資、人事、訴訟、監管政策、服務當機、非開發領域趣聞（除非改變開發者可用的服務或 API）。
- [ ] 「不算重大」清單加入：廠商認證／合規公告、統計或威脅報告、公關文（對應 cloudflare 類內容）。
- [ ] prompt 不加入任何數字（憲章 §12 錨定教訓）。
- [ ] `curation.service.spec`／prompt 快照測試同步。
- [ ] dev-guide §4.4 階段 B 同步。
- [ ] Opus review → merge --no-ff → push。

## 擱置（使用者決策 2026-09-12）

- 非 AI 動態放寬上限 7 → 5：維持 7，待四支分支上線觀察兩週後再議。
- 科技／科學新聞晨報（第二資料流）：需先修憲章 III／V 再開 Feature 009，暫緩。
