import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { mentionsBoardRepo } from '../news/funnel';
import { NewsCandidate, NewsDomain3 } from '../news/news.types';
import { buildCurationPrompt } from './curation-prompt';
import { parseCurationResponse } from './curation-parse';
import { validateCuration } from './curation-validate';
import { CuratedDigest, CurationItemView } from './curation.types';

/**
 * 每日單次策展服務（階段 B，FR-001~020）：把 F4 候選集投影為公開脈絡視圖，以**單一**
 * `LlmService.generate()` 完成殘留語意去重、依開發者重要性挑選、繁中改寫，再經硬驗證管線
 * 產出恆合規的精選集。空候選短路不呼叫 LLM（FR-020/SC-001）。只回傳記憶體結構，**不落檔、
 * 不寫 `seenNews`、不推播**（FR-019，交 F7）。策展失敗的降級包覆見 US2（curate() 加 try/catch）。
 */
@Injectable()
export class NewsCurationService {
  private readonly logger = new Logger(NewsCurationService.name);

  constructor(private readonly llm: LlmService) {}

  async curate(candidates: readonly NewsCandidate[], boardRepoNames: ReadonlySet<string>): Promise<CuratedDigest> {
    if (candidates.length === 0) {
      return { items: [], degraded: false };
    }

    const views = candidates.map((c, ref) => projectItemView(c, ref, boardRepoNames));
    const raw = await this.llm.generate(buildCurationPrompt(views));
    const { picks } = parseCurationResponse(raw);
    const items = validateCuration(picks, candidates);
    return { items, degraded: false };
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
