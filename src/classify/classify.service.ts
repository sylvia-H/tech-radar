import { Injectable } from '@nestjs/common';
import { Domain, DOMAINS } from '../board/board.types';
import { DOMAIN_KEYWORDS } from './domain-keywords';

/** 分類輸入（僅需 topics 與 description；language 不參與，見下）。 */
export interface ClassifyInput {
  topics: string[];
  description: string | null;
}

/**
 * 三領域歸類（FR-003 / FR-011，零 LLM）。
 *
 * 訊號優先序：**topics（主要）→ 無 topics 時改用 description**。
 * - topics 非空：只比對 topics（小寫子字串）；無命中即排除，**不** fallback 到 description。
 * - topics 為空：改以 description（小寫詞界）比對。
 * language **僅為輔助訊號**：不單獨定領域、不參與跨領域主領域決勝、不改變歸屬（I1），
 * 故本服務不讀 language。
 * 命中多領域時依固定優先序 **AI > DevOps > 前後端** 擇一主領域（FR-011）。
 * topics 與 description 皆無命中 → 回 `null`（排除，寧缺勿濫）。
 */
@Injectable()
export class ClassifyService {
  classify(input: ClassifyInput): Domain | null {
    const hits =
      input.topics.length > 0
        ? this.matchTopics(input.topics)
        : this.matchDescription(input.description);

    // 固定優先序擇一主領域（DOMAINS 即 AI > DevOps > 前後端）。
    for (const domain of DOMAINS) {
      if (hits.has(domain)) {
        return domain;
      }
    }
    return null;
  }

  /** topics：小寫子字串比對（寬鬆）。 */
  private matchTopics(topics: string[]): Set<Domain> {
    const lowered = topics.map((t) => t.toLowerCase());
    const hits = new Set<Domain>();
    for (const domain of DOMAINS) {
      for (const kw of DOMAIN_KEYWORDS[domain]) {
        if (lowered.some((t) => t.includes(kw))) {
          hits.add(domain);
          break;
        }
      }
    }
    return hits;
  }

  /** description：小寫詞界比對（以非英數字元為界，短關鍵字不誤命中一般字詞）。 */
  private matchDescription(description: string | null): Set<Domain> {
    const hits = new Set<Domain>();
    if (!description) {
      return hits;
    }
    const text = description.toLowerCase();
    for (const domain of DOMAINS) {
      for (const kw of DOMAIN_KEYWORDS[domain]) {
        if (wordBoundaryIncludes(text, kw)) {
          hits.add(domain);
          break;
        }
      }
    }
    return hits;
  }
}

/** 已小寫的 text 是否以「非英數字元為界」包含 keyword（keyword 內部連字號不受影響）。 */
function wordBoundaryIncludes(loweredText: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`);
  return pattern.test(loweredText);
}
