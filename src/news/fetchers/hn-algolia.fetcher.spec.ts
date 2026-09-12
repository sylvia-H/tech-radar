import { HN_WINDOW_DAYS, OLD_YEAR_GRACE_DAYS, hnAlgoliaFetcher, isOldYearSuffixed } from './hn-algolia.fetcher';
import { FetcherContext } from './fetcher';
import { NewsHttp } from '../news-http';
import { NewsSource } from '../news.types';

const SRC: NewsSource = {
  id: 'hn',
  type: 'hn-algolia',
  url: 'https://hn.algolia.com/api/v1/search?tags=story',
  domain: 'cross',
  tier: 1,
};

function ctxWithJson(json: unknown, now: Date): { ctx: FetcherContext; getJson: jest.Mock } {
  const getJson = jest.fn().mockResolvedValue(json);
  const ctx: FetcherContext = {
    now,
    http: { getJson, getText: jest.fn() } as unknown as NewsHttp,
    parser: { parseString: jest.fn() },
  };
  return { ctx, getJson };
}

describe('hnAlgoliaFetcher（FR-005/010/015）', () => {
  const now = new Date('2026-07-18T00:00:00Z');
  const cutoff = Math.floor(now.getTime() / 1000) - HN_WINDOW_DAYS * 24 * 3600;

  it('視窗為 4 天', () => {
    expect(HN_WINDOW_DAYS).toBe(4);
  });

  it('近 HN_WINDOW_DAYS 天過濾、points→score、url 空退回 HN permalink', async () => {
    const { ctx, getJson } = ctxWithJson(
      {
        hits: [
          { objectID: '1', title: 'A', url: 'https://a.com/x', points: 150, created_at_i: cutoff + 1000 },
          { objectID: '2', title: 'Ask HN: B', url: '', points: 5, created_at_i: cutoff + 2000 },
          { objectID: '3', title: 'old', url: 'https://c.com', points: 999, created_at_i: cutoff - 5000 },
        ],
      },
      now,
    );
    const result = await hnAlgoliaFetcher(SRC, ctx);

    expect(result.items).toHaveLength(2); // 超過 HN_WINDOW_DAYS 天者濾除
    expect(result.items[0]).toMatchObject({ title: 'A', targetUrl: 'https://a.com/x', score: 150, summary: null });
    expect(result.items[1].targetUrl).toBe('https://news.ycombinator.com/item?id=2');
    expect(result.parsedCount).toBe(3); // 原始 hits 數（過濾前）
    expect(getJson.mock.calls[0][0]).toContain(`numericFilters=created_at_i>${cutoff}`);
  });

  it('視窗邊界：超過 4 天者濾除、4 天內保留；等於 cutoff 丟、cutoff+1 留（與 query 的 `>` 同界）', async () => {
    const sevenDaysAgo = Math.floor(now.getTime() / 1000) - 7 * 24 * 3600;
    const { ctx } = ctxWithJson(
      {
        hits: [
          { objectID: '1', title: 'six days', url: 'https://a.com/6', created_at_i: cutoff - 2 * 24 * 3600 },
          { objectID: '2', title: 'seven days', url: 'https://a.com/7', created_at_i: sevenDaysAgo + 1000 },
          { objectID: '3', title: 'three days', url: 'https://a.com/3', created_at_i: cutoff + 24 * 3600 },
          { objectID: '4', title: 'exactly cutoff', url: 'https://a.com/eq', created_at_i: cutoff },
          { objectID: '5', title: 'cutoff plus one', url: 'https://a.com/gt', created_at_i: cutoff + 1 },
        ],
      },
      now,
    );
    const result = await hnAlgoliaFetcher(SRC, ctx);

    expect(result.items.map((i) => i.title)).toEqual(['three days', 'cutoff plus one']);
    expect(result.parsedCount).toBe(5);
  });

  it('舊年份尾綴的 hit 不入 items，但 parsedCount 計入', async () => {
    const { ctx } = ctxWithJson(
      {
        hits: [
          { objectID: '1', title: 'Your intellectual fly is open (2025)', url: 'https://a.com/old', created_at_i: cutoff + 1000 },
          { objectID: '2', title: 'Fresh (2026)', url: 'https://a.com/new', created_at_i: cutoff + 2000 },
          { objectID: '3', title: 'No suffix', url: 'https://a.com/plain', created_at_i: cutoff + 3000 },
        ],
      },
      now,
    );
    const result = await hnAlgoliaFetcher(SRC, ctx);

    expect(result.items.map((i) => i.title)).toEqual(['Fresh (2026)', 'No suffix']);
    expect(result.parsedCount).toBe(3);
  });
});

describe('isOldYearSuffixed', () => {
  const now = new Date('2026-09-12T00:00:00Z');

  it('「Foo (2025)」於 2026 → true', () => {
    expect(isOldYearSuffixed('Foo (2025)', now)).toBe(true);
  });

  it('「Foo (2026)」於 2026 → false（當年不算舊）', () => {
    expect(isOldYearSuffixed('Foo (2026)', now)).toBe(false);
  });

  it('「Foo (1999)」→ true', () => {
    expect(isOldYearSuffixed('Foo (1999)', now)).toBe(true);
  });

  it('「Foo 2025」無括號 → false', () => {
    expect(isOldYearSuffixed('Foo 2025', now)).toBe(false);
  });

  it('「(2025) Foo」尾綴不在結尾 → false', () => {
    expect(isOldYearSuffixed('(2025) Foo', now)).toBe(false);
  });

  it('「Foo (v2025)」→ false', () => {
    expect(isOldYearSuffixed('Foo (v2025)', now)).toBe(false);
  });

  it('尾綴前後空白允許：「Foo  (2025)  」→ true', () => {
    expect(isOldYearSuffixed('Foo  (2025)  ', now)).toBe(true);
  });

  it('跨年邊界：2026-12-31T23:59:59Z 時「Foo (2026)」→ false', () => {
    expect(isOldYearSuffixed('Foo (2026)', new Date('2026-12-31T23:59:59Z'))).toBe(false);
  });

  describe('年份後接 HN 格式標籤（F1）', () => {
    it('「A Theory (1948) [pdf]」→ true', () => {
      expect(isOldYearSuffixed('A Theory (1948) [pdf]', now)).toBe(true);
    });

    it('「Demo (1968) [video]」→ true', () => {
      expect(isOldYearSuffixed('Demo (1968) [video]', now)).toBe(true);
    });

    it('「X (2011) [pdf, 2.3MB]」標籤含逗號與空白 → true', () => {
      expect(isOldYearSuffixed('X (2011) [pdf, 2.3MB]', now)).toBe(true);
    });

    it('「X [pdf] (2020)」標籤在年份前 → 仍以結尾 `(YYYY)` 判定 true', () => {
      expect(isOldYearSuffixed('X [pdf] (2020)', now)).toBe(true);
    });

    it('當年「Report (2026) [pdf]」→ false', () => {
      expect(isOldYearSuffixed('Report (2026) [pdf]', now)).toBe(false);
    });
  });

  describe('寬限天數對齊新鮮度視窗（F2）', () => {
    it('寬限為 30 天（對齊 funnel freshnessWindowDays）', () => {
      expect(OLD_YEAR_GRACE_DAYS).toBe(30);
    });

    it('2027-01-02 時「Foo (2026)」→ false（上年度年度報告仍在寬限內）', () => {
      expect(isOldYearSuffixed('Foo (2026)', new Date('2027-01-02T00:00:00Z'))).toBe(false);
    });

    it('2027-02-15 時「Foo (2026)」→ true（超過 30 天寬限）', () => {
      expect(isOldYearSuffixed('Foo (2026)', new Date('2027-02-15T00:00:00Z'))).toBe(true);
    });

    it('2026-09-12 時「Foo (2025)」→ true', () => {
      expect(isOldYearSuffixed('Foo (2025)', new Date('2026-09-12T00:00:00Z'))).toBe(true);
    });

    it('2026 年內「Foo (2026)」→ false', () => {
      expect(isOldYearSuffixed('Foo (2026)', now)).toBe(false);
    });
  });
});
