import { Injectable, Logger } from '@nestjs/common';
import { GithubHttpService } from '../github/github-http';
import { fetchReadme } from '../github/github-readme';
import { LlmService } from '../llm/llm.service';
import { LlmError } from '../llm/llm.types';
import { BoardState } from '../state/state.schema';
import { nowIso } from '../state/state-time';
import { buildMaterial } from './intro-material';
import { clampTo250 } from './intro-length';
import { introPrompt } from './intro-prompt';
import { IntroInput, IntroResult } from './intro.types';

/**
 * repo 簡介服務（FR-001）：先查快取，未命中才取 README → 組素材 → LLM 生成 → 驗長收斂 →
 * 就地寫入 `state.intros`。單筆失敗一律降級（回 `degraded`），**不擲錯**、不寫快取（FR-014/015/016）。
 * 只寫入傳入的 in-memory `state`——**不呼叫 `StateStore.save()`**，持久化由呼叫端（F7）負責。
 *
 * 逾時熔斷（2026-10-27，ADR 0009）：同一次執行內任一則 LLM 呼叫掛住（`LlmError('timeout', 'hung')`）後，其餘未命中快取的
 * repo 不再呼叫 LLM、直接降級——Gemini 卡住時逐則各等滿 300 秒，十多個新進 repo 就會吃光步驟逾時，晨報段整段跑不到。
 * `'budget'`（Gemini 有回 503 等、只是剩餘期限不夠重送）不熔斷，下一則照常嘗試。範圍只含簡介：榜單日 TL;DR 是之後的
 * 單一呼叫，掛住時最多再等一個 300 秒（已計入 ADR 0009 的最壞耗時）。服務在 CLI 一次執行內為單例，旗標隨程序結束歸零。
 */
@Injectable()
export class IntroService {
  private readonly logger = new Logger(IntroService.name);
  private llmTimedOut = false;

  constructor(
    private readonly llm: LlmService,
    private readonly http: GithubHttpService,
  ) {}

  async ensureIntro(
    input: IntroInput,
    state: BoardState,
    now: () => Date = () => new Date(),
  ): Promise<IntroResult> {
    const key = String(input.repoId);
    const cachedIntro = state.intros[key]?.intro;
    if (cachedIntro) {
      return { status: 'cached', intro: cachedIntro };
    }

    if (this.llmTimedOut) {
      this.logger.warn(`repo ${input.repoId}（${input.fullName}）略過簡介生成、降級為 description：本次執行已有 LLM 呼叫逾時`);
      return { status: 'degraded', description: input.description };
    }

    try {
      const [owner, name] = input.fullName.split('/');
      const readme = await fetchReadme(this.http, owner, name);
      const material = buildMaterial(input, readme);
      const raw = await this.llm.generate(introPrompt(input, material));
      const intro = clampTo250(raw);
      const introAt = nowIso(now());
      state.intros[key] = { intro, introAt };
      return { status: 'generated', intro, introAt };
    } catch (err) {
      if (err instanceof LlmError && err.reason === 'timeout' && err.timeoutKind === 'hung') {
        this.llmTimedOut = true;
      }
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`repo ${input.repoId}（${input.fullName}）簡介生成失敗，降級為 description：${reason}`);
      return { status: 'degraded', description: input.description };
    }
  }
}
