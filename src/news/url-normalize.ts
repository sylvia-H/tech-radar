/**
 * target-URL 正規化（去重主鍵，FR-011 / SC-009）。純函式、無 I/O。
 *
 * 規則：scheme／host 小寫、去 `www.`、移除追蹤參數（`utm_*`／`mc_*`／`ref`／`fbclid`／`gclid`…）、
 * 其餘 query 依鍵值排序（順序無關的同資源得相同鍵）、統一去結尾斜線（root 保留 `/`）、去 fragment。
 * 指向同一資源者 → 相同鍵（SC-009）。
 *
 * **短網址網路解址刻意不做**（contract 定 url-normalize 為純函式、無 I/O）：真正解址需發請求，
 * 與抓取禮貌／零維運牴觸；`t.co`／`bit.ly` 等只做結構正規化。殘留的短網址重複為已知且有界的
 * 缺點，交由 F6 單次 LLM 順手清除（spec Edge：不為解址發起昂貴或不可靠請求）。
 */
export function normalizeTargetUrl(raw: string): string {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    // 非合法絕對 URL（理論上不會發生——fetcher 皆給絕對連結）：原樣回傳，仍讓完全相同者去重。
    return trimmed;
  }

  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.hash = '';

  const kept = [...url.searchParams.entries()]
    .filter(([key]) => !isTrackingParam(key))
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  url.search = '';
  for (const [key, value] of kept) {
    url.searchParams.append(key, value);
  }

  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }

  return url.toString();
}

/** 精確比對的追蹤參數（前綴類另判）。 */
const TRACKING_EXACT = new Set(['ref', 'ref_src', 'fbclid', 'gclid', 'igshid', 'ncid', 'spm', 'cmpid']);

function isTrackingParam(key: string): boolean {
  const k = key.toLowerCase();
  return k.startsWith('utm_') || k.startsWith('mc_') || TRACKING_EXACT.has(k);
}
