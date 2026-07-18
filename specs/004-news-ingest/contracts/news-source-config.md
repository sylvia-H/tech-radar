# Contract: 新聞來源設定檔（`src/config/news-sources.ts`）

單一設定入口（憲章 IV）。增、刪、修來源**只改此檔**，不動任何抓取／漏斗程式碼。

## 型別

```ts
export type NewsSourceType = 'hn-algolia' | 'reddit-weekly' | 'rss' | 'github-releases';
export type NewsDomain = 'ai' | 'devops' | 'frontend-backend' | 'cross';
export type NewsTier = 1 | 2 | 3;

export interface NewsSource {
  id: string;            // 唯一鍵（告警／seenNews 引用）
  type: NewsSourceType;  // 分派抓取器
  url: string;           // feed／端點
  domain: NewsDomain;    // cross 交關鍵字歸類；其餘直接沿用
  tier: NewsTier;        // 漏斗門檻／權重
  enabled?: boolean;     // 預設 true
}

export const NEWS_SOURCES: NewsSource[];
```

## Schema 驗證契約（`news-source.schema.ts`）

- `validateNewsSources(list: unknown): NewsSource[]`
  - 逐筆 zod：`id` 非空 string；`type`/`domain`/`tier` 為列舉；`url` 為合法 URL；`enabled` 選填 boolean。
  - **跨筆**：`id` 唯一。
  - 失敗行為：**擲 Error，訊息帶違規 `id`／欄位**（MUST NOT 靜默載入不合法清單，FR-002）。
  - 成功行為：回傳型別化 `NewsSource[]`（`enabled` 未給者不在此填預設，由抓取分派時視 `!== false` 判定啟用）。

## 啟用語意（FR-003）

- `enabled === false` → 該來源完全略過（不抓取、不告警）。
- `enabled` 為 `true`／未定義 → 抓取。

## 驗收對應

- FR-001/002/003/004、SC-002（僅設定檔 diff 即改變抓取行為）。
