/**
 * Gemini 免費層 Flash 系型號（憲章 I 釘死；dev-guide §2.4）。2026-09-12 起依資料流分兩個型號：
 *
 * - `GEMINI_MODEL_BOARD`（Flash-Lite）：榜單週報用——repo 250 字簡介（每新進 repo 一生一次）與
 *   榜單日一句話 TL;DR。用量極低、任務單純，Lite 足夠。**未指定型號時的預設值**。
 * - `GEMINI_MODEL_NEWS`（Flash）：每日晨報策展用——單次呼叫要對 50 則候選做語意去重、三類判準
 *   逐則核對與繁中改寫，判斷品質直接決定晨報內容，值得用較強的 Flash；每日僅 1 次呼叫。
 *
 * 教訓：2026-09-02 曾把**全部**呼叫升到 `gemini-3.7-flash`，當天觸及免費層上限而改回 Lite
 * （Flash 與 Flash-Lite 的免費配額不同級）。這次只讓每日 1 次的策展走 Flash，簡介與 TL;DR 留在
 * Lite；上線後前幾天須留意 429／告警，若再撞上限則策展改回 `GEMINI_MODEL_BOARD` 即可（只改此檔）。
 */
export const GEMINI_MODEL_BOARD = 'gemini-3.5-flash-lite';
export const GEMINI_MODEL_NEWS = 'gemini-3.8-flash';

/** 可用型號的聯集（避免呼叫端打錯字串）。 */
export type GeminiModel = typeof GEMINI_MODEL_BOARD | typeof GEMINI_MODEL_NEWS;

/** `LlmService.generate` 的選項：`model` 未給即用 `GEMINI_MODEL_BOARD`。 */
export interface LlmGenerateOptions {
  model?: GeminiModel;
}

/** 429/503/網路錯誤最多重試次數（含首次嘗試，research D6）。 */
export const LLM_MAX_RETRIES = 4;

/** 指數退避基準毫秒數（research D6）。 */
export const LLM_BACKOFF_BASE_MS = 1000;

/** 指數退避上限毫秒數（research D6）。 */
export const LLM_MAX_BACKOFF_MS = 8000;

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
