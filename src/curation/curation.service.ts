import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { mentionsBoardRepo } from '../news/funnel';
import { NewsCandidate, NewsDomain3 } from '../news/news.types';
import { fallbackDigest } from './curation-fallback';
import { buildCurationPrompt } from './curation-prompt';
import { parseCurationResponse } from './curation-parse';
import { validateCuration } from './curation-validate';
import { CuratedDigest, CurationItemView } from './curation.types';

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

  async curate(candidates: readonly NewsCandidate[], boardRepoNames: ReadonlySet<string>): Promise<CuratedDigest> {
    if (candidates.length === 0) {
      return { items: [], degraded: false };
    }

    try {
      const views = candidates.map((c, ref) => projectItemView(c, ref, boardRepoNames));
      const raw = await this.llm.generate(buildCurationPrompt(views));
      const { picks } = parseCurationResponse(raw);
      const items = validateCuration(picks, candidates);
      const domainDist = items.reduce(
        (acc, it) => {
          acc[it.domain] = (acc[it.domain] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );
      const domainStr = Object.entries(domainDist).map(([d, c]) => `${d}:${c}`).join(' / ');
      this.logger.log(
        `新聞策展完成：${candidates.length} 候選 → LLM 選 ${picks.length} 則 → ` +
        `驗證後 ${items.length} 則（${domainStr}）`,
      );
      return { items, degraded: false };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`新聞策展失敗，退回降級路徑：${reason}（候選數 ${candidates.length}）`);
      return fallbackDigest(candidates);
    }
  }
}

/**
 * 投影候選為公開脈絡視圖（只含公開資料，FR-007）。
 * `domain`：F4 `CandidateSet` 輸出不變式 `domain !== 'cross'`（I1 決策 B，信任已驗收上游契約、
 * 不另加執行期防衛過濾；若不變式破壞，`cross` 落 `isAi()=false` → 計非 AI，屬已知有界缺點）。
 */
function projectItemView(c: NewsCandidate, ref: number, boardRepoNames: ReadonlySet<string>): CurationItemView {
  return {
    ref,
    title: c.title,
    domain: c.domain as NewsDomain3,
    tier: c.tier,
    score: c.score,
    sourceCount: c.sources.length,
    onBoard: mentionsBoardRepo(c, boardRepoNames),
    summaryExcerpt: c.summary,
  };
}
