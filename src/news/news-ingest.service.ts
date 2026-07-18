import { Injectable, Logger } from '@nestjs/common';
import { DiscordWebhookService } from '../discord/discord.webhook.service';
import { bestEffortFailureAlert } from '../discord/best-effort-alert';
import { StateStore } from '../state/state.store';
import { BoardState } from '../state/state.schema';
import { NEWS_SOURCES } from '../config/news-sources';
import { NewsCandidate, NewsSource, RawItem } from './news.types';
import { NewsHttp } from './news-http';
import { FetcherContext, FETCHERS, NewsRssParser } from './fetchers/fetcher';
import { normalizeTargetUrl } from './url-normalize';
import { dedupByTitle, dedupByUrl } from './dedup';
import { TITLE_JACCARD_THRESHOLD } from './title-similarity';
import { classifyCross } from './news-classify';
import { DEFAULT_FUNNEL_CONFIG, runFunnel } from './funnel';
import { excludeSeen, pruneSeenNews } from './seen-news';
import { formatCandidateSet } from './news-log';

/**
 * 階段 A 編排器（@Injectable）：載入設定 → 逐源隔離抓取＋正規化 → URL 去重 → 標題 Jaccard 去重
 * → `cross` 歸類 → 漏斗過濾/加權/排序 → 排除 seen → 候選集＋觀測 log。
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
   */
  async ingest(
    now: Date = new Date(),
    boardRepoNames?: ReadonlySet<string>,
    sources: readonly NewsSource[] = NEWS_SOURCES,
  ): Promise<NewsCandidate[]> {
    const ctx: FetcherContext = { now, http: this.http, parser: this.parser };
    const raw = await this.collect(sources, ctx);

    let cands = dedupByUrl(raw);
    cands = dedupByTitle(cands, TITLE_JACCARD_THRESHOLD);
    cands = this.resolveDomains(cands);

    const state = await this.stateStore.load();
    const board = boardRepoNames ?? boardRepoNameSet(state.board);
    cands = runFunnel(cands, board, DEFAULT_FUNNEL_CONFIG);

    const pruned = pruneSeenNews(state.seenNews, now);
    cands = excludeSeen(cands, pruned);

    this.logger.log('\n' + formatCandidateSet(cands));
    return cands;
  }

  /**
   * 逐源隔離抓取＋正規化（FR-025/026）。任一來源：**擲錯** → 記錄並發帶 `id` 告警、跳過；
   * **回傳 0 筆** → 發帶 `id` 告警（含 Tier 2，非例外）、跳過。單源失敗不斷全線。
   */
  private async collect(sources: readonly NewsSource[], ctx: FetcherContext): Promise<NewsCandidate[]> {
    const enabled = sources.filter((s) => s.enabled !== false);
    const candidates: NewsCandidate[] = [];
    for (const source of enabled) {
      let items: RawItem[];
      try {
        items = await FETCHERS[source.type](source, ctx);
      } catch (err) {
        this.logger.warn(`來源抓取失敗 [${source.id}]，跳過`);
        await this.alert(source.id, `抓取失敗：${errMsg(err)}`);
        continue;
      }
      if (items.length === 0) {
        await this.alert(source.id, '解析到 0 筆');
        continue;
      }
      for (const item of items) {
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
 * 由 `state.board` 建榜上 repo 名 `Set`（`fullName` ＋ 短名，皆小寫），供漏斗榜單相關性加權。
 * 空 board → 空 Set → 加權安全略過（FR-018）。
 */
export function boardRepoNameSet(board: BoardState['board']): Set<string> {
  const names = new Set<string>();
  for (const fullName of Object.keys(board)) {
    names.add(fullName.toLowerCase());
    const short = fullName.split('/')[1];
    if (short) {
      names.add(short.toLowerCase());
    }
  }
  return names;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
