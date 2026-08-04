# Contract: 核心段對 `state.publish` 的寫入次序

**Feature**: 008-pages-publish | 涉及檔案：`src/diff/board-commit.ts`、
`src/pipeline/board-segment.service.ts`、`src/pipeline/news-segment.service.ts`

## C1. 榜單段（`board-segment.service.ts`，既有 push-then-commit 區塊擴充）

現行次序（`run()` 內，`discord.send` 成功之後）不變，只在 `commitBoardPush` 呼叫多帶兩個既有作用域
內已算好的變數：

```
const next = commitBoardPush(state, pushBoard, now, diff, summary);
//                                              ^^^^  ^^^^^^^ 【新增實參】
await this.stateStore.save(next);
Object.assign(state, next);
```

`commitBoardPush` 內部新增行為（純函式，不碰 I/O）：

```
next.publish = {
  ...state.publish,
  boardSummary: { summary: summary.summary, generatedAt: pushedAtIso },
  feed: trimFeed(
    [...(state.publish?.feed ?? []), ...makeBoardFeedEntries(diff, dateLabel, pushedAt)],
    50,
  ),
};
```

`dateLabel` 由呼叫端傳入或在函式內重新以 `taipeiDateLabel(pushedAt)` 算出（與封面組版同一個日期
字串來源，避免兩處各自算日期產生不一致）。

**不變式延續**：`commitBoardPush` 仍是**唯一**的狀態寫回轉換點——`publish` 欄位的寫入與
`board`/`lastBoardPushAt` 屬**同一次**回傳、**同一次** `stateStore.save()`，不產生半套狀態
（憲章 VI、FR-013）。

**失敗路徑不變**：`commitBoardPush` 拋錯或 `save` 失敗時，既有 catch 區塊（還原 `state.intros`、
best-effort 告警）不需改動——因為 `state.publish` 只在 `commitBoardPush` **成功回傳並 save 成功後**
才透過 `Object.assign(state, next)` 寫回共享物件，失敗時 `state.publish` 維持推播前的值，沒有新的
半套狀態風險。

## C2. 晨報段（`news-segment.service.ts`，既有 push-then-commit 區塊擴充）

現行次序（`discord.send` 成功之後、`stateStore.save(state)` 之前）新增兩行賦值，不新增函式呼叫層級
的抽象：

```ts
state.seenNews = seen;
state.lastNewsPushAt = seenAt;
state.publish = {
  ...state.publish,
  news: { items: digest.items, generatedAt: seenAt },
  feed: trimFeed(
    [...(state.publish?.feed ?? []), ...makeNewsFeedEntries(digest.items, now)],
    50,
  ),
};
await this.stateStore.save(state);
```

**不變式延續**：仍是既有的**單一** `save()` 呼叫，`publish.news`／`publish.feed` 與既有
`seenNews`／`lastNewsPushAt` 同一次原子寫入（FR-013）。失敗路徑（`discord.send` 擲錯）已在更早的
`try/catch` 攔截並 return，不會執行到這段賦值，故無新增的半套狀態風險。

## C3. 兩段共用 `state.publish.feed` 的疊加順序

`PipelineService.run()` 既有次序是**先榜單段、後晨報段**（`pipeline.service.ts:33-43`），兩段共用
同一個可變 `state` 物件。若同次執行兩段都推播成功：

1. 榜單段 `commitBoardPush` 回傳的 `next.publish.feed` 已包含（舊 `state.publish.feed` ∪ 本次榜單
   事件），修剪至 50，並透過 `Object.assign(state, next)` 寫回共享 `state`。
2. 晨報段讀到的 `state.publish?.feed` 已是步驟 1 之後的版本，疊加本次新聞事件，再修剪至 50。

**不變式**：無論哪一段獨自成功、跳過、或失敗，另一段永遠讀到「當下共享 `state` 物件的最新值」——
與既有 `state.board`／`state.intros` 的共用模式完全一致，不需要新的鎖或同步機制（單一 process、
無並發執行）。

## C4. 向後相容驗收點（FR-014）

- 現行 `state/board.json`（`state` 分支上、不含 `publish` 鍵）餵給 `boardStateSchema.safeParse`
  MUST 成功，且 `result.data.publish === undefined`。
- 榜單段/晨報段在 `state.publish` 為 `undefined` 的情況下首次寫入（`...state.publish` 展開
  `undefined` → 等同不展開任何既有鍵）MUST 正常運作，不擲錯。
