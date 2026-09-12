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
 * 兩陣列的歸屬（2026-09-12 起，對應 prompt 三類判準；先前 `communityPicks` 稱「社群熱度」）：
 * `officialPicks`＝(1) 官方發布＋(3) 影響開發者的外部事件；`communityPicks`＝(2) 技術深度內容。
 * 分成兩陣列是為了把「`officialPicks` 優先於 `communityPicks`」的收錄順序做成**結構性保證**，
 * 而非只靠 prompt 敘述指望 LLM 依序執行——單次生成整個回應的 LLM 無法真的「先窮盡評估完一組再看
 * 下一組」，純文字指示只是軟約束（實測：候選池充足、總數遠低於上限時，LLM 仍會在官方候選還沒
 * 選完前納入社群候選）。改為兩陣列後，`curation-validate.ts` 在合併時固定以 `officialPicks` 全部
 * 排在 `communityPicks` 之前，`slice(MAX_ITEMS)` 時 `communityPicks` 天然優先被截掉，優先順序不再
 * 依賴 LLM 是否確實「先做完再做下一步」。
 */
export interface CurationLlmResponse {
  officialPicks: CurationLlmPick[];
  communityPicks: CurationLlmPick[];
  /**
   * 回應中除 `officialPicks`／`communityPicks` 以外、被解析器忽略的其他頂層鍵（無則為空陣列，
   * 2026-09-12 新增）。用途是防禦性可觀測性：prompt 已要求「只能有兩個鍵」，但三類判準對兩個陣列
   * 時 LLM 仍可能自創 `externalPicks` 之類的鍵放第 (3) 類，若靜默忽略會無聲少推。解析器只記錄鍵名、
   * 不擲錯也不降級（兩個必要鍵仍合法，寧可少幾則也不要整份退回原文標題），交由
   * `NewsCurationService.curate()` 以 `logger.warn` 揭露。
   */
  ignoredKeys: string[];
}

/**
 * 精選輸出的一則。成功策展為繁中精煉版（`degraded:false`）；策展失敗降級為原文版
 * （`degraded:true`，`content:null`）。`url`/`domain`/`sourceId`/`sources`/`sourceCount`/
 * `weightedScore` 皆為程式對回候選附上的事實，非 LLM 產生（憲章 VI）。
 */
export interface CuratedNewsItem {
  title: string;
  content: string | null;
  url: string;
  domain: NewsDomain3;
  /**
   * 代表項來源 id（`NewsCandidate.sourceId`，多來源合併時為代表項所屬來源，2026-09-12 新增）。
   * 程式提供的事實、非 LLM 產生（憲章 VI）；隨推播寫入 `seenNews` 供事後按來源／領域統計，
   * 不再靠 host 反推來源。
   */
  sourceId: string;
  /**
   * 合併後的全部來源 id（`NewsCandidate.sources`，含代表項與被合併的次要來源，2026-09-12 新增）。
   * 程式提供的事實、非 LLM 產生（憲章 VI）。只記 `sourceId` 會系統性低估 RSS 一手來源——HN 是
   * 唯一帶分數的來源，凡交叉驗證項代表項一律是 hn，一手來源全被計成次要——故隨推播一併寫入
   * `seenNews`，供「哪些來源值得留」的統計把被合併者也算進去。與 `sourceCount` 的關係：
   * `sourceCount === sources.length`；`sourceCount` 保留不動以免影響既有讀取端。
   */
  sources: string[];
  sourceCount: number;
  weightedScore: number;
  degraded: boolean;
}

/** `NewsCurationService.curate()` 的回傳：當日晨報精選集（FR-008/010、SC-001~006）。 */
export interface CuratedDigest {
  items: CuratedNewsItem[];
  degraded: boolean;
}
