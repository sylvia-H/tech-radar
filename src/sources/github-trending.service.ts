import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { GithubHttpService } from '../github/github-http';
import { RawTrendingRepo } from '../board/board.types';

/** 主力 Trending 語言頁（clarify 已定：全站 ＋ 5 語言頁；FR-010）。空字串＝全站。 */
export const TRENDING_LANGS: readonly string[] = ['', 'typescript', 'javascript', 'python', 'rust', 'shell'];

/** 主力來源識別（告警用）。 */
export const TRENDING_SOURCE_ID = 'github-trending';

/** 語言頁的子來源識別（FR-007 要求告警可定位到出錯的子來源）。全站頁記為 `all`。 */
export function trendingPageId(lang: string): string {
  return lang || 'all';
}

function trendingUrl(lang: string): string {
  return lang
    ? `https://github.com/trending/${lang}?since=weekly`
    : 'https://github.com/trending?since=weekly';
}

/** 主力抓取結果：成功合併的候選 ＋ 失敗頁的子來源 id（由 board-builder 逐一告警）。 */
export interface TrendingResult {
  repos: RawTrendingRepo[];
  failedPages: string[];
}

/**
 * 主力：GitHub Trending weekly 爬取（contracts §1、research D1）。
 * 全站＋5 語言頁共 6 頁，`cheerio` 逐 `article.Box-row` 解析「stars this week」。
 * 跨頁先以 `fullName` 去重。
 *
 * **逐頁隔離**（FR-007）：單頁抓取或解析失敗只損失該頁，其餘頁照常合併，失敗頁記入
 * `failedPages` 供告警——否則一頁 404 或一列欄位漂移，就會讓另外 5 頁已解析好的上百筆
 * 候選一起陪葬、主力整個歸零。
 * **全部頁合併後 0 筆** → 擲可辨識錯誤（FR-009，由 board-builder 轉為 `github-trending`
 * 告警），不得靜默當「本週無熱門」。
 */
@Injectable()
export class GithubTrendingService {
  private readonly logger = new Logger(GithubTrendingService.name);

  constructor(private readonly http: GithubHttpService) {}

  async fetchTrending(): Promise<TrendingResult> {
    const byName = new Map<string, RawTrendingRepo>();
    const failedPages: string[] = [];

    for (const lang of TRENDING_LANGS) {
      try {
        const res = await this.http.getText(trendingUrl(lang));
        if (res.notModified) {
          continue; // 條件式請求 304（F2 無前值，不會發生；穩健處理）
        }
        for (const repo of parseTrendingHtml(res.text)) {
          if (!byName.has(repo.fullName)) {
            byName.set(repo.fullName, repo);
          }
        }
      } catch (err) {
        const pageId = trendingPageId(lang);
        failedPages.push(pageId);
        this.logger.warn(`Trending 頁失敗 [${pageId}]：${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const repos = [...byName.values()];
    if (repos.length === 0) {
      throw new Error('Trending 解析 0 筆（疑似頁面改版，不視為本週無熱門）');
    }
    return { repos, failedPages };
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
    // 取數字而非驗 Number.isFinite：非數字文字 replace 後為空字串，Number('') 是 0 不是
    // NaN，用 isFinite 守衛永遠為真——改版把數字挪走時會靜默記成 0 星而非被偵測到。
    const starsDigits = $row.find('.float-sm-right').first().text().replace(/[^0-9]/g, '');

    if (!fullName || !fullName.includes('/') || starsDigits === '') {
      throw new Error('Trending 欄位抽不到（疑似頁面改版：fullName 或 stars this week）');
    }

    const description = normalizeText($row.find('p').first().text());
    const language = normalizeText($row.find('[itemprop="programmingLanguage"]').first().text());

    out.push({
      fullName,
      description: description || null,
      language: language || null,
      starsThisWeek: Number(starsDigits),
    });
  });

  return out;
}

function normalizeText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}
