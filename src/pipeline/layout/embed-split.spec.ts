import { chunkEmbeds } from './embed-split';
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
