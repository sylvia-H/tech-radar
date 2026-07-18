import { BoardChangeDigest } from './board-summary.types';

/**
 * 組出榜單日封面 TL;DR 的 prompt：只依 `digest` 提供的計數與領域分布，要求一句繁中摘要，
 * 不得杜撰未提供的數字或名稱（FR-015、憲章 VI）。
 */
export function buildBoardSummaryPrompt(digest: BoardChangeDigest): string {
  return `你是技術雷達的榜單封面文案撰寫者。以下是本次榜單變化的事實統計：
新進：${digest.newcomers} 個
竄升：${digest.climbed} 個
下降：${digest.declined} 個
新進＋竄升的領域分布：AI ${digest.domainCounts.ai} 個、前後端 ${digest.domainCounts['frontend-backend']} 個
本次綜合榜 #1：${digest.topName ?? '（無）'}

請把上述事實摘成「一句」繁體中文封面文案，放在 Discord 榜單卡片頂端。規則：
- 只依上述數字與名稱撰寫，不得杜撰未提供的數字、名稱或事實。
- 只寫一句話，不加標題、前綴或引號，不需列點。
- 若三項計數皆為 0，直接表達「本次無變化」的語意。
- 直接輸出這句話本身。`;
}
