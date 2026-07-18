import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiError, GoogleGenAI } from '@google/genai';
import {
  GEMINI_MODEL,
  LLM_BACKOFF_BASE_MS,
  LLM_MAX_BACKOFF_MS,
  LLM_MAX_RETRIES,
  LlmError,
} from './llm.types';

/** 觸發退避重試的暫時性 HTTP 狀態碼（速率/額度限制、暫時不可用，research D6）。 */
const RETRYABLE_STATUS = new Set([429, 503]);

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
   * 對 Gemini Flash 送一段 prompt 生成文字（trim 後非空）。
   * @throws LlmError 空 prompt／空回應（`'empty'`，不重試）、重試耗盡（`'exhausted'`）、
   *   不可重試的用戶端錯誤（`'error'`，如 400/401/403）。
   */
  async generate(prompt: string): Promise<string> {
    if (!prompt.trim()) {
      throw new LlmError('empty');
    }

    for (let attempt = 1; attempt <= LLM_MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.models.generateContent({
          model: GEMINI_MODEL,
          contents: prompt,
        });
        const text = (response.text ?? '').trim();
        if (!text) {
          // 空回應（多為 MAX_TOKENS 截斷或安全過濾）刻意不重試：重送同一 prompt 通常仍空，
          // 重試只會白白多燒一次 Gemini 免費層配額（憲章 I／V 節制 LLM）；交由呼叫端降級。
          throw new LlmError('empty');
        }
        return text;
      } catch (err) {
        if (err instanceof LlmError) {
          throw err;
        }
        if (!this.isRetryable(err)) {
          throw new LlmError('error');
        }
        if (attempt < LLM_MAX_RETRIES) {
          const wait = this.backoffMs(attempt);
          this.logger.warn(`LLM 呼叫失敗，第 ${attempt}/${LLM_MAX_RETRIES} 次退避 ${wait}ms 後重試`);
          await this.delay(wait);
        }
      }
    }
    throw new LlmError('exhausted');
  }

  /** 429/503 與網路層錯誤（無法辨識明確狀態碼者）可重試；其餘（400/401/403 等）不可重試。 */
  private isRetryable(err: unknown): boolean {
    if (err instanceof ApiError) {
      return RETRYABLE_STATUS.has(err.status);
    }
    return true;
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
