# 0004. 晨報乾跑模式取代手動改 state

- **狀態**：Accepted
- **日期**：2026-09-27
- **相關**：憲章 VI（狀態只經 StateStore）；開發指南 §8.x；`src/pipeline/news-segment.service.ts` `dryRun()`、`.github/workflows/radar.yml` `dry_run` 輸入

## 脈絡

調整 prompt／型號／thinking 後想立刻看結果，但純 `workflow_dispatch` 會被 18h guard 擋住（距上次推播不足 18h 整段跳過）。唯一替代是手動改 `state` 分支的 `board.json`：退回 `lastNewsPushAt`、跑完再還原。這違反憲章 VI，且跑完後時間戳落在當下、隔日排程距離不足 18h 會被擋，還原 `seenNews` 又可能讓隔日重推同一批新聞。

## 決策

`workflow_dispatch` 新增 `dry_run` 布林輸入 → `NEWS_DRY_RUN=1`：跳過 guard、照常抓取與策展（會真的呼叫 Gemini、消耗當日 1 次策展配額），組版後推到**告警頻道**（username 與標題標「乾跑」）供檢視版面；不推晨報頻道、不寫狀態、不跑榜單段；workflow 的 state commit 步驟與 `publish` job 一併跳過。乾跑失敗直接讓 workflow 失敗，不走 best-effort 告警。

## 否決的替代方案

- **手動改 state 再真跑、事後還原** → 違反憲章 VI、需兩次手動改檔、隔日排程會被 guard 擋。
- **乾跑只印 log、不推 Discord** → 使用者選擇要看得到版面；推到告警頻道可檢視版面又不污染晨報頻道。
- **乾跑推到晨報頻道但不寫狀態** → 隔日會把同一批再推一次，訂閱者看到重複。

## 後果與觀察

- 首次乾跑（2026-09-27 run 36292115517）即驗證四項處置有效：同日候選池 6 則 → 12 則。
- 代價：每次乾跑消耗 1 次策展配額（Flash 20 RPD）與約 2 分鐘 Actions；乾跑結果不入 seenNews，當日正式排程會再評估同一批候選，這是刻意的。
