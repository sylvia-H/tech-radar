import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiError, GoogleGenAI, ThinkingLevel } from '@google/genai';
import { describeUsage, isTimeout, LlmService } from './llm.service';
import { geminiBaseUrlOverridden, installGeminiDispatcher } from './gemini-dispatcher';
import {
  GEMINI_MODEL_BOARD,
  GEMINI_MODEL_NEWS,
  GEMINI_MODEL_NEWS_FALLBACK,
  LlmError,
  LLM_MAX_RETRIES,
  LLM_MIN_ATTEMPT_MS,
  LLM_TIMEOUT_MS,
  NEWS_LLM_TIMEOUT_MS,
  NEWS_MIN_ATTEMPT_MS,
  NEWS_THINKING_LEVEL,
} from './llm.types';

jest.mock('@google/genai', () => {
  const actual = jest.requireActual('@google/genai');
  return { ...actual, GoogleGenAI: jest.fn() };
});

jest.mock('./gemini-dispatcher', () => ({ installGeminiDispatcher: jest.fn(), geminiBaseUrlOverridden: jest.fn() }));

const MockedGoogleGenAI = GoogleGenAI as unknown as jest.Mock;
const mockedInstall = installGeminiDispatcher as unknown as jest.Mock;
const mockedBaseUrlOverridden = geminiBaseUrlOverridden as unknown as jest.Mock;
/** 每次呼叫一律帶的 client 端逾時 signal（2026-10-27，不進請求體）。 */
const SIGNAL = expect.any(AbortSignal);

function makeService(generateContent: jest.Mock): LlmService {
  mockedInstall.mockReturnValue(true);
  mockedBaseUrlOverridden.mockReturnValue(false);
  MockedGoogleGenAI.mockImplementation(() => ({
    models: { generateContent },
  }));
  const config = {
    get: (k: string) => (k === 'GEMINI_API_KEY' ? 'test-key' : undefined),
  } as unknown as ConfigService;
  const svc = new LlmService(config);
  jest.spyOn(svc as unknown as { delay: (ms: number) => Promise<void> }, 'delay').mockResolvedValue(undefined);
  return svc;
}

afterEach(() => {
  jest.restoreAllMocks();
  MockedGoogleGenAI.mockReset();
  mockedInstall.mockReset();
  mockedBaseUrlOverridden.mockReset();
});

describe('LlmService', () => {
  it('空 prompt 立即擲 LlmError(empty)，不呼叫 API', async () => {
    const generateContent = jest.fn();
    const svc = makeService(generateContent);
    await expect(svc.generate('   ')).rejects.toMatchObject({ reason: 'empty' });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('正常回應：trim 後回傳文字', async () => {
    const generateContent = jest.fn().mockResolvedValue({ text: '  一段簡介  ' });
    const svc = makeService(generateContent);
    await expect(svc.generate('請生成')).resolves.toBe('一段簡介');
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('回應 text 空白 → 擲 LlmError(empty)，不重試', async () => {
    const generateContent = jest.fn().mockResolvedValue({ text: '   ' });
    const svc = makeService(generateContent);
    await expect(svc.generate('請生成')).rejects.toMatchObject({ reason: 'empty' });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('首次 429 隨後成功：有退避、最終回正常文字（SC-007）', async () => {
    const generateContent = jest
      .fn()
      .mockRejectedValueOnce(new ApiError({ message: 'rate limited', status: 429 }))
      .mockResolvedValueOnce({ text: '正常簡介' });
    const svc = makeService(generateContent);
    const result = await svc.generate('請生成');
    expect(result).toBe('正常簡介');
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect((svc as unknown as { delay: jest.Mock }).delay).toHaveBeenCalledTimes(1);
  });

  it('持續 429 至耗盡 → 擲 LlmError(exhausted)，重試次數 = LLM_MAX_RETRIES', async () => {
    const generateContent = jest
      .fn()
      .mockRejectedValue(new ApiError({ message: 'rate limited', status: 429 }));
    const svc = makeService(generateContent);
    await expect(svc.generate('請生成')).rejects.toMatchObject({ reason: 'exhausted' });
    expect(generateContent).toHaveBeenCalledTimes(LLM_MAX_RETRIES);
  });

  it('503 同樣退避重試', async () => {
    const generateContent = jest
      .fn()
      .mockRejectedValueOnce(new ApiError({ message: 'unavailable', status: 503 }))
      .mockResolvedValueOnce({ text: '正常簡介' });
    const svc = makeService(generateContent);
    await expect(svc.generate('請生成')).resolves.toBe('正常簡介');
  });

  it('網路層錯誤（無 status）視為可重試', async () => {
    const generateContent = jest
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ text: '正常簡介' });
    const svc = makeService(generateContent);
    await expect(svc.generate('請生成')).resolves.toBe('正常簡介');
  });

  it('400/403 用戶端錯誤不重試，直接擲 LlmError(error)', async () => {
    const generateContent = jest
      .fn()
      .mockRejectedValue(new ApiError({ message: 'forbidden', status: 403 }));
    const svc = makeService(generateContent);
    await expect(svc.generate('請生成')).rejects.toMatchObject({ reason: 'error' });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('LlmError 全為 name=LlmError，供呼叫端 catch 分流', async () => {
    const generateContent = jest.fn().mockResolvedValue({ text: '' });
    const svc = makeService(generateContent);
    try {
      await svc.generate('請生成');
      fail('應擲錯');
    } catch (err) {
      expect(err).toBeInstanceOf(LlmError);
      expect((err as LlmError).name).toBe('LlmError');
    }
  });
});

describe('LlmService 型號選擇（2026-09-12 依資料流分流）', () => {
  it('未指定 model → 用 GEMINI_MODEL_BOARD（Flash-Lite，簡介／榜單 TL;DR 預設）', async () => {
    const generateContent = jest.fn().mockResolvedValue({ text: 'ok' });
    const svc = makeService(generateContent);
    await svc.generate('請生成');
    expect(generateContent).toHaveBeenCalledWith({ model: GEMINI_MODEL_BOARD, contents: '請生成', config: { abortSignal: SIGNAL } });
  });

  it('指定 model: GEMINI_MODEL_NEWS → 送策展主型號（每日晨報策展）', async () => {
    const generateContent = jest.fn().mockResolvedValue({ text: 'ok' });
    const svc = makeService(generateContent);
    await svc.generate('請策展', { model: GEMINI_MODEL_NEWS });
    expect(generateContent).toHaveBeenCalledWith({ model: GEMINI_MODEL_NEWS, contents: '請策展', config: { abortSignal: SIGNAL } });
  });

  it('策展主型號為 Flash 系、備援為 Flash-Lite 系且與榜單同型號（2026-09-27 起）', () => {
    // 2026-09-27 起策展回到 Flash 主／Lite 備援（見 llm.types docstring）：Lite 主型號四天則數 5／7／7／6 且
    // 漏選明顯的官方發布，退場條件成立。備援刻意換不同型號——免費配額按型號分開計算，同型號重試對
    // 429／型號 404 都無解。
    expect(GEMINI_MODEL_NEWS).toMatch(/-flash$/);
    expect(GEMINI_MODEL_BOARD).toMatch(/flash-lite$/);
    expect(GEMINI_MODEL_NEWS_FALLBACK).toBe(GEMINI_MODEL_BOARD);
    expect(GEMINI_MODEL_NEWS_FALLBACK).not.toBe(GEMINI_MODEL_NEWS);
    expect(NEWS_THINKING_LEVEL).toBe('high');
  });
});

describe('LlmService thinking 設定（2026-09-27 新增）', () => {
  it('未指定 thinkingLevel → config 只帶 client 端的 abortSignal、不帶 thinkingConfig（簡介／TL;DR 行為不變）', async () => {
    const generateContent = jest.fn().mockResolvedValue({ text: 'ok' });
    const svc = makeService(generateContent);
    await svc.generate('請生成', { model: GEMINI_MODEL_BOARD });
    expect(generateContent).toHaveBeenCalledWith({ model: GEMINI_MODEL_BOARD, contents: '請生成', config: { abortSignal: SIGNAL } });
  });

  it('指定 thinkingLevel: high → 帶 config.thinkingConfig.thinkingLevel=HIGH，且用量 log 標 thinking=high', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const generateContent = jest.fn().mockResolvedValue({
      text: 'ok',
      usageMetadata: { promptTokenCount: 7420, candidatesTokenCount: 969, thoughtsTokenCount: 3000, totalTokenCount: 11389 },
      candidates: [{ finishReason: 'STOP' }],
    });
    const svc = makeService(generateContent);
    await svc.generate('請策展', { model: GEMINI_MODEL_NEWS, thinkingLevel: NEWS_THINKING_LEVEL });
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(generateContent).toHaveBeenCalledWith({
      model: GEMINI_MODEL_NEWS,
      contents: '請策展',
      config: { abortSignal: SIGNAL, thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH } },
    });
    const line = logSpy.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith('LLM 用量')) ?? '';
    expect(line).toContain('thinking=high');
    expect(line).toContain('思考 3000');
    logSpy.mockRestore();
  });

  it('帶 thinking 被型號以 400 拒絕 → warn 後立即以同一 prompt 不帶 thinking 重送一次並成功，不擲 LlmError', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const generateContent = jest
      .fn()
      .mockRejectedValueOnce(new ApiError({ status: 400, message: 'thinking_level is not supported' }))
      .mockResolvedValueOnce({ text: '不帶 thinking 的結果' });
    const svc = makeService(generateContent);

    await expect(svc.generate('請策展', { model: GEMINI_MODEL_NEWS, thinkingLevel: 'high' })).resolves.toBe('不帶 thinking 的結果');

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls[0][0]).toHaveProperty('config');
    expect(generateContent.mock.calls[1][0]).toEqual({ model: GEMINI_MODEL_NEWS, contents: '請策展', config: { abortSignal: SIGNAL } });
    // 重送沿用同一次嘗試的 signal（共用逾時）
    expect(generateContent.mock.calls[1][0].config.abortSignal).toBe(generateContent.mock.calls[0][0].config.abortSignal);
    const warn = warnSpy.mock.calls.map((c) => String(c[0])).find((l) => l.includes('拒絕 thinking')) ?? '';
    expect(warn).toContain(GEMINI_MODEL_NEWS);
    expect(warn).toContain('status=400');
    expect(warn).not.toContain('請策展');
    warnSpy.mockRestore();
  });

  it('帶 thinking 遇 503 → 走一般退避重試（下一次仍帶 thinking），不觸發「不帶 thinking 重送」', async () => {
    const generateContent = jest
      .fn()
      .mockRejectedValueOnce(new ApiError({ status: 503, message: 'high demand' }))
      .mockResolvedValueOnce({ text: 'ok' });
    const svc = makeService(generateContent);
    await svc.generate('請策展', { model: GEMINI_MODEL_NEWS, thinkingLevel: 'high' });
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls[1][0]).toHaveProperty('config');
  });

  it('不帶 thinking 的 400 仍為不可重試錯誤（LlmError(error)），只呼叫 1 次', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const generateContent = jest.fn().mockRejectedValue(new ApiError({ status: 400, message: 'bad request' }));
    const svc = makeService(generateContent);
    await expect(svc.generate('x', { model: GEMINI_MODEL_NEWS })).rejects.toMatchObject({ reason: 'error' });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});

describe('LlmService 結構化輸出 responseJsonSchema（2026-10-17 新增，ADR 0006）', () => {
  const SCHEMA: Record<string, unknown> = {
    type: 'object',
    properties: { picks: { type: 'array', items: { type: 'object' } } },
    required: ['picks'],
  };

  it('帶 responseJsonSchema → config 帶 responseMimeType=application/json 與同一個 schema 物件', async () => {
    const generateContent = jest.fn().mockResolvedValue({ text: '{"picks":[]}' });
    const svc = makeService(generateContent);
    await svc.generate('請策展', { model: GEMINI_MODEL_NEWS, responseJsonSchema: SCHEMA });
    expect(generateContent).toHaveBeenCalledTimes(1);
    const req = generateContent.mock.calls[0][0];
    expect(req).toEqual({
      model: GEMINI_MODEL_NEWS,
      contents: '請策展',
      config: { abortSignal: SIGNAL, responseMimeType: 'application/json', responseJsonSchema: SCHEMA },
    });
    expect(req.config.responseJsonSchema).toBe(SCHEMA);
    expect(req.config).not.toHaveProperty('thinkingConfig');
  });

  it('同時帶 thinking 與 schema → 同一個 config 兩者並存', async () => {
    const generateContent = jest.fn().mockResolvedValue({ text: '{"picks":[]}' });
    const svc = makeService(generateContent);
    await svc.generate('請策展', { model: GEMINI_MODEL_NEWS, thinkingLevel: NEWS_THINKING_LEVEL, responseJsonSchema: SCHEMA });
    expect(generateContent).toHaveBeenCalledWith({
      model: GEMINI_MODEL_NEWS,
      contents: '請策展',
      config: {
        abortSignal: SIGNAL,
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        responseMimeType: 'application/json',
        responseJsonSchema: SCHEMA,
      },
    });
    expect(generateContent.mock.calls[0][0].config.responseJsonSchema).toBe(SCHEMA);
  });

  it('不帶 schema 也不帶 thinking → config 只有 abortSignal', async () => {
    const generateContent = jest.fn().mockResolvedValue({ text: 'ok' });
    const svc = makeService(generateContent);
    await svc.generate('請生成');
    expect(generateContent.mock.calls[0][0]).toEqual({ model: GEMINI_MODEL_BOARD, contents: '請生成', config: { abortSignal: SIGNAL } });
  });

  it('帶 schema（不帶 thinking）遇 400 → warn 一次後以純 { model, contents } 重送並成功，不擲 LlmError', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const generateContent = jest
      .fn()
      .mockRejectedValueOnce(new ApiError({ status: 400, message: 'responseJsonSchema is not supported' }))
      .mockResolvedValueOnce({ text: '{"picks":[]}' });
    const svc = makeService(generateContent);

    await expect(svc.generate('請策展', { model: GEMINI_MODEL_NEWS, responseJsonSchema: SCHEMA })).resolves.toBe('{"picks":[]}');

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls[0][0].config).toMatchObject({ responseMimeType: 'application/json' });
    expect(generateContent.mock.calls[1][0]).toEqual({ model: GEMINI_MODEL_NEWS, contents: '請策展', config: { abortSignal: SIGNAL } });
    const warns = warnSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('拒絕 thinking'));
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain(GEMINI_MODEL_NEWS);
    expect(warns[0]).toContain('thinking=無');
    expect(warns[0]).toContain('schema=有');
    expect(warns[0]).toContain('status=400');
    expect(warns[0]).not.toContain('請策展');
    warnSpy.mockRestore();
  });

  it('帶 thinking＋schema 遇 400 → 重送時兩項一併拿掉', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const generateContent = jest
      .fn()
      .mockRejectedValueOnce(new ApiError({ status: 400, message: 'bad config' }))
      .mockResolvedValueOnce({ text: 'ok' });
    const svc = makeService(generateContent);
    await svc.generate('請策展', { model: GEMINI_MODEL_NEWS, thinkingLevel: 'high', responseJsonSchema: SCHEMA });
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls[1][0]).toEqual({ model: GEMINI_MODEL_NEWS, contents: '請策展', config: { abortSignal: SIGNAL } });
  });

  it('帶 schema 遇 503 → 走一般退避重試，下一次仍帶 schema', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const generateContent = jest
      .fn()
      .mockRejectedValueOnce(new ApiError({ status: 503, message: 'high demand' }))
      .mockResolvedValueOnce({ text: '{"picks":[]}' });
    const svc = makeService(generateContent);
    await svc.generate('請策展', { model: GEMINI_MODEL_NEWS, responseJsonSchema: SCHEMA });
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect((svc as unknown as { delay: jest.Mock }).delay).toHaveBeenCalledTimes(1);
    expect(generateContent.mock.calls[1][0].config).toEqual({ abortSignal: SIGNAL, responseMimeType: 'application/json', responseJsonSchema: SCHEMA });
  });

  it('用量 log 與空回應 warn 皆標 schema=json（接在 thinking 標籤之後）', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const generateContent = jest
      .fn()
      .mockResolvedValueOnce({ text: '{"picks":[]}' })
      .mockResolvedValueOnce({ text: '' });
    const svc = makeService(generateContent);

    await svc.generate('請策展', { model: GEMINI_MODEL_NEWS, thinkingLevel: 'high', responseJsonSchema: SCHEMA });
    const line = logSpy.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith('LLM 用量')) ?? '';
    expect(line).toContain(`${GEMINI_MODEL_NEWS}，thinking=high，schema=json，`);

    await expect(svc.generate('請策展', { model: GEMINI_MODEL_NEWS, responseJsonSchema: SCHEMA })).rejects.toMatchObject({
      reason: 'empty',
    });
    const warn = warnSpy.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith('LLM 回應為空')) ?? '';
    expect(warn).toContain(`${GEMINI_MODEL_NEWS}，schema=json，`);
  });

  it('不帶 schema 時用量 log 不出現 schema=json', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const generateContent = jest.fn().mockResolvedValue({ text: 'ok' });
    const svc = makeService(generateContent);
    await svc.generate('請生成');
    const line = logSpy.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith('LLM 用量')) ?? '';
    expect(line).not.toContain('schema=');
  });
});

describe('LlmService.generate — 重試路徑 warn 帶狀態碼與訊息（2026-09-20 補）', () => {
  it('429 退避重試與耗盡時，warn 皆含 status 與訊息，不含 prompt', async () => {
    const { Logger } = await import('@nestjs/common');
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const generateContent = jest
      .fn()
      .mockRejectedValue(new ApiError({ message: 'Service Unavailable', status: 503 }));
    const svc = makeService(generateContent);

    await expect(svc.generate('這是不該出現在 log 的 prompt')).rejects.toMatchObject({ reason: 'exhausted' });

    const msgs = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(msgs).toHaveLength(LLM_MAX_RETRIES);
    expect(msgs[0]).toContain('status=503 Service Unavailable');
    expect(msgs[0]).toContain(`第 1/${LLM_MAX_RETRIES} 次退避`);
    expect(msgs[LLM_MAX_RETRIES - 1]).toContain('重試耗盡');
    expect(msgs[LLM_MAX_RETRIES - 1]).toContain('status=503');
    expect(msgs.join('\n')).not.toContain('不該出現在 log');
    warnSpy.mockRestore();
  });

  it('網路層錯誤（無 status）warn 含 message', async () => {
    const { Logger } = await import('@nestjs/common');
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const generateContent = jest
      .fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce({ text: '正常' });
    const svc = makeService(generateContent);

    await svc.generate('請生成');

    expect(String(warnSpy.mock.calls[0][0])).toContain('fetch failed');
    warnSpy.mockRestore();
  });
});

describe('LlmService 用量與 finishReason log（2026-09-25）', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('成功回應：log 一行含型號、prompt 字元數、輸入／輸出／思考／合計 tokens 與 finishReason，不含 prompt 內容', async () => {
    const generateContent = jest.fn().mockResolvedValue({
      text: '結果',
      usageMetadata: { promptTokenCount: 14018, candidatesTokenCount: 9405, thoughtsTokenCount: 1200, totalTokenCount: 24623 },
      candidates: [{ finishReason: 'STOP' }],
    });
    const svc = makeService(generateContent);
    await svc.generate('機密般的 prompt 內容', { model: GEMINI_MODEL_NEWS });

    const line = logSpy.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith('LLM 用量')) ?? '';
    expect(line).toContain(GEMINI_MODEL_NEWS);
    expect(line).toContain('prompt 14 字元');
    expect(line).toContain('tokens 輸入 14018／輸出 9405／思考 1200／合計 24623');
    expect(line).toContain('finishReason=STOP');
    expect(line).toContain('回應 2 字元');
    expect(line).not.toContain('機密般的');
  });

  it('空回應：warn 帶 finishReason（如 MAX_TOKENS）與用量後才擲 LlmError(empty)', async () => {
    const generateContent = jest.fn().mockResolvedValue({
      text: '',
      usageMetadata: { promptTokenCount: 14018, candidatesTokenCount: 65536, totalTokenCount: 79554 },
      candidates: [{ finishReason: 'MAX_TOKENS' }],
    });
    const svc = makeService(generateContent);
    await expect(svc.generate('p')).rejects.toMatchObject({ reason: 'empty' });

    const warn = warnSpy.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith('LLM 回應為空')) ?? '';
    expect(warn).toContain('finishReason=MAX_TOKENS');
    expect(warn).toContain('輸出 65536');
    expect(warn).toContain('思考 ?');
  });

  it('usageMetadata 與 candidates 缺席時印「?」、不擲錯', async () => {
    const generateContent = jest.fn().mockResolvedValue({ text: 'ok' });
    const svc = makeService(generateContent);
    await expect(svc.generate('p')).resolves.toBe('ok');

    const line = logSpy.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith('LLM 用量')) ?? '';
    expect(line).toContain('tokens 輸入 ?／輸出 ?／思考 ?／合計 ?，finishReason=?');
  });

  it('describeUsage 為純函式：只輸出數字與型別安全的欄位', () => {
    expect(describeUsage({ usageMetadata: { promptTokenCount: 1 }, candidates: [{ finishReason: 'SAFETY' }] } as never, 5)).toBe(
      'prompt 5 字元，tokens 輸入 1／輸出 ?／思考 ?／合計 ?，finishReason=SAFETY',
    );
  });
});

describe('LlmService 逾時（2026-10-27，ADR 0009）', () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  /** 模擬 SDK：等到本次嘗試的 abortSignal 觸發後以 AbortError 拒絕。 */
  function hangUntilAborted(req: { config: { abortSignal: AbortSignal } }): Promise<never> {
    return new Promise((_, reject) => {
      req.config.abortSignal.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')));
    });
  }

  it('常數：預設 300 秒（同 undici 預設）、策展 10 分鐘；最小重送期限皆小於對應總期限（否則每次呼叫在入口擲 error）', () => {
    expect(LLM_TIMEOUT_MS).toBe(300_000);
    expect(NEWS_LLM_TIMEOUT_MS).toBe(600_000);
    expect(LLM_MIN_ATTEMPT_MS).toBeLessThan(LLM_TIMEOUT_MS);
    expect(NEWS_MIN_ATTEMPT_MS).toBeLessThan(NEWS_LLM_TIMEOUT_MS);
  });

  it('不重試的 warn 同樣帶 thinking／schema 標示', async () => {
    const generateContent = jest.fn().mockRejectedValue(new ApiError({ message: 'not found', status: 404 }));
    const svc = makeService(generateContent);
    await expect(svc.generate('請策展', { model: GEMINI_MODEL_NEWS, thinkingLevel: 'high' })).rejects.toMatchObject({
      reason: 'error',
    });
    const warn = warnSpy.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith('LLM 呼叫失敗（不重試')) ?? '';
    expect(warn).toContain(`（不重試，${GEMINI_MODEL_NEWS}，thinking=high）：status=404`);
  });

  it('未指定 timeoutMs → 首次嘗試的 signal 約為 LLM_TIMEOUT_MS；指定時約為指定值', async () => {
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
    const generateContent = jest.fn().mockResolvedValue({ text: 'ok' });
    const svc = makeService(generateContent);
    await svc.generate('請生成');
    await svc.generate('請策展', { model: GEMINI_MODEL_NEWS, timeoutMs: NEWS_LLM_TIMEOUT_MS });
    const [first, second] = timeoutSpy.mock.calls.map((c) => c[0]);
    expect(first).toBeLessThanOrEqual(LLM_TIMEOUT_MS);
    expect(first).toBeGreaterThan(LLM_TIMEOUT_MS - 1_000);
    expect(second).toBeLessThanOrEqual(NEWS_LLM_TIMEOUT_MS);
    expect(second).toBeGreaterThan(NEWS_LLM_TIMEOUT_MS - 1_000);
  });

  it('timeoutMs 是整次 generate()（含重試）的總期限：重試時 signal 只給剩餘時間', async () => {
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
    const generateContent = jest
      .fn()
      .mockImplementationOnce(async () => {
        now += 100_000; // 第一次嘗試耗掉 100 秒才回 503
        throw new ApiError({ message: 'unavailable', status: 503 });
      })
      .mockResolvedValueOnce({ text: 'ok' });
    const svc = makeService(generateContent);
    await expect(svc.generate('請策展', { timeoutMs: NEWS_LLM_TIMEOUT_MS })).resolves.toBe('ok');
    expect(timeoutSpy.mock.calls.map((c) => c[0])).toEqual([NEWS_LLM_TIMEOUT_MS, NEWS_LLM_TIMEOUT_MS - 100_000]);
  });

  it.each([
    ['退避後已超過期限（剩 5 秒）', 5_000],
    ['退避後剩餘不足 LLM_MIN_ATTEMPT_MS（剩約 35 秒、退避 10～20 秒）', 35_000],
  ])('%s → 不送第二次請求、擲 LlmError(timeout, budget)，warn 說明', async (_label, left) => {
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const generateContent = jest.fn().mockImplementation(async () => {
      now += LLM_TIMEOUT_MS - left;
      throw new ApiError({ message: 'unavailable', status: 503 });
    });
    const svc = makeService(generateContent);
    await expect(svc.generate('請生成')).rejects.toMatchObject({ reason: 'timeout', timeoutKind: 'budget' });
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect((svc as unknown as { delay: jest.Mock }).delay).not.toHaveBeenCalled();
    const warn = warnSpy.mock.calls.map((c) => String(c[0])).find((l) => l.includes('剩餘期限不足')) ?? '';
    expect(warn).toContain('status=503');
    expect(warn).toContain(`${LLM_MIN_ATTEMPT_MS / 1000} 秒`);
    expect(warn).toContain('不再重試');
  });

  it('minAttemptMs 可逐呼叫指定（策展 2 分鐘）：剩約 100 秒、退避 10～20 秒後不足 2 分鐘 → 不重送', async () => {
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const generateContent = jest.fn().mockImplementation(async () => {
      now += NEWS_LLM_TIMEOUT_MS - 100_000;
      throw new ApiError({ message: 'unavailable', status: 503 });
    });
    const svc = makeService(generateContent);
    await expect(
      svc.generate('請策展', { model: GEMINI_MODEL_NEWS, timeoutMs: NEWS_LLM_TIMEOUT_MS, minAttemptMs: NEWS_MIN_ATTEMPT_MS }),
    ).rejects.toMatchObject({ reason: 'timeout', timeoutKind: 'budget' });
    expect(generateContent).toHaveBeenCalledTimes(1);
    const warn = warnSpy.mock.calls.map((c) => String(c[0])).find((l) => l.includes('剩餘期限不足')) ?? '';
    expect(warn).toContain(`${NEWS_MIN_ATTEMPT_MS / 1000} 秒`);
  });

  it('LlmError：timeout 未給 kind 預設 hung，label／message 帶 kind；其他 reason 無 kind', () => {
    expect(new LlmError('timeout')).toMatchObject({ timeoutKind: 'hung', label: 'timeout/hung', message: 'LLM 呼叫失敗：timeout/hung' });
    expect(new LlmError('timeout', 'budget')).toMatchObject({ label: 'timeout/budget', message: 'LLM 呼叫失敗：timeout/budget' });
    expect(new LlmError('exhausted', 'budget')).toMatchObject({
      timeoutKind: undefined,
      label: 'exhausted',
      message: 'LLM 呼叫失敗：exhausted',
    });
  });

  it('退避重試與耗盡的 warn 同樣帶 thinking／schema 標示（與剩餘不足那條格式一致）', async () => {
    const generateContent = jest.fn().mockRejectedValue(new ApiError({ message: 'unavailable', status: 503 }));
    const svc = makeService(generateContent);
    await expect(svc.generate('請策展', { model: GEMINI_MODEL_NEWS, thinkingLevel: 'high' })).rejects.toMatchObject({
      reason: 'exhausted',
    });
    const msgs = warnSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('LLM 呼叫失敗'));
    expect(msgs).toHaveLength(LLM_MAX_RETRIES);
    for (const m of msgs) {
      expect(m).toContain(`（${GEMINI_MODEL_NEWS}，thinking=high，status=503`);
    }
  });

  it('退避後剩餘仍足夠（剩約 2 分鐘）→ 照常重試', async () => {
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const generateContent = jest
      .fn()
      .mockImplementationOnce(async () => {
        now += LLM_TIMEOUT_MS - 120_000;
        throw new ApiError({ message: 'unavailable', status: 503 });
      })
      .mockResolvedValueOnce({ text: 'ok' });
    const svc = makeService(generateContent);
    await expect(svc.generate('請生成')).resolves.toBe('ok');
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it('400 去設定重送前剩餘期限不足 → 不重送、擲 LlmError(timeout, budget)', async () => {
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const generateContent = jest.fn().mockImplementationOnce(async () => {
      now += NEWS_LLM_TIMEOUT_MS - 10_000;
      throw new ApiError({ status: 400, message: 'thinking_level is not supported' });
    });
    const svc = makeService(generateContent);
    await expect(
      svc.generate('請策展', { model: GEMINI_MODEL_NEWS, thinkingLevel: 'high', timeoutMs: NEWS_LLM_TIMEOUT_MS }),
    ).rejects.toMatchObject({ reason: 'timeout', timeoutKind: 'budget' });
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls.map((c) => String(c[0])).some((l) => l.includes('不重送'))).toBe(true);
  });

  it('timeoutMs 非正整數、minAttemptMs 非非負整數或不小於 timeoutMs → 擲 LlmError(error)、不送出請求', async () => {
    const badOptions = [
      ...[0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY].map((timeoutMs) => ({ timeoutMs })),
      ...[-1, 1.5, Number.NaN].map((minAttemptMs) => ({ minAttemptMs })),
      { timeoutMs: 60_000, minAttemptMs: 60_000 },
      { timeoutMs: 60_000, minAttemptMs: 120_000 },
    ];
    for (const bad of badOptions) {
      const generateContent = jest.fn();
      const svc = makeService(generateContent);
      await expect(svc.generate('請生成', bad)).rejects.toMatchObject({ reason: 'error' });
      expect(generateContent).not.toHaveBeenCalled();
    }
  });

  it('signal 逾時（SDK 擲 AbortError）→ 擲 LlmError(timeout)、不重試、warn 帶型號與秒數不含 prompt', async () => {
    const generateContent = jest.fn().mockImplementation(hangUntilAborted);
    const svc = makeService(generateContent);
    await expect(svc.generate('不該出現在 log 的 prompt', { model: GEMINI_MODEL_NEWS, timeoutMs: 20, minAttemptMs: 0 })).rejects.toMatchObject({
      reason: 'timeout',
      timeoutKind: 'hung',
    });
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect((svc as unknown as { delay: jest.Mock }).delay).not.toHaveBeenCalled();
    const warn = warnSpy.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith('LLM 呼叫逾時')) ?? '';
    expect(warn).toContain(GEMINI_MODEL_NEWS);
    expect(warn).toContain('期限 0.02 秒用盡');
    expect(warn).toContain('不在同一型號重試');
    expect(warn).not.toContain('不該出現在 log');
  });

  it('undici 連線層 headers／body 逾時（fetch failed，cause.code=UND_ERR_*_TIMEOUT）→ LlmError(timeout)、不重試', async () => {
    for (const code of ['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']) {
      const generateContent = jest.fn().mockRejectedValue(new TypeError('fetch failed', { cause: { code } }));
      const svc = makeService(generateContent);
      await expect(svc.generate('請策展', { model: GEMINI_MODEL_NEWS })).rejects.toMatchObject({
        reason: 'timeout',
        timeoutKind: 'hung',
      });
      expect(generateContent).toHaveBeenCalledTimes(1);
      // 連線層先砍斷時印 cause.code，不誤寫成「期限用盡」
      const warn = warnSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('LLM 呼叫逾時')).pop() ?? '';
      expect(warn).toContain(`連線層逾時 ${code}`);
      expect(warn).not.toContain('期限');
    }
  });

  it('非逾時的網路層錯誤：warn 附 cause.code', async () => {
    const generateContent = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }))
      .mockResolvedValueOnce({ text: 'ok' });
    const svc = makeService(generateContent);
    await svc.generate('請生成');
    expect(String(warnSpy.mock.calls[0][0])).toContain('fetch failed（ECONNRESET）');
  });

  it('其他網路層錯誤（fetch failed 但非逾時碼）仍走退避重試', async () => {
    const generateContent = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }))
      .mockResolvedValueOnce({ text: 'ok' });
    const svc = makeService(generateContent);
    await expect(svc.generate('請策展')).resolves.toBe('ok');
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it('isTimeout：signal 已觸發即逾時；未觸發時只認 undici 逾時碼', () => {
    const aborted = AbortSignal.abort();
    const live = new AbortController().signal;
    expect(isTimeout(new Error('x'), aborted)).toBe(true);
    expect(isTimeout(new TypeError('fetch failed', { cause: { code: 'UND_ERR_HEADERS_TIMEOUT' } }), live)).toBe(true);
    expect(isTimeout(new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }), live)).toBe(false);
    expect(isTimeout(new ApiError({ message: 'x', status: 503 }), live)).toBe(false);
    expect(isTimeout('not an error', live)).toBe(false);
  });
});

describe('LlmService 建構時安裝 Gemini dispatcher（2026-10-27，ADR 0009）', () => {
  it('建構即呼叫 installGeminiDispatcher；生效時不 warn', () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    makeService(jest.fn());
    expect(mockedInstall).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('baseUrl 被覆寫或走 Vertex（geminiBaseUrlOverridden）→ warn 說明上限不生效', () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    MockedGoogleGenAI.mockImplementation(() => ({ models: { generateContent: jest.fn() } }));
    mockedInstall.mockReturnValue(true);
    mockedBaseUrlOverridden.mockReturnValue(true);
    new LlmService({ get: () => 'test-key' } as unknown as ConfigService);
    expect(String(warnSpy.mock.calls[0][0])).toContain('baseUrl');
    expect(String(warnSpy.mock.calls[0][0])).toContain('300 秒');
  });

  it('偵測到環境代理（install 回 false）→ warn 說明逾時上限維持 300 秒', () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    MockedGoogleGenAI.mockImplementation(() => ({ models: { generateContent: jest.fn() } }));
    mockedInstall.mockReturnValue(false);
    new LlmService({ get: () => 'test-key' } as unknown as ConfigService);
    expect(String(warnSpy.mock.calls[0][0])).toContain('NODE_USE_ENV_PROXY');
    expect(String(warnSpy.mock.calls[0][0])).toContain('300 秒');
  });
});
