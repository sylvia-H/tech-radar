/**
 * 新聞資料流（階段 A）的記憶體型別。除 `SeenNewsEntry`（沿用 `state.schema.ts`）外皆為
 * 單次執行的記憶體結構，不持久化（data-model.md）。
 *
 * **領域列舉刻意與榜單 `board.types.ts` 的 `Domain` 不同**（兩條獨立資料流）：新聞保留 `devops`，
 * 且來源設定另有 `cross`（交關鍵字歸類）。故不复用榜單型別，另立於此（plan Structure Decision）。
 */

/** 四種抓取類型（釘死；新增同型別只改設定檔，FR-004）。 */
export type NewsSourceType = 'hn-algolia' | 'reddit-weekly' | 'rss' | 'github-releases';

/** 來源設定的領域列舉：`cross` 交由關鍵字歸類，其餘直接沿用（FR-006/027）。 */
export type NewsDomain = 'ai' | 'devops' | 'frontend-backend' | 'cross';

/** 候選輸出的領域列舉：`cross` 歸類後落定為三桶之一，輸出不留 `cross`（data-model 不變式）。 */
export type NewsDomain3 = 'ai' | 'devops' | 'frontend-backend';

/** 來源層級：漏斗門檻與權重差異化（FR-016/019）。 */
export type NewsTier = 1 | 2 | 3;

/** 單一新聞來源定義（設定即資料，憲章 IV）。 */
export interface NewsSource {
  /** 唯一鍵：抓取告警與 `seenNews` 統計的引用鍵（FR-002）。 */
  id: string;
  /** 決定分派哪個抓取器（FR-004）。 */
  type: NewsSourceType;
  /** feed／端點位址。 */
  url: string;
  /** 非 `cross` 直接沿用；`cross` 交關鍵字歸類（FR-006）。 */
  domain: NewsDomain;
  /** 漏斗門檻／權重差異化（FR-016/019）。 */
  tier: NewsTier;
  /** 預設 `true`（`!== false` 即啟用）；停用者完全略過（FR-003）。 */
  enabled?: boolean;
}

/** 抓取器統一輸出（正規化前的中間結構）。 */
export interface RawItem {
  title: string;
  /** 新聞本體連結；HN 無外部連結時為自身 permalink（FR-015）。 */
  targetUrl: string;
  /** feed 摘要／描述節錄（截 ~500 字，FR-007）。 */
  summary: string | null;
  /** 社群分數；RSS 無分數者為 `null`（research D8）。 */
  score: number | null;
  /** ISO 8601 新鮮度。 */
  publishedAt: string | null;
}

/**
 * 新聞候選（正規化後的統一結構，FR-005）。
 *
 * `domain` 於管線中段可能仍為 `cross`（來源設定值）——經 `classifyCross` 後落定為三桶之一，
 * 或（無命中時）該候選被丟棄；故**輸出集合的不變式**是 `domain !== 'cross'`（data-model）。
 * `weightedScore` 為漏斗加權後的排序輔助分（記憶體計算，非事實數據；憲章 VI）。
 */
export interface NewsCandidate {
  title: string;
  /** 去重主鍵（`normalizeTargetUrl` 產出，FR-011）。 */
  normalizedUrl: string;
  /** 正規化前的 target-URL（供輸出／觀測，FR-005）。 */
  originalUrl: string;
  summary: string | null;
  /** 代表項來源 id。 */
  sourceId: string;
  /** 代表項分數（合併時取最高分者為代表，FR-012）。 */
  score: number | null;
  domain: NewsDomain;
  tier: NewsTier;
  /** 合併後的多來源 id 清單；`length >= 2` 為交叉驗證強訊號（FR-017）。 */
  sources: string[];
  /** 新鮮度（決勝用，FR-020）。 */
  publishedAt: string | null;
  /** 漏斗加權後的排序輔助分（runFunnel 填入）。 */
  weightedScore: number;
}

/** 階段 A 的最終產物：一份排序後、大致無重複的候選集合，作為 F6 單次 LLM 策展的輸入。 */
export type CandidateSet = NewsCandidate[];
