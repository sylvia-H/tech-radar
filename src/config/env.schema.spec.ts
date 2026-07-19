import { validateEnv } from './env.schema';

const validEnv = {
  DISCORD_NEWS_WEBHOOK_URL: 'https://discord.com/api/webhooks/123/news',
  DISCORD_BOARD_WEBHOOK_URL: 'https://discord.com/api/webhooks/123/board',
  DISCORD_ALERT_WEBHOOK_URL: 'https://discord.com/api/webhooks/123/alert',
  GH_API_TOKEN: 'gh-token',
  GEMINI_API_KEY: 'gemini-key',
};

describe('env.schema validateEnv', () => {
  it('合法環境變數通過並回傳解析值', () => {
    const parsed = validateEnv({ ...validEnv, EXTRA: 'ignored' });
    expect(parsed.DISCORD_NEWS_WEBHOOK_URL).toBe(validEnv.DISCORD_NEWS_WEBHOOK_URL);
    expect(parsed.DISCORD_BOARD_WEBHOOK_URL).toBe(validEnv.DISCORD_BOARD_WEBHOOK_URL);
    expect(parsed.DISCORD_ALERT_WEBHOOK_URL).toBe(validEnv.DISCORD_ALERT_WEBHOOK_URL);
    expect(parsed.GH_API_TOKEN).toBe('gh-token');
    expect(parsed.GEMINI_API_KEY).toBe('gemini-key');
  });

  it.each([
    'DISCORD_NEWS_WEBHOOK_URL',
    'DISCORD_BOARD_WEBHOOK_URL',
    'DISCORD_ALERT_WEBHOOK_URL',
    'GH_API_TOKEN',
    'GEMINI_API_KEY',
  ])('缺少 %s 時擲錯', (key) => {
    const env: Record<string, unknown> = { ...validEnv };
    delete env[key];
    expect(() => validateEnv(env)).toThrow();
  });

  it.each([
    'https://discordapp.com/api/webhooks/1/t',
    'https://ptb.discord.com/api/webhooks/1/t',
    'https://canary.discord.com/api/webhooks/1/t',
    'https://ptb.discordapp.com/api/webhooks/1/t',
  ])('合法 webhook 變體 %s 通過（三個 webhook 欄位共用同一格式驗證）', (url) => {
    expect(() =>
      validateEnv({
        ...validEnv,
        DISCORD_NEWS_WEBHOOK_URL: url,
        DISCORD_BOARD_WEBHOOK_URL: url,
        DISCORD_ALERT_WEBHOOK_URL: url,
      }),
    ).not.toThrow();
  });

  it.each([
    'http://discord.com/api/webhooks/1/t',
    'https://example.com/api/webhooks/1/t',
    'https://discord.com/api/webhook/1/t',
    'not-a-url',
    '',
  ])('非法 webhook URL %s 擲錯', (url) => {
    expect(() => validateEnv({ ...validEnv, DISCORD_NEWS_WEBHOOK_URL: url })).toThrow();
  });

  it('擲錯訊息不含機密值', () => {
    try {
      validateEnv({ ...validEnv, DISCORD_ALERT_WEBHOOK_URL: 'https://evil.com/x' });
      fail('應擲錯');
    } catch (e) {
      expect((e as Error).message).not.toContain('gh-token');
      expect((e as Error).message).not.toContain('gemini-key');
    }
  });
});
