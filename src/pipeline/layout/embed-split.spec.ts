import { chunkEmbeds, chunkEmbedsByBudget, embedCharLength, MESSAGE_CHAR_BUDGET } from './embed-split';
import { DiscordEmbed } from '../../discord/discord.embed';

function makeEmbeds(n: number): DiscordEmbed[] {
  return Array.from({ length: n }, (_, i) => ({ title: `embed-${i}`, color: 0x000000 }));
}

describe('chunkEmbeds（契約 embed-split.md 六案例）', () => {
  it('空輸入 → []（0 批）', () => {
    expect(chunkEmbeds([], 10)).toEqual([]);
  });

  it('穩定態（4）→ 1 批 ×4', () => {
    const embeds = makeEmbeds(4);
    const batches = chunkEmbeds(embeds, 10);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(4);
  });

  it('恰滿 10 → 1 批 ×10', () => {
    const embeds = makeEmbeds(10);
    const batches = chunkEmbeds(embeds, 10);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(10);
  });

  it('冷啟動（12）→ 2 批：10 + 2', () => {
    const embeds = makeEmbeds(12);
    const batches = chunkEmbeds(embeds, 10);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(10);
    expect(batches[1]).toHaveLength(2);
  });

  it('邊界 11 → 2 批：10 + 1', () => {
    const embeds = makeEmbeds(11);
    const batches = chunkEmbeds(embeds, 10);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(10);
    expect(batches[1]).toHaveLength(1);
  });

  it('順序保持：flat(output) 與輸入同物件參照、同索引順序，長度不增不減', () => {
    const embeds = makeEmbeds(23);
    const batches = chunkEmbeds(embeds, 10);
    const flat = batches.flat();
    expect(flat).toHaveLength(embeds.length);
    flat.forEach((e, i) => {
      expect(e).toBe(embeds[i]); // 同物件參照
    });
    batches.forEach((b) => expect(b.length).toBeLessThanOrEqual(10));
  });
});

describe('chunkEmbedsByBudget（張數 ≤10 且合計 ≤6,000 字元，2026-09-25）', () => {
  const big = (n: number, len: number): DiscordEmbed[] =>
    Array.from({ length: n }, (_, i) => ({ title: `t${i}`, color: 0, description: 'x'.repeat(len) }));

  it('預算常數 6000；embedCharLength 計 title＋description＋fields（code point）', () => {
    expect(MESSAGE_CHAR_BUDGET).toBe(6000);
    expect(embedCharLength({ title: '晨報', color: 0, description: 'abc', fields: [{ name: 'n', value: '值' }] })).toBe(2 + 3 + 1 + 1);
  });

  it('三張各近 4,096 的晨報 embed → 三批（合計會超過 6,000，舊 chunkEmbeds 會塞成一批被 Discord 拒收）', () => {
    const batches = chunkEmbedsByBudget(big(3, 4000));
    expect(batches.map((b) => b.length)).toEqual([1, 1, 1]);
  });

  it('兩張各 2,500 → 一批；第三張 1,500 使合計 6,504 → 另起一批', () => {
    expect(chunkEmbedsByBudget(big(2, 2500)).map((b) => b.length)).toEqual([2]);
    expect(chunkEmbedsByBudget([...big(2, 2500), ...big(1, 1500)]).map((b) => b.length)).toEqual([2, 1]);
  });

  it('張數上限仍生效：11 張小 embed → 10 + 1；空輸入 → []', () => {
    expect(chunkEmbedsByBudget(makeEmbeds(11)).map((b) => b.length)).toEqual([10, 1]);
    expect(chunkEmbedsByBudget([])).toEqual([]);
  });

  it('單張本身超出預算仍自成一批送出（不靜默丟內容）', () => {
    expect(chunkEmbedsByBudget(big(1, 7000)).map((b) => b.length)).toEqual([1]);
  });

  it('順序保持、同物件參照', () => {
    const embeds = [...big(2, 3000), ...makeEmbeds(3)];
    const flat = chunkEmbedsByBudget(embeds).flat();
    expect(flat).toHaveLength(embeds.length);
    flat.forEach((e, i) => expect(e).toBe(embeds[i]));
  });
});
