import { NewsCandidate, NewsDigestDomain, NewsDomain3 } from '../news/news.types';
import { clampToLimit } from './curation-length';
import { clampNonAi, clampSourceDiversity, effectiveNonAiCap, isAi, MAX_ITEMS } from './curation-quota';
import { CuratedNewsItem, CurationLlmPick } from './curation.types';

interface ResolvedPick {
  ref: number;
  title: string;
  content: string;
  /** LLM 回填的領域（僅「未歸類」候選需要，2026-09-25 新增；其餘候選帶了也忽略）。 */
  domain?: NewsDomain3;
  candidate: NewsCandidate;
}

/**
 * 驗證管線剔除一則的階段（2026-09-14 新增）：
 * - `invalid-ref`：`ref` 非整數／越界（幻覺項）
 * - `duplicate-ref`：同一 `ref` 重複出現（保留第一次）
 * - `source-diversity`：非 AI 同來源 >2 被夾掉
 * - `non-ai-cap`：非 AI 超過 `effectiveNonAiCap` 被夾掉
 * - `max-items`：總數截 ≤10 被截掉
 */
export type CurationDropStage =
  | 'invalid-ref'
  | 'duplicate-ref'
  | 'source-diversity'
  | 'non-ai-cap'
  | 'max-items'
  | 'backfill-scope'
  | 'backfill-full';

/** 驗證管線剔除的一則：`ref` 為 LLM 回傳值（`invalid-ref` 時可能越界）；其餘欄位僅在 `ref` 可對回候選時提供。 */
export interface CurationDrop {
  stage: CurationDropStage;
  ref: number;
  sourceId?: string;
  domain?: NewsDomain3;
  title?: string;
}

/**
 * 領域落定：候選為「未歸類」（`domain === 'cross'`，2026-09-25 起候選集可含，見 `funnel.ts`）時採 LLM
 * 回填的 `domain`，未回填則預設 `ai`（未歸類通道的設計目標是 AI 側的新崛起事物，且 AI 不受配額上限、
 * 不會因預設值誤佔非 AI 名額）；其餘候選沿用程式歸類的領域，LLM 帶的 `domain` 一律忽略（憲章 VI：
 * 程式已知的事實不交 LLM 覆寫）。
 */
function domainOf(it: ResolvedPick): NewsDomain3 {
  if (it.candidate.domain === 'cross') {
    return it.domain ?? 'ai';
  }
  return it.candidate.domain;
}

function toDrop(stage: CurationDropStage, it: ResolvedPick): CurationDrop {
  return { stage, ref: it.ref, sourceId: it.candidate.sourceId, domain: domainOf(it), title: it.title };
}

/** 回報 `before` 中不在 `after` 裡的項目（依 `ref` 判定）為該階段的剔除。 */
function reportRemoved(
  stage: CurationDropStage,
  before: readonly ResolvedPick[],
  after: readonly ResolvedPick[],
  onDrop: ((drop: CurationDrop) => void) | undefined,
): void {
  if (!onDrop || before.length === after.length) {
    return;
  }
  const kept = new Set(after.map((it) => it.ref));
  for (const it of before) {
    if (!kept.has(it.ref)) {
      onDrop(toDrop(stage, it));
    }
  }
}

/**
 * 硬驗證管線（FR-008~010，固定順序，research D5）：只在「LLM 已選且已繁中改寫」的集合內
 * 剔除／重排，永不遞補新候選（FR-005/010）。
 *
 * (0) 合併 `officialPicks`＋`communityPicks`（`officialPicks` 固定排在 `communityPicks` 之前，
 *     2026-08-04 新增——見 `curation.types.ts` `CurationLlmResponse` docstring：這是把「官方優先」
 *     從純 prompt 敘述指示，改為合併順序的結構性保證，不再只靠 LLM 自行依序執行。兩陣列歸屬
 *     2026-09-12 起：`officialPicks`＝(1) 官方發布＋(3) 影響開發者的外部事件；`communityPicks`＝
 *     (2) 技術深度內容（先前稱社群熱度）；合併順序不變）
 * (1) 剔除幻覺項（`ref` 越界／非整數）＋重複 `ref` 去重（保留第一次出現，即較高重要性者）
 * (2) 非 AI 候選池夠大時，夾非 AI 同來源 ≤2（`clampSourceDiversity`，2026-08-04 新增）
 * (3) 依領域優先序夾非 AI ≤`effectiveNonAiCap`（DevOps 優先，AI 不受限；預設 ≤5，AI 則數不足 10
 *     時放寬至 `15 − AI 則數`，2026-08-04 新增，憲章 v1.6.0；2026-09-25 憲章 v1.7.0 由 3／7／10 調整）
 * (4) 依合併後順序（官方優先、各組內保留重要性序）截總數 ≤15——官方候選若本身已達 15 則，
 *     社群熱度會在這步被完全截掉，這正是結構性保證的體現
 * (5) `title`/`content` 收斂至 ≤70/≤500 code points
 *
 * 每則以 `ref` 對回候選附上程式提供的事實（`url`/`domain`/`sourceId`/`sources`/`sourceCount`/
 * `weightedScore`），`degraded:false`（憲章 VI 防幻覺，FR-006/009）。
 *
 * `onDrop`（選填，2026-09-14 新增）：每剔除一則即回呼一次並標明階段。此前 (1)～(4) 的剔除全無
 * 訊號，實測連兩日「LLM 選 N 則 → 驗證後 N−1 則」卻無從判斷是幻覺、重複還是配額夾掉；呼叫端
 * （`NewsCurationService`）彙整成一行 warn。本函式維持純函式，不直接持有 logger。
 *
 * `onDomainDefaulted`（選填，2026-09-25 新增）：「未歸類」候選被選入但 LLM 未回填合法 `domain`、
 * 程式以 `ai` 補上時回呼一次（`domainOf`），供呼叫端 warn——prompt 已要求回填，靜默補值會讓 prompt
 * 失效無感。
 *
 * (6) `backfillPicks`（選填，2026-09-26 新增，憲章 1.8.0）：「資安與一般軟體工程」補位項，在 (1)～(5)
 *     完成**之後**才處理，只補到總數 `MAX_ITEMS` 為止，領域一律記為 `general`、不計入非 AI 配額。
 *     只接受「未歸類」候選（`domain === 'cross'`）：已歸類候選屬三桶範圍，該走前兩陣列，放進補位陣列者
 *     以 `backfill-scope` 剔除；ref 越界／與前兩陣列重複同 (1) 處理；名額已滿者以 `backfill-full` 剔除。
 *     因補位項永遠排在最後，三桶精選不會被它擠掉——這是「AI 為主」的結構性保證。
 */
export function validateCuration(
  officialPicks: readonly CurationLlmPick[],
  communityPicks: readonly CurationLlmPick[],
  candidates: readonly NewsCandidate[],
  onDrop?: (drop: CurationDrop) => void,
  onDomainDefaulted?: (ref: number, title: string) => void,
  backfillPicks: readonly CurationLlmPick[] = [],
): CuratedNewsItem[] {
  const picks = [...officialPicks, ...communityPicks];
  const seenRefs = new Set<number>();
  const resolved: ResolvedPick[] = [];
  for (const pick of picks) {
    if (!Number.isInteger(pick.ref) || pick.ref < 0 || pick.ref >= candidates.length) {
      onDrop?.({ stage: 'invalid-ref', ref: pick.ref, title: pick.title });
      continue;
    }
    if (seenRefs.has(pick.ref)) {
      onDrop?.(toDrop('duplicate-ref', { ref: pick.ref, title: pick.title, content: pick.content, candidate: candidates[pick.ref] }));
      continue;
    }
    seenRefs.add(pick.ref);
    const candidate = candidates[pick.ref];
    if (candidate.domain === 'cross' && pick.domain === undefined) {
      onDomainDefaulted?.(pick.ref, pick.title);
    }
    resolved.push({ ref: pick.ref, title: pick.title, content: pick.content, domain: pick.domain, candidate });
  }

  const nonAiPoolSize = candidates.filter((c) => !isAi(c.domain as NewsDomain3)).length;
  const diversified = clampSourceDiversity(resolved, domainOf, (it) => it.candidate.sources, nonAiPoolSize);
  reportRemoved('source-diversity', resolved, diversified, onDrop);
  const aiCount = diversified.filter((it) => isAi(domainOf(it))).length;
  const clamped = clampNonAi(diversified, domainOf, effectiveNonAiCap(aiCount));
  reportRemoved('non-ai-cap', diversified, clamped, onDrop);
  const limited = clamped.slice(0, MAX_ITEMS);
  reportRemoved('max-items', clamped, limited, onDrop);

  const main = limited.map((it) => toItem(it, domainOf(it)));
  const backfill: CuratedNewsItem[] = [];
  for (const pick of backfillPicks) {
    if (!Number.isInteger(pick.ref) || pick.ref < 0 || pick.ref >= candidates.length) {
      onDrop?.({ stage: 'invalid-ref', ref: pick.ref, title: pick.title });
      continue;
    }
    const candidate = candidates[pick.ref];
    const it: ResolvedPick = { ref: pick.ref, title: pick.title, content: pick.content, candidate };
    if (seenRefs.has(pick.ref)) {
      onDrop?.(toDrop('duplicate-ref', it));
      continue;
    }
    seenRefs.add(pick.ref);
    if (candidate.domain !== 'cross') {
      onDrop?.(toDrop('backfill-scope', it));
      continue;
    }
    if (main.length + backfill.length >= MAX_ITEMS) {
      onDrop?.({ ...toDrop('backfill-full', it), domain: undefined });
      continue;
    }
    backfill.push(toItem(it, 'general'));
  }
  return [...main, ...backfill];
}

/** 解析後的單則 → 精選輸出（事實欄位由程式自候選帶入，憲章 VI）。 */
function toItem(it: ResolvedPick, domain: NewsDigestDomain): CuratedNewsItem {
  return {
    title: clampToLimit(it.title, 70),
    content: clampToLimit(it.content, 500),
    url: it.candidate.originalUrl,
    domain,
    sourceId: it.candidate.sourceId,
    sources: [...it.candidate.sources], // 淺拷貝：精選項落檔後不與候選陣列共用參照（2026-09-12 新增）
    sourceCount: it.candidate.sources.length,
    weightedScore: it.candidate.weightedScore,
    degraded: false,
  };
}
