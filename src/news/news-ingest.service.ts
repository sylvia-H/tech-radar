import { Injectable, Logger } from '@nestjs/common';
import { DiscordWebhookService } from '../discord/discord.webhook.service';
import { bestEffortFailureAlert } from '../discord/best-effort-alert';
import { StateStore } from '../state/state.store';
import { BoardState, SeenNewsEntry } from '../state/state.schema';
import { NEWS_SOURCES } from '../config/news-sources';
import { NewsCandidate, NewsSource, RawItem } from './news.types';
import { NewsHttp } from './news-http';
import { FetcherContext, FetchResult, FETCHERS, NewsRssParser } from './fetchers/fetcher';
import { normalizeTargetUrl } from './url-normalize';
import { dedupByTitle, dedupByUrl } from './dedup';
import { TITLE_JACCARD_THRESHOLD } from './title-similarity';
import { classifyCross } from './news-classify';
import { DEFAULT_FUNNEL_CONFIG, runFunnel } from './funnel';
import { excludeSeen, pruneSeenNews } from './seen-news';
import { formatCandidateSet } from './news-log';

/**
 * 階段 A 編排器（@Injectable）：載入設定 → 逐源隔離抓取＋正規化 → URL 去重 → 標題 Jaccard 去重
 * → `cross` 歸類 → 排除 seen → 漏斗過濾/加權/排序/收斂 → 候選集＋觀測 log。
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
   * 產出階段 A 候選集。`now` 注入以驅動近 7 天口徑、seen 修剪、新鮮度決勝（不依賴真實時間）。
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

    let cands = dedupByUrl(raw);
    cands = dedupByTitle(cands, TITLE_JACCARD_THRESHOLD);
    cands = this.resolveDomains(cands);

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
    cands = excludeSeen(cands, pruned);

    cands = runFunnel(cands, board, DEFAULT_FUNNEL_CONFIG, now);

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
   * `cross` 來源以關鍵字歸類落定領域（FR-006）：無命中 → 丟（離題，寧缺勿濫，與榜單同精神）；
   * 非 `cross` 來源直接沿用設定 `domain`、不重新歸類。
   */
  private resolveDomains(cands: readonly NewsCandidate[]): NewsCandidate[] {
    const out: NewsCandidate[] = [];
    for (const c of cands) {
      if (c.domain !== 'cross') {
        out.push(c);
        continue;
      }
      const domain = classifyCross(`${c.title} ${c.summary ?? ''}`);
      if (domain === null) {
        continue;
      }
      out.push({ ...c, domain });
    }
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
