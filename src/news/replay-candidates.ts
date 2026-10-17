import { NEWS_SOURCES } from '../config/news-sources';
import { SeenNewsEntry } from '../state/state.schema';
import { NewsCandidate, NewsDomain, NewsSource, NewsTier } from './news.types';

/**
 * 晨報補發（2026-10-17 新增，`NEWS_REPLAY_DATE`）的候選重建純函式。
 *
 * 用途：某日晨報策展降級（推出原文標題、無翻譯摘要版）後，原始候選池已無法重建（HN 視窗只有 4 天、
 * RSS 早已滾動），唯一留存的事實是當日推播後寫入 `state.seenNews` 的條目（url／來源／領域／原始標題）。
 * 本模組把這些條目還原為 `NewsCandidate`，交 `NewsCurationService.curate()` 重新策展出翻譯摘要版；
 * 只讀 `seenNews`、不寫任何狀態（憲章 VI，寫回與否由呼叫端決定——補發一律不寫）。
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** 台北時區固定偏移（UTC+8，台灣無夏令時；與 `taipeiDateLabel` 同口徑）。 */
const TAIPEI_OFFSET_HOURS = 8;

/**
 * 查不到來源設定時的 tier 預設值：補發的 sourceId 可能已自 `news-sources.ts` 移除或改名（或舊條目缺
 * sourceId）。取 2 是因為 Tier 2 在漏斗權重中與 Tier 1 同為 1（`tierWeight`），對 LLM 投影是中性值，
 * 不會無故把該則拉高（Tier 1）或打成低權重（Tier 3）。
 */
const FALLBACK_TIER: NewsTier = 2;

const REPLAY_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * 驗證並正規化補發日期（台北日期 `YYYY-MM-DD`）。格式不合或非真實日期（如 `2026-02-30`）一律擲錯——
 * 補發為人工觸發，錯誤不吞，讓 workflow 失敗並送告警（比照乾跑）。
 */
export function parseReplayDate(raw: string): string {
  const value = raw.trim();
  const m = REPLAY_DATE_PATTERN.exec(value);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const probe = new Date(Date.UTC(y, mo - 1, d));
    if (probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d) {
      return value;
    }
  }
  throw new Error(`NEWS_REPLAY_DATE 格式不合法（須為台北日期 YYYY-MM-DD）：「${raw}」`);
}

/** 台北日 `date` 對應的 UTC 半開區間 `[start, end)`（毫秒）：台北 00:00 ＝ 前一日 UTC 16:00。 */
export function taipeiDayRange(date: string): { start: number; end: number } {
  const start = Date.parse(`${parseReplayDate(date)}T00:00:00.000Z`) - TAIPEI_OFFSET_HOURS * HOUR_MS;
  return { start, end: start + DAY_MS };
}

/**
 * 取 `seenAt` 落在台北日 `date`（UTC+8 的 00:00～24:00，半開區間）且帶 `title` 的條目，**保持陣列順序**
 * ——推播時依 `digest.items` 順序 append，故陣列順序即當日推播順序。無 `title` 者（2026-10-06 前寫入的
 * 舊條目）沒有可供改寫的標題，略過。
 */
export function seenEntriesOnTaipeiDate(
  entries: readonly SeenNewsEntry[],
  date: string,
): Array<SeenNewsEntry & { title: string }> {
  const { start, end } = taipeiDayRange(date);
  return entries.filter((e): e is SeenNewsEntry & { title: string } => {
    if (!e.title) return false;
    const t = Date.parse(e.seenAt);
    return t >= start && t < end;
  });
}

/**
 * 條目領域 → 候選領域：三桶之一直接沿用；`general`（補位項）或缺席 → `cross`＝「未歸類」，交 LLM 判定
 * （`general` 只是策展輸出端的補位標記，候選端沒有此值；以 `cross` 重入策展，補位規則可再次作用）。
 */
function toCandidateDomain(domain: SeenNewsEntry['domain']): NewsDomain {
  return domain === 'ai' || domain === 'devops' || domain === 'frontend-backend' ? domain : 'cross';
}

/**
 * 把台北日 `date` 已推的 `seenNews` 條目重建為策展候選（順序＝當日推播順序）。
 *
 * 只能還原程式留存的事實：`summary`／`score`／`publishedAt` 皆無紀錄，一律 `null`（LLM 只看得到標題，
 * 內容依標題改寫）；`weightedScore` 依原順序遞減（N…1），僅作排序輔助、非事實數據（憲章 VI）。
 * `tier` 依 sourceId 查來源設定，查不到用 `FALLBACK_TIER`。
 */
export function candidatesFromSeen(
  entries: readonly SeenNewsEntry[],
  date: string,
  sources: readonly NewsSource[] = NEWS_SOURCES,
): NewsCandidate[] {
  const picked = seenEntriesOnTaipeiDate(entries, date);
  const tierById = new Map(sources.map((s) => [s.id, s.tier]));
  return picked.map((e, i) => {
    // 帶 title 的條目（2026-10-06 起）必帶 sourceId（2026-09-12 起），缺席僅為防禦；'unknown' 查不到 tier → 預設值。
    const sourceId = e.sourceId ?? 'unknown';
    return {
      title: e.title,
      normalizedUrl: e.url,
      originalUrl: e.url,
      summary: null,
      sourceId,
      score: null,
      domain: toCandidateDomain(e.domain),
      tier: tierById.get(sourceId) ?? FALLBACK_TIER,
      sources: e.sources && e.sources.length > 0 ? [...e.sources] : [sourceId],
      publishedAt: null,
      weightedScore: picked.length - i,
    };
  });
}
