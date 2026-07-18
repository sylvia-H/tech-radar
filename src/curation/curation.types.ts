import { NewsDomain3 } from '../news/news.types';

/**
 * 送交 LLM 的候選公開脈絡投影（策展輸入投影，只含公開資料，FR-007）。`ref` 為候選在送入
 * prompt 清單中的 0-based 索引（穩定參照鍵，research D1），只在單次執行內有效、不持久化。
 */
export interface CurationItemView {
  ref: number;
  title: string;
  domain: NewsDomain3;
  tier: 1 | 2 | 3;
  score: number | null;
  sourceCount: number;
  onBoard: boolean;
  summaryExcerpt: string | null;
}

/** `parseCurationResponse()` 解析出的單則（形狀淺驗證後、硬驗證前，research D2）。 */
export interface CurationLlmPick {
  ref: number;
  title: string;
  content: string;
}

/** LLM 回應解析容器（research D1）。 */
export interface CurationLlmResponse {
  picks: CurationLlmPick[];
}

/**
 * 精選輸出的一則。成功策展為繁中精煉版（`degraded:false`）；策展失敗降級為原文版
 * （`degraded:true`，`content:null`）。`url`/`domain`/`sourceCount`/`weightedScore` 皆為
 * 程式對回候選附上的事實，非 LLM 產生（憲章 VI）。
 */
export interface CuratedNewsItem {
  title: string;
  content: string | null;
  url: string;
  domain: NewsDomain3;
  sourceCount: number;
  weightedScore: number;
  degraded: boolean;
}

/** `NewsCurationService.curate()` 的回傳：當日晨報精選集（FR-008/010、SC-001~006）。 */
export interface CuratedDigest {
  items: CuratedNewsItem[];
  degraded: boolean;
}
