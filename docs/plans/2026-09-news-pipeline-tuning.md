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

- [x] 停用 `vue-blog`（feed 最新 741 天前，比照 web-dev 註記「停用觀察」）。
- [x] `simonwillison` URL 改 `https://simonwillison.net/atom/entries/`（註記 blogmark 重複推播證據：
      2026-09-05 collusion.wiki 與 rogue-agent-wikis 同事兩推）。
- [x] `cloudflare-blog` tier 2 → 3（註記：117 則推播中佔 24 則、含公關文）。review 指出 Tier 3 無分數候選加權 50 排在所有
      Tier 1/2 之後，候選池滿時整批截掉、近似停用；已據實改寫設定檔註解、dev-guide 與 README。
- [x] 新增 `github-changelog-copilot`（`https://github.blog/changelog/label/copilot/feed/`，ai，tier 2）。
- [x] 新增 `kubernetes-blog`（`https://kubernetes.io/feed.xml`，devops，tier 2）。
- [x] 上線前以 `NewsHttp` 同一 UA 實測兩個新 feed 200 且量體正常（copilot 10 筆、k8s 50 筆、simon entries 15 筆）；`news-source.schema.spec` 通過。
- [x] dev-guide §4.2 三層表格同步；一個來源一個 commit。
- [x] Opus review（10 findings：F1 Tier 3 實際效果、F2 前後端文章來源歸零、F3 simon 代價未記，餘為文件一致性）→ 全部採納、以文件與註解修正 → merge --no-ff → push。

## 分支 3：`fix/hn-noise`（HN 候選品質）

證據：今日候選池 24/50 席為 HN，含 1 則 2025 舊文（標題尾綴「(2025)」，HN 豁免新鮮度）、3 則
twitter/mastodon 貼文（摘要 null）、2 則 Ask/Tell HN；同一批未入選候選被 LLM 重複評估最多 7 次。

- [x] HN 視窗 7 天 → 4 天（`hn-algolia.fetcher`，dev-guide §4.3「本週口徑」需改寫說明）。
- [x] HN 標題尾綴 `(YYYY)` 且 YYYY < 當年 → 丟（fetcher 層，`now` 注入）。
- [x] 社群平台 host 過濾：`twitter.com`／`x.com`／`bsky.app`／`threads.net`／`*.mastodon.*` 與已知
      Mastodon 實例（`mathstodon.xyz`、`fosstodon.org`、`hachyderm.io`、`mastodon.social`）→ 丟；
      清單獨立為資料檔（比照 `news-domain-keywords.ts`，增刪不動邏輯）。
- [x] 單元測試：舊年份尾綴、社群 host、視窗邊界。
- [ ] （合併後觀察）回測第 1 輪保底：HN 席數是唯一變數（目前 19 個無分數來源 → HN ≤ 31 席才成立，09-12 實測 24 席）；視窗
      縮到 4 天後以逐來源 log 確認 HN 席數下降、Tier 3 來源是否重新可見；並確認 Tier 3／低權重來源是否因 HN 同 URL
      合併機會減少（視窗 4 天）而反向變差。
- [x] dev-guide §4.3／§4.4 同步。
- [x] Opus review（9 findings，全部採納）→ 修正 → merge --no-ff → push。

## 分支 4：`feat/curation-community-criteria`（策展判準）

證據：8/4 把「高信度社群任何形式內容」列為重大後，實際推出 OpenAI 被控竊取數學家成果、三家模型
同時當機、Amiga 遊戲移植 Godot、Apple Mac Mini 需求、Bloomberg／CNBC 商業報導、圍棋名手擊敗 KataGo
等「熱門非重要」內容（dev-guide §12 已警告的風險）。其中「三家模型同時當機」依新判準仍算重大，
屬下述第 (3) 類。

- [x] prompt「(2)【社群熱度】」限縮並改名為「(2)【技術深度內容】」：技術深度是必要條件、社群熱度是
      加分訊號（review 指正：若把高熱度當必要條件，無分數的一手部落格深文三類皆不命中會被系統性
      刷掉）；明列排除：募資／估值、人事異動、訴訟／指控的進行中進展（已生效判決若改變開發者可用的
      工具／授權／API 依 (3) 收錄）、與軟體開發無關的趣聞（遊戲引擎／圖形效能技術與硬體技術評測不在
      此列）。**監管政策與服務當機不排除**（使用者決策 2026-09-12：兩者對開發者有實際影響）——
      另立第 (3) 類【影響開發者的外部事件】，歸入 `officialPicks`（`officialPicks`＝(1)＋(3)、
      `communityPicks`＝(2)；與官方發布同為穩定事實紀錄，不被社群內容擠掉）；同時命中 (2)／排除清單
      時以 (3) 為準（否則 HN 高分帶入的當機事故會落入 `communityPicks` 被截掉）。
- [x] prompt 補「只依候選標題與摘要改寫、不得補充來源未提供的事實、素材不足時寫短一點」（dev-guide
      原本只有文件宣稱、prompt 未寫）與「只能有 `officialPicks`／`communityPicks` 兩個鍵、不得新增
      其他鍵」（parse 對額外鍵以 `warn` 揭露）。
- [x] 「不算重大」清單加入：廠商認證／合規公告、統計或威脅報告、行銷公關文（對應 cloudflare 類內容）。
- [x] prompt 不加入任何數字（憲章 §12 錨定教訓）。
- [x] 新增 `curation-prompt.spec.ts`：斷言三類判準與排除清單措辭、「配額段除 10 外不含數字」
      （原規劃為 `curation.service.spec`／prompt 快照同步）。
- [x] dev-guide §4.4 階段 B 同步（判準結構、排除清單、第 (3) 類歸 `officialPicks` 理由）；§12
      「晨報只挑熱門的風險」加註；README 第 7 關與工程亮點第 4 點同步。
- [ ] （合併後觀察）每日總則數與非 AI 則數是否下滑（判準限縮可能壓低供給）；HN 高分帶入的當機／監管
      事件是否確實落在 `officialPicks`。
- [x] Opus review（11 findings，除「收窄監管政策排除出口管制」一項因使用者決策不採外全部採納）→ 修正
      → merge --no-ff → push。

## 擱置（使用者決策 2026-09-12）

- 非 AI 動態放寬上限 7 → 5：維持 7，待四支分支上線觀察兩週後再議。
- 科技／科學新聞晨報（第二資料流）：需先修憲章 III／V 再開 Feature 009，暫緩。

## 2026-09-14 追加：AI 技術深度來源＋收斂上限（使用者決策）

依 1.1.0 上線後兩日觀察（09-13 Flash 首次呼叫失敗退 Lite、09-14 Flash 正常）與 08-25～09-14 共 20 次晨報統計：
平均 7.0 則／日、AI 入選平均 3.7 則、最高 6 則、**從未達 7**，非 AI 動態上限從未夾到任何一則；AI 池約 30 則中
多為 HN 輿論與廠商行銷（AI 入選率 12%，三領域最低）。結論：問題在供給品質而非配額，**補技術深度一手來源優先
於放寬策展判準 (2)**（來源只改設定檔、可逐一開關、效果可歸因；prompt 放寬須回測且有錨定風險）。

- [x] 實測 22 個候補 AI feed（curl 狀態碼／筆數／最新日期＋專案 rss-parser 解析）。
      入選：`raschka-ahead-of-ai`、`interconnects`、
      `ollama-blog`，皆 ai／tier 2。`huggingface-blog` 技術上可重啟（08-04 移除原因已因 09-12 新鮮度視窗提前而消失），
      使用者 09-14 決定先不啟用、以停用項列回清單。落選與原因記於 `news-sources.ts` 註解（mistral PR 為主、google／microsoft
      research 學術、blog.google 行銷、latent.space 彙整、importai 政策、github ai-and-ml 與 changelog 重疊、
      claude-code releases 純 changelog；anthropic 兩端點仍 404）。
- [x] `convergeMax` 50 → 60：3 個無分數來源 +9 席，不調高會把 Tier 3（thenewstack 09-13 有入選）與低分 HN
      整批擠掉；`funnel.spec`／`news-ingest.service.spec` 對應調整。
- [x] 同步 dev-guide §4.2 Tier 2 表、§4.4 收斂段；README 一眼看懂／架構圖／來源表／治理原則。
- [x] 同支變更另含：`validateCuration` 剔除回呼＋`NewsCurationService` 一行 warn（連兩日「選 N → 驗證後 N−1」
      無 log 可判）。
- [ ] （合併後觀察一週）AI 入選是否由平均 3.7 上升、`communityPicks` 是否由 3 上升、thenewstack 與 HN 席次
      是否維持（HN 常態 14～17 席）、新來源是否被同來源 3 輪上限或 30 天視窗擋成啞源；若 AI 仍不到 5，
      再動 prompt，第一刀只加「tier 與分數反映來源信度、不反映內容深度」。
- 前後端供給（候選池平均 2.3 則、常有 0 則）另案：`vercel.com/atom` 可用但 1,574 筆多為 changelog，需另評估。

## 2026-09-21 追加：逐來源新鮮度視窗、停用 interconnects（使用者決策）

依 09-21 晨報（第二批修正上線首日）檢視：Flash 失敗成因確證為 503 UNAVAILABLE，新退避下第 3 次成功；
k8s v1.37 系列 09-12～09-21 共推 15 篇、每日滴一兩篇，09-20／09-21 推的是 08-26／08-28 舊文。

- [x] `NewsSource.freshnessWindowDays`（選填、1～30 整數，schema 把關只能縮短）；`NewsIngestService` 新鮮度步驟
      依候選各來源視窗取最大值；`kubernetes-blog` 設 10 天。測試：schema 邊界、逐來源丟棄、URL 合併取最大值。
- [x] `interconnects` 停用（09-15～09-21 每日 3～4 席、0 入選）。
- [x] 同步 README 來源表／治理原則／測試數、dev-guide §4.2 來源表與 §4.4 第 7 步。
- [ ] （合併後觀察）k8s-blog 是否停止滴舊文、仍能在發文 10 天內入選新系列；退避參數維持 10s／60s，觀察一週
      Flash 成功落在第幾次嘗試再議。

### 同日追加：AI 來源補強（使用者決策）

09-13～09-21 AI 入選 40 則／8 天（HN 21、changelog-copilot 10，官方 blog 類極少）；候選池 AI 約 36 則但多為 HN
輿論與廠商公關，瓶頸在合格供給而非配額（「7」只是非 AI 放寬門檻，不是 AI 目標；重新引入 AI 下限會重演 08-04
錨定）。實測 29 個候補 feed 後，使用者選定：

- [x] `huggingface-blog` 重新啟用（30 天 15 篇）、新增 `github-blog-ai-ml`（30 天 10 篇），皆 ai／tier 2。
      席次：+6、扣 interconnects −3，淨 +3；近一週候選池 48～56 則，可能觸及 `convergeMax` 60。
- 落選：Google Developers Blog（item 無日期，會被新鮮度視窗全丟）、AWS ML／together.ai（廠商文）、
  r/MachineLearning（學術閒聊）、openai/codex releases（alpha 洪流）、多個個人 blog 30 天 0 篇、pytorch／vllm／
  anthropic engineering／meta AI 404／403、langchain feed 解析失敗。Cursor changelog、InfoQ AI 為候補。
- [ ] （合併後觀察一週）AI 入選是否由平均 5.0 上升、兩新來源入選數、候選池是否觸頂 60 而擠掉 thenewstack 與低分 HN。

## 2026-09-25 追加：策展型號改 gemini-3.7-flash（使用者決策）

09-22～09-25 四日回顧：則數 10／9／5／7、AI 6／5／4／6；候選池 49／60／54／59，各來源席次健康
（thenewstack 每天 3 席、kubernetes-blog 每天 1 席且都在 10 天視窗內 → 逐來源視窗有效）。新來源合計入選
6／31（github-blog-ai-ml 4、huggingface-blog 2）。**則數大減與來源無關**：09-24／09-25 兩天 `gemini-3.8-flash`
四次重試全撞 503，退 Lite 策展，Lite 只選 5／7 則。

- [x] `GEMINI_MODEL_NEWS`：`gemini-3.8-flash` → `gemini-3.7-flash`（只改常數，分流與降級機制不動）。
      **同日再次改動、取代此項**：策展主備型號皆改 Flash-Lite 系——主 `gemini-3.5-flash-lite`、新增常數
      `GEMINI_MODEL_NEWS_FALLBACK` = `gemini-3.1-flash-lite` 作備援（`generateWithModelFallback` 改用它，
      log 字樣由「Flash／Lite」改為「主型號／備援型號」）。理由：新篩選邏輯候選池 60→70、每日輸出至多
      15 則，Flash 系 5 RPM／20 RPD 餘裕與 503 過載風險都不划算，Lite 額度高一級。3.1-flash-lite 官方公告
      shutdown 2027-05-07（2026-09-25 覆核），到期前須換。
- 使用者同時決定：Flash→Lite 降級**不加** Discord 告警（維持只寫 log）。
- [ ] （觀察）主型號 Lite 首次呼叫是否還會失敗、錯誤碼是 503 還是 429、備援 3.1-flash-lite 是否真的可用
      （目前只憑官方 deprecations 頁覆核，本機無 GEMINI_API_KEY 無法 ListModels）；**品質面**：Lite 策展日
      則數變異較大（09-13～09-25 四個 Lite 日 9／9／5／7 則），若連續一週明顯偏低、或新 prompt 的「未歸類
      高熱度」候選全數不選，就改回 Flash 系（只改 `llm.types.ts` 常數）。

## 2026-09-25 追加：未歸類高熱度通道、同題群集、晨報上限 15（使用者決策）

起因：使用者反映 09-15 起 Jev（TypeSafe AI 的 System One 決策模型）崛起、晨報全無。診斷（Actions log 重放
09-15～09-25 十一次執行＋Algolia 重播四天 HN top 100）：HN「Introducing System One Models and Jev」1979 分在
四天視窗內每日被抓到、每日被 `cross` 關鍵字歸類（標題無 AI 關鍵字）靜默丟棄，log 只有「領域歸類後 -96」計數；
關鍵字歸類每日丟 72～85% 的 HN top 100，≥300 分被丟者 38～53 則，含 MiMo v2.6（1126）、OpenJev（721）、
Grok 4.7（607）、Qwen 3.8 Omni Flash（346）。進到候選池的 Jev 二手內容（simonwillison 連 4 天、arcturus-labs
251～323 分、reddit、lobsters、thenewstack T3）LLM 全未選；「Jev in 25 Lines of Python」因只命中 python 被歸
前後端、且 09-24／25 皆為 Lite 降級日。TypeSafe 官方 blog 無 RSS（5 個端點 404），新玩家事件只能靠 HN／Reddit／
Lobsters 偵測。**使用者原則：高熱度但關鍵字歸類不到的候選不是雜訊，而是「我不知道、但應該關注」的新聞本身。**

- [x] 未歸類高熱度通道：`resolveDomains` 無命中時 (a) 沿用 URL 合併來源領域 (b) 分數 ≥300 者以 `cross` 保留
      (c) 其餘丟；`runFunnel` 依分數取前 10 則（`unresolvedMinScore`／`unresolvedMaxCount`）、`convergeMax` 60 → 70；
      `fallbackDigest` 排除未歸類；log 揭露保留數／入池數／名額外剔除數。
- [x] 同題群集（`topic-cluster.ts`）：同一罕見 token 跨 ≥2 來源 ≥3 則 → 投影前綴「🔥同題「X」×N（M 來源）」；
      停用清單含泛用詞、三桶關鍵字、人人皆知的產品名。
- [x] prompt：領域欄「未歸類」、正向先驗段落、同題段落、輸出規則要求未歸類候選回填 `domain`（文字不含阿拉伯數字）；
      `curation-parse` 只保留合法 domain；`curation-validate` 落定領域、未回填預設 ai 並 warn（`onDomainDefaulted`）。
- [x] 配額：`MAX_ITEMS` 10 → 15、`MAX_NON_AI` 3 → 5（AI 隱含 7 → 10），憲章 1.7.0、CLAUDE.md、dev-guide、README 同步。
      上限是天花板不是目標，prompt 仍無任何下限。
- [x] Discord：`chunkEmbedsByBudget`（張數 ≤10 且合計 ≤6,000 字元）取代晨報段的 chunk-by-10——15 則可拆成三張近
      4,096 的 embed，合計會被 Discord 整則拒收。
- [x] 測試 579 → 625（funnel／ingest／topic-cluster／prompt／parse／validate／fallback／embed-split）。
- 未做（有意）：不擴充關鍵字表（治標；OpenJev／Astra／Dario 類專有名詞仍救不到）；不加 TypeSafe 來源（無 RSS）。
- [ ] （合併後觀察一週，至 10-02）每日「未歸類高熱度入池 K 則」與其中入選數；同題群集是否命中真實新事件、是否被
      泛用詞污染（若某 token 天天出現請加進 `CLUSTER_STOP_TOKENS`）；未歸類候選被 LLM 選入時 `domain` 回填率
      （「未歸類候選未回填 domain」warn 次數）；則數是否上升到 10～15、非 AI 是否被夾到 5；候選池是否觸頂 70
      擠掉 thenewstack；Lite 主型號（見同日型號段落）在 70 候選／15 則輸出下是否出現輸出截斷（`LlmError('empty')`
      不重試、直接換備援）或則數偏低——若連續一週偏低或未歸類候選全數不選，回 Flash 系。

### 同日追加：LLM 用量 log（使用者決策，回應「候選池變大是否該分三批送」）

估算 worst case（70 候選、每則摘要 500 字）prompt 約 47k 字元 ≈ 14k tokens、回應 15 則約 8.5k 字 ≈ 9.4k tokens，
離 Flash-Lite 的 1M context／65k 輸出上限甚遠；過去失敗皆為 503 過載、非大小。拆批會破壞未歸類通道（候選尚無領域）、
同題群集與殘留去重（需一次看全池）、非 AI 動態上限（需先知 AI 則數），並讓 503 曝險倍增且違反憲章 V「每日僅呼叫一次」，
故**不拆批**；先補可觀測性，用數據判斷。

- [x] `LlmService.generate` 成功時 log「LLM 用量（型號，prompt N 字元，tokens 輸入／輸出／思考／合計，finishReason=…，
      回應 M 字元）」；空回應時 warn 同一組數字後才擲 `LlmError('empty')`（此前只有 reason=empty，看不出是否 MAX_TOKENS）。
      只印數字，不含 prompt／回應內容。
- [ ] （觀察一週）策展呼叫的 promptTokenCount 常態值與最大值、thoughtsTokenCount 是否吃掉可觀輸出額度、是否出現
      finishReason=MAX_TOKENS。若出現截斷，第一刀是投影摘要由 500 字截 250 字（prompt −37%），其次降 `convergeMax`；
      拆批列為最後手段且須先修憲章 V。
