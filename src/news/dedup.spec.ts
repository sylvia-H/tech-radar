import { NewsCandidate } from './news.types';
import { dedupByTitle, dedupByUrl, TITLE_MERGE_MAX_GAP_DAYS } from './dedup';
import { TITLE_JACCARD_THRESHOLD } from './title-similarity';
import { DEFAULT_FUNNEL_CONFIG } from './funnel';

const BASE = Date.parse('2026-09-08T12:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;

/** 以 `BASE` 為基準往前推 `days` 天（可加 `extraMs` 微調）的 ISO 字串。 */
function daysBefore(days: number, extraMs = 0): string {
  return new Date(BASE - days * 24 * HOUR_MS - extraMs).toISOString();
}

function cand(over: Partial<NewsCandidate>): NewsCandidate {
  return {
    title: 't',
    normalizedUrl: 'https://a.com/x',
    originalUrl: 'https://a.com/x',
    summary: null,
    sourceId: 's1',
    score: null,
    domain: 'ai',
    tier: 1,
    sources: ['s1'],
    publishedAt: null,
    weightedScore: 0,
    ...over,
  };
}

describe('dedupByUrl（FR-012 / SC-001）', () => {
  it('同 URL 合併：最高分為代表、sources[] 累積並去重排序', () => {
    const out = dedupByUrl([
      cand({ sourceId: 'hn', score: 200, sources: ['hn'], normalizedUrl: 'u' }),
      cand({ sourceId: 'rd', score: null, sources: ['rd'], normalizedUrl: 'u' }),
      cand({ sourceId: 'lo', score: 50, sources: ['lo'], normalizedUrl: 'u' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].sourceId).toBe('hn');
    expect(out[0].score).toBe(200);
    expect(out[0].sources).toEqual(['hn', 'lo', 'rd']);
  });

  it('同分時代表以 sourceId→originalUrl 字典序確定性決勝，與輸入順序無關（FR-012, SC-011）', () => {
    const a = cand({ sourceId: 'b', score: 100, originalUrl: 'https://z', sources: ['b'], normalizedUrl: 'u' });
    const b = cand({ sourceId: 'a', score: 100, originalUrl: 'https://y', sources: ['a'], normalizedUrl: 'u' });
    expect(dedupByUrl([a, b])[0].sourceId).toBe('a');
    expect(dedupByUrl([b, a])[0].sourceId).toBe('a');
  });

  it('無目標連結以自身連結為鍵、不崩潰（FR-015/Edge）', () => {
    const out = dedupByUrl([
      cand({ normalizedUrl: 'https://news.ycombinator.com/item?id=1', originalUrl: 'https://news.ycombinator.com/item?id=1' }),
    ]);
    expect(out).toHaveLength(1);
  });
});

describe('dedupByTitle（FR-013）', () => {
  it('標題近似合併（最高分代表）；低於門檻不誤合併', () => {
    const c1 = cand({ title: 'OpenAI releases GPT-5 model today', normalizedUrl: 'u1', score: 10, sourceId: 's1', sources: ['s1'] });
    const c2 = cand({ title: 'OpenAI releases GPT-5 model', normalizedUrl: 'u2', score: 20, sourceId: 's2', sources: ['s2'] });
    const c3 = cand({ title: 'Rust compiler performance improvements', normalizedUrl: 'u3', sourceId: 's3', sources: ['s3'] });

    const out = dedupByTitle([c1, c2, c3], TITLE_JACCARD_THRESHOLD);
    expect(out).toHaveLength(2);
    const merged = out.find((o) => o.sources.includes('s1'))!;
    expect(merged.sources).toEqual(['s1', 's2']);
    expect(merged.score).toBe(20);
  });

  describe('發表日期差上限（TITLE_MERGE_MAX_GAP_DAYS，2026-09-12）', () => {
    const similar = (over: Partial<NewsCandidate>): NewsCandidate =>
      cand({ title: 'OpenAI releases GPT-5 model today', ...over });

    it('上限必須小於漏斗新鮮度視窗（視窗若降到 ≤ 上限，上限形同失效）', () => {
      // 比照 seen-news.spec.ts「保留期 ≥ 視窗」的耦合斷言：候選最舊只到視窗邊界，
      // 若上限 ≥ 視窗，視窗內任兩則的日期差都不會超過上限，日期差門檻就擋不住任何合併。
      expect(TITLE_MERGE_MAX_GAP_DAYS).toBeLessThan(DEFAULT_FUNNEL_CONFIG.freshnessWindowDays);
    });

    it('相似標題但發表日期相差 144 天 → 不合併、兩則皆保留', () => {
      const newer = similar({ normalizedUrl: 'u1', sourceId: 's1', sources: ['s1'], publishedAt: daysBefore(4) });
      const older = similar({
        title: 'OpenAI releases GPT-5 model',
        normalizedUrl: 'u2',
        sourceId: 's2',
        sources: ['s2'],
        score: 999,
        publishedAt: daysBefore(148),
      });
      const out = dedupByTitle([older, newer], TITLE_JACCARD_THRESHOLD);
      expect(out).toHaveLength(2);
      expect(out.map((o) => o.sources)).toEqual([['s1'], ['s2']]);
    });

    it('相似標題且發表日期相差 3 天 → 合併', () => {
      const a = similar({ normalizedUrl: 'u1', sourceId: 's1', sources: ['s1'], publishedAt: daysBefore(1) });
      const b = similar({ normalizedUrl: 'u2', sourceId: 's2', sources: ['s2'], publishedAt: daysBefore(4) });
      const out = dedupByTitle([a, b], TITLE_JACCARD_THRESHOLD);
      expect(out).toHaveLength(1);
      expect(out[0].sources).toEqual(['s1', 's2']);
    });

    it('一方 publishedAt 為 null → 仍合併（向後相容）', () => {
      const dated = similar({ normalizedUrl: 'u1', sourceId: 's1', sources: ['s1'], publishedAt: daysBefore(200) });
      const undated = similar({ normalizedUrl: 'u2', sourceId: 's2', sources: ['s2'], publishedAt: null });
      expect(dedupByTitle([dated, undated], TITLE_JACCARD_THRESHOLD)).toHaveLength(1);
      expect(dedupByTitle([undated, dated], TITLE_JACCARD_THRESHOLD)).toHaveLength(1);
    });

    it('一方 publishedAt 無法解析 → 視同缺日期、仍合併', () => {
      const dated = similar({ normalizedUrl: 'u1', sourceId: 's1', sources: ['s1'], publishedAt: daysBefore(200) });
      const garbage = similar({ normalizedUrl: 'u2', sourceId: 's2', sources: ['s2'], publishedAt: 'not-a-date' });
      expect(dedupByTitle([dated, garbage], TITLE_JACCARD_THRESHOLD)).toHaveLength(1);
    });

    it('邊界：恰好 14 天合併；14 天又 1 小時不合併', () => {
      const anchor = similar({ normalizedUrl: 'u1', sourceId: 's1', sources: ['s1'], publishedAt: daysBefore(0) });
      const exact = similar({ normalizedUrl: 'u2', sourceId: 's2', sources: ['s2'], publishedAt: daysBefore(14) });
      const over = similar({ normalizedUrl: 'u2', sourceId: 's2', sources: ['s2'], publishedAt: daysBefore(14, HOUR_MS) });
      expect(dedupByTitle([anchor, exact], TITLE_JACCARD_THRESHOLD)).toHaveLength(1);
      expect(dedupByTitle([anchor, over], TITLE_JACCARD_THRESHOLD)).toHaveLength(2);
    });

    it('maxPublishedGapDays 可由參數覆寫', () => {
      const a = similar({ normalizedUrl: 'u1', sourceId: 's1', sources: ['s1'], publishedAt: daysBefore(0) });
      const b = similar({ normalizedUrl: 'u2', sourceId: 's2', sources: ['s2'], publishedAt: daysBefore(20) });
      expect(dedupByTitle([a, b], TITLE_JACCARD_THRESHOLD)).toHaveLength(2);
      expect(dedupByTitle([a, b], TITLE_JACCARD_THRESHOLD, 30)).toHaveLength(1);
    });

    it('鏈式合併（F2）：day0／day14／day28 三則相似標題，day0 與 day28 不得同組、day0 仍在輸出', () => {
      // normalizedUrl 字典序決定貪婪合併順序：A(day0) → B(day14) → C(day28)。
      // 舊實作只跟「當前代表項」比：B 併入 A 後代表項換成 B（sourceId 較小）、群組日期變 day14，
      // C 再以 |28−14| ≤ 14 併入，最後代表項為 C，day0 的 A 整則消失。
      // 新實作追蹤群組範圍：A 建立 [day0]，B 併入（|14−0| ≤ 14）後範圍為 [day0, day14]；
      // C 與範圍下端相距 28 > 14 → 不得併入，自成一組。期望輸出 2 組：A+B、C。
      const a = similar({ normalizedUrl: 'u1', sourceId: 'simonwillison', sources: ['simonwillison'], publishedAt: daysBefore(0) });
      const b = similar({ normalizedUrl: 'u2', sourceId: 'openai-blog', sources: ['openai-blog'], publishedAt: daysBefore(14) });
      const c = similar({ normalizedUrl: 'u3', sourceId: 'cloudflare-blog', sources: ['cloudflare-blog'], publishedAt: daysBefore(28) });
      const out = dedupByTitle([c, a, b], TITLE_JACCARD_THRESHOLD);
      expect(out).toHaveLength(2);
      const withA = out.find((o) => o.sources.includes('simonwillison'))!;
      expect(withA).toBeDefined();
      expect(withA.sources).toEqual(['openai-blog', 'simonwillison']);
      expect(withA.sources).not.toContain('cloudflare-blog');
      const cAlone = out.find((o) => o.sources.includes('cloudflare-blog'))!;
      expect(cAlone.sources).toEqual(['cloudflare-blog']);
      expect(cAlone.publishedAt).toBe(daysBefore(28));
    });

    it('缺日期的高分代表項（F1）：不得抹掉群組日期範圍，範圍由有日期成員建立並持續生效', () => {
      // 順序 H → R1 → R2。H（hn、score 200、publishedAt null）先建組、範圍為 null；
      // R1（day0）併入並建立範圍 [day0]，代表項仍為 H（分數最高）。
      // 舊實作只跟代表項 H 的 null 日期比 → R2（day28）也能併入，14 天上限完全失效。
      // 新實作：R2 與範圍 [day0] 相距 28 > 14 → 不得併入，獨立存在。
      const h = similar({ normalizedUrl: 'u1', sourceId: 'hn', sources: ['hn'], score: 200, publishedAt: null });
      const r1 = similar({ normalizedUrl: 'u2', sourceId: 'rss-1', sources: ['rss-1'], publishedAt: daysBefore(0) });
      const r2 = similar({ normalizedUrl: 'u3', sourceId: 'rss-2', sources: ['rss-2'], publishedAt: daysBefore(28) });
      const out = dedupByTitle([r2, h, r1], TITLE_JACCARD_THRESHOLD);
      expect(out).toHaveLength(2);
      const merged = out.find((o) => o.sources.includes('hn'))!;
      expect(merged.sourceId).toBe('hn');
      expect(merged.sources).toEqual(['hn', 'rss-1']);
      const r2Alone = out.find((o) => o.sources.includes('rss-2'))!;
      expect(r2Alone.sources).toEqual(['rss-2']);
      expect(r2Alone.sourceId).toBe('rss-2');
    });

    it('真實案例：「Introducing ChatGPT Images 2.0」（144 天前）不再吞掉「Images 2.5」（4 天前）', () => {
      const older = cand({
        title: 'Introducing ChatGPT Images 2.0',
        normalizedUrl: 'https://openai.com/index/chatgpt-images-2-0',
        sourceId: 'openai-blog',
        sources: ['openai-blog'],
        publishedAt: daysBefore(144),
      });
      const newer = cand({
        title: 'Introducing ChatGPT Images 2.5',
        normalizedUrl: 'https://openai.com/index/chatgpt-images-2-5',
        sourceId: 'simonwillison',
        sources: ['simonwillison'],
        publishedAt: daysBefore(4),
      });
      const out = dedupByTitle([older, newer], TITLE_JACCARD_THRESHOLD);
      expect(out).toHaveLength(2);
      expect(out.find((o) => o.title === 'Introducing ChatGPT Images 2.5')?.sources).toEqual(['simonwillison']);
      // 若日期相近則仍會合併（確認擋下的是日期差，而非標題相似度不足）
      const recentOlder = { ...older, publishedAt: daysBefore(6) };
      expect(dedupByTitle([recentOlder, newer], TITLE_JACCARD_THRESHOLD)).toHaveLength(1);
    });
  });
});
