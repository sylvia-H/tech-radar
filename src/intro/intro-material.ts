import { IntroInput, IntroMaterial, MAX_README_CHARS, MIN_README_CHARS } from './intro.types';
import { countCodePoints } from './intro-length';
import { stripMarkdownNoise } from './markdown-noise';

/**
 * 組出送 LLM 的素材：README 去雜訊後 ≥ `MIN_README_CHARS` 用 README（截斷至
 * `MAX_README_CHARS`）；否則（取不到／空／極短）退回 description + topics（FR-003/FR-008）。
 * 退回時 description 與 topics 皆近乎空 → `sparse=true`（US3-3 最小可用簡介，FR-009）。
 */
export function buildMaterial(input: IntroInput, readme: string): IntroMaterial {
  const cleaned = stripMarkdownNoise(readme);
  if (countCodePoints(cleaned) >= MIN_README_CHARS) {
    const truncated = [...cleaned].slice(0, MAX_README_CHARS).join('');
    return { text: truncated, source: 'readme', sparse: false };
  }

  const descriptionText = input.description?.trim() ?? '';
  const topicsText = input.topics.length > 0 ? input.topics.join('、') : '';
  const parts = [descriptionText, topicsText].filter((part) => part.length > 0);

  return {
    text: parts.join('\n'),
    source: 'fallback',
    sparse: descriptionText.length === 0 && topicsText.length === 0,
  };
}
