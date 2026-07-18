import { ConfigService } from '@nestjs/config';
import { ApiError, GoogleGenAI } from '@google/genai';
import { LlmService } from './llm.service';
import { LlmError, LLM_MAX_RETRIES } from './llm.types';

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
