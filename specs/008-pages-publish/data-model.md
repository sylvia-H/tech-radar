# Data Model: GitHub Pages 儀表板 + RSS/Atom 發佈

**Feature**: 008-pages-publish | **Date**: 2026-08-04

本檔涵蓋兩類實體：（1）持久化狀態擴充（`state/board.json` 新增欄位，zod schema，`src/state/`）、
（2）發佈段記憶體型別與純函式簽章（不持久化，`src/publish/`）。既有型別（`BoardState`／
`CuratedNewsItem`／`BoardDiff`／`PushBoardRow` 等）不重複定義，直接參照。

## 1. 持久化狀態擴充（`src/state/state.schema.ts`）

```ts
/** 單則 feed entry（新聞或榜單事件，皆不含星數等數值指標，FR-016）。 */
export const feedEntrySchema = z.object({
  id: z.string(),                       // 見 §2.2 GUID 規則（research D9）
  type: z.enum(['news', 'board-new', 'board-climbed']),
  title: z.string(),
  url: z.string(),                      // 刻意不加 .url()，理由見下方「驗證規則」（2026-08-04 修正）
  content: z.string().nullable().optional(), // 新聞內文 → atom:summary；榜單事件缺席
  publishedAt: isoDatetime,
});

/** 最近一次晨報精選新聞全文（FR-013），與同次推去 Discord 的批次完全一致。 */
export const publishNewsSchema = z.object({
  items: z.array(curatedNewsItemSchema),  // 重用既有 CuratedNewsItem 形狀（見下）
  generatedAt: isoDatetime,               // = 該次 lastNewsPushAt
});

/** 最近一次榜單變化摘要（FR-013），即封面 TL;DR 原句，不重算。 */
export const publishBoardSummarySchema = z.object({
  summary: z.string(),
  generatedAt: isoDatetime,               // = 該次 lastBoardPushAt
});

/** 發佈用狀態容器（FR-013/014）：整體選用，內部三欄位各自選用（各自獨立成立/缺席）。 */
export const publishStateSchema = z.object({
  news: publishNewsSchema.optional(),
  boardSummary: publishBoardSummarySchema.optional(),
  feed: z.array(feedEntrySchema).optional(),   // 刻意不加 .max(50)，理由見下方「驗證規則」
});

// boardStateSchema 擴充：
export const boardStateSchema = z.object({
  lastBoardPushAt: nullableIso,
  lastNewsPushAt: nullableIso,
  board: lenientBoardSchema,
  intros: z.record(z.string(), introCacheSchema),
  seenNews: z.array(seenNewsEntrySchema),
  publish: publishStateSchema.optional(),   // 【新增】FR-014：缺此欄位的既有檔案仍需無錯載入
});
```

`curatedNewsItemSchema` 是 `CuratedNewsItem`（`src/curation/curation.types.ts`）目前尚無对應 zod
schema（該型別只在記憶體流轉，F6 未曾持久化過）——本 Feature **新增**這個 schema 做為「型別↔
持久化」的橋接，欄位與 `CuratedNewsItem` 逐一對應（`title`/`content`/`url`/`domain`/`sourceCount`/
`weightedScore`/`degraded`）。放在 `state.schema.ts`（狀態 schema 的唯一權威位置），`curation.types.ts`
的 TS interface 不動。

**空骨架**：`emptyBoardState()` 不加 `publish` 鍵（維持 `undefined`），對應 US1 Acceptance
Scenario 2「尚無資料」空狀態——渲染層需自行處理 `state.publish` 為 `undefined` 的情形（顯示
「尚無資料」，不擲錯）。

**驗證規則**：
- `feed` 陣列上限 50 **只由 `trimFeed` 單點保證，schema 刻意不加 `.max(50)`**
  （2026-08-04 修正）。原設計把 `.max(50)` 當「防呆」，但 zod schema 是在 `StateStore.load()`
  時驗證的：一旦 state 內的 feed 因任何原因超過 50 筆（手動編輯 state、日後調整上限、寫入端
  bug），`load()` 會依「壞檔擲錯不覆寫」（憲章 VI）擲錯，而 `load()` 是**核心推播段**的第一步
  ——結果是一個純發佈用的選用欄位把整條 pipeline（含 Discord 推播）打掛，正好違反 FR-014
  「MUST NOT 因這些欄位而使核心推播段失敗」。上限的正確守護位置是寫入端：`trimFeed` 加上
  T025／T027／T030 三組測試已覆蓋。
- `FeedEntry.url` **刻意只用 `z.string()`、不加 `.url()`**（2026-08-04 修正）——與上一條同一類的
  失敗模式。此值直接來自第三方 RSS 的 `<link>`：`rss.fetcher.ts` 只檢查非空，經 `targetUrl` →
  `NewsCandidate.originalUrl` → `CuratedNewsItem.url` → `FeedEntry.url` **全鏈無任何格式驗證**，
  網址也不進 Gemini prompt，因此來源產生器出錯給出的相對路徑／漏 scheme 網址可一路存活。zod
  `.url()` 的判定就是 `new URL()` 成不成功，與 `normalizeTargetUrl` 同一把尺，而 `seenNews` 對
  同一份資料只用 `z.string()`——嚴格驗證會讓同一次 `save()` 內兩個欄位標準打架。更關鍵的是
  `save()` 執行於**推播成功之後**：驗證擲錯 → `lastNewsPushAt` 不落檔 → 補跑 cron 重推同一份晨報，
  同 run 榜單狀態一併遺失。壞連結的代價（一則新聞的連結點不開，且 Discord 晨報本來就已是同一個
  壞連結）遠低於重推與狀態遺失。
- `FeedEntry.content` 為新增的選用欄位（2026-08-04）：新聞類 entry 存 `CuratedNewsItem.content`
  （可為 `null`＝策展降級），供 `renderFeed` 輸出 `atom:summary`；榜單事件無內文故欄位缺席。
  `.optional()` 同時保證 F8 早期已寫入、不含 `content` 的 state 仍可載入。
- 所有新欄位對舊資料 100% 向後相容：`publishStateSchema.optional()` 全鏈可選，任何一層缺席都不
  影響其餘欄位或既有五個根欄位的驗證。

## 2. 發佈段記憶體型別與純函式（`src/publish/`）

### 2.1 型別（`publish.types.ts`）

大部分直接重用 `state.schema.ts` 匯出的 `PublishState`／`FeedEntry`／`PublishNews`／
`PublishBoardSummary`（zod `z.infer`），不重複定義。額外只需：

```ts
/** RepoVisibilityService 的查詢結果（research D3）。 */
export type RepoVisibility = 'public' | 'private' | 'unknown';
```

### 2.2 GUID 構成規則（純函式，`feed-entry.ts`）

```ts
/** 新聞 feed entry 的 id（research D9）。傳入值 MUST 已經過 `normalizeTargetUrl`。 */
export function newsFeedId(normalizedUrl: string): string {
  return `news:${normalizedUrl}`;
}

/** 榜單事件 feed entry 的 id（research D9）：repoId + 事件型別 + 事件日期。 */
export function boardFeedId(repoId: number, kind: 'new' | 'climbed', dateLabel: string): string {
  return `repo:${repoId}:${kind}:${dateLabel}`;
}
```

**三套命名的對照表（實作時 MUST 依此映射，字串為對外契約、日後不得更名）**：

| 來源 `ChangeKind`（`diff.types.ts`） | GUID 的 `kind` 片段 | `FeedEntry.type` |
|---|---|---|
| `newcomer` | `new` | `board-new` |
| `climbed` | `climbed` | `board-climbed` |
| `declined` | （無，不產生 entry，FR-003） | — |

GUID 用 `new` 而非 `newcomer`，是為對齊 spec Clarifications 已定案的樣例
`repo:{repoId}:new:2026-08-04`；一旦發佈出去就成為訂閱者 reader 的已讀鍵，改名等同讓所有既有
entry 重新出現一次，故以 `feed-entry.spec.ts` 的字面斷言鎖住。

**新聞 id 的正規化落點**：`makeNewsFeedEntries` 內部對 `item.url` 套用既有
`normalizeTargetUrl`（`src/news/url-normalize.ts`）後才交給 `newsFeedId`——與 `seenNews` 的記鍵
方式同源（`news-segment.service.ts` 既有用法），確保同一則新聞跨來源/跨執行得到同一個 id
（FR-004／SC-002）。`FeedEntry.url` 則保留**未正規化**的原始 `item.url`，因為那是訪客實際要點的
連結，正規化僅用於識別鍵。

不變式：同一 repo 在同一天只會有一種 `kind`（`diffBoard` 保證 `changes` 內每個 `repoId` 恰一筆，
`ChangeKind` 三者互斥）；跨天重複（重回榜／再次竄升）因 `dateLabel` 不同而合法地產生新 id
（對齊憲章 III、spec FR-004）。

### 2.3 Feed 組裝與修剪（純函式，`feed-entry.ts`）

```ts
/** BoardDiff → 榜單類 feed entries（僅 newcomer/climbed，declined 不產生，FR-003）。 */
export function makeBoardFeedEntries(diff: BoardDiff, dateLabel: string, now: Date): FeedEntry[]

/** CuratedNewsItem[] → 新聞類 feed entries（一則新聞一筆，含 content）。 */
export function makeNewsFeedEntries(items: CuratedNewsItem[], now: Date): FeedEntry[]

/**
 * 併入新 entries：同 id 取新棄舊後再 trimFeed。兩個寫入端 MUST 用此函式，
 * 理由見 contracts/state-write-contract.md C5（2026-08-04 新增）。
 */
export function appendFeedEntries(
  existing: readonly FeedEntry[],
  incoming: readonly FeedEntry[],
  limit = 50,
): FeedEntry[]

/** 上限 50、超出移除最舊（陣列前端），純函式（research D8）。 */
export function trimFeed(entries: readonly FeedEntry[], limit = 50): FeedEntry[]
```

### 2.4 核心段寫入點擴充（既有檔案，簽章變更）

```ts
// src/diff/board-commit.ts —— 擴充參數，回傳型別不變（仍是完整 BoardState）
export function commitBoardPush(
  state: BoardState,
  pushBoard: PushBoard,
  pushedAt: Date,
  diff: BoardDiff,              // 【新增】供投影 boardSummary 的 feed entries
  summary: BoardChangeSummary,  // 【新增】供 publish.boardSummary.summary
): BoardState
```

呼叫端 `board-segment.service.ts` 既有作用域內 `diff`（L73）與 `summary`（L102）皆已算好，
呼叫點（L119 附近）新增兩個既有變數作實參即可，不需額外計算。

`news-segment.service.ts` 不新增函式，直接在既有「push-then-commit」區塊（`save()` 呼叫前）
就地賦值 `state.publish`（見 contracts/state-write-contract.md 的精確次序）。

### 2.5 可見性查詢（`repo-visibility.service.ts`）

```ts
@Injectable()
export class RepoVisibilityService {
  constructor(private readonly github: GithubHttpService, private readonly config: ConfigService) {}

  /** 查 GITHUB_REPOSITORY 的可見性；查不到/格式不符/請求失敗一律回 'unknown'（research D3）。 */
  async check(): Promise<RepoVisibility>
}
```

### 2.6 渲染（純函式，`render-page.ts` / `render-feed.ts`）

```ts
/** state → 儀表板 HTML（research D5）。state.publish 為 undefined 時渲染空狀態，不擲錯。 */
export function renderPage(state: BoardState, now: Date): string

/** state → Atom XML 字串（research D4；feed 套件包裝）。state.publish?.feed 為空時回傳空 feed（0 entries），不擲錯。 */
export function renderFeed(state: BoardState, pagesUrl: string): string
```

### 2.7 編排（`publish.service.ts`）

```ts
@Injectable()
export class PublishService {
  constructor(
    private readonly visibility: RepoVisibilityService,
    private readonly stateStore: StateStore,
    private readonly discord: DiscordWebhookService,
  ) {}

  /** research D10 的完整流程與告警規則。永不 throw（頂層 catch-all，best-effort 告警）。 */
  async run(): Promise<void>
}
```

## 3. 實體關係摘要

```
BoardState（既有，state.schema.ts）
├── board / intros / seenNews / lastBoardPushAt / lastNewsPushAt（既有，不動）
└── publish?（新增）
    ├── news? { items: CuratedNewsItem[]（重用型別）, generatedAt }
    ├── boardSummary? { summary, generatedAt }
    └── feed? FeedEntry[]（≤50，混合 news/board-new/board-climbed 三型別，依 GUID 命名空間區隔）

發佈段（src/publish/，唯讀 BoardState）
├── RepoVisibilityService.check() → RepoVisibility
├── renderPage(state, now) → index.html 內容
└── renderFeed(state, pagesUrl) → feed.xml 內容
```
