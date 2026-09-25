/**
 * Gemini 免費層 Flash 系型號（憲章 I 釘死；dev-guide §2.4）。2026-09-12 起依資料流分兩個型號：
 *
 * - `GEMINI_MODEL_BOARD`（Flash-Lite）：榜單週報用——repo 250 字簡介（每新進 repo 一生一次）與
 *   榜單日一句話 TL;DR。用量極低、任務單純，Lite 足夠。**未指定型號時的預設值**。
 * - `GEMINI_MODEL_NEWS`（Flash）：每日晨報策展用——單次呼叫要對 50 則候選做語意去重、三類判準
 *   逐則核對與繁中改寫，判斷品質直接決定晨報內容，值得用較強的 Flash；每日僅 1 次呼叫。
 *
 * 教訓：2026-09-02 曾把**全部**呼叫升到 `gemini-3.7-flash`，當天觸及免費層上限而改回 Lite
 * （Flash 與 Flash-Lite 的免費配額不同級：`gemini-3.8-flash` 免費層僅 **5 RPM／20 RPD**，2026-09-12
 * 於 AI Studio 確認，本機手動執行吃同一份 RPD）。這次只讓每日 1 次的策展走 Flash（含退避最多 4 次
 * HTTP 嘗試，仍在 5 RPM 之下、對 20 RPD 有 5 倍餘裕），簡介與 TL;DR 留在 Lite；Flash 失敗會先以 Lite
 * 重試一次（`NewsCurationService`），若連續撞上限則策展改回 `GEMINI_MODEL_BOARD` 即可（只改此檔）。
 *
 * 2026-09-25（一）：`GEMINI_MODEL_NEWS` 曾由 `gemini-3.8-flash` 改為 `gemini-3.7-flash`——09-13～09-25 的
 * 13 天裡 3.8-flash 幾乎每天首次呼叫就回 **503 UNAVAILABLE（high demand）**，09-18／09-24／09-25 更是 4 次
 * 重試全數耗盡、退 Lite 策展，而 Lite 選出的則數明顯偏少（09-24 五則、09-25 七則，對照 Flash 成功日的
 * 09-22 十則、09-23 九則）。503 是型號伺服器端容量問題，退避拉長（10s／20s／40s）只橫跨約 1.5 分鐘、
 * 跨不過尖峰。**該次改動已被下一段取代，未曾上線。**
 *
 * 2026-09-25（二，現況）：**策展主備型號皆改為 Flash-Lite 系**（使用者決策）——主型號
 * `GEMINI_MODEL_NEWS` = `gemini-3.5-flash-lite`（與 `GEMINI_MODEL_BOARD` 同型號、配額同一份），備援
 * `GEMINI_MODEL_NEWS_FALLBACK` = `gemini-3.1-flash-lite`。理由：新篩選邏輯上線後候選池由 60 放大到 70、
 * 每日輸出至多 15 則，prompt 與回應都變長，Flash 系的 **5 RPM／20 RPD** 餘裕與 503 過載風險都不划算；
 * Lite 免費層額度高出一個級別（約 15 RPM／1,000 RPD），每日仍只 1 次策展呼叫。備援刻意選**不同型號**
 * 而非同型號重試：免費配額按型號分開計算，且本專案兩度遇到型號無預警 404，換型號才有機會當日成功。
 * `gemini-3.1-flash-lite` 於 2026-08-09 曾是本專案的 Lite 型號，2026-09-25 覆核官方 deprecations 頁：
 * 公告的 shutdown 日為 **2027-05-07**（3.5-flash-lite 未公告 shutdown），到期前須換備援型號。
 * 品質風險：Lite 策展日的則數變異較大（09-13～09-25 四個 Lite 日為 9／9／5／7 則），且新 prompt 要 LLM
 * 對「未歸類高熱度」候選回填領域、辨識同題群集，對判斷力要求更高——若連續一週則數明顯偏低、或未歸類
 * 候選全數不選，就改回 Flash 系（只改此檔常數）。
 */
export const GEMINI_MODEL_BOARD = 'gemini-3.5-flash-lite';
export const GEMINI_MODEL_NEWS = 'gemini-3.5-flash-lite';

/** 策展備援型號：主型號擲 `LlmError` 時同 prompt 單次重試用（2026-09-25 新增，見上方 docstring）。 */
export const GEMINI_MODEL_NEWS_FALLBACK = 'gemini-3.1-flash-lite';

/** 可用型號的聯集（避免呼叫端打錯字串）。 */
export type GeminiModel =
  | typeof GEMINI_MODEL_BOARD
  | typeof GEMINI_MODEL_NEWS
  | typeof GEMINI_MODEL_NEWS_FALLBACK;

/** `LlmService.generate` 的選項：`model` 未給即用 `GEMINI_MODEL_BOARD`。 */
export interface LlmGenerateOptions {
  model?: GeminiModel;
}

/** 429/503/網路錯誤最多重試次數（含首次嘗試，research D6）。 */
export const LLM_MAX_RETRIES = 4;

/**
 * 指數退避基準毫秒數（research D6；2026-09-20 由 1000 → 10000，使用者決策）。1.1.0 上線後
 * gemini-3.8-flash 連續六天首次呼叫皆失敗（每次失敗耗時 5～45 秒，疑為 503 過載），原本 1s／2s／4s
 * 的退避對伺服器端排隊太短、一天四次耗盡退 Lite。改為 10s／20s／40s＋jitter，四次嘗試等待總計約
 * 70～100 秒，四次呼叫落在約兩分鐘內、仍在 5 RPM 之下；對每日一次的排程最壞多約 1.5 分鐘。
 */
export const LLM_BACKOFF_BASE_MS = 10000;

/** 指數退避上限毫秒數（research D6；2026-09-20 由 8000 → 60000，配合基準調整，第三次退避 40s＋jitter 不被夾）。 */
export const LLM_MAX_BACKOFF_MS = 60000;

/**
 * `LlmService.generate` 失敗時擲出，供 `IntroService` catch 後降級（FR-014）。
 * `reason` 供 log 分流，不含 prompt/回應全文（憲章 VII）。
 */
export class LlmError extends Error {
  readonly name = 'LlmError';

  constructor(public readonly reason: 'exhausted' | 'empty' | 'error') {
    super(`LLM 呼叫失敗：${reason}`);
  }
}
