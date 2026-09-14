import { NewsCandidate, NewsDomain3 } from '../news/news.types';
import { clampToLimit } from './curation-length';
import { clampNonAi, clampSourceDiversity, effectiveNonAiCap, isAi, MAX_ITEMS } from './curation-quota';
import { CuratedNewsItem, CurationLlmPick } from './curation.types';

interface ResolvedPick {
  ref: number;
  title: string;
  content: string;
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
export type CurationDropStage = 'invalid-ref' | 'duplicate-ref' | 'source-diversity' | 'non-ai-cap' | 'max-items';

/** 驗證管線剔除的一則：`ref` 為 LLM 回傳值（`invalid-ref` 時可能越界）；其餘欄位僅在 `ref` 可對回候選時提供。 */
export interface CurationDrop {
  stage: CurationDropStage;
  ref: number;
  sourceId?: string;
  domain?: NewsDomain3;
  title?: string;
}

/** F4 `CandidateSet` 輸出不變式：`domain !== 'cross'`（I1 決策 B，信任已驗收上游契約、不另加執行期防衛過濾）。 */
function domainOf(it: ResolvedPick): NewsDomain3 {
  return it.candidate.domain as NewsDomain3;
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
 * (3) 依領域優先序夾非 AI ≤`effectiveNonAiCap`（DevOps 優先，AI 不受限；預設 ≤3，AI 則數不足 7
 *     時放寬至 `10 − AI 則數`，2026-08-04 新增，憲章 v1.6.0）
 * (4) 依合併後順序（官方優先、各組內保留重要性序）截總數 ≤10——官方候選若本身已達 10 則，
 *     社群熱度會在這步被完全截掉，這正是結構性保證的體現
 * (5) `title`/`content` 收斂至 ≤70/≤500 code points
 *
 * 每則以 `ref` 對回候選附上程式提供的事實（`url`/`domain`/`sourceId`/`sources`/`sourceCount`/
 * `weightedScore`），`degraded:false`（憲章 VI 防幻覺，FR-006/009）。
 *
 * `onDrop`（選填，2026-09-14 新增）：每剔除一則即回呼一次並標明階段。此前 (1)～(4) 的剔除全無
 * 訊號，實測連兩日「LLM 選 N 則 → 驗證後 N−1 則」卻無從判斷是幻覺、重複還是配額夾掉；呼叫端
 * （`NewsCurationService`）彙整成一行 warn。本函式維持純函式，不直接持有 logger。
 */
export function validateCuration(
  officialPicks: readonly CurationLlmPick[],
  communityPicks: readonly CurationLlmPick[],
  candidates: readonly NewsCandidate[],
  onDrop?: (drop: CurationDrop) => void,
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
    resolved.push({ ref: pick.ref, title: pick.title, content: pick.content, candidate: candidates[pick.ref] });
  }

  const nonAiPoolSize = candidates.filter((c) => !isAi(c.domain as NewsDomain3)).length;
  const diversified = clampSourceDiversity(resolved, domainOf, (it) => it.candidate.sources, nonAiPoolSize);
  reportRemoved('source-diversity', resolved, diversified, onDrop);
  const aiCount = diversified.filter((it) => isAi(domainOf(it))).length;
  const clamped = clampNonAi(diversified, domainOf, effectiveNonAiCap(aiCount));
  reportRemoved('non-ai-cap', diversified, clamped, onDrop);
  const limited = clamped.slice(0, MAX_ITEMS);
  reportRemoved('max-items', clamped, limited, onDrop);

  return limited.map((it) => ({
    title: clampToLimit(it.title, 70),
    content: clampToLimit(it.content, 500),
    url: it.candidate.originalUrl,
    domain: domainOf(it),
    sourceId: it.candidate.sourceId,
    sources: [...it.candidate.sources], // 淺拷貝：精選項落檔後不與候選陣列共用參照（2026-09-12 新增）
    sourceCount: it.candidate.sources.length,
    weightedScore: it.candidate.weightedScore,
    degraded: false,
  }));
}
