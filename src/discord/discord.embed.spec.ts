import {
  buildTestEmbed,
  buildFailureAlert,
  COLOR_TEST,
  COLOR_FAILURE,
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
