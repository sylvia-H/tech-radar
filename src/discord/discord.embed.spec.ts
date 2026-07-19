import {
  buildTestEmbed,
  buildFailureAlert,
  COLOR_TEST,
  COLOR_FAILURE,
  COLOR_BOARD_COVER,
  COLOR_DIGEST,
  COLOR_AI,
  COLOR_FRONTEND_BACKEND,
  DiscordEmbed,
} from './discord.embed';

describe('buildTestEmbed', () => {
  const ts = '2026-07-11T22:07:00.000Z';

  it('橙色、標題、時間戳與 env 標記正確', () => {
    const payload = buildTestEmbed(ts, 'ci');
    expect(payload.username).toBe('Tech Radar');
    expect(payload.embeds).toHaveLength(1);
    const embed = payload.embeds[0];
    expect(embed.color).toBe(COLOR_TEST);
    expect(embed.color).toBe(0xf5a623);
    expect(embed.title).toBe('📡 Tech Radar 連通測試');
    expect(embed.timestamp).toBe(ts);
    expect(embed.description).toContain(ts);
    expect(embed.description).toContain('env=ci');
  });

  it('env=local 反映於 description', () => {
    const embed = buildTestEmbed(ts, 'local').embeds[0];
    expect(embed.description).toContain('env=local');
  });
});

describe('buildFailureAlert', () => {
  it('紅色、標題正確、帶錯誤摘要', () => {
    const embed = buildFailureAlert('StateStore 讀取失敗').embeds[0];
    expect(embed.color).toBe(COLOR_FAILURE);
    expect(embed.color).toBe(0xe74c3c);
    expect(embed.title).toBe('⚠️ Tech Radar 執行失敗');
    expect(embed.description).toContain('StateStore 讀取失敗');
    expect(embed.description).toContain('Actions log');
  });

  it('description 不含 token / webhook URL / 金鑰（呼叫端傳入已清理摘要）', () => {
    // 契約：呼叫端須傳入不含機密的摘要；此處驗證函式不額外注入機密。
    const embed = buildFailureAlert('HTTP 500').embeds[0];
    expect(embed.description).not.toMatch(/discord\.com\/api\/webhooks/);
    expect(embed.description).not.toMatch(/gh[-_]?token/i);
  });

  it('過長摘要被截斷', () => {
    const embed = buildFailureAlert('x'.repeat(2000)).embeds[0];
    expect(embed.description!.length).toBeLessThan(600);
  });

  it('空摘要退回預設文字', () => {
    const embed = buildFailureAlert('   ').embeds[0];
    expect(embed.description).toContain('未知錯誤');
  });
});

describe('F7 加法擴充：url?/fields? 為可選、既有函式不受影響（T002）', () => {
  it('buildTestEmbed/buildFailureAlert 輸出不含 url/fields（可選欄位預設不存在）', () => {
    const testEmbed = buildTestEmbed('2026-07-19T00:00:00.000Z', 'ci').embeds[0];
    const failureEmbed = buildFailureAlert('x').embeds[0];
    expect(testEmbed.url).toBeUndefined();
    expect(testEmbed.fields).toBeUndefined();
    expect(failureEmbed.url).toBeUndefined();
    expect(failureEmbed.fields).toBeUndefined();
  });

  it('DiscordEmbed 可攜帶 url 與 fields（型別層面允許，供 F7 組版使用）', () => {
    const embed: DiscordEmbed = {
      title: 'repo',
      color: COLOR_AI,
      url: 'https://github.com/owner/name',
      fields: [{ name: '本週增星', value: '⭐ +100', inline: true }],
    };
    expect(embed.url).toBe('https://github.com/owner/name');
    expect(embed.fields).toHaveLength(1);
  });

  it('F7 色值常數：封面藍/晨報橙/AI 綠/前後端黃', () => {
    expect(COLOR_BOARD_COVER).toBe(0x5865f2);
    expect(COLOR_DIGEST).toBe(0xf5a623);
    expect(COLOR_AI).toBe(0x10a37f);
    expect(COLOR_FRONTEND_BACKEND).toBe(0xf7df1e);
  });
});
