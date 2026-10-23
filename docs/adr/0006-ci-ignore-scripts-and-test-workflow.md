# 0006. CI 不執行 install script，另以 test.yml 跑 build、測試與執行期相依稽核

- **狀態**：Accepted
- **日期**：2026-10-23
- **相關**：憲章 VII（機密隔離）、VIII（關鍵邏輯測試）；開發指南 §2.1、§8.y；`.github/workflows/radar.yml`、`.github/workflows/test.yml`

## 脈絡

2026-10 相依資安修補（分支 `fix/deps-security-2026-10`）把 jest 29 升到 30，連帶帶入兩個有 install script 的開發依賴
（`@parcel/watcher`、`unrs-resolver`）。`radar` job 在 `contents: write` 的 `GITHUB_TOKEN` 與五項 Actions Secrets 下跑
`npm ci`，checkout 預設把 token 留在 `.git/config`：任何相依套件的 install script 被投毒，都能取得可推送 repo 的 token
與 Discord／Gemini 等機密。另外 CI 從未跑過 `npm test`，jest 30 只在 Windows 本機驗證過；沒被 spec import 的
`main.cli.ts`、各 `*.module.ts` 壞掉時，要等隔天 04:07 的排程才會失敗、當天晨報不發。

## 決策

- `radar`、`publish`、`test` 三處 `npm ci` 一律帶 `--ignore-scripts`；目前 lockfile 內四個 install script 都不是建置或執行所需（清單見開發指南 §8.y）。
- 新增獨立的 `test.yml`：push（排除 `state` 分支）與 pull_request 時跑 `test` job（`npm ci --ignore-scripts` → build → test）與並行的 `audit` job（`npm audit --omit=dev --audit-level=high`），權限只有 `contents: read`。
- 不需要推送的 checkout 一律 `persist-credentials: false`；只有 `radar` job 的 state-branch checkout 保留預設，因為要把 `board.json` 推回 `state`。

## 否決的替代方案

- **把測試併進 `radar.yml` 的 radar job**（合併門第 1 輪審查評估、審查方否決；修法指示即「不要塞進每天的 radar job」）→ 測試失敗不應擋下當天晨報；程式只在 push 時改變，每天排程多跑一次測試只是多花時間與 Actions 分鐘。
- **以 `.npmrc` 設 `ignore-scripts=true` 取代旗標**（合併門第 2 輪審查提案 → 使用者裁決維持旗標）→ 本機 npm 11 的 `allow-scripts` 預設為空、已不執行未核准的 install script；`.npmrc` 只多一份要維護的設定。
- **`test.yml` 拿掉 `--ignore-scripts`，讓 install script 照常執行**（合併門第 2 輪審查提案 → 使用者裁決維持）→ 三處保持一致；jest 30 需要的原生檔由 lockfile 內的 optional 依賴提供，不靠 install script。
- **`radar`／`publish` 只裝執行期依賴、以 artifact 傳 `dist/`**（合併門第 2 輪審查提案 → 使用者裁決延後、記為已知限制）→ 屬排程架構改動（job 依賴、artifact 保存、失敗告警都要調），與這次資安修補無關；`--ignore-scripts` 加 `persist-credentials: false` 已擋下主要風險。記為開發指南 §8.y 的已知限制。

## 後果與觀察

- `audit` 在既有執行期依賴出新公告時也會紅燈，不一定是該次 push 造成；有修正版就開 `fix/` 分支升級，沒有修正版或確認誤報就記進 `docs/plans/` 並接受紅燈到上游修正。不為了轉綠而移除 job 或調高 `--audit-level`。
- 前提：jest 30 的 `jest-resolve` 需要 `unrs-resolver` 的原生檔，CI 依賴 lockfile 已含各平台 binding。在 Windows 重產 lockfile 若漏掉其他平台的 optional 套件（npm/cli#4828），`test` job 會報找不到原生 binding。
- 新依賴帶進新的 install script 時，先確認是否為建置或執行所需；真的需要時改用「只在推回狀態那一步帶 token」的做法，而不是拿掉 `--ignore-scripts`。
- 已知限制：`radar`／`publish` 仍各自裝含 dev 的整棵相依（見上方延後的方案）。
- 代價：每次 push 多 2～3 分鐘 Actions（repo 目前為 public、不計分鐘），開 PR 時再多一次。
