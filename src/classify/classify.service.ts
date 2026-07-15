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
 * - topics 非空：只比對 topics；無命中即排除，**不** fallback 到 description。
 * - topics 為空：改以 description 比對。
 * 兩者皆用**小寫詞界**比對（以非英數字元為界）：短關鍵字 `ai`／`rag`／`gpt` 若用子字串，
 * 會讓 topic `blockchain`／`domain-driven-design` 誤命中 `ai`，再被 AI 最高優先序吃掉歸類
 * （SC-002）；詞界接不到的黏著變體（`openai`／`agents`…）改由種子集 `extra` 群逐一涵蓋。
 * language **僅為輔助訊號**：不單獨定領域、不參與跨領域主領域決勝、不改變歸屬（I1），
 * 故本服務不讀 language。
 * 命中多領域時依固定優先序 **AI > DevOps > 前後端** 擇一主領域（FR-011）。
 * topics 與 description 皆無命中 → 回 `null`（排除，寧缺勿濫）。
 */
@Injectable()
export class ClassifyService {
  classify(input: ClassifyInput): Domain | null {
    const haystacks =
      input.topics.length > 0
        ? input.topics.map((t) => t.toLowerCase())
        : descriptionHaystack(input.description);

    // 固定優先序擇一主領域（DOMAINS 即 AI > DevOps > 前後端）。
    for (const domain of DOMAINS) {
      if (haystacks.some((h) => DOMAIN_PATTERNS[domain].test(h))) {
        return domain;
      }
    }
    return null;
  }
}

function descriptionHaystack(description: string | null): string[] {
  return description ? [description.toLowerCase()] : [];
}

/** 領域關鍵字 → 單一詞界 regex（模組載入時編一次；增刪關鍵字仍只改 domain-keywords）。 */
const DOMAIN_PATTERNS: Record<Domain, RegExp> = {
  ai: buildPattern(DOMAIN_KEYWORDS.ai),
  devops: buildPattern(DOMAIN_KEYWORDS.devops),
  'frontend-backend': buildPattern(DOMAIN_KEYWORDS['frontend-backend']),
};

/** 組出「以非英數字元為界，命中任一關鍵字」的 regex（keyword 內部連字號不受影響）。 */
function buildPattern(keywords: readonly string[]): RegExp {
  const alternatives = keywords.map((kw) => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`(?<![a-z0-9])(?:${alternatives})(?![a-z0-9])`);
}
