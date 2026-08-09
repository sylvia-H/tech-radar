/** Gemini 免費層 Flash 系型號（憲章 I 釘死；dev-guide §2.4）。 */
export const GEMINI_MODEL = 'gemini-3.5-flash-lite';

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
