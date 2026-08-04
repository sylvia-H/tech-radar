import { Injectable, Logger } from '@nestjs/common';
import { DiscordWebhookService } from '../discord/discord.webhook.service';
import { bestEffortFailureAlert } from '../discord/best-effort-alert';
import { StateStore } from '../state/state.store';
import { BoardState } from '../state/state.schema';
import { NewsIngestService, boardRepoNameSet } from '../news/news-ingest.service';
import { NewsCurationService } from '../curation/curation.service';
import { normalizeTargetUrl } from '../news/url-normalize';
import { pruneSeenNews } from '../news/seen-news';
import { decideNewsGuard } from './layout/news-guard';
import { buildDigestEmbeds } from './layout/digest-embeds';
import { chunkEmbeds } from './layout/embed-split';
import { taipeiDateLabel } from './layout/date-label';

/** `NewsSegmentService.run()` 的回傳型別（判別聯集，供觀測；F7 內部型別）。 */
export type NewsSegmentResult =
  | { status: 'skipped' } // guard 未到期，整段跳過（FR-002）
  | { status: 'no-content' } // 精選為空，未推播、未前進 guard（FR-006）
  | { status: 'push-failed' } // 推播失敗，狀態未寫回、已發告警（FR-005/SC-003）
  | { status: 'ok' }; // 正常推播並落檔

/**
 * 晨報段（US1/US2）：guard → F4 ingest → F6 curate →（空精選早退）→ 組版 → 依序推播 →
 * **推播成功後**寫回 `seenNews`＋`lastNewsPushAt` 並原子 save（contract pipeline-orchestration.md C3）。
 *
 * 推播失敗於**段內**捕捉並 best-effort 告警、不 save、不重擲——使本服務可獨立以 mock 驗證失敗路徑
 * （T010），亦與既有 `BoardDiffService` 的段內告警慣例一致。`PipelineService`（US4）另加外層
 * try/catch 作為未預期例外的安全網，不影響本段已自行處理的已知失敗。
 */
@Injectable()
export class NewsSegmentService {
  private readonly logger = new Logger(NewsSegmentService.name);

  constructor(
    private readonly stateStore: StateStore,
    private readonly discord: DiscordWebhookService,
    private readonly newsIngest: NewsIngestService,
    private readonly newsCuration: NewsCurationService,
  ) {}

  async run(state: BoardState, now: Date): Promise<NewsSegmentResult> {
    const guard = decideNewsGuard(state.lastNewsPushAt, now);
    if (!guard.due) {
      return { status: 'skipped' };
    }

    const boardRepoNames = boardRepoNameSet(state.board);
    // 傳入共享 state 的 seenNews，讓 ingest 免去重複 stateStore.load()（pipeline 開頭已 load 一次）。
    const candidates = await this.newsIngest.ingest(now, boardRepoNames, undefined, state.seenNews);
    const digest = await this.newsCuration.curate(candidates, boardRepoNames);

    if (digest.items.length === 0) {
      // 空精選：不推空晨報、不前進 lastNewsPushAt，同日補跑/隔日重試（FR-006）。
      return { status: 'no-content' };
    }

    const dateLabel = taipeiDateLabel(now);
    const embeds = buildDigestEmbeds(digest, dateLabel);
    const batches = chunkEmbeds(embeds, 10);

    try {
      for (const batch of batches) {
        await this.discord.send({ username: 'Tech Radar', embeds: batch }, 'news');
      }
    } catch (err) {
      await bestEffortFailureAlert(this.discord, this.logger, `晨報推播失敗：${errMsg(err)}`);
      return { status: 'push-failed' };
    }

    // push-then-commit：推播成功後才寫回，seenNews 以 normalized url 記鍵（與 F4 excludeSeen 對齊，research D7）。
    // 先修剪逾保留期（7 天）的舊紀錄再 append 本次，使**落檔的** seenNews 不無限膨脹（FR-023/SC-008）——
    // 過去 ingest 只在讀取時記憶體修剪、不寫回，寫回路徑若不修剪則 7 天保留形同虛設。
    const seen = pruneSeenNews(state.seenNews, now);
    const seenUrls = new Set(seen.map((e) => e.url));
    const seenAt = now.toISOString();
    for (const item of digest.items) {
      const url = normalizeTargetUrl(item.url);
      if (!seenUrls.has(url)) {
        seen.push({ url, seenAt });
        seenUrls.add(url);
      }
    }
    state.seenNews = seen;
    state.lastNewsPushAt = seenAt;
    state.publish = {
      ...state.publish,
      news: { items: digest.items, generatedAt: seenAt },
    };
    await this.stateStore.save(state);

    return { status: 'ok' };
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
