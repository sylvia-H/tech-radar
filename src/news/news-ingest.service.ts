import { Injectable, Logger } from '@nestjs/common';
import { DiscordWebhookService } from '../discord/discord.webhook.service';
import { bestEffortFailureAlert } from '../discord/best-effort-alert';
import { StateStore } from '../state/state.store';
import { BoardState, SeenNewsEntry } from '../state/state.schema';
import { NEWS_SOURCES } from '../config/news-sources';
import { NewsCandidate, NewsDomain3, NewsSource, RawItem } from './news.types';
import { NewsHttp } from './news-http';
import { FetcherContext, FetchResult, FETCHERS, NewsRssParser } from './fetchers/fetcher';
import { normalizeTargetUrl } from './url-normalize';
import { dedupByTitle, dedupByUrl } from './dedup';
import { TITLE_JACCARD_THRESHOLD } from './title-similarity';
import { classifyCross } from './news-classify';
import { DEFAULT_FUNNEL_CONFIG, isFreshEnough, isUnresolved, runFunnel } from './funnel';
import { excludeSeen, pruneSeenNews } from './seen-news';
import { formatCandidateSet } from './news-log';
import { isSocialPlatformUrl } from './social-hosts';

/**
 * 階段 A 編排器（@Injectable）：載入設定 → 逐源隔離抓取＋正規化 → 社群平台連結過濾
 * （2026-09-12 起，於 URL 去重前）→ URL 去重 → 新鮮度視窗
 * （無分數者，2026-09-12 起提前至標題去重前）→ 標題 Jaccard 去重 → `cross` 歸類（無命中但高熱度者
 * 以 `cross` 保留，2026-09-25 起）→ 排除 seen → 漏斗過濾/加權/排序/收斂 → 候選集＋觀測 log。
 * （排除 seen 於收斂前，避免已見項佔用 `convergeMax` 名額而排擠新鮮候選。）
 *
 * **邊界（本 Feature）**：只產出候選供觀測，**不呼叫 LLM、不推播、不寫回 `seenNews`**
 * （寫回屬 F6/F7 推播成功後）。只經 `StateStore.load()` 讀取狀態並在**記憶體**修剪（憲章 VI）。
 * 逐源 try/catch 隔離、0 筆／失敗發帶 `id` 告警（憲章 IV/VII，FR-025/026）。
 */
@Injectable()
export class NewsIngestService {
  private readonly logger = new Logger(NewsIngestService.name);

  constructor(
    private readonly http: NewsHttp,
    private readonly parser: NewsRssParser,
    private readonly discord: DiscordWebhookService,
    private readonly stateStore: StateStore,
  ) {}

  /**
   * 產出階段 A 候選集。`now` 注入以驅動各 fetcher 的時間視窗（HN 近 4 天，2026-09-12 起）、
   * seen 修剪、新鮮度決勝（不依賴真實時間）。
   * `boardRepoNames` 未給時由 `state.board` 建立（空 → 榜單相關性加權安全略過，FR-018）。
   * `seenNews` 未給時由 `state.seenNews` 取得；F7 pipeline 開頭已 `load()` 過共享 `state`，兩者
   * 皆傳入即可**免去本服務重複 `stateStore.load()`**（僅在缺任一參數時才回退讀盤）。
   */
  async ingest(
    now: Date = new Date(),
    boardRepoNames?: ReadonlySet<string>,
    sources: readonly NewsSource[] = NEWS_SOURCES,
    seenNews?: readonly SeenNewsEntry[],
  ): Promise<NewsCandidate[]> {
    const ctx: FetcherContext = { now, http: this.http, parser: this.parser };
    const raw = await this.collect(sources, ctx);
    this.logger.log(`[漏斗 A] 原始候選：${raw.length} 則`);

    // 社群平台連結（twitter／x／bsky／mastodon 實例…）於 URL 去重前直接丟（2026-09-12）：貼文本身
    // 多為個人動態、非技術內容，且 HN／RSS 皆無摘要、LLM 只能憑標題判斷。放在去重前的理由：這類
    // URL 不會與任何一手來源同 URL，先丟不影響交叉驗證。清單見 `social-hosts.ts`（資料檔）。
    let cands = raw.filter((c) => !isSocialPlatformUrl(c.originalUrl));
    this.logger.log(`[漏斗 A] 社群平台連結過濾後：${cands.length} 則（-${raw.length - cands.length}）`);

    const beforeUrlDedup = cands.length;
    cands = dedupByUrl(cands);
    this.logger.log(`[漏斗 A] URL 去重後：${cands.length} 則（-${beforeUrlDedup - cands.length}）`);

    // 新鮮度視窗提前至標題去重之前、但在 URL 去重之後（2026-09-12）：無分數者（`score === null`）
    // `publishedAt` 缺失或超出 `freshnessWindowDays` 即丟；有分數者（HN）豁免。否則封存舊文（如
    // openai-blog feed 含整站 1192 篇）會在標題 Jaccard 去重時吞掉其他來源的新文章，代表項落在
    // 舊文後再被漏斗內視窗整則丟掉。放在 URL 去重之後的理由：URL 精確比對合併的必是同一篇文章、
    // 不可能誤吞，先合併才能讓「低分 HN 投稿 ＋ 同 URL 官方舊文」以有分數的 HN 為代表項通過本步，
    // 再靠交叉驗證豁免門檻入池；若提前到 URL 去重前，官方舊文先被丟、HN 單筆再被門檻丟，整則消失。
    // 視窗依來源而定（2026-09-21）：`freshnessWindowDays` 可逐來源縮短；URL 合併的候選取其各來源視窗的
    // **最大值**——另一來源也收錄同一篇，代表它仍有討論價值，不應被較短的視窗丟掉。
    const windowOf = sourceWindowLookup(sources);
    const beforeFresh = cands.length;
    cands = cands.filter((c) => c.score !== null || isFreshEnough(c, now, windowOf(c)));
    this.logger.log(`[漏斗 A] 新鮮度視窗後：${cands.length} 則（-${beforeFresh - cands.length}）`);

    const beforeTitleDedup = cands.length;
    cands = dedupByTitle(cands, TITLE_JACCARD_THRESHOLD);
    this.logger.log(`[漏斗 A] 標題去重後：${cands.length} 則（-${beforeTitleDedup - cands.length}）`);

    const beforeDomainResolve = cands.length;
    cands = this.resolveDomains(cands, sources);
    this.logger.log(`[漏斗 A] 領域歸類後：${cands.length} 則（-${beforeDomainResolve - cands.length}）`);

    let board = boardRepoNames;
    let seen = seenNews;
    if (board === undefined || seen === undefined) {
      // 只要有任一參數未提供才讀盤（獨立 CLI，state 已在別處 load 時避免重複讀取＋zod 解析）。
      const state = await this.stateStore.load();
      board ??= boardRepoNameSet(state.board);
      seen ??= state.seenNews;
    }

    // 先排除已見（收斂前）：避免已見項佔用漏斗 convergeMax 名額、排擠排名其後的新鮮候選。
    const pruned = pruneSeenNews(seen, now);
    const beforeExcluded = cands.length;
    cands = excludeSeen(cands, pruned);
    this.logger.log(`[漏斗 A] 排除已見後：${cands.length} 則（-${beforeExcluded - cands.length}）`);

    const beforeFunnel = cands.length;
    const unresolvedBeforeFunnel = cands.filter(isUnresolved).length;
    cands = runFunnel(cands, board, DEFAULT_FUNNEL_CONFIG, now);
    this.logger.log(`[漏斗 A] 漏斗後最終：${cands.length} 則（-${beforeFunnel - cands.length}）`);
    const unresolvedAdmitted = cands.filter(isUnresolved).length;
    this.logger.log(
      `[漏斗 A] 未歸類高熱度入池：${unresolvedAdmitted} 則（名額 ${DEFAULT_FUNNEL_CONFIG.unresolvedMaxCount}，` +
        `名額外剔除 ${unresolvedBeforeFunnel - unresolvedAdmitted} 則）`,
    );

    this.logger.log('\n' + formatCandidateSet(cands));
    return cands;
  }

  /**
   * 逐源隔離抓取＋正規化（FR-025/026）。任一來源：**擲錯** → 記錄並發帶 `id` 告警、跳過；
   * **原始解析 0 筆**（`parsedCount === 0`，即來源空／壞）→ 發帶 `id` 告警（含 Tier 2，非例外）、
   * 跳過。**內容過濾後為 0**（`parsedCount > 0` 但 `items` 空，如 github-releases 濾光 patch）
   * 屬正常、不告警。單源失敗不斷全線。
   */
  private async collect(sources: readonly NewsSource[], ctx: FetcherContext): Promise<NewsCandidate[]> {
    const enabled = sources.filter((s) => s.enabled !== false);
    const candidates: NewsCandidate[] = [];
    for (const source of enabled) {
      let result: FetchResult;
      try {
        result = await FETCHERS[source.type](source, ctx);
      } catch (err) {
        this.logger.warn(`來源抓取失敗 [${source.id}]，跳過`);
        await this.alert(source.id, `抓取失敗：${errMsg(err)}`);
        continue;
      }
      // 逐源對帳 log 置於 0 筆早退之前，讓壞掉／空的來源也出現在對帳清單（2026-09-12）。
      this.logger.log(`[來源 ${source.id}] 解析 ${result.parsedCount} 則 → 過濾後 ${result.items.length} 則`);
      if (result.parsedCount === 0) {
        await this.alert(source.id, '解析到 0 筆');
        continue;
      }
      for (const item of result.items) {
        candidates.push(toCandidate(item, source));
      }
    }
    return candidates;
  }

  /**
   * `cross` 來源以關鍵字歸類落定領域（FR-006）；非 `cross` 來源直接沿用設定 `domain`、不重新歸類。
   * 關鍵字**無命中**時依序（2026-09-25 起，此前一律丟棄）：
   * (a) 該候選已在 URL 去重時與非 `cross` 來源合併（`sources` 含之）→ 沿用該來源的設定領域——代表項
   *     是高分 HN、標題沒有關鍵字，但另一來源本身已表明領域，原本會連同一手來源一起被丟；
   * (b) 有真實社群分數且 ≥ `unresolvedMinScore` → 以 `domain: 'cross'` **保留**為「未歸類高熱度」候選，
   *     交策展 LLM 判定領域與重要性（每日名額由 `runFunnel` 把關，見 `FunnelConfig.unresolvedMinScore`）；
   * (c) 其餘 → 丟（離題，寧缺勿濫）。
   * 關鍵字表只負責正向命中、不再有否決高分項目的權力：陌生的新名字正是晨報最想捕捉的訊號。
   */
  private resolveDomains(cands: readonly NewsCandidate[], sources: readonly NewsSource[]): NewsCandidate[] {
    const sourceDomain = new Map(sources.map((s) => [s.id, s.domain] as const));
    const minScore = DEFAULT_FUNNEL_CONFIG.unresolvedMinScore;
    const out: NewsCandidate[] = [];
    let inherited = 0;
    let unresolved = 0;
    for (const c of cands) {
      if (c.domain !== 'cross') {
        out.push(c);
        continue;
      }
      const domain = classifyCross(`${c.title} ${c.summary ?? ''}`);
      if (domain !== null) {
        out.push({ ...c, domain });
        continue;
      }
      const merged = c.sources
        .map((id) => sourceDomain.get(id))
        .find((d): d is NewsDomain3 => d !== undefined && d !== 'cross');
      if (merged !== undefined) {
        out.push({ ...c, domain: merged });
        inherited++;
        continue;
      }
      if (c.score !== null && c.score >= minScore) {
        out.push(c);
        unresolved++;
      }
    }
    this.logger.log(
      `[漏斗 A] 未歸類高熱度保留：${unresolved} 則（關鍵字無命中、分數 ≥${minScore}，交策展 LLM 判定領域）；` +
        `沿用合併來源領域：${inherited} 則`,
    );
    return out;
  }

  /** best-effort 發帶來源 id 的紅色告警（共用包裝，憲章 VII）。 */
  private async alert(sourceId: string, detail: string): Promise<void> {
    await bestEffortFailureAlert(this.discord, this.logger, `新聞來源失敗 [${sourceId}]：${detail}`);
  }
}

/** RawItem → NewsCandidate（填 `normalizedUrl`/`domain`/`sources=[sourceId]`，FR-005）。 */
function toCandidate(item: RawItem, source: NewsSource): NewsCandidate {
  return {
    title: item.title,
    normalizedUrl: normalizeTargetUrl(item.targetUrl),
    originalUrl: item.targetUrl,
    summary: item.summary,
    sourceId: source.id,
    score: item.score,
    domain: source.domain,
    tier: source.tier,
    sources: [source.id],
    publishedAt: item.publishedAt,
    weightedScore: 0,
  };
}

/**
 * 過於通用的 repo 短名停用清單：作為單一 token 與新聞內文比對時極易誤命中一般詞（如 `core`／
 * `cli`），故不納入榜單相關性比對集（`fullName` 全名仍保留）。只影響 +50 加權、不影響去留。
 */
const GENERIC_REPO_SHORT_NAMES = new Set([
  'core', 'cli', 'api', 'app', 'apps', 'ui', 'web', 'www', 'site', 'docs', 'doc',
  'lib', 'sdk', 'server', 'client', 'cloud', 'main', 'dev', 'demo', 'example', 'examples',
]);

/**
 * 由 `state.board` 建榜上 repo 名 `Set`（`fullName` ＋ 短名，皆小寫），供漏斗榜單相關性加權。
 * 空 board → 空 Set → 加權安全略過（FR-018）。過於通用的短名（`GENERIC_REPO_SHORT_NAMES`）跳過，
 * 避免以單一 token 誤命中新聞內文的一般詞而給出不實加權。
 */
export function boardRepoNameSet(board: BoardState['board']): Set<string> {
  const names = new Set<string>();
  for (const fullName of Object.keys(board)) {
    names.add(fullName.toLowerCase());
    const short = fullName.split('/')[1]?.toLowerCase();
    if (short && !GENERIC_REPO_SHORT_NAMES.has(short)) {
      names.add(short);
    }
  }
  return names;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 候選 → 新鮮度視窗天數：各 `sources` 的 `freshnessWindowDays`（未設者用預設值）取最大值（2026-09-21）。
 * 不在清單中的來源 id 視同預設值（保守：不因查無設定而縮短視窗）。
 */
function sourceWindowLookup(sources: readonly NewsSource[]): (c: NewsCandidate) => number {
  const def = DEFAULT_FUNNEL_CONFIG.freshnessWindowDays;
  const byId = new Map(sources.map((s) => [s.id, s.freshnessWindowDays ?? def]));
  return (c) => Math.max(...c.sources.map((id) => byId.get(id) ?? def));
}
