import { Injectable, Logger } from '@nestjs/common';
import { GithubHttpService } from '../github/github-http';
import { fetchReadme } from '../github/github-readme';
import { LlmService } from '../llm/llm.service';
import { BoardState } from '../state/state.schema';
import { buildMaterial } from './intro-material';
import { clampTo250 } from './intro-length';
import { introPrompt } from './intro-prompt';
import { IntroInput, IntroResult } from './intro.types';

/**
 * repo 簡介服務（FR-001）：先查快取，未命中才取 README → 組素材 → LLM 生成 → 驗長收斂 →
 * 就地寫入 `state.intros`。單筆失敗一律降級（回 `degraded`），**不擲錯**、不寫快取（FR-014/015/016）。
 * 只寫入傳入的 in-memory `state`——**不呼叫 `StateStore.save()`**，持久化由呼叫端（F7）負責。
 */
@Injectable()
export class IntroService {
  private readonly logger = new Logger(IntroService.name);

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

    try {
      const [owner, name] = input.fullName.split('/');
      const readme = await fetchReadme(this.http, owner, name);
      const material = buildMaterial(input, readme);
      const raw = await this.llm.generate(introPrompt(input, material));
      const intro = clampTo250(raw);
      const introAt = now().toISOString();
      state.intros[key] = { intro, introAt };
      return { status: 'generated', intro, introAt };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`repo ${input.repoId}（${input.fullName}）簡介生成失敗，降級為 description：${reason}`);
      return { status: 'degraded', description: input.description };
    }
  }
}
