# Quickstart: 驗證 F3 榜單狀態快照與變化偵測（M2）

驗收目標（M2，dev-guide §11.2）：**連跑兩次，第二次只產出差異；未到期時榜單段整段跳過**。本指引為驗證/執行步驟，實作細節見 [plan.md](plan.md)、[data-model.md](data-model.md)、[contracts/](contracts/)。

## 前置

- Node.js 24、已 `npm ci`、`npm run build`（沿用 F1/F2）。
- 環境變數 `GH_API_TOKEN`（本機以 env 提供，勿寫入檔案；Actions 走 Secrets）。F3 不呼叫 Gemini、不推播 Discord，但 F1 env schema 仍要求三個機密都存在（缺任一 fail-fast），本機驗證時三者都給即可（後兩者可為佔位值）。
- **注意**：F3 會**實際寫入** `state/board.json`（F1/F2 都不寫）。驗證前先記下現況：`git status state/`。

## 1. 單元測試（關鍵邏輯，憲章 VIII）

```bash
npm test
```

須全綠。完整的規則 → 測試對映見 [data-model.md §5](data-model.md)；重點：

- **四層決勝全序**（`rank-compare.spec.ts`）：週增星→總星數→新進者優先→`repoId`；含「前三層全平手、僅靠 `repoId` 分出」的案例。
- **選榜**（`push-board.spec.ts`）：保底每領域 2 席（SC-005）；候選不足照實不湊數；≤10 筆；**打亂輸入順序重跑 10 次名次序列一致**（SC-008）。
- **diff**（`board-diff.spec.ts`）：三類互斥；掉出／穩定留榜靜默；冷啟動全數新進（SC-003）；純位移計為下降；改名以 `repoId` 判同一；`unchanged` + `topEntry`；`needsIntro` 標示；總數 ≤10（SC-004）。
- **節奏**（`board-cadence.spec.ts`）：<162h 跳過、≥162h 執行、無時間戳執行（SC-002）；**163h 執行**（寬限生效，US2 場景 5）；**未來時間戳 → 執行 + `clock-anomaly`**（FR-019a）。
- **commit**（`board-commit.spec.ts`）：快照與時間戳同次更新；`intros` 原樣保留（SC-007）；`firstSeenAt` 既有沿用／新進用 `pushedAt`；持久化 ≤10 筆（SC-009）。
- **服務容錯**（`board-diff.service.spec.ts`）：空榜 → 告警 + 不 commit（SC-010）；交付失敗 → 狀態不變（SC-006）。
- **舊分類相容**（`state.schema.spec.ts`）：含 `domain: "devops"` 的舊條目 → 剔除 + warn，其餘條目照常載入、**整份狀態不失效**（FR-024）。

## 2. 主驗收：連跑兩次（SC-001）

```powershell
# PowerShell：暫時提供機密給本次執行
$env:GH_API_TOKEN="<token>"; $env:GEMINI_API_KEY="x"; $env:DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/x/x"

# 從乾淨狀態開始（確認是空骨架）
git checkout state/board.json
node dist/main.cli.js          # 第一次
node dist/main.cli.js          # 第二次
```

**第一次**預期（冷啟動）：

- 節奏判定印出 `due`（原因 `no-timestamp`）。
- 印出跨領域綜合 top 10（`#1..#10`，每筆含 `owner/name`、週增星、領域）。
- **10 筆全數列為「新進」**，0 筆竄升、0 筆下降（SC-003）。
- `state/board.json` 被寫入：`board` **恰 ≤10 筆**、`lastBoardPushAt` 有值（`git diff state/board.json` 可見）。

**第二次**預期（本次驗收的核心）：

- 節奏判定印出 **`not-due`**（距第一次 <162h）→ **榜單段整段跳過**，`state/board.json` 不再變動。

> **⚠ 第二次會被節奏 guard 擋下，因此無法直接觀察「無變化」**。要驗證 SC-001 的「第二次只產出差異」，須繞過節奏——見下節。

## 3. 驗證「第二次無變化」（SC-001，需手動調時間戳）

節奏 guard 與 diff 是兩件事，分開驗：

```powershell
# 把 lastBoardPushAt 往回撥 8 天，讓榜單段再次到期
# （手動改 state 僅限本驗證情境；正式流程一律經 StateStore）
node -e "const f='state/board.json',s=JSON.parse(require('fs').readFileSync(f));s.lastBoardPushAt=new Date(Date.now()-8*864e5).toISOString();require('fs').writeFileSync(f,JSON.stringify(s,null,2)+'\n')"

node dist/main.cli.js
```

預期：

- 節奏判定 `due`。
- 若上游榜單在這段時間內沒實質變動 → 印出 **「榜單無變化」+ 榜首一行摘要**，**變化項目 0 筆**（SC-001/FR-014）。
- 若上游確有變動 → 只印出**變化的那幾筆**（新進/竄升/下降），**穩定留榜者不出現**（FR-012）——這同樣證明「不重述整份榜單」。

> 實跑相隔數分鐘時，週增星幾乎不動，通常會得到「無變化」。若剛好碰上 Trending 換榜而出現少量變化，屬正常——重點是**沒有重述整份榜**。

## 4. 驗證未到期跳過（SC-002）

```powershell
# 把 lastBoardPushAt 設為 1 小時前
node -e "const f='state/board.json',s=JSON.parse(require('fs').readFileSync(f));s.lastBoardPushAt=new Date(Date.now()-3600e3).toISOString();require('fs').writeFileSync(f,JSON.stringify(s,null,2)+'\n')"

node dist/main.cli.js
```

預期：印出 `not-due` 並**整段跳過**——log 中**不應出現任何榜單抓取**（無 `api: core=…` 行）、無選榜、無 diff（FR-018）；`git diff state/board.json` 無變化。

> 這一項也順帶證明未到期時**不會浪費 GitHub API 配額**（憲章 I）。

## 5. 驗證狀態不被半套寫入（SC-006）

```powershell
# 記錄執行前的雜湊
$before = (Get-FileHash state/board.json).Hash
# 以無效 token 觸發上游全滅 → 空榜路徑
$env:GH_API_TOKEN="invalid"; node dist/main.cli.js
$after = (Get-FileHash state/board.json).Hash
$before -eq $after   # 須為 True
```

預期：發出「榜單為空」告警（本機無有效 webhook 時，log 會記錄告警送出失敗，屬預期）、**不 commit 狀態**、雜湊完全相同（SC-010/SC-006），且**進程不以非零碼結束**（憲章 VII：不得使整條 pipeline 失敗）。

## 6. 收尾

```powershell
git checkout state/board.json   # 還原成空骨架，不把驗證產生的快照帶進 commit
```

> 正式排程的狀態 commit 由 workflow 在 `state/board.json` 實際變更時進行（no-diff 早退）；本機驗證產生的快照**不應**入庫。

## 完成定義（M2）

- [ ] `npm test` 全綠，涵蓋 [data-model.md §5](data-model.md) 全部規則。
- [ ] 冷啟動印出 10 筆新進、0 竄升、0 下降，狀態寫入 ≤10 筆（§2）。
- [ ] 再次到期時輸出「榜單無變化」或只含差異項（§3）。
- [ ] 未到期時整段跳過、無任何抓取、狀態不變（§4）。
- [ ] 空榜時告警 + 狀態逐位元組不變 + 不中斷（§5）。
