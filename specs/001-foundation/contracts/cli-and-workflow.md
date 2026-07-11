# Contract: CLI 進入點與排程 Workflow

## CLI 契約

```
node dist/main.cli.js
```

### 輸入（環境變數，全部來自 Actions Secrets）

| 變數 | 必填 | 說明 |
|------|------|------|
| `DISCORD_WEBHOOK_URL` | 是 | 推播與告警目的地 |
| `GH_API_TOKEN` | 是 | F2+ 使用；F1 僅驗證存在 |
| `GEMINI_API_KEY` | 是 | F5+ 使用；F1 僅驗證存在 |

### 行為與退出碼

| 情況 | 副作用 | Exit code |
|------|--------|-----------|
| 機密缺失/無效 | 早期擲錯、**不推播**、**不寫狀態**、不寫 marker（由 workflow 補送告警） | ≠0 |
| 執行成功 | 推一則測試 embed；（如有變更才）寫回 `state/board.json` | 0 |
| 執行中失敗 | app 內送紅色告警 embed；**成功送出後寫 marker 檔 `.radar-alert-sent`**（供 workflow 去重），送出失敗則不寫 marker | ≠0 |

- 進程**跑完即退**（`app.close()`），不啟 HTTP server、不常駐。
- 不讀 stdin、無互動；所有輸入來自環境變數。
- marker 檔 `.radar-alert-sent`（repo 根目錄，已列入 `.gitignore`）語意：「CLI 已成功送出失敗告警」。只在告警實際送達（HTTP 204）後寫入。

## Workflow 契約（`.github/workflows/radar.yml`）

### 觸發

| 觸發 | cron（UTC） | 台北 | 角色 |
|------|-------------|------|------|
| `schedule` | `7 22 * * *` | 06:07 | 主排 |
| `schedule` | `37 22 * * *` | 06:37 | 補跑 |
| `workflow_dispatch` | — | — | 手動驗證 |

### 必要設定

- `permissions: contents: write`（為 commit `state/board.json`）。
- `concurrency: { group: tech-radar, cancel-in-progress: false }`（避免手動撞排程造成 push 衝突）。
- Secrets：`DISCORD_WEBHOOK_URL`、`GH_API_TOKEN`、`GEMINI_API_KEY`。

### 步驟契約（順序）

1. `actions/checkout@v4`（含既有 `state/board.json`）。
2. `actions/setup-node@v4`（`node-version: 24`、`cache: npm`）。
3. `npm ci` → `npm run build`。
4. `node dist/main.cli.js`（帶三個 env secrets；step `id: run-app`）。
5. **Commit state（僅在變更時）**：`git add state/board.json` → `git diff --cached --quiet` 則早退（不 commit）；否則先設 committer 身分 `git config user.name "radar-bot"` / `user.email "radar-bot@users.noreply.github.com"` → `git commit -m "chore: update board state [skip ci]"` → `pull --rebase --autostash` + `push`，重試至多 3 次，最終失敗 `::error::` 並讓 job 失敗。
6. **告警（`if: failure()` + marker 去重）**：任何步驟失敗都會進入此步；script 內先檢查 marker 檔 `.radar-alert-sent`——存在（CLI 已成功送出告警）即跳過，缺席才以 `curl` POST 紅色 embed 到 `DISCORD_WEBHOOK_URL`。因此涵蓋：app 啟動前失敗（步驟 1–3）、app 啟動階段失敗（env 驗證/DI，`run-app` 失敗但 CLI 未及送告警）、CLI 告警送出本身失敗、以及狀態 commit/push 失敗（步驟 5）。

### 不變條件

- 步驟 6 保證：只要 CLI 未成功送出告警（無論失敗發生在哪一層），workflow 必補送一則，失敗仍可見（FR-014）。
- 去重依據是「CLI 明確回報已送出」（marker 存在），而非推測 `run-app` 的 outcome；pipeline 失敗且 CLI 告警成功送出時，步驟 6 跳過，確保單一失敗通常只送一則告警。marker 寫入失敗的極端情況下可能重複一則——設計上**寧可重複、不可沉默**。
- 狀態 commit 僅在實際 diff 時發生（FR-007 / 憲章 v1.0.1）。
- 保活由（正式期）每日狀態變更與（開發期）程式碼 commit 自然維持，不製造空 commit。
