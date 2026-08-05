import { IntroInput, IntroMaterial } from './intro.types';

/**
 * 組出送給 LlmService 的簡介生成 prompt：繁中、≤250 字、「解決什麼→特色→適合誰」結構為
 * 指引（非程式硬性驗證項，FR-007）、只依素材不杜撰。`starsThisWeek`/`fullName` 等事實數據
 * 僅供語境，明確要求 LLM 不需（亦不得）產生星數/名次/連結（FR-007、防幻覺契約）。
 * `material.sparse` 為真時（FR-009），要求簡介末尾標註「（資訊有限）」。
 */
export function introPrompt(input: IntroInput, material: IntroMaterial): string {
  const topicsLine = input.topics.length > 0 ? input.topics.join('、') : '（無）';
  const sourceLabel = material.source === 'readme' ? 'README 節錄' : 'description + topics（README 不足或取不到）';
  const sparseNote = material.sparse
    ? '\n- 素材明顯有限，請在簡介結尾額外標註「（資訊有限）」。'
    : '';

  return `你是技術雷達的 repo 簡介撰寫者。請根據下列素材，為這個 GitHub repo 撰寫一段繁體中文簡介。

repo: ${input.fullName}
主要語言: ${input.language ?? '（未提供）'}
topics: ${topicsLine}

素材（${sourceLabel}）：
"""
${material.text}
"""

撰寫規則：
- 只使用繁體中文，不得夾雜大段英文。
- 長度不得超過 250 個字元（含標點）。
- 內容依「這個專案解決什麼問題 → 核心特色 → 適合誰／使用情境」的結構組織。
- 只依上述素材撰寫，不得杜撰素材未出現的功能、數字、名次或連結；星數、名次等事實數據由系統
  另行提供，不需你產生、也不需你推算。${sparseNote}
- 直接輸出簡介本文，不要加上標題、前綴或引號。`;
}
