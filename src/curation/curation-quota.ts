import { NewsDomain3 } from '../news/news.types';

/** 精選集總數上限（憲章 III、FR-004）。 */
export const MAX_ITEMS = 10;

/** 非 AI（devops + frontend-backend）合計上限（憲章 III、FR-004）。 */
export const MAX_NON_AI = 3;

/**
 * AI 候選足夠時的軟性下限（僅供 T012 prompt 引用組字樣，程式硬驗證管線不強制填滿，
 * FR-004/005：候選不足照實輸出、不硬湊）。
 */
export const MIN_AI = 5;

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
