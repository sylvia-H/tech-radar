# Phase 0 Research: 榜單狀態快照與變化偵測（F3）

**Feature**: `003-board-state-diff` | **Date**: 2026-07-15 | **Plan**: [plan.md](plan.md)

Technical Context 無 NEEDS CLARIFICATION（spec 的四項待定已於 `/speckit-clarify` Session 2026-07-15 全數定案）。本文件記錄實作前必須先釘死的**設計決策**，逐項對映 spec 需求與既有程式碼現況。

---

## D1：決勝所需的 `totalStars` 從何而來

**現況**：FR-004 的決勝第二層要比 `totalStars`，但 F2 產出的 `BoardRow`（`src/board/board.types.ts:77`）**不帶 `totalStars`**，只有 `weeklyStarsEstimate` 與 `starsThisWeek`。同時 `state.board` 的 `BoardEntry` 需要 `language`（`src/state/state.schema.ts:10`），`BoardRow` **也不帶 `language`**。

**Decision**：**擴充 `BoardRow`，新增 `totalStars: number | null` 與 `language: string | null`**，由 `assembleBoards()` 從 `CandidateRepo` 帶出（兩者皆為 `CandidateRepo` 既有欄位，見 `board.types.ts:61`）。決勝比較時 `totalStars ?? 0`。

**Rationale**：
- 資料**已經在記憶體裡**——`mergeById()` 對 Trending 候選由 `GET /repos` 的 meta 取得 `totalStars`、對 Search 候選由回應直接取得，兩條路徑都已填入 `CandidateRepo.totalStars`；只是 `assembleBoards()` 在收斂成 `BoardRow` 時沒帶出來。純屬欄位轉遞，**新增外部呼叫數為 0**（憲章 I）。
- `language` 同理（`CandidateRepo.language`），且 F3 是首個寫入 `state.board` 的 Feature，`BoardEntry.language` 至此才真正需要有值。

**Alternatives considered**：
- **F3 自行呼叫 `GET /repos` 補 `totalStars`**：憑空多出 ≤30 次 core 呼叫、且資料本就在手，違背憲章 I 的「先降用量」精神。捨棄。
- **改用不需 `totalStars` 的決勝層**：FR-004 已定案，變更需重開 clarify。捨棄。

**型別註記**：`CandidateRepo.totalStars` 宣告為 `number | null`，但兩條合併路徑實務上都會填值；型別保持 `| null` 以忠實反映上游契約，決勝時以 `?? 0` 收斂（null 視為最低，排在後面）。

---

## D2：四層決勝比較器的適用範圍

**Decision**：定義**單一比較器** `compareForPushBoard(prevIds)`，回傳 `(a, b) => number`，依序比較：

1. `weeklyStarsEstimate` **降序**
2. `totalStars ?? 0` **降序**
3. **新進者優先**：`prevIds.has(repoId)` 為 `false` 者在前
4. `repoId` **升序**（最終決勝）

此比較器**同時用於三個地方**：保底席次的「每領域最高 2 筆」挑選、其餘席次的跨領域競爭、以及最終 `#1..#10` 名次指派。

**Rationale**：
- FR-003 說保底席次取「該領域**熱度最高**的 2 筆」。F2 領域內排序用的是**兩層**規則（`weeklyStarsEstimate desc, repoId asc`，見 `board-builder.service.ts:244`）。若 F3 直接沿用 `DomainBoard.entries` 的既有順序挑前 2，則在平手時挑出的 2 筆可能與 F3 四層規則算出的不同 → 同一份輸入下「誰是保底」與「誰排第幾」用了兩套尺，是 FR-004 全域確定性的破口。**F3 一律用自己的比較器重排**即可消除。
- 第 3 層需要「上次快照有誰」，故比較器必須以 `prevIds` 閉包注入，而非全域純函式。這也讓它天然可測（給不同 `prevIds` 即可驗證第 3 層）。
- 第 4 層保證**全序**：任兩筆 repo 的 `repoId` 必不相等（GitHub 數字 id 唯一），故比較器永不回傳 0 → `Array.prototype.sort` 是否穩定不影響結果（SC-008）。

**Alternatives considered**：
- **沿用 F2 的兩層排序挑保底、只在最終名次用四層**：如上，會產生兩套尺。捨棄。
- **改動 F2 的 `assembleBoards` 排序為四層**：F2 的領域內名次不需要「新進者優先」（它沒有 prev 概念），且會擴大 F3 對 F2 的改動面。捨棄——F3 只加欄位、不改 F2 排序語意。

**已知代價（定案時明知並接受）**：第 3 層「新進者優先」在平手時把既有成員推後一名，會多產生一張「🔻 下降」卡。平手極罕見，且與 FR-010 已接受的純位移噪音同性質。

---

## D3：每週節奏的判定

**Decision**：常數 `BOARD_PUSH_INTERVAL_HOURS = 162`；純函式

```
decideCadence(lastBoardPushAt: string | null, now: Date) -> CadenceDecision
```

回傳 `{ due: boolean; reason: 'no-timestamp' | 'due' | 'not-due' | 'clock-anomaly'; }`。判定順序：

1. `lastBoardPushAt === null` → `{ due: true, reason: 'no-timestamp' }`（FR-019）
2. `lastBoardPushAt > now` → `{ due: true, reason: 'clock-anomaly' }`（FR-019a，**呼叫端須發告警**）
3. `now - lastBoardPushAt >= 162h` → `{ due: true, reason: 'due' }`
4. 否則 → `{ due: false, reason: 'not-due' }`（FR-018，呼叫端整段跳過）

**Rationale**：
- **162h 而非 168h**：`lastBoardPushAt` 記的是**推播完成**時間，必晚於當次 cron 觸發時間。取精確 168h 會使七天後同一班 cron 算出的間隔恆略小於門檻而跳過，改由次一班或隔天補推，起算點再往後挪——Actions cron 只會延遲不會提前，誤差**單向累積**，節奏由 7 天滑向 8 天。6h 寬限吸收延遲與 `:07`/`:37` 雙班抖動（決策全文見 spec Clarifications Session 2026-07-15）。
- **回傳 `reason` 而非裸 boolean**：`clock-anomaly` 與 `due` 都要執行榜單段，但前者**額外需要告警**。若只回 boolean，呼叫端得重算一次「是不是未來時間」才知道要不要告警——把判定邏輯漏到編排層，違反「判定全在純函式」的結構決策。`reason` 也讓 log 能說清楚這次為何跑或為何跳。
- **時間由參數注入**（`now: Date`），不在函式內讀 `Date.now()`（spec Assumptions「時間可注入」、SC-002 可測）。

**Alternatives considered**：
- **精確 168h**：接受節奏在 7～8 天間單向擺盪。clarify 階段已評估並捨棄。
- **對齊曆日（每週一推）**：FR-017 明文 MUST NOT 以曆日為節奏依據。捨棄。

---

## D4：空榜的偵測點與行為

**Decision**：在 `pickPushBoard()` 產出後、diff 之前判定。綜合榜 `length === 0` → **中止榜單段**：不 diff、不 log 變化、**不 commit**、發告警 `postFailureAlert('榜單為空：上游來源全數失敗或候選全被過濾')`；`return` 讓新聞段（F4/F6 接上後）照常。

**Rationale**：
- 空榜代表上游全滅，屬**異常**而非「這週沒變化」。若讓它走 FR-014 的「無變化」路徑，`prev` 非空時三類變化會全空（因為 curr 空 → 無新進、無留榜）→ 吐出「榜單無變化」並試圖取榜首 → 空榜無榜首，實作直接爆或吐假摘要（FR-014 已明文排除此路徑）。
- 不 commit ⇒ `lastBoardPushAt` 不動 ⇒ 下次執行仍判定到期 → **自動重試**，變化不遺失（FR-025）。
- 告警但不擲錯：憲章 VII「任一資料來源失敗不得使整條 pipeline 失敗」。

**Alternatives considered**：
- **門檻放寬為「候選 < 保底 4 席即中止」**：clarify 階段提出過（Option B）。使用者選 A（僅空榜）。半殘榜仍會產生假掉出/假下降，屬**已知且接受**的代價——與 T=1 的取捨一致，且不必再引入一個門檻常數。
- **照常 diff、只在快照為空時特判不寫回**：邏輯散落、仍會推誤導性卡片。捨棄。

**告警文案**：沿用 F2 `BoardBuilderService.alert()` 的既有樣式（帶來源脈絡的紅色 embed），但 F3 的空榜**不帶單一來源 id**——它是「全部來源都沒東西」的聚合結果，個別來源失敗的帶 id 告警已由 F2 在更下游發出。

---

## D5：「推播成功後才寫回」在沒有推播的 F3 如何成立

**現況張力**：FR-020 要求「**推播確實成功後**才寫回」，但 F3 明文不含推播（F7 才有）；同時 spec 驗收要求「**連跑兩次，第二次只產出差異**」——這需要第一次真的寫回，否則第二次仍是全數新進。

**Decision**：把寫回收斂成**單一提交點**的純函式 `commitBoardPush(state, pushBoard, pushedAt) -> BoardState`（不含 I/O），由 `BoardDiffService` 在**本階段的交付成功之後**呼叫，並經 `StateStore.save()` 落檔。「交付成功」在 F3 的定義是**變化結果已成功產出並輸出到 log**；F7 接上 Discord 後，改由**推播成功**驅動同一個 `commitBoardPush`，函式本身不變。

**Rationale**：
- FR-020 的實質是「**寫回一律發生在交付成功之後，失敗則狀態原封不動**」——F3 遵守此不變式，只是當前階段的「交付」是 log 輸出。spec Assumptions 已明文預告此作法（「由上層告知推播結果、再由本 Feature 提供的狀態提交行為完成寫回；端到端串接於 F7 驗收」）。
- 收斂成單一純函式使 FR-021（快照與時間戳**同次**更新、禁止半套）成為**型別層面的保證**：`commitBoardPush` 一次回傳完整的新 `BoardState`，呼叫端無法只寫其中一半。
- F7 的接線成本為零：把觸發點從「log 成功」換成「Discord 回報成功」，`commitBoardPush` 與其測試都不動。

**Alternatives considered**：
- **F3 完全不寫回，驗收改以單元測試模擬**：spec 驗收明文要求「連跑兩次」的端到端行為，且 M2 的價值就在於用真實資料觀察節奏與 diff。捨棄。
- **以 CLI flag `--commit-board` 控制是否寫回**：多一個只在 F3 存在、F7 就要拆掉的旋鈕，違背「一切從簡」。捨棄。

**失敗路徑**：`commitBoardPush` 之前的任一步擲錯（含空榜中止）→ 不呼叫 `save()` → 狀態逐位元組不變（SC-006）。

---

## D6：`state.board` 的 2-way domain 對齊與寬鬆載入

**現況**：`state.schema.ts:7` 的 `domainSchema` 仍是 4-way 佔位 `['ai','devops','backend','frontend']`（F1 留給 F2 定案、F2 因不寫狀態而順延至 F3）；F2 記憶體型別已是 2-way `'ai' | 'frontend-backend'`。**兩者目前對不起來**，F3 一寫入就會炸。

**Decision**：
1. `domainSchema` 改為 `z.enum(['ai', 'frontend-backend'])`，與 `board.types.ts` 的 `Domain` 一致（FR-024 前半）。
2. `boardStateSchema.board` 改為**條目層寬鬆載入**：逐條 `safeParse`，**不合法者剔除並 warn**，不使整份狀態失效（FR-024 後半）。根結構（五欄位）仍**嚴格**驗證。

**Rationale**：
- 現行 `StateStore.load()` 對 schema 不合法一律擲錯（`state.store.ts:44`）。若舊快照留有 `domain: "devops"` 條目，載入即中止整條 pipeline——正是 FR-024 明文禁止的「因舊分類值使整個狀態失效」。
- **只放寬條目層、不放寬根結構**，才能同時守住憲章 VI 的「壞檔擲錯不覆寫」：JSON 壞掉、或 `board` 根本不是物件 → 仍擲錯；只有「某個 repo 條目長得不對」→ 剔除該條目。
- 剔除的語意是**安全的**：該 repo 等同「不在上次快照」→ 下次以新進呈現，最壞情況是多推一張卡，不會產生錯誤資料。
- 剔除**必須 warn**（憲章 VII「不得無聲」）。

**Alternatives considered**：
- **保留 `devops` 於 enum 當 legacy 值**：FR-024 明文要求移除；留著會讓型別繼續說謊。捨棄。
- **寫一次性遷移程序**：spec Assumptions 已確認「狀態檔為空骨架、無既有正式狀態需遷移」，FR-024 的容錯純屬防禦性。寫遷移是為不存在的資料付成本。捨棄。

---

## D7：`firstSeenAt` 的語意與 commit 時的處理

**Decision**：`BoardEntry.firstSeenAt` = 該 repo **首次進入綜合 top 10** 的時間。`commitBoardPush` 時：
- 既有成員（`prev` 有該 `repoId`）→ **沿用 `prev` 的 `firstSeenAt`**（不因每次推播而刷新）。
- 新進者 → 設為本次 `pushedAt`。
- 掉出後重回者 → 因 `prev` 已無該條目，`firstSeenAt` **重設**為重回的時間。

**Rationale**：語意是「這一輪在榜期間的起點」。dev-guide §5.1 的範例即此語意（與 `rank`、`starsThisWeek` 同為「上次看到的樣貌」）。重回者重設是「掉出即當次靜默、重回以新進呈現」（FR-011/US1 場景 8）的自然延伸——若要保留跨輪的「史上首見」，得另存一份不隨掉出清除的紀錄，那是 `intros` 快取的職責，不是榜單快照的。F3 不需要跨輪首見時間，故不引入。

---

## D8：M2 觀測輸出

**Decision**：新增 `src/diff/diff-log.ts`，比照 F2 既有 `board-log.ts` 的風格，把 `BoardDiff` 印成結構化區塊：節奏判定（跑/跳過 + 原因）、綜合 top 10（`#N owner/name ⭐+週增星 [領域]`）、三類變化（含 `#舊 → #新`）、或「榜單無變化 + 榜首摘要」。

**Rationale**：F3 沒有推播，log 是**唯一**的觀測面，也是 M2 驗收（連跑兩次比對輸出）的依據。比照 `board-log.ts` 可讓兩段輸出在同一份 Actions log 裡風格一致。純格式化函式，可單元測試。
