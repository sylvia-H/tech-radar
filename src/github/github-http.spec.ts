import { ConfigService } from '@nestjs/config';
import { GithubHttpService, mapWithConcurrency, USER_AGENT } from './github-http';

const TOKEN = 'test-token-abc';

function makeService(): GithubHttpService {
  const config = { get: (k: string) => (k === 'GH_API_TOKEN' ? TOKEN : undefined) } as unknown as ConfigService;
  const svc = new GithubHttpService(config);
  // 消除真實等待，並可斷言退避是否觸發。
  jest.spyOn(svc as unknown as { delay: (ms: number) => Promise<void> }, 'delay').mockResolvedValue(undefined);
  return svc;
}

function jsonRes(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: init.headers,
  });
}

function delaySpy(svc: GithubHttpService): jest.SpyInstance {
  return (svc as unknown as { delay: jest.SpyInstance }).delay as unknown as jest.SpyInstance;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('GithubHttpService', () => {
  describe('呼叫計數', () => {
    it('core 與 search 分開累計，resetCounts 歸零', async () => {
      const svc = makeService();
      const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async () => jsonRes({ ok: true }));
      await svc.getJson('https://api.github.com/repos/o/r', 'core');
      await svc.getJson('https://api.github.com/repos/o/r2', 'core');
      await svc.getJson('https://api.github.com/search/repositories?q=x', 'search');
      expect(svc.counts).toEqual({ core: 2, search: 1 });
      svc.resetCounts();
      expect(svc.counts).toEqual({ core: 0, search: 0 });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('重試不重複計數（一次邏輯呼叫記一次）', async () => {
      const svc = makeService();
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(new Response('', { status: 500 }))
        .mockResolvedValueOnce(jsonRes({ ok: true }));
      await svc.getJson('https://api.github.com/repos/o/r', 'core');
      expect(svc.counts.core).toBe(1);
    });
  });

  describe('退避重試', () => {
    it('5xx 先退避再重試，最終成功', async () => {
      const svc = makeService();
      const fetchMock = jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(new Response('', { status: 503 }))
        .mockResolvedValueOnce(new Response('', { status: 502 }))
        .mockResolvedValueOnce(jsonRes({ ok: true }));
      const out = await svc.getJson<{ ok: boolean }>('https://api.github.com/repos/o/r', 'core');
      expect(out.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(delaySpy(svc)).toHaveBeenCalledTimes(2);
    });

    it('429 依 Retry-After 退避', async () => {
      const svc = makeService();
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '2' } }))
        .mockResolvedValueOnce(jsonRes({ ok: true }));
      await svc.getJson('https://api.github.com/repos/o/r', 'core');
      expect(delaySpy(svc)).toHaveBeenCalledWith(2000);
    });

    it('網路錯誤退避重試，耗盡後擲錯且訊息不含 URL/token', async () => {
      const svc = makeService();
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNRESET'));
      await expect(svc.getJson('https://api.github.com/repos/secret/r', 'core')).rejects.toThrow(/網路錯誤/);
      try {
        await svc.getJson('https://api.github.com/repos/secret/r', 'core');
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).not.toContain(TOKEN);
        expect(msg).not.toContain('api.github.com');
      }
    });

    it('5xx 退避耗盡擲錯，訊息只含狀態碼、不含 URL/token', async () => {
      const svc = makeService();
      jest.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 500 }));
      try {
        await svc.getJson('https://api.github.com/repos/o/r', 'core');
        throw new Error('should have thrown');
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).toContain('HTTP 500');
        expect(msg).not.toContain(TOKEN);
        expect(msg).not.toContain('api.github.com');
      }
    });
  });

  describe('rate-limit 監看', () => {
    it('剩餘逼近門檻 → 下次同類請求前退避一次', async () => {
      const svc = makeService();
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(jsonRes({}, { headers: { 'x-ratelimit-remaining': '1' } }))
        .mockResolvedValueOnce(jsonRes({}));
      await svc.getJson('https://api.github.com/repos/o/r', 'core');
      expect(delaySpy(svc)).not.toHaveBeenCalled(); // 首次未退避
      await svc.getJson('https://api.github.com/repos/o/r2', 'core');
      expect(delaySpy(svc)).toHaveBeenCalledTimes(1); // 逼近門檻 → 退避
    });
  });

  describe('認證與 header', () => {
    it('API 請求帶 Bearer token 與自訂 User-Agent', async () => {
      const svc = makeService();
      const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async () => jsonRes({}));
      await svc.getJson('https://api.github.com/repos/o/r', 'core');
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(headers['User-Agent']).toBe(USER_AGENT);
    });

    it('Trending 網頁不帶 token（僅 UA）', async () => {
      const svc = makeService();
      const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('<html></html>', { status: 200 }));
      await svc.getText('https://github.com/trending?since=weekly');
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
      expect(headers['User-Agent']).toBe(USER_AGENT);
    });
  });

  describe('條件式請求（getText）', () => {
    it('有前值時帶 If-None-Match／If-Modified-Since', async () => {
      const svc = makeService();
      const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('x', { status: 200 }));
      await svc.getText('https://github.com/trending', { etag: 'W/"abc"', lastModified: 'Mon, 01 Jan 2026 00:00:00 GMT' });
      const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
      expect(headers['If-None-Match']).toBe('W/"abc"');
      expect(headers['If-Modified-Since']).toBe('Mon, 01 Jan 2026 00:00:00 GMT');
    });

    it('無前值時不帶條件式 header（F2 no-op 骨架）', async () => {
      const svc = makeService();
      const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('x', { status: 200 }));
      await svc.getText('https://github.com/trending');
      const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
      expect(headers['If-None-Match']).toBeUndefined();
      expect(headers['If-Modified-Since']).toBeUndefined();
    });

    it('304 回 notModified、text 為空', async () => {
      const svc = makeService();
      jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 304, headers: { etag: 'W/"abc"' } }));
      const out = await svc.getText('https://github.com/trending', { etag: 'W/"abc"' });
      expect(out.notModified).toBe(true);
      expect(out.text).toBe('');
    });
  });
});

describe('mapWithConcurrency', () => {
  it('同時 in-flight 不超過 limit，且保序回傳', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    const out = await mapWithConcurrency(
      items,
      async (n) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
        return n * 2;
      },
      6,
    );
    expect(peak).toBeLessThanOrEqual(6);
    expect(out).toEqual(items.map((n) => n * 2));
  });

  it('items 少於 limit 時只開 items.length 個 worker', async () => {
    const out = await mapWithConcurrency([1, 2], async (n) => n + 1, 6);
    expect(out).toEqual([2, 3]);
  });
});
