import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { GEMINI_MODEL_NEWS, GEMINI_MODEL_NEWS_FALLBACK, GeminiModel, LlmError, NEWS_THINKING_LEVEL } from '../llm/llm.types';
import { isUnresolved, mentionsBoardRepo } from '../news/funnel';
import { NewsCandidate } from '../news/news.types';
import { detectTopicClusters, summarizeClusters, TopicCluster } from '../news/topic-cluster';
import { fallbackDigest } from './curation-fallback';
import { buildCurationPrompt } from './curation-prompt';
import { describeIgnoredKeys, parseCurationResponse } from './curation-parse';
import { CurationDrop, validateCuration } from './curation-validate';
import { CuratedDigest, CuratedNewsItem, CurationItemView } from './curation.types';

/** `generateWithModelFallback()` 的結果：LLM 原文、實際成功的型號、是否經主型號失敗後降級為備援型號。 */
interface ModelFallbackResult {
  raw: string;
  model: GeminiModel;
  fellBack: boolean;
}

/**
 * 每日單次策展服務（階段 B，FR-001~020）：把 F4 候選集投影為公開脈絡視圖，以**單一**
 * `LlmService.generate()` 完成殘留語意去重、依開發者重要性挑選、繁中改寫，再經硬驗證管線
 * 產出恆合規的精選集。空候選短路不呼叫 LLM（FR-020/SC-001）。策展的 LLM 呼叫或解析失敗時
 * **不擲錯**，改退回 `fallbackDigest()` 純程式排序降級版，並以 `logger.warn` 記錄失敗（不含
 * prompt／回應全文，FR-011/014）。只回傳記憶體結構，**不落檔、不寫 `seenNews`、不推播**
 * （FR-019，交 F7）。
 */
@Injectable()
export class NewsCurationService {
  private readonly logger = new Logger(NewsCurationService.name);

  constructor(private readonly llm: LlmService) {}

  async curate(
    candidates: readonly NewsCandidate[],
    boardRepoNames: ReadonlySet<string>,
    now: Date = new Date(),
  ): Promise<CuratedDigest> {
    if (candidates.length === 0) {
      return { items: [], degraded: false };
    }

    try {
      // 同題群集（零 LLM，2026-09-25）：同一罕見詞跨來源多則出現 → 投影為「🔥同題」前綴，配合「未歸類」
      // 候選讓 LLM 把「多方同時討論同一陌生名詞」讀成新崛起訊號（見 `topic-cluster.ts`）。
      const clusters = detectTopicClusters(candidates);
      const views = candidates.map((c, ref) =>
        projectItemView(c, ref, boardRepoNames, now, clusters.get(c.normalizedUrl) ?? null),
      );
      const clusterSummary = summarizeClusters(clusters);
      const clusterStr =
        clusterSummary.length > 0
          ? `（${clusterSummary.map((k) => `「${k.token}」×${k.count}/${k.sourceCount} 來源`).join('、')}）`
          : '';
      this.logger.log(
        `策展輸入：${candidates.length} 候選，未歸類高熱度 ${candidates.filter(isUnresolved).length} 則，` +
          `同題群集 ${clusterSummary.length} 組${clusterStr}`,
      );
      // 每日晨報策展走 `GEMINI_MODEL_NEWS`（2026-09-27 起回 gemini-3.8-flash，見 `llm.types.ts`）並開啟
      // thinking；主型號擲 `LlmError` 時改以備援型號重試一次（見 `generateWithModelFallback`）。
      const { raw, model, fellBack } = await this.generateWithModelFallback(buildCurationPrompt(views));
      const { officialPicks, communityPicks, backfillPicks, ignoredKeys } = parseCurationResponse(raw);
      if (ignoredKeys.length > 0) {
        // 防禦：LLM 自創鍵（如 externalPicks）會被解析器靜默忽略而無聲少推；只警示鍵名與陣列長度，
        // 不含回應全文（憲章 VII），流程照常繼續、不降級（2026-09-12 新增）
        this.logger.warn(
          `策展回應含未知頂層鍵，已忽略（可能無聲少推）：${describeIgnoredKeys(raw, ignoredKeys)}`,
        );
      }
      const drops: CurationDrop[] = [];
      const defaulted: string[] = [];
      const rerouted: string[] = [];
      const items = validateCuration(
        officialPicks,
        communityPicks,
        candidates,
        (d) => drops.push(d),
        (ref, title) => defaulted.push(`ref=${ref}「${clampTitle(title)}」`),
        backfillPicks,
        (ref, title) =>
          rerouted.push(`ref=${ref} ${candidates[ref].sourceId}/${candidates[ref].domain}「${clampTitle(title)}」`),
      );
      if (rerouted.length > 0) {
        // 已歸類候選被放進補位陣列（2026-09-27）：程式已回流主桶套配額，這裡只揭露 LLM 分類錯誤、不降級。
        this.logger.warn(`補位陣列含已歸類候選，已回流主桶套配額：${rerouted.join(' ')}`);
      }
      if (defaulted.length > 0) {
        // 未歸類候選被選入但 LLM 未回填合法 domain（2026-09-25）：程式已預設 ai，這裡只揭露、不降級。
        this.logger.warn(`未歸類候選未回填 domain、預設 ai：${defaulted.join(' ')}`);
      }
      if (drops.length > 0) {
        // 驗證剔除揭露（2026-09-14 新增）：此前 ref 越界／重複、來源分散、非 AI 上限、總數截斷的剔除
        // 全無 log，實測連兩日「選 N → 驗證後 N−1」無從判斷是幻覺還是配額夾掉。只印階段、ref、
        // 來源與截短標題，不含回應全文（憲章 VII）；流程照常繼續、不降級。
        this.logger.warn(`策展驗證剔除 ${drops.length} 則：${describeDrops(drops)}`);
      }
      const domainDist = items.reduce(
        (acc, it) => {
          acc[it.domain] = (acc[it.domain] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );
      const domainStr = Object.entries(domainDist).map(([d, c]) => `${d}:${c}`).join(' / ');
      const modelStr = fellBack ? `${model}，主型號失敗後降級至備援` : model;
      this.logger.log(
        `新聞策展完成：${candidates.length} 候選 → LLM 選官方 ${officialPicks.length} 則＋社群 ` +
        `${communityPicks.length} 則＋補位 ${backfillPicks.length} 則 → 驗證後 ${items.length} 則（${domainStr}）（${modelStr}）`,
      );
      if (items.length > 0) {
        // 入選清單揭露（2026-09-27 新增）：此前 log 只有則數，要知道「推了什麼、漏了什麼」得去 state 分支翻
        // seenNews 對照候選池。只印領域、代表來源與截短標題，不含 LLM 回應全文（憲章 VII）。
        this.logger.log(`策展入選 ${items.length} 則：${describeItems(items)}`);
      }
      return { items, degraded: false };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`新聞策展失敗，退回降級路徑：${reason}（候選數 ${candidates.length}）`);
      return fallbackDigest(candidates);
    }
  }

  /**
   * 以主型號（`GEMINI_MODEL_NEWS`）送出策展 prompt；若擲 `LlmError`（不論 `reason`：`exhausted`＝429
   * 退避耗盡、`error`＝型號 404 下架等不可重試錯誤、`empty`＝空回應），記 warn 後改以備援型號
   * （`GEMINI_MODEL_NEWS_FALLBACK`）重送**同一 prompt 一次**；第二次仍失敗才把錯誤拋給呼叫端走降級。
   * 2026-09-27 起回到 Flash → Lite（主 `gemini-3.8-flash`、備援 `gemini-3.5-flash-lite`），兩者皆帶
   * `thinkingLevel: NEWS_THINKING_LEVEL`；09-25～09-27 曾為 Lite 主／Lite 備援（見 `llm.types.ts`）。
   *
   * 為何換型號而非同型號再退避：Gemini 免費層配額**按型號分開計算**，主型號 429 耗盡時同型號的
   * 指數退避只是白等，換型號才有機會在當日成功；另本專案已兩度遇到型號無預警下架（404），
   * 該情況同型號重試永遠失敗、也只有換型號有解。
   *
   * 與憲章 V「新聞策展每日僅呼叫 Gemini 一次」的關係：該原則指的是**策展邏輯上一次**（同一
   * prompt、同一份候選），`LlmService.generate()` 既有的退避本就是多次 HTTP 嘗試；失敗日多 1 次
   * Lite 呼叫屬同一策展的重試，不是第二次策展（2026-09-12）。成功日仍嚴格只有 1 次呼叫。
   *
   * 只攔 `LlmError`：解析／驗證失敗（`CurationParseError` 等）發生在本方法回傳之後，不觸發換型號
   * ——那是回應內容問題，不是型號問題。
   */
  private async generateWithModelFallback(prompt: string): Promise<ModelFallbackResult> {
    try {
      const raw = await this.llm.generate(prompt, { model: GEMINI_MODEL_NEWS, thinkingLevel: NEWS_THINKING_LEVEL });
      return { raw, model: GEMINI_MODEL_NEWS, fellBack: false };
    } catch (err) {
      if (!(err instanceof LlmError)) {
        throw err;
      }
      this.logger.warn(
        `策展主型號失敗（${err.reason}，${GEMINI_MODEL_NEWS}），改以備援型號（${GEMINI_MODEL_NEWS_FALLBACK}）重試一次`,
      );
      const raw = await this.llm.generate(prompt, { model: GEMINI_MODEL_NEWS_FALLBACK, thinkingLevel: NEWS_THINKING_LEVEL });
      return { raw, model: GEMINI_MODEL_NEWS_FALLBACK, fellBack: true };
    }
  }
}

/**
 * 投影候選為公開脈絡視圖（只含公開資料，FR-007）。
 * `domain`：三桶之一，或 `cross`＝「未歸類高熱度」候選（2026-09-25 起候選集可含，見 `funnel.ts`；
 * prompt 顯示為「未歸類」、由 LLM 回填領域，`curation-validate.ts` 落定）。
 * `cluster`：同題群集資訊（`topic-cluster.ts`），無則 `null`。
 */
function projectItemView(
  c: NewsCandidate,
  ref: number,
  boardRepoNames: ReadonlySet<string>,
  now: Date,
  cluster: TopicCluster | null,
): CurationItemView {
  return {
    ref,
    title: c.title,
    domain: c.domain,
    tier: c.tier,
    score: c.score,
    sourceCount: c.sources.length,
    onBoard: mentionsBoardRepo(c, boardRepoNames),
    summaryExcerpt: c.summary,
    ageDays: ageInDays(c.publishedAt, now),
    cluster,
  };
}

const DAY_MS = 86_400_000;

/** 發表天齡：整數天、未來時間夾為 0；缺失或無法解析回 `null`（不回 0，0 會被誤讀為「今天」）。 */
function ageInDays(publishedAt: string | null, now: Date): number | null {
  if (publishedAt === null) {
    return null;
  }
  const t = Date.parse(publishedAt);
  if (Number.isNaN(t)) {
    return null;
  }
  return Math.max(0, Math.floor((now.getTime() - t) / DAY_MS));
}

/**
 * 驗證剔除的 log 摘要（2026-09-14 新增）：每則「階段 ref=N 來源／領域「截短標題」」，標題截 30 code
 * points 只為辨識，不含回應全文（憲章 VII）。`invalid-ref` 無法對回候選，只印 ref 與標題。
 */
export function describeDrops(drops: readonly CurationDrop[]): string {
  return drops
    .map((d) => {
      const title = d.title ? `「${clampTitle(d.title)}」` : '';
      const origin = d.sourceId ? ` ${d.sourceId}/${d.domain}` : '';
      return `[${d.stage} ref=${d.ref}${origin}${title}]`;
    })
    .join(' ');
}

/**
 * 入選清單的 log 摘要（2026-09-27 新增）：每則「[領域 代表來源「截短標題」]」，順序即推播順序。標題為 LLM 改寫的
 * 繁中標題截 30 code points，只為辨識，不含回應全文（憲章 VII）。
 */
export function describeItems(items: readonly CuratedNewsItem[]): string {
  return items.map((it) => `[${it.domain} ${it.sourceId}「${clampTitle(it.title)}」]`).join(' ');
}

function clampTitle(title: string): string {
  const cps = Array.from(title);
  return cps.length <= 30 ? title : `${cps.slice(0, 30).join('')}…`;
}
