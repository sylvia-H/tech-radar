import { buildDigestEmbeds } from './digest-embeds';
import { CuratedDigest, CuratedNewsItem } from '../../curation/curation.types';
import { COLOR_DIGEST } from '../../discord/discord.embed';

const DATE_LABEL = '2026-07-19';

function item(overrides: Partial<CuratedNewsItem> = {}): CuratedNewsItem {
  return {
    title: 'Some AI News',
    content: '一段不超過三百字的內容摘要。',
    url: 'https://example.com/a',
    domain: 'ai',
    sourceCount: 1,
    weightedScore: 100,
    degraded: false,
    ...overrides,
  };
}

describe('buildDigestEmbeds（research D4；contract discord-layout.md L4）', () => {
  it('正常：每則「N. [標題](url)」換行內容、AI 優先在前（順序沿用 digest.items 不重排）', () => {
    const digest: CuratedDigest = {
      items: [item({ title: 'AI 1' }), item({ title: 'FE 1', domain: 'frontend-backend' })],
      degraded: false,
    };
    const [embed] = buildDigestEmbeds(digest, DATE_LABEL);
    expect(embed.title).toBe(`📡 Tech Radar 晨報 · ${DATE_LABEL}`);
    expect(embed.color).toBe(COLOR_DIGEST);
    expect(embed.description).toBe(
      '1. [AI 1](https://example.com/a)\n一段不超過三百字的內容摘要。\n\n' +
        '2. [FE 1](https://example.com/a)\n一段不超過三百字的內容摘要。',
    );
  });

  it('降級（content===null）：原文標題＋連結，不套改寫', () => {
    const digest: CuratedDigest = {
      items: [item({ title: '原文標題', content: null, degraded: true })],
      degraded: true,
    };
    const [embed] = buildDigestEmbeds(digest, DATE_LABEL);
    expect(embed.description).toBe('1. [原文標題](https://example.com/a)');
  });

  it('description ≤4096 → 回單一 embed（1 個元素）', () => {
    const digest: CuratedDigest = {
      items: [item(), item(), item()],
      degraded: false,
    };
    const embeds = buildDigestEmbeds(digest, DATE_LABEL);
    expect(embeds).toHaveLength(1);
  });

  it('description code-point 長度 >4096 → 貪婪拆成兩張橙 embed，皆 ≤4096、無遺漏', () => {
    const longContent = 'x'.repeat(2000);
    const digest: CuratedDigest = {
      items: [
        item({ title: 'A', content: longContent }),
        item({ title: 'B', content: longContent }),
        item({ title: 'C', content: longContent }),
      ],
      degraded: false,
    };
    const embeds = buildDigestEmbeds(digest, DATE_LABEL);
    expect(embeds.length).toBeGreaterThanOrEqual(2);
    for (const e of embeds) {
      expect(e.color).toBe(COLOR_DIGEST);
      expect([...e.description!].length).toBeLessThanOrEqual(4096);
    }
    // 無遺漏：三則標題皆出現在某一張 embed
    const joined = embeds.map((e) => e.description).join('\n');
    expect(joined).toContain('[A](');
    expect(joined).toContain('[B](');
    expect(joined).toContain('[C](');
  });
});
