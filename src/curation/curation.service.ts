import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { GEMINI_MODEL_BOARD, GEMINI_MODEL_NEWS, GeminiModel, LlmError } from '../llm/llm.types';
import { mentionsBoardRepo } from '../news/funnel';
import { NewsCandidate, NewsDomain3 } from '../news/news.types';
import { fallbackDigest } from './curation-fallback';
import { buildCurationPrompt } from './curation-prompt';
import { describeIgnoredKeys, parseCurationResponse } from './curation-parse';
import { validateCuration } from './curation-validate';
import { CuratedDigest, CurationItemView } from './curation.types';

/** `generateWithModelFallback()` 的結果：LLM 原文、實際成功的型號、是否經 Flash 失敗後降級為 Lite。 */
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
      const views = candidates.map((c, ref) => projectItemView(c, ref, boardRepoNames, now));
      // 每日晨報策展改用 Flash（`GEMINI_MODEL_NEWS`，2026-09-12 起）；簡介與榜單 TL;DR 仍走預設 Lite。
      // Flash 擲 `LlmError` 時改以 Lite 重試一次（見 `generateWithModelFallback`）。
      const { raw, model, fellBack } = await this.generateWithModelFallback(buildCurationPrompt(views));
      const { officialPicks, communityPicks, ignoredKeys } = parseCurationResponse(raw);
      if (ignoredKeys.length > 0) {
        // 防禦：LLM 自創鍵（如 externalPicks）會被解析器靜默忽略而無聲少推；只警示鍵名與陣列長度，
        // 不含回應全文（憲章 VII），流程照常繼續、不降級（2026-09-12 新增）
        this.logger.warn(
          `策展回應含未知頂層鍵，已忽略（可能無聲少推）：${describeIgnoredKeys(raw, ignoredKeys)}`,
        );
      }
      const items = validateCuration(officialPicks, communityPicks, candidates);
      const domainDist = items.reduce(
        (acc, it) => {
          acc[it.domain] = (acc[it.domain] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );
      const domainStr = Object.entries(domainDist).map(([d, c]) => `${d}:${c}`).join(' / ');
      const modelStr = fellBack ? `${model}，Flash 失敗後降級` : model;
      this.logger.log(
        `新聞策展完成：${candidates.length} 候選 → LLM 選官方 ${officialPicks.length} 則＋社群 ` +
        `${communityPicks.length} 則 → 驗證後 ${items.length} 則（${domainStr}）（${modelStr}）`,
      );
      return { items, degraded: false };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`新聞策展失敗，退回降級路徑：${reason}（候選數 ${candidates.length}）`);
      return fallbackDigest(candidates);
    }
  }

  /**
   * 以 Flash（`GEMINI_MODEL_NEWS`）送出策展 prompt；若擲 `LlmError`（不論 `reason`：`exhausted`＝429
   * 退避耗盡、`error`＝型號 404 下架等不可重試錯誤、`empty`＝空回應），記 warn 後改以 Lite
   * （`GEMINI_MODEL_BOARD`）重送**同一 prompt 一次**；第二次仍失敗才把錯誤拋給呼叫端走降級。
   *
   * 為何換型號而非同型號再退避：Gemini 免費層配額**按型號分開計算**，Flash 429 耗盡時同型號的
   * 指數退避只是白等，換 Lite 才有機會在當日成功；另本專案已兩度遇到型號無預警下架（404），
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
      const raw = await this.llm.generate(prompt, { model: GEMINI_MODEL_NEWS });
      return { raw, model: GEMINI_MODEL_NEWS, fellBack: false };
    } catch (err) {
      if (!(err instanceof LlmError)) {
        throw err;
      }
      this.logger.warn(
        `Flash 策展失敗（${err.reason}，${GEMINI_MODEL_NEWS}），改以 Lite（${GEMINI_MODEL_BOARD}）重試一次`,
      );
      const raw = await this.llm.generate(prompt, { model: GEMINI_MODEL_BOARD });
      return { raw, model: GEMINI_MODEL_BOARD, fellBack: true };
    }
  }
}

/**
 * 投影候選為公開脈絡視圖（只含公開資料，FR-007）。
 * `domain`：F4 `CandidateSet` 輸出不變式 `domain !== 'cross'`（I1 決策 B，信任已驗收上游契約、
 * 不另加執行期防衛過濾；若不變式破壞，`cross` 落 `isAi()=false` → 計非 AI，屬已知有界缺點）。
 */
function projectItemView(
  c: NewsCandidate,
  ref: number,
  boardRepoNames: ReadonlySet<string>,
  now: Date,
): CurationItemView {
  return {
    ref,
    title: c.title,
    domain: c.domain as NewsDomain3,
    tier: c.tier,
    score: c.score,
    sourceCount: c.sources.length,
    onBoard: mentionsBoardRepo(c, boardRepoNames),
    summaryExcerpt: c.summary,
    ageDays: ageInDays(c.publishedAt, now),
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
