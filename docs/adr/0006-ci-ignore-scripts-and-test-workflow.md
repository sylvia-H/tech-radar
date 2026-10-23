# 0006. 相依的 install script 一律不執行（本機 allowScripts deny、CI --ignore-scripts），另以 test.yml 跑 build、測試與執行期相依稽核

- **狀態**：Accepted
- **日期**：2026-10-23（首次裁決）；2026-10-23 修訂（install script 的本機防線重新裁決，見「否決的替代方案」的推翻紀錄）
- **相關**：憲章 VII（機密隔離）、VIII（關鍵邏輯測試）；開發指南 §2.1、§8.y；`package.json` `allowScripts`、`.github/workflows/radar.yml`、`.github/workflows/test.yml`

## 脈絡

2026-10 相依資安修補（分支 `fix/deps-security-2026-10`）把 jest 29 升到 30，連帶帶入兩個有 install script 的開發依賴
（`@parcel/watcher`、`unrs-resolver`）。`radar` job 帶 `contents: write` 的 `GITHUB_TOKEN` 跑 `npm ci`：install script
可直接取得 checkout 留在 `.git/config` 的 token；Secrets 在後續步驟才進 env，`--ignore-scripts` 擋的是安裝階段這一層。
本機同樣有風險：npm 11 對未被 `allowScripts` 涵蓋的 install script **只警告、仍會執行**（`strict-allow-scripts` 預設
false）。`allow-scripts` 這個 config 預設為空，設計給一次性與全域情境（`npm exec`、`npx`、`npm install -g`）；專案層的
`install`／`ci` 命令列不接受 `--allow-scripts`（但 `.npmrc` 可設）；專案層的團隊政策用 `package.json` 的 `allowScripts`。
npm 11.19／11.20 自帶的 `npm-install-scripts.md` 寫「blocked by default」，與實際行為不符（那是 npm 12 起的預設）；以
`config.md` 的 `strict-allow-scripts`（預設 false＝running with a notice）與實測為準。npm 12.0.0（2026-07-08）的 BREAKING
CHANGES 已改為未經 `allowScripts` 允許的相依 script 一律擋下，本機或 CI 換到 npm 12 後，未審核的 script 行為會改變。
另外 CI 從未跑過 `npm test`，jest 30 只在 Windows 本機驗證過；沒被 spec import 的 `main.cli.ts`、各 `*.module.ts` 壞掉時，
要等隔天 04:07 的排程才會失敗、當天晨報不發。

## 決策

- 本機：以 `npm install-scripts deny --all` 在 `package.json` 的 `allowScripts` 把目前 4 個有 install script 的套件
  （`@google/genai`、`protobufjs`、`@parcel/watcher`、`unrs-resolver`）記為 `false`；它們都不是建置或執行所需（清單見開發指南 §8.y）。
- 版本分界（npm CHANGELOG 與 nodejs.org `dist/index.json`）：`allowScripts` 欄位自 npm 11.16.0（2026-05-27，「Phase 1 of
  allowScripts」；Node 24 線為 24.18.0）起生效：11.16 起名稱型 `false` 項目已會略過 script（v11.16.0 的 arborist
  `rebuild.js` 已有 Phase 1 gate），也有 `npm approve-scripts`／`deny-scripts`。11.18.0 另補了釘版本 deny 在 lockfile 缺
  `resolved` 時 fail closed、`npm link <pkg>` 過 gate 等 gap（npm/cli #9652，release/v11 的 backport 為 #9663），並新增
  `npm install-scripts` 子命令（#9635）與 `prune`（#9662）；開發指南 §8.y 的維護流程依賴後者，故 `engines.npm` 取 `>=11.18`
  （npm 預設只警告 engines 不符，不會讓安裝失敗）。舊的 `approve-scripts`／`deny-scripts` 在 11.18+ 仍保留，`install-scripts`
  為正式入口。Node 24 線沒有附帶 11.18.x 的版本，最早是 24.20.0（npm 11.19.0）。
- CI：`radar`、`publish`、`test` 三處 `npm ci` 另保留 `--ignore-scripts` 當第二道防線。Node 24.22.1 附帶的 npm 11.19.1
  支援 `allowScripts`（本機實測 deny 生效），但 `setup-node` 的 `node-version: 24` 解析到哪個 24.x、附帶哪版 npm 不由本 repo
  決定；不認得這個欄位的 npm（例如 Node 22.23.4 附帶的 npm 10.9.9）會直接忽略它、不報錯，照樣執行 script。
- 新增獨立的 `test.yml`：push（排除 `state` 分支）與 pull_request 時跑 `test` job（`npm ci --ignore-scripts` → build → test）與並行的 `audit` job（`npm audit --omit=dev --audit-level=high`），權限只有 `contents: read`。
- 不需要推送的 checkout 一律 `persist-credentials: false`；只有 `radar` job 的 state-branch checkout 保留預設，因為要把 `board.json` 推回 `state`。

## 否決的替代方案

- **把測試併進 `radar.yml` 的 radar job**（合併門第 1 輪審查評估、審查方否決；修法指示即「不要塞進每天的 radar job」）→ 測試失敗不應擋下當天晨報；程式只在 push 時改變，每天排程多跑一次測試只是多花時間與 Actions 分鐘。
- **以 `.npmrc` 設 `ignore-scripts=true`**（合併門第 2 輪審查提案 → 使用者 2026-10-23 重新裁決改採 `package.json` 的 `allowScripts` deny）→ 連日後真正需要的 script 也一律擋下，失去逐套件審核。
- **維持現狀、本機只靠 npm 的警告**（第 2 輪裁決「維持旗標、不加 .npmrc」的實際效果 → 使用者 2026-10-23 重新裁決）→ 本機每次 `npm ci` 都會執行這 4 個 script。
  - **推翻紀錄**：第 2 輪裁決建立在錯誤前提上——「本機 npm 11 的 `allow-scripts` 預設為空、已不執行未核准的 install script」。
    這個前提由主 session 提供，agent 以 `npm config ls -l` 顯示 `allow-scripts = [""]` 誤當成已驗證並寫入文件；主 session 以
    npm 11.20.0、agent 以 npm 11.19.1 各自重現，皆確認未核准的 script 仍會執行。2026-10-23 使用者重新裁決改採 `package.json` 的 `allowScripts` deny。
- **`test.yml` 拿掉 `--ignore-scripts`，讓 install script 照常執行**（合併門第 2 輪審查提案 → 使用者裁決維持）→ 三處保持一致；jest 30 需要的原生檔由 lockfile 內的 optional 依賴提供，不靠 install script。
- **`radar`／`publish` 只裝執行期依賴、以 artifact 傳 `dist/`**（合併門第 2 輪審查提案 → 使用者裁決延後、記為已知限制）→ 屬排程架構改動（job 依賴、artifact 保存、失敗告警都要調），與這次資安修補無關；`--ignore-scripts` 加 `persist-credentials: false` 已擋下主要風險。記為開發指南 §8.y 的已知限制。

## 後果與觀察

- 新增帶 install script 的依賴時，`npm ci`／`npm install` 會列出「not yet covered by allowScripts」；先確認是否為建置或執行所需，再用 `npm install-scripts deny <pkg>`（不需要）或 `npm install-scripts approve <pkg>`（需要，預設寫入釘版本的項目）記錄，並更新開發指南 §8.y 的表。CI 真的需要某個 script 時，改用「只在推回狀態那一步帶 token」的做法，而不是拿掉 `--ignore-scripts`。
- `audit` 在既有執行期依賴出新公告時也會紅燈，不一定是該次 push 造成；有修正版就開 `fix/` 分支升級，沒有修正版或確認誤報就記進 `docs/plans/` 並接受紅燈到上游修正。不為了轉綠而移除 job 或調高 `--audit-level`。
- 前提：jest 30 的 `jest-resolve` 需要 `unrs-resolver` 的原生檔，CI 依賴 lockfile 已含各平台 binding。在 Windows 重產 lockfile 若漏掉其他平台的 optional 套件（npm/cli#4828），`test` job 會報找不到原生 binding。
- 已知限制：`radar`／`publish` 仍各自裝含 dev 的整棵相依（見上方延後的方案）。
- 代價：每次 push 多 2～3 分鐘 Actions（repo 目前為 public、不計分鐘），開 PR 時再多一次。
