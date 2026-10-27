import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import {
  GEMINI_MODEL_NEWS,
  GEMINI_MODEL_NEWS_FALLBACK,
  GeminiModel,
  LlmError,
  LlmGenerateOptions,
  NEWS_LLM_TIMEOUT_MS,
  NEWS_MIN_ATTEMPT_MS,
  NEWS_THINKING_LEVEL,
} from '../llm/llm.types';
import { isUnresolved, mentionsBoardRepo } from '../news/funnel';
import { NewsCandidate } from '../news/news.types';
import { detectTopicClusters, summarizeClusters, TopicCluster } from '../news/topic-cluster';
import { fallbackDigest } from './curation-fallback';
import { buildCurationPrompt } from './curation-prompt';
import { CurationParseError, describeIgnoredKeys, describeMalformed, parseCurationResponse } from './curation-parse';
import { CURATION_RESPONSE_JSON_SCHEMA } from './curation-schema';
import { CurationDrop, validateCuration } from './curation-validate';
import { CuratedDigest, CuratedNewsItem, CurationItemView, CurationLlmResponse } from './curation.types';
import {
  buildReplayDigest,
  buildReplayTranslationPrompt,
  parseReplayTranslation,
  REPLAY_TRANSLATION_JSON_SCHEMA,
} from './replay-translation';

/** `generateWithModelFallback()` 的結果：LLM 原文、實際成功的型號、是否經主型號失敗後降級為備援型號。 */
interface ModelFallbackResult {
  raw: string;
  model: GeminiModel;
  fellBack: boolean;
}

/** 單一型號回應的解析結果（2026-10-17，ADR 0006）：成功（可能含形狀不符項）或結構性錯誤的 `reason`。 */
type ParseOutcome = { ok: true; response: CurationLlmResponse } | { ok: false; reason: string };

/** 一次型號呼叫的回應與其解析結果。 */
interface ParsedAttempt {
  raw: string;
  model: GeminiModel;
  outcome: ParseOutcome;
}

/** `resolveResponse()` 最終採用的回應：原文（供 `describeIgnoredKeys`）、解析結果與完成 log 的型號字樣。 */
interface ResolvedResponse {
  raw: string;
  response: CurationLlmResponse;
  modelStr: string;
}

/**
 * 每日單次策展服務（階段 B，FR-001~020）：把 F4 候選集投影為公開脈絡視圖，以**單一**策展
 * prompt 交 `LlmService.generate()` 完成殘留語意去重、依開發者重要性挑選、繁中改寫，再經硬驗證管線
 * 產出恆合規的精選集。空候選短路不呼叫 LLM（FR-020/SC-001）。
 *
 * 失敗處理：主型號擲 `LlmError` → 備援型號重試一次（2026-09-12）；主型號回應解析不完整（結構性錯誤或
 * 任一則形狀不符）→ 同樣改用備援型號重試一次，仍不完整則丟棄壞項、採用可用則數較多的回應（2026-10-17，
 * ADR 0006，見 `resolveResponse`）。皆無可用項目時**不擲錯**，改退回 `fallbackDigest()` 純程式排序降級版，
 * 並以 `logger.warn` 記錄失敗（不含 prompt／回應全文，FR-011/014）。只回傳記憶體結構，**不落檔、不寫
 * `seenNews`、不推播**（FR-019，交 F7）。
 */
@Injectable()
export class NewsCurationService {
  private readonly logger = new Logger(NewsCurationService.name);

  constructor(private readonly llm: LlmService) {}

  async curate(
    candidates: readonly NewsCandidate[],
    boardRepoNames: ReadonlySet<string>,
    now: Date = new Date(),
    recentPushed: readonly string[] = [],
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
          `同題群集 ${clusterSummary.length} 組${clusterStr}，近期已推 ${recentPushed.length} 則供比對`,
      );
      // 每日晨報策展走 `GEMINI_MODEL_NEWS`（2026-09-27 起回 gemini-3.8-flash，見 `llm.types.ts`）並開啟
      // thinking、帶結構化輸出 schema（2026-10-17）；主型號擲 `LlmError` 時改以備援型號重試一次（見
      // `generateWithModelFallback`），主型號回應解析不完整時亦同（見 `resolveResponse`）。
      const prompt = buildCurationPrompt(views, recentPushed);
      const first = await this.generateWithModelFallback(prompt);
      const { raw, response, modelStr } = await this.resolveResponse(prompt, first);
      const { officialPicks, communityPicks, backfillPicks, ignoredKeys } = response;
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
   * 晨報補發的逐則翻譯（2026-10-17 新增，見 `replay-translation.ts`）：候選是當日已推過的項目，**不篩選**，只把
   * 每則補成繁中標題＋內容，順序與則數同當日推播。型號與設定同每日策展（Flash 主、Lite 備援、thinking、結構化
   * 輸出，schema 換成 `REPLAY_TRANSLATION_JSON_SCHEMA`）；主型號回應結構性解析失敗時改用備援重試一次。
   * 未回或形狀不符的項目保留原文標題（`degraded:true`）；兩型號皆失敗則整份原文標題版。不擲錯。
   * 補發是人工觸發的單次動作，額外的這 1～2 次呼叫不屬於每日策展（憲章 V 的「每日一次」指排程晨報）。
   */
  async translateForReplay(candidates: readonly NewsCandidate[]): Promise<CuratedDigest> {
    if (candidates.length === 0) {
      return { items: [], degraded: false };
    }
    const prompt = buildReplayTranslationPrompt(candidates);
    let parsed: ReturnType<typeof parseReplayTranslation> | null = null;
    let modelStr = '';
    try {
      const first = await this.generateWithModelFallback(prompt, REPLAY_TRANSLATION_JSON_SCHEMA);
      modelStr = first.fellBack ? `${first.model}，主型號失敗後降級至備援` : first.model;
      try {
        parsed = parseReplayTranslation(first.raw, candidates.length);
      } catch (err) {
        if (!(err instanceof CurationParseError) || first.fellBack) {
          throw err;
        }
        this.logger.warn(
          `補發翻譯回應解析失敗（${first.model}）：${err.reason}；改以備援型號（${GEMINI_MODEL_NEWS_FALLBACK}）重試一次`,
        );
        const raw = await this.llm.generate(prompt, curationOptions(GEMINI_MODEL_NEWS_FALLBACK, REPLAY_TRANSLATION_JSON_SCHEMA));
        modelStr = `${GEMINI_MODEL_NEWS_FALLBACK}，主型號回應解析失敗後改用備援`;
        parsed = parseReplayTranslation(raw, candidates.length);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`補發翻譯失敗，全部保留原文標題：${reason}（${candidates.length} 則）`);
      return buildReplayDigest(candidates, new Map());
    }
    const digest = buildReplayDigest(candidates, parsed.picks);
    const missing = digest.items.filter((it) => it.degraded).length;
    this.logger.log(
      `補發翻譯完成：${candidates.length} 則 → 翻譯 ${candidates.length - missing} 則` +
        `${missing > 0 ? `、保留原文標題 ${missing} 則` : ''}` +
        `${parsed.skipped > 0 ? `（略過形狀不符／越界／重複 ${parsed.skipped} 則）` : ''}（${modelStr}）`,
    );
    return digest;
  }

  /**
   * 以主型號（`GEMINI_MODEL_NEWS`）送出策展 prompt；若擲 `LlmError`（不論 `reason`：`exhausted`＝429
   * 退避耗盡、`error`＝型號 404 下架等不可重試錯誤、`empty`＝空回應、`timeout`＝10 分鐘期限用盡（2026-10-27，
   * ADR 0009）），記 warn 後改以備援型號
   * （`GEMINI_MODEL_NEWS_FALLBACK`）重送**同一 prompt 一次**；第二次仍失敗才把錯誤拋給呼叫端走降級。
   * 2026-09-27 起回到 Flash → Lite（主 `gemini-3.8-flash`、備援 `gemini-3.5-flash-lite`），兩者皆帶
   * `thinkingLevel: NEWS_THINKING_LEVEL`；09-25～09-27 曾為 Lite 主／Lite 備援（見 `llm.types.ts`）。
   * 2026-10-17 起兩者另帶 `responseJsonSchema`（見 `curationOptions`）。
   *
   * 為何換型號而非同型號再退避：Gemini 免費層配額**按型號分開計算**，主型號 429 耗盡時同型號的
   * 指數退避只是白等，換型號才有機會在當日成功；另本專案已兩度遇到型號無預警下架（404），
   * 該情況同型號重試永遠失敗、也只有換型號有解。
   *
   * 與憲章 V「新聞策展每日僅呼叫 Gemini 一次」的關係：該原則指的是**策展邏輯上一次**（同一
   * prompt、同一份候選），`LlmService.generate()` 既有的退避本就是多次 HTTP 嘗試；失敗日多 1 次
   * Lite 呼叫屬同一策展的重試，不是第二次策展（2026-09-12）。成功日仍嚴格只有 1 次呼叫。
   *
   * 本方法只攔 `LlmError`。解析失敗原本也不換型號（「那是回應內容問題，不是型號問題」），2026-10-17 由
   * 使用者裁決推翻（ADR 0006）：主型號回應解析不完整時改用備援型號重試一次，由 `resolveResponse` 處理；
   * 兩條換型號路徑互斥（本方法已降級為備援者，`resolveResponse` 不再呼叫），故每日最多主型號 1 輪＋
   * 備援 1 輪。
   */
  private async generateWithModelFallback(
    prompt: string,
    schema: Record<string, unknown> = CURATION_RESPONSE_JSON_SCHEMA,
  ): Promise<ModelFallbackResult> {
    try {
      const raw = await this.llm.generate(prompt, curationOptions(GEMINI_MODEL_NEWS, schema));
      return { raw, model: GEMINI_MODEL_NEWS, fellBack: false };
    } catch (err) {
      if (!(err instanceof LlmError)) {
        throw err;
      }
      this.logger.warn(
        `策展主型號失敗（${err.reason}，${GEMINI_MODEL_NEWS}），改以備援型號（${GEMINI_MODEL_NEWS_FALLBACK}）重試一次`,
      );
      const raw = await this.llm.generate(prompt, curationOptions(GEMINI_MODEL_NEWS_FALLBACK, schema));
      return { raw, model: GEMINI_MODEL_NEWS_FALLBACK, fellBack: true };
    }
  }

  /**
   * 解析策展回應並決定採用哪一份（2026-10-17 新增，ADR 0006；2026-10-08 一則形狀不符就讓整份晨報降級的修正）：
   *
   * 1. 第一份回應（`first`）解析成功且無形狀不符項 → 直接採用（成功日的唯一路徑，仍只 1 次呼叫）。
   * 2. 否則 warn「策展回應解析不完整（型號）：診斷」。若 `first` 來自主型號 → 以備援型號同 prompt、同設定
   *    重試**一次**；備援擲 `LlmError` 只 warn、視為無第二份（非 `LlmError` 照常上拋，由呼叫端降級）。
   *    `first` 已是備援（主型號 `LlmError` 降級而來）→ 不再呼叫任何型號。
   * 3. 第二份解析成功且無形狀不符 → 採用。否則在成功解析的回應中取可用則數（三陣列合計）最多者、平手取
   *    第一份，丟棄其形狀不符項並 warn「策展回應丟棄形狀不符 N 則」（明細已在步驟 2 的 warn 印過，不重複）。
   * 4. 皆無成功解析、或可用則數為 0 → 擲 `CurationParseError`，由 `curate()` 外層 catch 走 `fallbackDigest`。
   *
   * 與憲章 V「每日僅呼叫一次」的關係：備援重試是**同一份策展**（同 prompt、同候選）的重試、不是第二次策展；
   * 與 `generateWithModelFallback` 的 `LlmError` 換型號互斥，每日最多主型號 1 輪＋備援 1 輪。
   * 所有 log 只含型號、則數、陣列鍵、索引與鍵的型別，不含 LLM 回應的標題或內容（憲章 VII）。
   */
  private async resolveResponse(prompt: string, first: ModelFallbackResult): Promise<ResolvedResponse> {
    const r1: ParsedAttempt = { raw: first.raw, model: first.model, outcome: tryParse(first.raw) };
    const baseNotes = first.fellBack ? ['主型號失敗後降級至備援'] : [];
    if (r1.outcome.ok && r1.outcome.response.malformed.length === 0) {
      return { raw: r1.raw, response: r1.outcome.response, modelStr: formatModel(r1.model, baseNotes) };
    }

    const nextStep = first.fellBack
      ? '已是備援型號，不再重試'
      : `改以備援型號（${GEMINI_MODEL_NEWS_FALLBACK}）重試一次`;
    this.logger.warn(`策展回應解析不完整（${r1.model}）：${describeOutcome(r1.outcome)}；${nextStep}`);

    let r2: ParsedAttempt | null = null;
    if (!first.fellBack) {
      r2 = await this.retryWithFallbackModel(prompt);
      if (r2 !== null) {
        if (r2.outcome.ok && r2.outcome.response.malformed.length === 0) {
          return {
            raw: r2.raw,
            response: r2.outcome.response,
            modelStr: formatModel(r2.model, ['主型號回應解析不完整後改用備援']),
          };
        }
        this.logger.warn(`策展回應解析不完整（${r2.model}）：${describeOutcome(r2.outcome)}；不再重試`);
      }
    }

    // 逐則搶救：r1 在前，只在 r2 可用則數「嚴格大於」時才取 r2（平手取 r1）。
    let chosen: { attempt: ParsedAttempt; response: CurationLlmResponse } | null = null;
    for (const attempt of [r1, r2]) {
      if (attempt === null || !attempt.outcome.ok) continue;
      const response = attempt.outcome.response;
      if (chosen === null || usableCount(response) > usableCount(chosen.response)) {
        chosen = { attempt, response };
      }
    }
    if (chosen === null || usableCount(chosen.response) === 0) {
      throw new CurationParseError('主備型號回應皆無可用項目');
    }

    const notes = [...baseNotes];
    if (chosen.attempt === r2) notes.push('主型號回應解析不完整後改用備援');
    const dropped = chosen.response.malformed.length;
    if (dropped > 0) {
      notes.push(`已丟棄形狀不符 ${dropped} 則`);
      this.logger.warn(
        `策展回應丟棄形狀不符 ${dropped} 則：採用 ${chosen.attempt.model} 回應的可用 ` +
          `${usableCount(chosen.response)} 則（明細見上方「策展回應解析不完整（${chosen.attempt.model}）」）`,
      );
    }
    return { raw: chosen.attempt.raw, response: chosen.response, modelStr: formatModel(chosen.attempt.model, notes) };
  }

  /**
   * 主型號回應解析不完整時的備援重試（2026-10-17，ADR 0006）：同 prompt、同 thinking、同 schema。
   * 備援擲 `LlmError` → warn 後回 `null`（由呼叫端搶救主型號回應）；其他錯誤照常上拋。
   */
  private async retryWithFallbackModel(prompt: string): Promise<ParsedAttempt | null> {
    try {
      const raw = await this.llm.generate(prompt, curationOptions(GEMINI_MODEL_NEWS_FALLBACK));
      return { raw, model: GEMINI_MODEL_NEWS_FALLBACK, outcome: tryParse(raw) };
    } catch (err) {
      if (!(err instanceof LlmError)) {
        throw err;
      }
      this.logger.warn(
        `策展備援重試失敗（${err.reason}，${GEMINI_MODEL_NEWS_FALLBACK}），改為搶救主型號回應的可用項目`,
      );
      return null;
    }
  }
}

/**
 * 策展呼叫的 `generate` 選項：指定型號＋thinking（2026-09-27）＋結構化輸出 schema（2026-10-17，ADR 0006）＋10 分鐘總期限、
 * 剩不到 2 分鐘不重送（2026-10-27，ADR 0009）。
 * 主、備援（含解析失敗的備援重試）一律相同，只換型號。
 */
function curationOptions(
  model: GeminiModel,
  schema: Record<string, unknown> = CURATION_RESPONSE_JSON_SCHEMA,
): LlmGenerateOptions {
  return {
    model,
    thinkingLevel: NEWS_THINKING_LEVEL,
    responseJsonSchema: schema,
    timeoutMs: NEWS_LLM_TIMEOUT_MS,
    minAttemptMs: NEWS_MIN_ATTEMPT_MS,
  };
}

/** 解析回應；結構性錯誤（`CurationParseError`）轉為 `{ ok: false }`，其他例外照常上拋。 */
function tryParse(raw: string): ParseOutcome {
  try {
    return { ok: true, response: parseCurationResponse(raw) };
  } catch (err) {
    if (err instanceof CurationParseError) {
      return { ok: false, reason: err.reason };
    }
    throw err;
  }
}

/** 解析不完整的診斷：結構性錯誤印 `reason`；否則「形狀不符 N 則：<describeMalformed>」。 */
function describeOutcome(outcome: ParseOutcome): string {
  if (!outcome.ok) return outcome.reason;
  const { malformed } = outcome.response;
  return `形狀不符 ${malformed.length} 則：${describeMalformed(malformed)}`;
}

/** 可用則數：三陣列中通過形狀驗證的項目合計（硬驗證前）。 */
function usableCount(response: CurationLlmResponse): number {
  return response.officialPicks.length + response.communityPicks.length + response.backfillPicks.length;
}

/** 完成 log 的型號字樣：`型號`，有附註時為 `型號，附註1，附註2`。 */
function formatModel(model: GeminiModel, notes: readonly string[]): string {
  return [model, ...notes].join('，');
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
