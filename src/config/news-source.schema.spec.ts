import { validateNewsSources } from './news-source.schema';
import { NEWS_SOURCES } from './news-sources';

const valid = { id: 'a', type: 'rss', url: 'https://a.com/f', domain: 'ai', tier: 1 };

describe('validateNewsSources（FR-002）', () => {
  it('合法清單通過並回傳型別化陣列', () => {
    expect(validateNewsSources([valid])).toHaveLength(1);
  });

  it('重複 id → 擲帶 id 的明確錯誤', () => {
    expect(() => validateNewsSources([valid, { ...valid }])).toThrow(/重複 id：a/);
  });

  it('缺必填欄位 → 擲帶 id 的明確錯誤', () => {
    expect(() => validateNewsSources([{ id: 'b', type: 'rss' }])).toThrow(/\[b\]/);
  });

  it('列舉不符（tier/domain）→ 擲帶 id 錯誤', () => {
    expect(() => validateNewsSources([{ ...valid, id: 'c', tier: 5 }])).toThrow(/\[c\]/);
    expect(() => validateNewsSources([{ ...valid, id: 'd', domain: 'crypto' }])).toThrow(/\[d\]/);
  });

  it('非陣列 → 擲錯', () => {
    expect(() => validateNewsSources({} as unknown)).toThrow(/必須是陣列/);
  });
});

describe('NEWS_SOURCES 初始清單（憲章 IV）', () => {
  it('載入即通過驗證、id 唯一', () => {
    const ids = NEWS_SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('四種抓取類型齊備', () => {
    const types = new Set(NEWS_SOURCES.map((s) => s.type));
    expect(types).toEqual(new Set(['hn-algolia', 'reddit-weekly', 'rss', 'github-releases']));
  });

  it('保留至少三個 DevOps 專屬來源（憲章 v1.2.0 Scope note）', () => {
    const devops = NEWS_SOURCES.filter((s) => s.domain === 'devops');
    expect(devops.length).toBeGreaterThanOrEqual(3);
  });
});
