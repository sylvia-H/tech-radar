# Contract: 抓取器介面與分派（`src/news/fetchers/`）

四種抓取器共用一個介面；依 `source.type` 分派。新增**同類型**來源不動此處（FR-004）。

## 介面

```ts
export interface RawItem {
  title: string;
  targetUrl: string;         // HN 無外部連結時為自身 permalink（FR-015）
  summary: string | null;    // 截 ~500 字
  score: number | null;      // 無社群分數（如 Reddit RSS）為 null
  publishedAt: string | null;// ISO 8601
}

export interface FetcherContext {
  now: Date;                 // 注入時間（近 7 天口徑），利於測試
  http: NewsHttp;            // getText / getJson（UA／條件式／退避）
  parser: RssParser;         // rss-parser 實例（可注入 mock）
}

export interface FetchResult {
  parsedCount: number;       // 過濾前解析到的原始條目數（0 = 來源空／壞）
  items: RawItem[];          // 過濾後產出的候選原料
}

export type SourceFetcher = (source: NewsSource, ctx: FetcherContext) => Promise<FetchResult>;

export const FETCHERS: Record<NewsSourceType, SourceFetcher>;
```

`parsedCount` 與 `items` 分離，讓呼叫端區分「來源空／壞掉」與「來源正常、只是內容過濾後無合格項」
（如 github-releases 濾光 patch），後者不應誤觸 0 筆告警。

## 各抓取器契約

| type | 端點 | target-URL | score | 過濾 |
|------|------|-----------|-------|------|
| `hn-algolia` | Algolia search（`created_at_i>7天前`） | 項目 `url`；空則 HN permalink | `points` | 近 7 天 |
| `reddit-weekly` | `/top/.rss?t=week` | 項目 `link` | `null`（RSS 無分數） | 本週 |
| `rss` | 一般 RSS/Atom | 項目 `link` | 視 feed（通常 `null`） | feed 自身 |
| `github-releases` | `releases.atom` | release `link` | `null` | **drop pre-release／純 patch**（`release-filter`，FR-008/SC-010；安全字樣掃**標題＋內文**，版號／pre-release 只看標題） |

## 錯誤與 0 筆語意（由 `NewsIngestService` 統一處理）

- 抓取器**擲錯** → 呼叫端 try/catch 記錄並跳過該源，不斷全線（FR-026）。
- 抓取器**原始解析 0 筆**（`parsedCount === 0`，即來源空／壞）→ 呼叫端發**帶 `source.id`** 的告警
  （FR-025，含 Tier 2；非例外）。
- 抓取器**過濾後 0 筆**（`parsedCount > 0` 但 `items` 空，如 github-releases 濾光 patch）→ 屬正常、
  **不告警**（避免誤報）。

## 驗收對應

- FR-004/005/007/008/010/015；SC-010（releases 噪音 0）；Acceptance US1-6/7。
