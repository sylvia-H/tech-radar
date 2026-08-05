import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiCallCounts } from '../board/board.types';

/** 自訂 User-Agent（所有請求皆帶；抓取禮貌，憲章 VII / research D9）。 */
export const USER_AGENT = 'tech-radar/1.0 (+github-actions; personal)';

const API_ACCEPT = 'application/vnd.github+json';
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 200;
const MAX_BACKOFF_MS = 8000;
/** 逼近限額門檻：低於此值即在下次請求前退避（core 5000/hr、search 30/min，護欄用）。 */
const RATE_LIMIT_THRESHOLD: Record<'core' | 'search', number> = { core: 50, search: 3 };
/** `GET /repos` 批次有限並發上限（避免 secondary rate limit，FR-008）。 */
export const MAX_CONCURRENCY = 6;

/** GitHub 回應非 2xx（且非 304）時擲出，攜帶狀態碼供呼叫端分流（如 401/403 告警門檻）。 */
export class GithubHttpError extends Error {
  constructor(public readonly status: number) {
    super(`GitHub 請求失敗，HTTP ${status}`);
    this.name = 'GithubHttpError';
  }
}

/** 條件式請求前值（F2 不持久化、執行期無前值可帶 → 實為 no-op；介面留供 F5+ 復用）。 */
export interface Conditional {
  etag?: string | null;
  lastModified?: string | null;
}

/** HTML 抓取結果（Trending）。 */
export interface TextResult {
  text: string;
  status: number;
  etag: string | null;
  lastModified: string | null;
  notModified: boolean;
}

/**
 * GitHub 對外請求的唯一薄客戶端：自訂 UA、Bearer 認證（僅 API）、條件式請求、
 * 失敗（5xx/429/網路）指數退避＋jitter、有限並發、rate-limit 監看、core/search 呼叫計數。
 *
 * 機密：`GH_API_TOKEN` 只從 env 讀、只放進 Authorization header；**絕不**寫入 log／
 * 錯誤訊息／任何產物（憲章 VII）。錯誤訊息不含 URL 與 token。
 */
@Injectable()
export class GithubHttpService {
  private readonly logger = new Logger(GithubHttpService.name);
  private core = 0;
  private search = 0;
  /** 上次某類別 rate-limit 逼近門檻 → 下次同類請求前退避。 */
  private readonly low: Record<'core' | 'search', boolean> = { core: false, search: false };

  constructor(private readonly config: ConfigService) {}

  /** 重置本次執行的呼叫計數（每次 build() 前呼叫）。 */
  resetCounts(): void {
    this.core = 0;
    this.search = 0;
    this.low.core = false;
    this.low.search = false;
  }

  /** 本次累計 core／search 呼叫數（供 SC-006 觀測）。 */
  get counts(): ApiCallCounts {
    return { core: this.core, search: this.search };
  }

  private get token(): string {
    const t = this.config.get<string>('GH_API_TOKEN');
    if (!t) {
      throw new Error('GH_API_TOKEN 未設定');
    }
    return t;
  }

  /**
   * 帶認證的 GitHub API JSON 請求（core 或 search）。每次邏輯呼叫計數一次（重試不重複計）。
   * 失敗（重試耗盡）擲錯，訊息只含狀態碼、不含 URL/token。
   *
   * 計數在**送出前**累加：失敗的呼叫一樣吃掉限額，若只計成功數，SC-006 的用量觀測會在
   * 最需要它的失敗場景下低估實際消耗。
   */
  async getJson<T>(url: string, kind: 'core' | 'search' = 'core'): Promise<T> {
    if (kind === 'search') {
      this.search += 1;
    } else {
      this.core += 1;
    }
    const res = await this.requestWithRetry(
      url,
      {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: API_ACCEPT,
          Authorization: `Bearer ${this.token}`,
        },
      },
      kind,
    );
    this.noteRateLimit(res, kind);
    return (await res.json()) as T;
  }

  /**
   * 公開網頁 HTML 抓取（Trending，不帶 token）。支援條件式請求（有前值才帶對應 header）；
   * 304 回 `notModified=true`、`text=''`。不計入 API 呼叫數（github.com 網頁）。
   */
  async getText(url: string, conditional?: Conditional): Promise<TextResult> {
    const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
    if (conditional?.etag) {
      headers['If-None-Match'] = conditional.etag;
    }
    if (conditional?.lastModified) {
      headers['If-Modified-Since'] = conditional.lastModified;
    }
    const res = await this.requestWithRetry(url, { method: 'GET', headers }, null);
    const etag = res.headers.get('etag');
    const lastModified = res.headers.get('last-modified');
    if (res.status === 304) {
      return { text: '', status: 304, etag, lastModified, notModified: true };
    }
    return { text: await res.text(), status: res.status, etag, lastModified, notModified: false };
  }

  /**
   * 有限並發地映射（≤ limit，預設 MAX_CONCURRENCY）；保序回傳，避免 secondary rate limit。
   */
  async mapLimited<I, O>(
    items: readonly I[],
    fn: (item: I, index: number) => Promise<O>,
    limit: number = MAX_CONCURRENCY,
  ): Promise<O[]> {
    return mapWithConcurrency(items, fn, limit);
  }

  /**
   * 送出請求並在 5xx/429/網路錯誤時指數退避＋jitter 重試；逼近 rate-limit 時先退避。
   * `kind` 為 null 表非 API（Trending 網頁），不做 rate-limit 節流。
   */
  private async requestWithRetry(
    url: string,
    init: RequestInit,
    kind: 'core' | 'search' | null,
  ): Promise<Response> {
    if (kind && this.low[kind]) {
      this.logger.warn(`GitHub ${kind} 逼近限額，請求前退避`);
      await this.delay(this.backoffMs(1));
      this.low[kind] = false;
    }

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, init);
      } catch {
        // 網路層錯誤：消毒後退避重試，絕不夾帶 URL/token（憲章 VII）。
        if (attempt < MAX_RETRIES) {
          await this.delay(this.backoffMs(attempt));
          continue;
        }
        throw new Error('GitHub 請求失敗：網路錯誤');
      }

      if (res.ok || res.status === 304) {
        return res;
      }

      if (isThrottled(res) || res.status >= 500) {
        if (attempt < MAX_RETRIES) {
          const wait = this.retryAfterMs(res) ?? this.backoffMs(attempt);
          this.logger.warn(`GitHub 回應 HTTP ${res.status}，第 ${attempt}/${MAX_RETRIES} 次退避 ${wait}ms`);
          await this.delay(wait);
          continue;
        }
        // 退避耗盡：擲錯，只含狀態碼。
        throw new GithubHttpError(res.status);
      }

      // 其餘 4xx（401/憑證型 403/404/422…）：不重試，擲帶狀態碼的錯誤。
      throw new GithubHttpError(res.status);
    }
    // 不可達（迴圈必定 return 或 throw）。
    throw new Error('GitHub 請求失敗：重試耗盡');
  }

  /**
   * 讀 `X-RateLimit-Remaining`，低於門檻則標記下次同類請求前退避。
   * header 缺席時直接略過：`Number(null)` 為 0（不是 NaN），逕自轉數字會把「沒有這個
   * header」誤判成「剩餘 0、逼近限額」，白白退避並印出假警告。
   */
  private noteRateLimit(res: Response, kind: 'core' | 'search'): void {
    const header = res.headers.get('x-ratelimit-remaining');
    if (header === null) {
      return;
    }
    const remaining = Number(header);
    if (Number.isFinite(remaining) && remaining <= RATE_LIMIT_THRESHOLD[kind]) {
      this.low[kind] = true;
      this.logger.warn(`GitHub ${kind} rate-limit 剩餘 ${remaining}，逼近門檻`);
    }
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

/**
 * 此回應是否為「限流」而非「憑證／權限」問題（決定該不該退避重試）。
 *
 * GitHub 的 secondary rate limit 與限額耗盡都可能回 **403**（非只有 429），辨識特徵是
 * 帶 `Retry-After` 或 `X-RateLimit-Remaining: 0`。少了這道判斷，`GET /repos` 批次一旦
 * 觸發 secondary limit 就會整批不重試地失敗，還被 `shouldAlertRepoFailures` 依 403 誤報
 * 成憑證問題。純憑證型 403（無這些 header）仍照舊直接擲錯、不重試。
 */
export function isThrottled(res: Response): boolean {
  if (res.status === 429) {
    return true;
  }
  if (res.status !== 403) {
    return false;
  }
  return res.headers.has('retry-after') || res.headers.get('x-ratelimit-remaining') === '0';
}

/**
 * 有限並發映射（純函式，可獨立測）：同時最多 `limit` 個 in-flight，保序回傳。
 */
export async function mapWithConcurrency<I, O>(
  items: readonly I[],
  fn: (item: I, index: number) => Promise<O>,
  limit: number,
): Promise<O[]> {
  const results: O[] = new Array(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) {
        return;
      }
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
