# Quickstart: 驗證 F2 榜單來源與三領域歸類（M1）

驗收目標（M1）：**本機／Actions log 印出正確的三領域週增星榜**。本指引為驗證/執行步驟，實作細節見 [plan.md](plan.md)、[data-model.md](data-model.md)、[contracts/](contracts/)。

## 前置

- Node.js 24、已 `npm ci`、`npm run build`（沿用 F1）。
- 環境變數 `GH_API_TOKEN`（本機以 env 提供，勿寫入檔案；Actions 走 Secrets）。F2 不需 `GEMINI_API_KEY`／`DISCORD_WEBHOOK_URL` 亦能建榜，但 F1 env schema 仍要求三者存在（缺任一 fail-fast）；本機驗證時三者都給即可。

## 1. 單元測試（關鍵邏輯，憲章 VIII）

```bash
npm test
```

須全綠，且涵蓋：

- **Trending 解析快照**：`github-trending.service.spec.ts` 以 `tests/fixtures/trending-weekly.html` 比對；改選擇器或 GitHub 改版即紅（FR-009）。
- **分類**：topics 命中歸對領域；無 topics 靠 description；只有語言相符不歸類；跨領域擇一主領域（AI>DevOps>前後端）；皆無命中→排除（FR-003/FR-011）。
- **合併去重**：同一 repo 兩來源／改名樣本 → `repoId` 去重後只一筆（FR-004/SC-003）。
- **排序**：每領域 `weeklyStarsEstimate` 取 top 15；打亂來源順序名次不變（SC-005）；`ageDays=0` 不除以零。
- **容錯**：mock 主力失敗或 0 筆 → 補位仍出榜、且送帶來源 id 的告警（FR-007/FR-009/SC-004）。

## 2. 本機實跑（觀測 log）

```bash
# PowerShell：暫時提供機密給本次執行
$env:GH_API_TOKEN="<token>"; $env:GEMINI_API_KEY="x"; $env:DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/x/x"
node dist/main.cli.js
```

預期 log（格式見 [contracts/board-output.md](contracts/board-output.md)）：

- 印出 **AI / DevOps / 前後端** 三段，每段 ≤15 筆，每筆含**名次、`owner/name`、`weeklyStarsEstimate`、來源、領域**。
- 開頭一行印 `api: core=…, search=…`（供 SC-006 核對用量在安全範圍）。
- **不**送任何 Discord 訊息、**不**變更 `state/board.json`（`git status` 應無 `state/` 變更）。

## 3. 人工抽查（SC-002 / SC-001）

- 隨機挑 **≥10 個** repo（跨三領域），開其 GitHub 頁確認：領域歸類合理（**目標歸對率 ≥90%**，記錄實際比率）、`weeklyStarsEstimate` 與實際本週熱度相符（Trending 筆為官方週增星）。
- 確認補位來源確有「近 7 天新建、已累積相當星數」的新星（`[search]` 標記）。

## 4. 容錯情境（SC-004）

- 暫時將 Trending URL 指到不可達位址（或以測試替身模擬）→ 應：補位仍印出其榜、且收到一則指明 `github-trending` 的紅色告警；反之亦然。
- 兩來源皆正常時，**不**應出現任何來源告警。

## 5. Actions 觸發（可選）

- `workflow_dispatch` 觸發 radar workflow → 於 Actions log 看到同樣三領域榜輸出；確認未產生非預期的 `state/board.json` commit（F2 不寫狀態）。

---

**通過標準**：步驟 1 全綠 ＋ 步驟 2 log 印出欄位齊備的三領域榜 ＋ 步驟 3 抽查歸類合理 ＋ 步驟 4 容錯告警帶來源 id。達成即滿足 M1，可進入 F3（`003-board-state-diff`）。
