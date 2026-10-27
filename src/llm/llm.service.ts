import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiError, GenerateContentConfig, GenerateContentResponse, GoogleGenAI, ThinkingLevel } from '@google/genai';
import {
  GEMINI_MODEL_BOARD,
  GeminiModel,
  LLM_BACKOFF_BASE_MS,
  LLM_MAX_BACKOFF_MS,
  LLM_MAX_RETRIES,
  LLM_TIMEOUT_MS,
  LlmError,
  LlmGenerateOptions,
  LlmThinkingLevel,
} from './llm.types';
import { installGeminiDispatcher } from './gemini-dispatcher';

/** 觸發退避重試的暫時性 HTTP 狀態碼（速率/額度限制、暫時不可用，research D6）。 */
const RETRYABLE_STATUS = new Set([429, 503]);

/** undici 連線層逾時的錯誤碼（`fetch failed` 的 `cause.code`）：視同呼叫逾時（2026-10-27）。 */
const UNDICI_TIMEOUT_CODES = new Set(['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);

/** 本專案的 thinking 深度 → SDK 列舉（只暴露三檔，不用 MINIMAL／UNSPECIFIED）。 */
const THINKING_LEVEL_MAP: Record<LlmThinkingLevel, ThinkingLevel> = {
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

/**
 * 所有 LLM 呼叫的唯一入口（FR-011）：對 Gemini 免費層 Flash 系送一段 prompt 生成文字，
 * 內建 429/503/網路錯誤指數退避 + jitter 重試（FR-012）；只送呼叫端給的 prompt（FR-013）。
 * 本 Feature 由簡介使用，F6 新聞策展 MUST 重用同一封裝。
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly client: GoogleGenAI;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY 未設定');
    }
    this.client = new GoogleGenAI({ apiKey });
    // Gemini 連線層逾時上限（2026-10-27，ADR 0009）：Node fetch 預設 300 秒會先砍斷策展的長呼叫。
    if (!installGeminiDispatcher()) {
      this.logger.warn('偵測到環境代理設定（NODE_USE_ENV_PROXY），保留 Node 預設 dispatcher：Gemini 呼叫逾時上限維持 300 秒');
    }
  }

  /**
   * 對 Gemini Flash 系送一段 prompt 生成文字（trim 後非空）。`options.model` 未給即用
   * `GEMINI_MODEL_BOARD`（Flash-Lite）；每日晨報策展傳 `GEMINI_MODEL_NEWS`（2026-09-12 起，見
   * `llm.types.ts`）。退避、錯誤分類與 log 對兩個型號一視同仁，log 會帶型號以利對帳配額。
   * `options.thinkingLevel`／`options.responseJsonSchema`（後者 2026-10-17 新增，ADR 0006）為進階設定，
   * 帶法與 400 防禦見 `callModel()`；log 以「thinking=…」「schema=json」標示有帶上哪些。
   *
   * 逾時（2026-10-27，ADR 0009）：每次 HTTP 呼叫以 `abortSignal` 限時 `options.timeoutMs`（未給即 `LLM_TIMEOUT_MS`）。逾時
   * **不在同一型號重試**、直接擲 `'timeout'`：等滿逾時仍無回應，同型號重送多半再等一輪，且 Gemini 端可能已生成完、
   * 每次重送都可能多扣免費層 RPD；交呼叫端換備援或降級。
   * @throws LlmError 空 prompt／空回應（`'empty'`，不重試）、重試耗盡（`'exhausted'`）、
   *   不可重試的用戶端錯誤（`'error'`，如 400/401/403）、單次呼叫逾時（`'timeout'`，不重試）。
   */
  async generate(prompt: string, options: LlmGenerateOptions = {}): Promise<string> {
    if (!prompt.trim()) {
      throw new LlmError('empty');
    }
    const model = options.model ?? GEMINI_MODEL_BOARD;
    const thinking = options.thinkingLevel;
    const schema = options.responseJsonSchema;
    const timeoutMs = options.timeoutMs ?? LLM_TIMEOUT_MS;
    // 有 schema 時加標「schema=json」（2026-10-17，ADR 0006）：讓 Actions log 看得出結構化輸出確實有帶上。
    const thinkingLabel = (thinking ? `，thinking=${thinking}` : '') + (schema ? '，schema=json' : '');

    for (let attempt = 1; attempt <= LLM_MAX_RETRIES; attempt++) {
      const signal = AbortSignal.timeout(timeoutMs);
      try {
        const response = await this.callModel(model, prompt, thinking, schema, signal);
        const text = (response.text ?? '').trim();
        // 用量與結束原因（2026-09-25 新增）：候選池 60 → 70、晨報 10 → 15 則後，「prompt 太大容易失敗」
        // 只能猜——此前既不記 token 數也不記 finishReason，輸出被 MAX_TOKENS 截斷只會以 reason=empty
        // 現身。只印數字與型號，不含 prompt／回應全文（憲章 VII）。
        const usage = describeUsage(response, prompt.length);
        if (!text) {
          // 空回應（多為 MAX_TOKENS 截斷或安全過濾）刻意不重試：重送同一 prompt 通常仍空，
          // 重試只會白白多燒一次 Gemini 免費層配額（憲章 I／V 節制 LLM）；交由呼叫端降級。
          this.logger.warn(`LLM 回應為空（${model}${thinkingLabel}，${usage}）`);
          throw new LlmError('empty');
        }
        this.logger.log(`LLM 用量（${model}${thinkingLabel}，${usage}，回應 ${text.length} 字元）`);
        return text;
      } catch (err) {
        if (err instanceof LlmError) {
          throw err;
        }
        if (isTimeout(err, signal)) {
          this.logger.warn(
            `LLM 呼叫逾時（${model}${thinkingLabel}，${timeoutMs / 1000} 秒，${this.errDetail(err)}），不在同一型號重試`,
          );
          throw new LlmError('timeout');
        }
        if (!this.isRetryable(err)) {
          // 不重試路徑原本吞掉真實狀態碼/訊息，只留籠統的 'error'，故障時無從排查；
          // 這裡補印出處（不含 prompt/回應全文，符合憲章 VII）。
          this.logger.warn(`LLM 呼叫失敗（不重試，${model}）：${this.errDetail(err)}`);
          throw new LlmError('error');
        }
        // 重試路徑同樣印出處（2026-09-20 補）：1.1.0 上線後 gemini-3.8-flash 連續六天首次呼叫皆失敗重試、
        // 一天耗盡退 Lite，卻因這裡只印「呼叫失敗」而無法分辨 429／503／網路層錯誤，成因懸置一週。
        // 只印狀態碼與訊息，不含 prompt／回應全文（憲章 VII）。
        const detail = this.errDetail(err);
        if (attempt < LLM_MAX_RETRIES) {
          const wait = this.backoffMs(attempt);
          this.logger.warn(`LLM 呼叫失敗（${model}，${detail}），第 ${attempt}/${LLM_MAX_RETRIES} 次退避 ${wait}ms 後重試`);
          await this.delay(wait);
        } else {
          this.logger.warn(`LLM 呼叫失敗（${model}，${detail}），第 ${attempt}/${LLM_MAX_RETRIES} 次，重試耗盡`);
        }
      }
    }
    throw new LlmError('exhausted');
  }

  /**
   * 單次 HTTP 呼叫。「進階設定」共兩項，可同時存在於同一個 `config`：
   * - `thinking`：帶 `config.thinkingConfig.thinkingLevel`（2026-09-27 新增，見 `llm.types.ts` `NEWS_THINKING_LEVEL`）。
   * - `schema`：帶 `config.responseMimeType: 'application/json'`＋`config.responseJsonSchema`（2026-10-17 新增，
   *   ADR 0006）。2026-10-08 gemini-3.8-flash 回了形狀不符的 JSON（某則缺欄位或型別錯）、整份晨報降級，
   *   僅靠 prompt 約束形狀不夠，改由 Gemini 結構化輸出保證回應形狀。
   * `config.abortSignal`（2026-10-27）一律帶上：只在 client 端用來限時、不送進請求體；兩項進階設定皆無時請求體只多一個
   * 空的 `generationConfig`，等同不帶設定（簡介／TL;DR 不受影響）。
   *
   * 防禦：進階設定是否被型號接受無法在本機驗證（無 `GEMINI_API_KEY`），若型號以 400 拒絕該參數，
   * 不能讓整條策展因設定問題走 `error` → 備援型號同樣 400 → 原文標題版＋紅色告警；故只在「帶了任一進階
   * 設定且 400」時 warn 後**立即以同一 prompt、不帶任何進階設定（純 `{ model, contents }`）重送一次**（多 1 次
   * HTTP 呼叫、不佔退避次數）。2026-10-17 起由「只攔 thinking」擴大為整組進階設定一併拿掉：400 只說明請求被拒、
   * 分不出是哪一項，逐項試會多燒 Flash 免費層 RPD（憲章 I／V）；schema 拿掉後回應形狀退回由 prompt 約束、
   * 交呼叫端解析把關。其餘錯誤原樣拋給 `generate()` 的重試／分類邏輯（503 等重試時下一次仍帶進階設定）；
   * 不帶任何進階設定的呼叫 400 仍是不可重試錯誤、不在此攔。重送沿用同一個 `abortSignal`（同一次嘗試共用逾時）。
   */
  private async callModel(
    model: GeminiModel,
    prompt: string,
    thinking: LlmThinkingLevel | undefined,
    schema: Record<string, unknown> | undefined,
    signal: AbortSignal,
  ): Promise<GenerateContentResponse> {
    if (!thinking && !schema) {
      return this.client.models.generateContent({ model, contents: prompt, config: { abortSignal: signal } });
    }
    const config: GenerateContentConfig = { abortSignal: signal };
    if (thinking) {
      config.thinkingConfig = { thinkingLevel: THINKING_LEVEL_MAP[thinking] };
    }
    if (schema) {
      config.responseMimeType = 'application/json';
      config.responseJsonSchema = schema;
    }
    try {
      return await this.client.models.generateContent({ model, contents: prompt, config });
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        this.logger.warn(
          `LLM 拒絕 thinking／結構化輸出設定（${model}，thinking=${thinking ?? '無'}，schema=${schema ? '有' : '無'}，` +
            `${this.errDetail(err)}），改以不帶這些設定重送一次`,
        );
        return this.client.models.generateContent({ model, contents: prompt, config: { abortSignal: signal } });
      }
      throw err;
    }
  }

  /** 429/503 與網路層錯誤（無法辨識明確狀態碼者）可重試；其餘（400/401/403 等）不可重試。 */
  private isRetryable(err: unknown): boolean {
    if (err instanceof ApiError) {
      return RETRYABLE_STATUS.has(err.status);
    }
    return true;
  }

  /** 供 log 用的錯誤摘要：ApiError 帶狀態碼，其餘退回 message（不含 prompt/回應全文）。 */
  private errDetail(err: unknown): string {
    if (err instanceof ApiError) {
      return `status=${err.status} ${err.message}`;
    }
    return err instanceof Error ? err.message : String(err);
  }

  /** 指數退避＋jitter：base × 2^(attempt-1) + [0, base) 隨機，上限 LLM_MAX_BACKOFF_MS。 */
  private backoffMs(attempt: number): number {
    const exp = LLM_BACKOFF_BASE_MS * 2 ** (attempt - 1);
    const jitter = Math.floor(Math.random() * LLM_BACKOFF_BASE_MS);
    return Math.min(exp + jitter, LLM_MAX_BACKOFF_MS);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * 是否為單次呼叫逾時（2026-10-27）：本次嘗試的 `abortSignal` 已觸發（SDK 轉成 `AbortError` 擲出），或 undici 連線層的
 * headers／body 逾時（`fetch failed`，`cause.code` 為 `UND_ERR_*_TIMEOUT`）。
 */
export function isTimeout(err: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) {
    return true;
  }
  const cause = err instanceof Error ? (err.cause as { code?: unknown } | undefined) : undefined;
  return typeof cause?.code === 'string' && UNDICI_TIMEOUT_CODES.has(cause.code);
}

/**
 * 供 log 用的用量摘要：prompt 字元數、Gemini 回傳的 `usageMetadata`（輸入／輸出／思考／合計 tokens；
 * 缺席者印「?」）與第一個候選的 `finishReason`（正常為 STOP，輸出截斷為 MAX_TOKENS，安全過濾為 SAFETY；
 * 缺席印「?」）。純函式、不含任何 prompt／回應內容。
 */
export function describeUsage(response: GenerateContentResponse, promptChars: number): string {
  const u = response.usageMetadata;
  const n = (v: number | undefined): string => (typeof v === 'number' ? String(v) : '?');
  const finish = response.candidates?.[0]?.finishReason ?? '?';
  return (
    `prompt ${promptChars} 字元，tokens 輸入 ${n(u?.promptTokenCount)}／輸出 ${n(u?.candidatesTokenCount)}` +
    `／思考 ${n(u?.thoughtsTokenCount)}／合計 ${n(u?.totalTokenCount)}，finishReason=${finish}`
  );
}
