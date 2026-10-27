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

/** 簡介 LLM 呼叫失敗時，耗時達此值即熔斷（2026-10-27，見 `IntroService` 說明）。 */
export const INTRO_BREAKER_SLOW_MS = 2 * 60_000;

/**
 * repo 簡介服務（FR-001）：先查快取，未命中才取 README → 組素材 → LLM 生成 → 驗長收斂 →
 * 就地寫入 `state.intros`。單筆失敗一律降級（回 `degraded`），**不擲錯**、不寫快取（FR-014/015/016）。
 * 只寫入傳入的 in-memory `state`——**不呼叫 `StateStore.save()`**，持久化由呼叫端（F7）負責。
 *
 * 慢失敗熔斷（2026-10-27，ADR 0009）：同一次執行內任一則簡介的 LLM 呼叫**失敗且耗時達 `INTRO_BREAKER_SLOW_MS`**（或逾時）
 * 後，其餘未命中快取的 repo 不再呼叫 LLM、直接降級——Gemini 卡住或慢回 503 時逐則各耗近 300 秒，十多個新進 repo 就會吃光
 * 步驟逾時，晨報段整段跑不到。以耗時而非 `reason` 判斷：慢回 503 的同一情境可能以 `timeout`（`hung`／`budget`）或第 4 次
 * 失敗的 `exhausted` 收尾。正常簡介數秒即回，不會誤觸；只有近乎秒回的 503 重試到放棄（約 70～100 秒）不會觸發。以實測
 * 503 每次 5～45 秒計，四次嘗試合計約 90～280 秒，Lite 過載時第一則 `exhausted` 通常就會熔斷——這是刻意接受的代價（2026-10-27
 * 使用者裁決）：過載時後面幾則多半也失敗，逐則再耗 90～280 秒會把晨報段擠出 60 分鐘步驟上限。
 * 代價只是其餘簡介改用 description。範圍只含簡介：榜單日 TL;DR 是之後的單一呼叫，最多再等一個 300 秒（已計入 ADR 0009 的
 * 最壞耗時）。服務在 CLI 一次執行內為單例，旗標隨程序結束歸零。
 */
@Injectable()
export class IntroService {
  private readonly logger = new Logger(IntroService.name);
  /** 本次執行是否已熔斷（慢失敗或逾時）。 */
  private breakerTripped = false;

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

    if (this.breakerTripped) {
      this.logger.warn(`repo ${input.repoId}（${input.fullName}）略過簡介生成、降級為 description：本次執行已有 LLM 呼叫慢失敗或逾時`);
      return { status: 'degraded', description: input.description };
    }

    let llmStartedAt: number | undefined;
    try {
      const [owner, name] = input.fullName.split('/');
      const readme = await fetchReadme(this.http, owner, name);
      const material = buildMaterial(input, readme);
      // 用 Date.now() 而非注入的 now()：榜單段傳入的是固定的執行時間戳（供 introAt 用），拿它計時耗時恆為 0。
      llmStartedAt = Date.now();
      const raw = await this.llm.generate(introPrompt(input, material));
      const intro = clampTo250(raw);
      const introAt = nowIso(now());
      state.intros[key] = { intro, introAt };
      return { status: 'generated', intro, introAt };
    } catch (err) {
      const slow = llmStartedAt !== undefined && Date.now() - llmStartedAt >= INTRO_BREAKER_SLOW_MS;
      // reason === 'timeout' 是保底：現行常數下逾時必已超過門檻（hung 等滿 300 秒、budget 最早約 220 秒），
      // 但總期限若日後調到門檻以下，逾時仍應熔斷。
      if (err instanceof LlmError && (err.reason === 'timeout' || slow)) {
        this.breakerTripped = true;
      }
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`repo ${input.repoId}（${input.fullName}）簡介生成失敗，降級為 description：${reason}`);
      return { status: 'degraded', description: input.description };
    }
  }
}
