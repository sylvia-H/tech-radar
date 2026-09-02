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
  /**
   * 發表天齡（整數天，`floor((now − publishedAt) / 1 天)`，未來時間夾為 0；`publishedAt` 缺失或
   * 無法解析為 `null`，2026-09-02 新增）。此前投影完全沒有時間資訊，LLM 分不出三週前與今天的
   * 文章；prompt 以「重要性相當時優先較新者、但天齡不改變是否重大」的軟性偏好使用此欄位。
   */
  ageDays: number | null;
}

/** `parseCurationResponse()` 解析出的單則（形狀淺驗證後、硬驗證前，research D2）。 */
export interface CurationLlmPick {
  ref: number;
  title: string;
  content: string;
}

/**
 * LLM 回應解析容器（2026-08-04 由單一 `picks` 改為 `officialPicks`／`communityPicks` 兩陣列）。
 * 分成兩陣列是為了把「官方發布優先於社群熱度」的收錄順序做成**結構性保證**，而非只靠 prompt
 * 敘述指望 LLM 依序執行——單次生成整個回應的 LLM 無法真的「先窮盡評估完一組再看下一組」，純文字
 * 指示只是軟約束（實測：候選池充足、總數遠低於上限時，LLM 仍會在官方候選還沒選完前納入社群熱度
 * 候選）。改為兩陣列後，`curation-validate.ts` 在合併時固定以 `officialPicks` 全部排在
 * `communityPicks` 之前，`slice(MAX_ITEMS)` 時社群熱度天然優先被截掉，優先順序不再依賴 LLM
 * 是否確實「先做完再做下一步」。
 */
export interface CurationLlmResponse {
  officialPicks: CurationLlmPick[];
  communityPicks: CurationLlmPick[];
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
