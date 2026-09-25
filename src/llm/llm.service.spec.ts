import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiError, GoogleGenAI } from '@google/genai';
import { describeUsage, LlmService } from './llm.service';
import {
  GEMINI_MODEL_BOARD,
  GEMINI_MODEL_NEWS,
  GEMINI_MODEL_NEWS_FALLBACK,
  LlmError,
  LLM_MAX_RETRIES,
} from './llm.types';

jest.mock('@google/genai', () => {
  const actual = jest.requireActual('@google/genai');
  return { ...actual, GoogleGenAI: jest.fn() };
});

const MockedGoogleGenAI = GoogleGenAI as unknown as jest.Mock;

function makeService(generateContent: jest.Mock): LlmService {
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
    expect(generateContent).toHaveBeenCalledWith({ model: GEMINI_MODEL_BOARD, contents: '請生成' });
  });

  it('指定 model: GEMINI_MODEL_NEWS → 送策展主型號（每日晨報策展）', async () => {
    const generateContent = jest.fn().mockResolvedValue({ text: 'ok' });
    const svc = makeService(generateContent);
    await svc.generate('請策展', { model: GEMINI_MODEL_NEWS });
    expect(generateContent).toHaveBeenCalledWith({ model: GEMINI_MODEL_NEWS, contents: '請策展' });
  });

  it('三個型號常數皆為 Flash-Lite 系，且策展備援與主型號不同（2026-09-25 起）', () => {
    // 2026-09-25 起策展主備型號皆為 Lite（見 llm.types docstring）：主型號與榜單型號同一個，備援刻意
    // 換不同型號——免費配額按型號分開計算，同型號重試對 429／型號 404 都無解。
    for (const model of [GEMINI_MODEL_BOARD, GEMINI_MODEL_NEWS, GEMINI_MODEL_NEWS_FALLBACK]) {
      expect(model).toMatch(/flash-lite$/);
    }
    expect(GEMINI_MODEL_NEWS).toBe(GEMINI_MODEL_BOARD);
    expect(GEMINI_MODEL_NEWS_FALLBACK).not.toBe(GEMINI_MODEL_NEWS);
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
