import { ConfigService } from '@nestjs/config';
import { DiscordWebhookService } from './discord.webhook.service';

const WEBHOOK_URL = 'https://discord.com/api/webhooks/123/secrettoken';

function makeService(): DiscordWebhookService {
  const config = {
    get: (key: string) => (key === 'DISCORD_WEBHOOK_URL' ? WEBHOOK_URL : undefined),
  } as unknown as ConfigService;
  return new DiscordWebhookService(config);
}

function response(status: number, body?: unknown): Response {
  return {
    status,
    headers: new Map<string, string>() as unknown as Headers,
    clone() {
      return this as unknown as Response;
    },
    json: async () => body,
  } as unknown as Response;
}

describe('DiscordWebhookService.postTestEmbed', () => {
  const ts = '2026-07-11T22:07:00.000Z';
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    // 立即執行 callback，跳過真實延遲
    jest.spyOn(global, 'setTimeout').mockImplementation(((cb: () => void) => {
      cb();
      return 0 as unknown as NodeJS.Timeout;
    }) as unknown as typeof setTimeout);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('204 視為成功', async () => {
    fetchMock.mockResolvedValueOnce(response(204));
    await expect(makeService().postTestEmbed(ts, 'ci')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(WEBHOOK_URL);
    expect(init.method).toBe('POST');
  });

  it('429 後退避重試，最終 204 成功', async () => {
    fetchMock
      .mockResolvedValueOnce(response(429, { retry_after: 0.01 }))
      .mockResolvedValueOnce(response(204));
    await expect(makeService().postTestEmbed(ts, 'ci')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('持續 429 逾重試次數視為失敗（有限退避）', async () => {
    fetchMock.mockResolvedValue(response(429, { retry_after: 0.01 }));
    await expect(makeService().postTestEmbed(ts, 'ci')).rejects.toThrow(/429/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('非 204/429 失敗擲錯', async () => {
    fetchMock.mockResolvedValueOnce(response(500));
    await expect(makeService().postTestEmbed(ts, 'ci')).rejects.toThrow(/500/);
  });

  it('擲錯訊息不含 webhook URL / token', async () => {
    fetchMock.mockResolvedValueOnce(response(403));
    try {
      await makeService().postTestEmbed(ts, 'ci');
      fail('應擲錯');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain('secrettoken');
      expect(msg).not.toContain(WEBHOOK_URL);
    }
  });

  it('fetch 網路錯誤被消毒（不夾帶含 token 的 URL）', async () => {
    // 模擬 undici 網路錯誤，cause 夾帶完整 URL
    const netErr = new TypeError('fetch failed');
    (netErr as unknown as { cause: unknown }).cause = new Error(
      `connect ENOTFOUND ${WEBHOOK_URL}`,
    );
    fetchMock.mockRejectedValueOnce(netErr);
    try {
      await makeService().postTestEmbed(ts, 'ci');
      fail('應擲錯');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain('secrettoken');
      expect(msg).not.toContain(WEBHOOK_URL);
      expect(msg).toContain('網路錯誤');
    }
  });
});

describe('DiscordWebhookService.send（F7 T003：委派既有 post）', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('204 視為成功，送出任意 payload', async () => {
    fetchMock.mockResolvedValueOnce(response(204));
    const payload = {
      username: 'Tech Radar',
      embeds: [{ title: 'cover', color: 0x5865f2 }],
    };
    await expect(makeService().send(payload)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(WEBHOOK_URL);
    expect(JSON.parse(init.body)).toEqual(payload);
  });

  it('非 204/429 失敗擲錯（與既有 post 行為一致，不重複實作退避）', async () => {
    fetchMock.mockResolvedValueOnce(response(500));
    await expect(
      makeService().send({ username: 'Tech Radar', embeds: [] }),
    ).rejects.toThrow(/500/);
  });
});
