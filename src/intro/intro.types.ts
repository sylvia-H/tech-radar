/** 簡介輸出長度上限（code points，憲章 III、FR-006）。 */
export const MAX_INTRO_CHARS = 250;

/** README 去雜訊後截斷上限（code points，research D2）。 */
export const MAX_README_CHARS = 6000;

/** README 去雜訊後視為「極短」的門檻（code points，低於此退回 description+topics，research D3）。 */
export const MIN_README_CHARS = 200;

/**
 * `IntroService.ensureIntro` 輸入；由呼叫端（F7）以 repoId join 當次榜單抓取結果後傳入
 * （FR-001、research D7）；IntroService 除自行取 README 外不另打 GitHub metadata API。
 */
export interface IntroInput {
  /** GitHub 數字 id；快取鍵來源（`String(repoId)`），抗改名。 */
  repoId: number;
  /** `owner/name`；拆出 owner/name 供 README 取得，亦入 prompt 語境。 */
  fullName: string;
  description: string | null;
  language: string | null;
  topics: string[];
  /** 僅作 prompt 語境；事實數據由程式提供、不由 LLM 產生（FR-007）。 */
  starsThisWeek: number | null;
}

/**
 * `IntroService.ensureIntro` 輸出（discriminated union，research D8）。
 * 呼叫端據 `status` 區分「真簡介」與「降級卡」，不得把 description 誤當簡介。
 */
export type IntroResult =
  | { status: 'cached'; intro: string }
  | { status: 'generated'; intro: string; introAt: string }
  | { status: 'degraded'; description: string | null };

/**
 * `buildMaterial` 輸出：送 LLM 的素材本文與其來源、是否資訊貧乏（FR-008/009）。
 */
export interface IntroMaterial {
  text: string;
  source: 'readme' | 'fallback';
  /** 素材整體貧乏（README 不足且 description/topics 皆近乎空）→ prompt 要求標「（資訊有限）」。 */
  sparse: boolean;
}
