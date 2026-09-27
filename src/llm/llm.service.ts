import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiError, GenerateContentResponse, GoogleGenAI, ThinkingLevel } from '@google/genai';
import {
  GEMINI_MODEL_BOARD,
  GeminiModel,
  LLM_BACKOFF_BASE_MS,
  LLM_MAX_BACKOFF_MS,
  LLM_MAX_RETRIES,
  LlmError,
  LlmGenerateOptions,
  LlmThinkingLevel,
} from './llm.types';

/** 觸發退避重試的暫時性 HTTP 狀態碼（速率/額度限制、暫時不可用，research D6）。 */
const RETRYABLE_STATUS = new Set([429, 503]);

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
  }

  /**
   * 對 Gemini Flash 系送一段 prompt 生成文字（trim 後非空）。`options.model` 未給即用
   * `GEMINI_MODEL_BOARD`（Flash-Lite）；每日晨報策展傳 `GEMINI_MODEL_NEWS`（2026-09-12 起，見
   * `llm.types.ts`）。退避、錯誤分類與 log 對兩個型號一視同仁，log 會帶型號以利對帳配額。
   * @throws LlmError 空 prompt／空回應（`'empty'`，不重試）、重試耗盡（`'exhausted'`）、
   *   不可重試的用戶端錯誤（`'error'`，如 400/401/403）。
   */
  async generate(prompt: string, options: LlmGenerateOptions = {}): Promise<string> {
    if (!prompt.trim()) {
      throw new LlmError('empty');
    }
    const model = options.model ?? GEMINI_MODEL_BOARD;
    const thinking = options.thinkingLevel;
    const thinkingLabel = thinking ? `，thinking=${thinking}` : '';

    for (let attempt = 1; attempt <= LLM_MAX_RETRIES; attempt++) {
      try {
        const response = await this.callModel(model, prompt, thinking);
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
   * 單次 HTTP 呼叫：有 `thinking` 時帶 `config.thinkingConfig.thinkingLevel`（2026-09-27 新增，見 `llm.types.ts`
   * `NEWS_THINKING_LEVEL`），否則請求體與此前完全相同（簡介／TL;DR 不受影響）。
   *
   * 防禦：thinking 設定是否被型號接受無法在本機驗證（無 `GEMINI_API_KEY`），若型號以 400 拒絕該參數，
   * 不能讓整條策展因設定問題走 `error` → 備援型號同樣 400 → 原文標題版＋紅色告警；故只在「帶了 thinking
   * 且 400」時 warn 後**立即以同一 prompt 不帶 thinking 重送一次**（多 1 次 HTTP 呼叫、不佔退避次數），
   * 其餘錯誤原樣拋給 `generate()` 的重試／分類邏輯。不帶 thinking 的呼叫 400 仍是不可重試錯誤、不在此攔。
   */
  private async callModel(
    model: GeminiModel,
    prompt: string,
    thinking: LlmThinkingLevel | undefined,
  ): Promise<GenerateContentResponse> {
    if (!thinking) {
      return this.client.models.generateContent({ model, contents: prompt });
    }
    try {
      return await this.client.models.generateContent({
        model,
        contents: prompt,
        config: { thinkingConfig: { thinkingLevel: THINKING_LEVEL_MAP[thinking] } },
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        this.logger.warn(`LLM 拒絕 thinking 設定（${model}，thinking=${thinking}，${this.errDetail(err)}），改以不帶 thinking 重送一次`);
        return this.client.models.generateContent({ model, contents: prompt });
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
