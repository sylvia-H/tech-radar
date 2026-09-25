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
 * 2026-09-25：`GEMINI_MODEL_NEWS` 由 `gemini-3.8-flash` 改為 `gemini-3.7-flash`（使用者決策，試型號穩定性）。
 * 理由：09-13～09-25 的 13 天裡，3.8-flash 幾乎每天首次呼叫就回 **503 UNAVAILABLE（high demand）**，
 * 09-18／09-24／09-25 更是 4 次重試全數耗盡、退 Lite 策展，而 Lite 選出的則數明顯偏少（09-24 五則、
 * 09-25 七則，對照 Flash 成功日的 09-22 十則、09-23 九則）。503 是該型號的伺服器端容量問題，退避拉長
 * （10s／20s／40s）也只橫跨約 1.5 分鐘、跨不過尖峰，故改試熱度較低的前一代 Flash。分流與降級機制不變
 * （Flash 失敗仍以 Lite 單次重試）。注意 3.7-flash 無 Flash-Lite 版本，配額級別與 3.8 可能不同，
 * 觀察 Actions log 的型號字樣與是否改成 429。
 */
export const GEMINI_MODEL_BOARD = 'gemini-3.5-flash-lite';
export const GEMINI_MODEL_NEWS = 'gemini-3.7-flash';

/** 可用型號的聯集（避免呼叫端打錯字串）。 */
export type GeminiModel = typeof GEMINI_MODEL_BOARD | typeof GEMINI_MODEL_NEWS;

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
