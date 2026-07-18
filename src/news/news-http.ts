import { Injectable, Logger } from '@nestjs/common';

/**
 * 自訂 User-Agent（抓取禮貌，憲章 VII / FR-009）。與 `github-http` 分開命名，語意獨立。
 */
export const NEWS_USER_AGENT = 'tech-radar/1.0 (+github-actions; personal news reader)';

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 200;
const MAX_BACKOFF_MS = 8000;

/** 非 2xx（且非 304）時擲出，攜帶狀態碼供呼叫端分流。 */
export class NewsHttpError extends Error {
  constructor(
    public readonly status: number,
    url: string,
  ) {
    // 新聞 feed 皆公開、不帶 token，錯誤訊息可含 URL 以利定位失敗來源（research D3 / Q1）。
    super(`新聞來源請求失敗，HTTP ${status}：${url}`);
    this.name = 'NewsHttpError';
  }
}

/** 條件式請求前值（F4 執行期不持久化 ETag → 實為 no-op；介面留供日後強化，與 github-http 一致）。 */
export interface Conditional {
  etag?: string | null;
  lastModified?: string | null;
}

/** 文字抓取結果（RSS/Atom feed）。 */
export interface TextResult {
  text: string;
  status: number;
  etag: string | null;
  lastModified: string | null;
  notModified: boolean;
}

/**
 * 新聞 feed 的通用薄客戶端：自訂 UA、可選條件式請求、5xx/429/網路錯誤指數退避＋jitter。
 * **host 無關、不帶任何 token**（公開 feed，憲章 VII）；鏡射 `github-http` 的退避邏輯。
 *
 * 與 `github-http` 的差異：無 Bearer 認證、無 rate-limit 監看（各站限額不一，靠退避即可），
 * 且錯誤訊息**可含 URL**（無機密外洩風險，利於定位失敗來源）。
 */
@Injectable()
export class NewsHttp {
  private readonly logger = new Logger(NewsHttp.name);

  /** 抓取文字型 feed（RSS/Atom）。304 回 `notModified=true`、`text=''`。 */
  async getText(url: string, conditional?: Conditional): Promise<TextResult> {
    const headers: Record<string, string> = { 'User-Agent': NEWS_USER_AGENT };
    if (conditional?.etag) {
      headers['If-None-Match'] = conditional.etag;
    }
    if (conditional?.lastModified) {
      headers['If-Modified-Since'] = conditional.lastModified;
    }
    const res = await this.requestWithRetry(url, { method: 'GET', headers });
    const etag = res.headers.get('etag');
    const lastModified = res.headers.get('last-modified');
    if (res.status === 304) {
      return { text: '', status: 304, etag, lastModified, notModified: true };
    }
    return { text: await res.text(), status: res.status, etag, lastModified, notModified: false };
  }

  /** 抓取 JSON 型端點（HN Algolia）。 */
  async getJson<T>(url: string): Promise<T> {
    const res = await this.requestWithRetry(url, {
      method: 'GET',
      headers: { 'User-Agent': NEWS_USER_AGENT, Accept: 'application/json' },
    });
    return (await res.json()) as T;
  }

  /**
   * 送出請求並在 5xx/429/網路錯誤時指數退避＋jitter 重試；退避耗盡擲 `NewsHttpError`。
   */
  private async requestWithRetry(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, init);
      } catch {
        if (attempt < MAX_RETRIES) {
          await this.delay(this.backoffMs(attempt));
          continue;
        }
        throw new Error(`新聞來源請求失敗：網路錯誤：${url}`);
      }

      if (res.ok || res.status === 304) {
        return res;
      }

      if (res.status === 429 || res.status >= 500) {
        if (attempt < MAX_RETRIES) {
          const wait = this.retryAfterMs(res) ?? this.backoffMs(attempt);
          this.logger.warn(`新聞來源回應 HTTP ${res.status}，第 ${attempt}/${MAX_RETRIES} 次退避 ${wait}ms`);
          await this.delay(wait);
          continue;
        }
        throw new NewsHttpError(res.status, url);
      }

      // 其餘 4xx（404/410…）：不重試，擲帶狀態碼的錯誤。
      throw new NewsHttpError(res.status, url);
    }
    // 不可達（迴圈必定 return 或 throw）。
    throw new Error(`新聞來源請求失敗：重試耗盡：${url}`);
  }

  /** 429 的 Retry-After（秒）→ 毫秒；無則回 null（改用指數退避）。 */
  private retryAfterMs(res: Response): number | null {
    const header = res.headers.get('retry-after');
    const seconds = header ? Number(header) : NaN;
    if (Number.isFinite(seconds)) {
      return Math.min(Math.ceil(seconds * 1000), MAX_BACKOFF_MS);
    }
    return null;
  }

  /** 指數退避＋jitter：base × 2^(attempt-1) + [0, base) 隨機，上限 MAX_BACKOFF_MS。 */
  private backoffMs(attempt: number): number {
    const exp = BACKOFF_BASE_MS * 2 ** (attempt - 1);
    const jitter = Math.floor(Math.random() * BACKOFF_BASE_MS);
    return Math.min(exp + jitter, MAX_BACKOFF_MS);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
