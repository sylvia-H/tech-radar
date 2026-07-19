# Quickstart: Pipeline 端到端編排與 Discord 組版推播（F7）

驗證 F7 把 F2~F6 串成端到端、推上 Discord、並在**推播成功後**原子落檔。全程 mock 外部呼叫
（Discord push、Gemini via F5/F6、GitHub via F2/F4）——**不依賴真實網路/機密**（憲章 VIII）。

## 前置

```powershell
npm ci
npm run build   # tsc，strict，零 error
```

## 單元/整合測試（主驗證）

```powershell
npm test
```

覆蓋（憲章 VIII 必測 + 本 Feature SC）：
- `board-cadence` / `board-diff` / `push-board` / `board-commit` 既有測試**仍全綠**（F7 未動判定純函式）。
- 新增純函式：`decideNewsGuard`（D5）、`chunkEmbeds`（embed-split 契約六案例）、`buildDigestEmbeds`
  4096 拆分（D4）、`toBoardChangeDigest`（D6）、`buildCoverEmbed`/`buildRepoCard`（配色/可點/降級卡）。
- 段服務（mock 上游與 `DiscordWebhookService`）：`board-segment.service.spec` / `news-segment.service.spec`。

## 端到端驗證情境（以測試斷言，對應 spec User Stories / SC）

### US1 — 每日晨報端到端（非榜單日）
- **Given** `lastBoardPushAt` 距今 <162h、`lastNewsPushAt` 距今 ≥18h、F4 有候選、F6 回合規精選。
- **When** `PipelineService.run()`（mock）。
- **Then** 恰組**一則橙色晨報 embed** 並 `send` 一次；每則連結取自候選（無杜撰）；**推播成功後**
  `seenNews` 新增本次各則、`lastNewsPushAt` 前進、`save` 一次；**推播成功前 `state` 未寫回**（SC-001/003）。
- **降級**：F6 `degraded=true` → 照樣組版推播、晨報不中斷；各則仍寫回 `seenNews`（Acceptance 2）。
- **推播失敗**：`seenNews`/`lastNewsPushAt` **逐位元組不變**＋發紅色告警（Acceptance 3，SC-003）。
- **空精選**：0 則 → 不推、不前進 `lastNewsPushAt`（Acceptance 4，FR-006）。

### US2 — 晨報 idempotency guard（`decideNewsGuard`）
- `lastNewsPushAt` 距今 10h → **跳過整段**（不 ingest/LLM/推播/寫狀態），推播數 0。
- 距今 24h 或 `null` → 執行並推播一次。
- 正常日主排推完、補跑 <18h → 跳過（當日總推播維持 1）；主排漏跑、補跑 ~24h → 補推 1（SC-001）。

### US3 — 榜單日疊加（push-then-commit）
- **Given** `lastBoardPushAt` 距今 ≥162h（或 `null`）、綜合 top10 非空、diff 含新進與竄升。
- **Then** 每個新進/竄升取 250 字簡介（**快取命中不重生成**）、F6 一句封面 TL;DR、封面＋每項一張領域色卡
  並 `send`；掉出項不出現、下降以一行式列封面。
- **推播成功** → `commitBoardPush`（`board`+`lastBoardPushAt`）與本次 `intros` **同一次原子 save**。
- **推播失敗** → **不 commit**（`board`/`lastBoardPushAt`/`intros` 逐位元組不變、簡介不落檔）＋紅色告警
  （SC-002/003/006）。
- 簡介降級（`status='degraded'`）→ 可區分的 description 卡，榜單仍照推。

### US4 — 段間與來源隔離容錯
- 榜單段失敗（build 擲錯／空榜 `aborted`／推播失敗）→ **晨報段照常推播**＋榜單發紅色告警（SC-004）。
- **榜單段推播失敗＋同 run 晨報段推播成功** → 晨報段 `save` 後 `board`/`lastBoardPushAt`/`intros` 仍為榜單
  推播前狀態（榜單段就地生成的簡介經 entry 快照**還原**、未經共享 `state` 外溢落檔；C1/FR-011/SC-003）。
- 晨報段失敗 → 已落檔的榜單段狀態**不回滾**＋晨報發紅色告警。
- best-effort 告警自身送不出去 → 只記 error log、**不再擲錯**。
- 單源/單次 LLM 失敗 → 沿用 F4/F5/F6 既有降級，pipeline 不整條失敗。

### US5 — Discord 版面上限與冷啟動拆分
- 冷啟動集合（封面＋10 卡＋晨報＝12）→ `chunkEmbeds` 切 **2 則（10+2）**、順序不亂、無遺漏，任一則
  **不 >10**（SC-005）。
- 穩定態（4 embeds）→ 一則。
- 晨報 6 則逼近 4096 → 兩張晨報 embed。
- 配色/可點：卡片依領域上色、封面藍、晨報橙、標題 `url` 可點（Acceptance 4）。

## 手動煙霧測試（可選，需真實機密；非 CI 必要）

於**臨時 feature 環境**設 `GH_API_TOKEN`/`GEMINI_API_KEY`/`DISCORD_WEBHOOK_URL`（環境變數，勿入庫），
`node dist/main.cli.js`：
- 觀察 Discord 是否收到晨報（榜單日另有封面＋卡）；訊息數 = ⌈embeds/10⌉。
- 檢查 `state/board.json`：推播成功後 `lastNewsPushAt`（榜單日另含 `lastBoardPushAt`/`board`/`intros`）
  已更新且為完整（無半套）。
- `NEWS_INGEST_OBSERVE=1 node dist/main.cli.js` → 只印 F4 候選、不推播（除錯路徑，D7）。

> 注意：手動測試會真的推 Discord 與打 GitHub/Gemini；自用低頻，勿在 `develop`/`main` 直接跑。
