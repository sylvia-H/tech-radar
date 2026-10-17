import { SeenNewsEntry } from '../state/state.schema';

const DAY_MS = 86_400_000;

/**
 * 近期已推標題投影進策展 prompt 的回看天數（2026-10-17 新增，ADR 0007）。設為 0 即關閉投影（退場開關，只改此常數）。
 *
 * 取 5 天（使用者決策，Agent 原提 7 天）：10-07～10-17 跨日同題重推的間隔多為 1～4 天（Deno×Cloudflare、Python 3.15、
 * Gemini 4 Argo、LFM2.5、Void、AdFection 各 1 天，OpenCode 2.0 4 天）；天數越長 prompt 越大，5 天已涵蓋主要情況。
 */
export const RECENT_PUSHED_WINDOW_DAYS = 5;

/** 每則已推標題投影時的長度上限（code points）：只供比對是否同一件事，標題前段已足夠。 */
export const RECENT_PUSHED_TITLE_MAX = 60;

/** 投影則數上限：5 天約 70 則，上限 100 只防異常日把 prompt 撐大（Flash 失敗率顧慮，ADR 0007）。 */
export const RECENT_PUSHED_MAX = 100;

/**
 * 取近 `windowDays` 天內帶原始標題的已推紀錄（2026-10-06 起落檔才有 `title`），新到舊排序、同標題去重、截長、限量，
 * 供策展 prompt 的「近期已推報導」段落讓 LLM 判斷候選是否為已報導過的同一件事（ADR 0005 候補方案、ADR 0007）。
 * 只投影程式落檔的候選原始標題（公開資料，憲章 VII），不投影 URL。純函式、`now` 注入。
 */
export function recentPushedTitles(
  seen: readonly SeenNewsEntry[],
  now: Date,
  windowDays: number = RECENT_PUSHED_WINDOW_DAYS,
  maxTitles: number = RECENT_PUSHED_MAX,
): string[] {
  if (windowDays <= 0 || maxTitles <= 0) {
    return [];
  }
  const cutoff = now.getTime() - windowDays * DAY_MS;
  const recent = seen
    .map((e) => ({ title: e.title?.trim() ?? '', at: Date.parse(e.seenAt) }))
    .filter((e) => e.title.length > 0 && Number.isFinite(e.at) && e.at >= cutoff && e.at <= now.getTime())
    .sort((a, b) => b.at - a.at);
  const titles: string[] = [];
  const seenTitles = new Set<string>();
  for (const { title } of recent) {
    const clamped = clampTitle(title);
    if (seenTitles.has(clamped)) continue;
    seenTitles.add(clamped);
    titles.push(clamped);
    if (titles.length >= maxTitles) break;
  }
  return titles;
}

function clampTitle(title: string): string {
  const cps = Array.from(title);
  return cps.length <= RECENT_PUSHED_TITLE_MAX ? title : `${cps.slice(0, RECENT_PUSHED_TITLE_MAX).join('')}…`;
}
