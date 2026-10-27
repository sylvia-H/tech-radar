import { Agent, Pool } from 'undici';
import { GEMINI_HTTP_TIMEOUT_MS, GEMINI_ORIGIN, createDispatcher, poolOptionsFor } from './gemini-dispatcher';

describe('gemini-dispatcher（Gemini 請求逾時，2026-10-27）', () => {
  it('逾時取 10 分鐘，高於 undici 預設的 300 秒', () => {
    expect(GEMINI_HTTP_TIMEOUT_MS).toBe(600_000);
    expect(GEMINI_HTTP_TIMEOUT_MS).toBeGreaterThan(300_000);
  });

  it('Gemini origin（字串或 URL、帶不帶尾斜線）→ headers／body 逾時拉長，其餘選項保留', () => {
    const opts: Pool.Options = { connections: 10, keepAliveTimeout: 4_000 };
    const expected = {
      connections: 10,
      keepAliveTimeout: 4_000,
      headersTimeout: GEMINI_HTTP_TIMEOUT_MS,
      bodyTimeout: GEMINI_HTTP_TIMEOUT_MS,
    };
    expect(poolOptionsFor(GEMINI_ORIGIN, opts)).toEqual(expected);
    expect(poolOptionsFor(`${GEMINI_ORIGIN}/`, opts)).toEqual(expected);
    expect(poolOptionsFor(new URL(GEMINI_ORIGIN), opts)).toEqual(expected);
    expect(opts).toEqual({ connections: 10, keepAliveTimeout: 4_000 });
  });

  it('其他 origin（新聞來源、GitHub、Discord）原樣沿用 undici 預設，不拉長逾時', () => {
    const opts: Pool.Options = { connections: 10 };
    for (const origin of ['https://api.github.com', 'https://discord.com', 'https://hnrss.org', 'http://generativelanguage.googleapis.com']) {
      expect(poolOptionsFor(origin, opts)).toBe(opts);
    }
  });

  it('createDispatcher 回傳 undici Agent', async () => {
    const dispatcher = createDispatcher();
    expect(dispatcher).toBeInstanceOf(Agent);
    await dispatcher.close();
  });
});
