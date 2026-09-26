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

/**
 * 精選輸出的領域列舉（三桶）。候選集（`CandidateSet`）自 2026-09-25 起**可能含 `cross`**：關鍵字無命中但
 * 高熱度的「未歸類」候選以 `cross` 進入策展，由 LLM 回填三桶之一；`CuratedNewsItem.domain` 仍恆為三桶。
 */
export type NewsDomain3 = 'ai' | 'devops' | 'frontend-backend';

/**
 * 晨報精選輸出的領域（2026-09-26 新增，憲章 1.8.0）：三桶之外多一個 `general`＝「資安與一般軟體工程」
 * 補位項——只來自「未歸類高熱度」候選、只在三桶精選未滿 `MAX_ITEMS` 時補入（見 `curation-validate.ts`）。
 * 不參與非 AI 配額計算；配額、歸類、候選流程仍只認三桶。
 */
export type NewsDigestDomain = NewsDomain3 | 'general';

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
  /**
   * 該來源專屬的新鮮度視窗（天數，2026-09-21 新增）；省略即沿用 `DEFAULT_FUNNEL_CONFIG.freshnessWindowDays`
   * （30 天）。只能縮短、不能超過預設值（schema 把關）：漏斗內的結構性保險仍以預設值檢查，放寬會被它丟掉。
   * 用於「同一系列文章在 feed 上掛數週、每日滴一兩篇舊文」的來源（如 kubernetes-blog 版本功能系列）。
   */
  freshnessWindowDays?: number;
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
 * `domain` 於管線中段可能仍為 `cross`（來源設定值）——經 `classifyCross` 後落定為三桶之一；無命中時
 * 該候選被丟棄，**或**（2026-09-25 起）有真實分數且達 `unresolvedMinScore` 者以 `cross` 保留為「未歸類
 * 高熱度」候選進入策展（見 `funnel.ts`）。故候選集**不再保證** `domain !== 'cross'`；讀取端以
 * `isUnresolved()` 判別，精選輸出的 `domain` 由策展層落定為三桶。
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
