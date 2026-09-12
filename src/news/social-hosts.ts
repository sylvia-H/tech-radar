/**
 * 社群平台 host 過濾清單（2026-09-12，分支 3 `fix/hn-noise`）。**過濾規則資料檔：增刪只改此檔、
 * 不動 `news-ingest.service` 的過濾邏輯**（比照 `news-domain-keywords.ts`，憲章 IV 精神）。
 *
 * 證據：HN 高分投稿常直接指向 twitter／mastodon 貼文——2026-09-12 候選池 50 席中有 3 則
 * （`twitter.com` 的「I resigned from Anthropic today」、`mathstodon.xyz` 兩則）。理由：
 * (1) 貼文本身多為個人動態／短評，非技術內容；(2) RSS 與 HN 皆無摘要（`summary === null`），
 * LLM 只能憑標題判斷，極易以「熱門」誤判為「重要」。故於漏斗 A 直接丟棄，不交由 LLM 評選。
 *
 * 兩層規則：`SOCIAL_PLATFORM_HOSTS` 為 host 或其子網域（後綴比對，如 `mobile.twitter.com`），
 * `SOCIAL_PLATFORM_HOST_PATTERNS` 補抓未列入的 Mastodon／Misskey 類實例慣用命名（`mastodon.*`／
 * `mstdn.*` 一律交由 pattern 層，精確清單不重複列入）。短網址（`t.co` 等）刻意不列——不解址即
 * 無法得知目標（見 `url-normalize` 純函式約束），交由後段處理。
 *
 * 代價：僅在 X／Mastodon 發布的一手公告（模型上線、API 變更、事故說明）若 HN 投稿指向該貼文是
 * 唯一入口，會在漏斗最前端整則消失，已知且接受、觀察兩週。逃生門：過濾套用於**全部**來源的候選，
 * 日後若在 `news-sources.ts` 新增以這些 host 為目標連結的來源，會被此規則無聲全滅（症狀：來源
 * 解析 N 則、社群過濾後大量減少），屆時在本檔加 allowlist 或把過濾限定於 `hn`。
 */
export const SOCIAL_PLATFORM_HOSTS: readonly string[] = [
  'twitter.com',
  'x.com',
  'bsky.app',
  'threads.com',
  'threads.net',
  'mathstodon.xyz',
  'fosstodon.org',
  'hachyderm.io',
  'infosec.exchange',
  'mas.to',
  'toot.community',
  'ioc.exchange',
];

/** 以 host 片段比對的 pattern：抓 `mastodon.<anything>`／`mstdn.<anything>` 一類自架實例。 */
export const SOCIAL_PLATFORM_HOST_PATTERNS: readonly RegExp[] = [
  /(^|\.)mastodon\./,
  /(^|\.)mstdn\./,
];

/**
 * 判斷連結是否指向社群平台貼文。純函式、無 I/O。
 * hostname 小寫並去 `www.` 後：精確命中、子網域命中（`host.endsWith('.' + h)`）或 pattern 命中
 * → `true`；URL 無法解析 → `false`（交由後段照常處理，不在此誤殺）。
 */
export function isSocialPlatformUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url.trim()).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return false;
  }
  if (SOCIAL_PLATFORM_HOSTS.some((h) => host === h || host.endsWith('.' + h))) {
    return true;
  }
  return SOCIAL_PLATFORM_HOST_PATTERNS.some((re) => re.test(host));
}
