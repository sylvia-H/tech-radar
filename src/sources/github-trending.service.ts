import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { GithubHttpService } from '../github/github-http';
import { RawTrendingRepo } from '../board/board.types';

/** 主力 Trending 語言頁（clarify 已定：全站 ＋ 5 語言頁；FR-010）。空字串＝全站。 */
export const TRENDING_LANGS: readonly string[] = ['', 'typescript', 'javascript', 'python', 'rust', 'shell'];

/** 主力來源識別（告警用）。 */
export const TRENDING_SOURCE_ID = 'github-trending';

function trendingUrl(lang: string): string {
  return lang
    ? `https://github.com/trending/${lang}?since=weekly`
    : 'https://github.com/trending?since=weekly';
}

/**
 * 主力：GitHub Trending weekly 爬取（contracts §1、research D1）。
 * 全站＋5 語言頁共 6 頁，`cheerio` 逐 `article.Box-row` 解析「stars this week」。
 * 跨頁先以 `fullName` 去重。合併後 0 筆或欄位抽不到 → 擲可辨識錯誤（FR-009，
 * 由 board-builder 轉為 `github-trending` 告警），不得靜默當「本週無熱門」。
 */
@Injectable()
export class GithubTrendingService {
  constructor(private readonly http: GithubHttpService) {}

  async fetchTrending(): Promise<RawTrendingRepo[]> {
    const byName = new Map<string, RawTrendingRepo>();
    for (const lang of TRENDING_LANGS) {
      const res = await this.http.getText(trendingUrl(lang));
      if (res.notModified) {
        continue; // 條件式請求 304（F2 無前值，不會發生；穩健處理）
      }
      for (const repo of parseTrendingHtml(res.text)) {
        if (!byName.has(repo.fullName)) {
          byName.set(repo.fullName, repo);
        }
      }
    }
    const merged = [...byName.values()];
    if (merged.length === 0) {
      throw new Error('Trending 解析 0 筆（疑似頁面改版，不視為本週無熱門）');
    }
    return merged;
  }
}

/**
 * 解析單頁 Trending HTML → RawTrendingRepo[]（純函式，可餵 fixture 快照測）。
 * 有 `article.Box-row` 但欄位（fullName／starsThisWeek）抽不到 → 擲錯（結構漂移）。
 * 完全無 Box-row → 回空陣列（交由呼叫端判斷合併後是否全 0）。
 */
export function parseTrendingHtml(html: string): RawTrendingRepo[] {
  const $ = cheerio.load(html);
  const rows = $('article.Box-row');
  const out: RawTrendingRepo[] = [];

  rows.each((_, el) => {
    const $row = $(el);
    const fullName = $row.find('h2 a').first().text().replace(/\s+/g, '');
    const starsText = $row.find('.float-sm-right').first().text();
    const stars = Number(starsText.replace(/[^0-9]/g, ''));

    if (!fullName || !/\//.test(fullName) || !Number.isFinite(stars) || starsText.trim() === '') {
      throw new Error('Trending 欄位抽不到（疑似頁面改版：fullName 或 stars this week）');
    }

    const description = normalizeText($row.find('p').first().text());
    const language = normalizeText($row.find('[itemprop="programmingLanguage"]').first().text());

    out.push({
      fullName,
      description: description || null,
      language: language || null,
      starsThisWeek: stars,
    });
  });

  return out;
}

function normalizeText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}
