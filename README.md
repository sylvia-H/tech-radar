# Tech Radar

排程型自用 Tech Radar。**Feature 001（Foundation）** 打通「排程執行環境 → Discord 私人頻道」的推播通道，並建立唯一權威狀態 `state/board.json` 的讀寫與 schema 骨架。本階段**不含**任何資料來源抓取、LLM 或新聞漏斗（範圍見 [spec FR-012](specs/001-foundation/spec.md)）。

## 架構概要

一支跑完即退的 NestJS 一次性 CLI job（`NestFactory.createApplicationContext`，不啟 HTTP server）：

```
載入設定（env 驗證，缺機密→fail-fast 不推播）
  → StateStore.load()（缺檔→空骨架；壞檔→告警）
  → 推測試 embed（Discord webhook）
  → 推播成功後 StateStore.save()（僅實際變更才由 workflow commit）
```

模組：`config`（env zod 驗證）、`discord`（webhook 推播）、`state`（狀態讀寫）、`pipeline`（編排）。`sources / classify / news-filter / diff / intro / summary / llm` 等留待 F2–F8。

## 環境需求

- Node.js 24 LTS（本機建議 nvm `24.x`；CI 用 `actions/setup-node@v4` `node-version: 24`）
- npm

## 機密（三項皆必填）

| 變數 | 用途 | F1 |
|------|------|----|
| `DISCORD_WEBHOOK_URL` | 推播與告警目的地 | 使用 |
| `GH_API_TOKEN` | GitHub API（唯讀 public repo） | 僅驗證存在 |
| `GEMINI_API_KEY` | Gemini API | 僅驗證存在 |

**機密只走環境變數／GitHub Actions Secrets，絕不入庫**（`.env` 已列入 `.gitignore`）。

## 本機執行

```bash
npm ci
npm run build

# 以環境變數提供機密（勿寫進檔案）
DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/…" \
GH_API_TOKEN="…" \
GEMINI_API_KEY="…" \
node dist/main.cli.js
```

預期：手機 Discord 頻道收到一則橙色「📡 Tech Radar 連通測試」embed；程序自行結束（exit 0）。缺機密則 1 分鐘內清楚失敗、exit≠0、無推播。

Windows PowerShell：

```powershell
$env:DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/…"
$env:GH_API_TOKEN="…"; $env:GEMINI_API_KEY="…"
node dist/main.cli.js
```

## 測試

```bash
npm test
```

涵蓋 env 驗證、embed 組版、Discord 推播（204/429 退避/失敗，斷言不含機密）、狀態 schema 與 StateStore（缺檔/壞檔/round-trip/穩定鍵序）。

## GitHub Actions

`.github/workflows/radar.yml`：`workflow_dispatch` + 雙 cron（UTC `7 22 * * *` / `37 22 * * *`＝台北 06:07 / 06:37）。於 repo Settings → Secrets and variables → Actions 設定三項機密後，於 Actions 頁 **Run workflow** 手動驗證。狀態僅在實際變更時由 `radar-bot` commit（no-diff 早退）。

完整驗證步驟見 [specs/001-foundation/quickstart.md](specs/001-foundation/quickstart.md)。
