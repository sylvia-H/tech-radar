# Quickstart & 驗證指引: 001-foundation（M0）

本檔說明如何**驗證** F1 端到端可用（M0）。實作細節見 [plan.md](plan.md)、[data-model.md](data-model.md)、[contracts/](contracts/)。

## 前置

- Node.js 24 LTS（本機 nvm 24.18.0）、npm。
- 一個私人 Discord 伺服器與頻道，且已建立 Webhook，取得 `DISCORD_WEBHOOK_URL`。
- 一組 GitHub fine-grained PAT（唯讀 public repo）作為 `GH_API_TOKEN`（F1 只驗證存在）。
- 一組 Gemini API key 作為 `GEMINI_API_KEY`（F1 只驗證存在）。

## A. 本機驗證

```bash
npm ci
npm run build

# 以環境變數提供機密（勿寫進檔案）
DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/…" \
GH_API_TOKEN="…" \
GEMINI_API_KEY="…" \
node dist/main.cli.js
```

**預期**：
- 手機 Discord 頻道收到一則橙色「📡 Tech Radar 連通測試」embed（含時間戳）。→ 對應 **SC-001 / US1**
- 程序自行結束（exit 0），無常駐。

### 缺機密的負向驗證（US1 場景 2 / SC-003）

```bash
# 故意不帶 DISCORD_WEBHOOK_URL
GH_API_TOKEN="…" GEMINI_API_KEY="…" node dist/main.cli.js
```

**預期**：1 分鐘內以清楚錯誤訊息失敗、exit ≠0、**完全沒有推播送出**。

### App 內失敗告警（US3 場景 1 / SC-004）

以無效的 `DISCORD_WEBHOOK_URL`（格式對但 token 錯）或注入一個暫時性錯誤，確認 app 內 catch 會嘗試送紅色告警（若目的地本身不可用，至少 exit ≠0 並在 log 顯示）。

## B. GitHub Actions 驗證（M0 正式驗收）

1. Repo → Settings → Secrets and variables → Actions，新增：
   `DISCORD_WEBHOOK_URL`、`GH_API_TOKEN`、`GEMINI_API_KEY`。
2. Actions 頁 → 選 `tech-radar` workflow → **Run workflow**（`workflow_dispatch`）。
3. **預期**：
   - 手機收到橙色測試 embed。→ **SC-001**
   - Job 綠燈；若該次執行使狀態實際變更，`state/board.json` 出現一筆 `radar-bot` 的 commit。

### commit-back 驗證（US2 場景 2 / SC-002）

F1 成功執行本身可能**不**改動狀態（無資料來源），因此不會有 commit——這是預期行為（no-diff 早退）。要在 F1 明確驗證「狀態變更→commit+push 回 repo」的路徑，任一即可：

- **一次性人工變更**：本機或分支上手動改動 `state/board.json`（例如把 `lastNewsPushAt` 設為某時間戳）→ 觸發 workflow → 確認 workflow 步驟 5 產生 `radar-bot` commit 並 push 成功；驗證後還原。
- **或**在 F2/F3 首次寫入真實狀態時自然驗證（屆時每次執行都有 diff）。

無變更的執行則應**不**產生 commit（US2 場景 3）。

### 失敗告警：workflow 層（US3 場景 2 / SC-004 / FR-014）

暫時性地讓 `npm run build` 失敗（例如引入語法錯誤於分支），觸發 workflow：

**預期**：即使 app 從未執行，`if: failure()` 步驟仍送出一則紅色告警 embed 到手機。驗證後還原。

## 對應關係速查

| 驗證 | Spec 對應 |
|------|-----------|
| A / B 收到測試 embed | US1、SC-001、FR-004 |
| 缺機密快速失敗、無推播 | US1-2、SC-003、FR-002/003 |
| 狀態變更→commit；無變更→不 commit | US2、SC-002、FR-007/008、FR-015 |
| seed 骨架可讀入、欄位齊備 | US2-1、FR-005/006、FR-015 |
| app 內失敗紅色告警 | US3-1、SC-004、FR-010 |
| 啟動前失敗仍告警 | US3-2、SC-004、FR-014 |
| 雙 cron + 手動觸發 | FR-011 |
| 單次不涉外部來源/LLM | SC-005、FR-012 |
