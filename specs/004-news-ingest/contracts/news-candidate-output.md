# Contract: 漏斗純函式與候選輸出（`src/news/`）

階段 A 的零 LLM 純函式群與 `NewsIngestService` 產出的候選集契約。所有純函式**無 I/O、時間經參數
注入**，供憲章 VIII 單測。

## 去重（US2, 憲章 V）

```ts
// url-normalize.ts
normalizeTargetUrl(raw: string): string;
// 小寫 host、去 www.、去追蹤參數(utm_*/ref/fbclid/gclid…)、統一結尾斜線、去 fragment；
// 已知短網址 host 單次解址，否則照原樣。指向同一資源 → 相同鍵（SC-009）。

// title-similarity.ts
normalizeTitle(title: string): string[];         // 小寫、去標點、去 stop words → token[]
jaccard(a: string[], b: string[]): number;       // |∩|/|∪|

// dedup.ts
dedupByUrl(cands: NewsCandidate[]): NewsCandidate[];      // 同 normalizedUrl 合併，取最高分為代表，併 sources[]
dedupByTitle(cands: NewsCandidate[], threshold: number): NewsCandidate[]; // 無共同 URL 者標題 Jaccard 補漏
```

- 合併不變式：代表項＝分數最高者（FR-012）；`sources[]` 累積全部來源、去重；`length>=2` 標記強訊號（FR-017）。

## 歸類（FR-006, Clarifications 2026-07-16）

```ts
// news-classify.ts
classifyCross(text: string): NewsDomain3 | null;  // ai|devops|frontend-backend；前後端關鍵字 → 單一 frontend-backend
// 非 cross 來源不呼叫此函式，直接沿用設定 domain。
```

## 漏斗過濾與加權（US3）

```ts
// funnel.ts
interface FunnelConfig {
  scoreThresholds: Record<NewsTier, number | null>; // 有分數才比；Tier2/無分數不套（null）
  crossValidationBoost: number;                     // sources>=2
  boardRelevanceBoost: number;                      // 命中榜上 repo
  tierWeight: Record<NewsTier, number>;             // Tier3 更低權重
  convergeMax: number;                              // 收斂上限（~25）
}
runFunnel(
  cands: NewsCandidate[],
  boardRepoNames: ReadonlySet<string>,  // 空集合 → 榜單相關性略過（FR-018）
  cfg: FunnelConfig,
): NewsCandidate[];
```

- 過濾：`score` 存在且低於該 tier 門檻 → 丟；Tier 2 或 `score===null` → 不因門檻丟（SC-005）。
- 加權：交叉驗證（FR-017）、榜單相關性（FR-018，無榜單資料安全略過）、tier 差異化（FR-019）。
- 排序（全序，SC-011）：`weightedScore ↓ → publishedAt ↓ → normalizedUrl ↑`。
- 收斂：取前 `convergeMax`；不足照實輸出（FR-021）。

## seen 排除與修剪（US4）

```ts
// seen-news.ts
pruneSeenNews(entries: SeenNewsEntry[], now: Date, retentionDays?: number): SeenNewsEntry[]; // 預設 7
excludeSeen(cands: NewsCandidate[], seen: SeenNewsEntry[]): NewsCandidate[];                 // 正規化 URL 比對
```

## 編排輸出（`news-ingest.service.ts`）

```ts
ingest(now: Date, boardRepoNames?: ReadonlySet<string>): Promise<NewsCandidate[]>;
// 驗證設定 → 逐源隔離抓取（0 筆告警帶 id／失敗跳過）→ 正規化 → dedupByUrl → dedupByTitle
// → classifyCross → runFunnel → excludeSeen(pruneSeenNews(load().seenNews)) → 排序後候選 → news-log 觀測。
// 不推播、不寫回狀態（本 Feature 邊界）。
```

## 驗收對應

FR-005/006/011-023；SC-001/003/004/005/006/007/008/009/010/011；US2/US3/US4 全 Acceptance Scenarios。
