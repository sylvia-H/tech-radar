import { NewsDomain3 } from '../news/news.types';

/** 精選集總數上限（憲章 III、FR-004）。 */
export const MAX_ITEMS = 10;

/** 非 AI（devops + frontend-backend）合計上限（憲章 III、FR-004）。 */
export const MAX_NON_AI = 3;

/**
 * 非 AI 同一來源最多入選則數（避免候選池夠大時，單一來源吃滿非 AI 名額、排擠其他來源）。
 * 2026-08-04 新增：起因 cloudflare-blog 主題週單日投稿量大，曾一次佔滿當日非 AI 全部 3 則。
 */
export const MAX_PER_SOURCE_NON_AI = 2;

/** 是否為 AI 領域（配額分類依 `candidate.domain`，research D4）。 */
export function isAi(domain: NewsDomain3): boolean {
  return domain === 'ai';
}

/**
 * 夾非 AI 合計 ≤`max`：非 AI 數量超過上限時，依領域優先序（DevOps 優先，同領域內保留
 * picks 原順序＝重要性序）保留前 `max` 則、其餘剔除；AI 項目不受此步限制、不改變其相對順序
 * （research D5、FR-010）。
 */
export function clampNonAi<T>(
  items: readonly T[],
  domainOf: (item: T) => NewsDomain3,
  max: number = MAX_NON_AI,
): T[] {
  const nonAi = items.filter((it) => !isAi(domainOf(it)));
  if (nonAi.length <= max) {
    return [...items];
  }
  const devopsFirst = [
    ...nonAi.filter((it) => domainOf(it) === 'devops'),
    ...nonAi.filter((it) => domainOf(it) === 'frontend-backend'),
  ];
  const kept = new Set(devopsFirst.slice(0, max));
  return items.filter((it) => isAi(domainOf(it)) || kept.has(it));
}

/**
 * 非 AI 同來源上限：僅在非 AI **候選池**（`nonAiPoolSize`，指候選集大小、非入選數）大於
 * `MAX_NON_AI` 時才生效——代表當天存在其他來源可能被排擠，才值得為多樣性犧牲則數；候選池
 * 本就不足以撐滿非 AI 名額時，不特別限制單一來源（2026-08-04 決策：候選不足時沒必要為了
 * 多樣性平白減少則數）。生效時依原順序（重要性序）逐一計數，同一 `sourceId` 累計達 `max`
 * 即剔除該則、不遞補其他候選（比照 `clampNonAi` 的裁切哲學）；AI 項目不受影響。
 */
export function clampSourceDiversity<T>(
  items: readonly T[],
  domainOf: (item: T) => NewsDomain3,
  sourcesOf: (item: T) => readonly string[],
  nonAiPoolSize: number,
  max: number = MAX_PER_SOURCE_NON_AI,
): T[] {
  if (nonAiPoolSize <= MAX_NON_AI) {
    return [...items];
  }
  const countBySource = new Map<string, number>();
  const kept: T[] = [];
  for (const it of items) {
    if (isAi(domainOf(it))) {
      kept.push(it);
      continue;
    }
    const srcs = sourcesOf(it);
    if (srcs.some((s) => (countBySource.get(s) ?? 0) >= max)) {
      continue;
    }
    for (const s of srcs) {
      countBySource.set(s, (countBySource.get(s) ?? 0) + 1);
    }
    kept.push(it);
  }
  return kept;
}
