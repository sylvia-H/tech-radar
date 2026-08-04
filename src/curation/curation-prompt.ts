import { MAX_ITEMS } from './curation-quota';
import { CurationItemView } from './curation.types';

/**
 * 組出送給 LlmService 的每日單次策展 prompt：候選逐行編號呈現（含 `onBoard` 標記，
 * 使榜單相關性脈絡實際進入 prompt，FR-001）；明列「重要 ≠ 熱門」優先類別、主題降噪優先序
 * （FR-004 語意判斷交此次呼叫執行）、配額、繁中 70/500、殘留語意去重，並限定回應格式
 * （research D1、contracts/llm-response.schema.md）。
 */
export function buildCurationPrompt(items: readonly CurationItemView[]): string {
  const lines = items
    .map((it) => {
      const boardMark = it.onBoard ? '★在榜 ' : '';
      const scoreLabel = it.score !== null ? `分數 ${it.score}` : '分數 無';
      return `[${it.ref}] ${boardMark}(${it.domain}/tier${it.tier}/${scoreLabel}/${it.sourceCount} 來源) ${it.title}${
        it.summaryExcerpt ? `\n    摘要：${it.summaryExcerpt}` : ''
      }`;
    })
    .join('\n');

  return `你是技術雷達的每日新聞策展人。以下是今天的候選新聞清單（已去重、已排序），請完成三件事：
(a) 認出候選中「不同連結但其實是同一件事」的殘留語意重複，只保留其中一則；
(b) 依「對開發者的重要性」（非熱度）挑出最多 ${MAX_ITEMS} 則——優先會改變開發者做事方式的內容
    （新工具／框架／版本、breaking change、安全通報、重大模型／API 發布、標準變動、重大 deprecation），
    壓低純爆紅口水／drama／純觀點文；分數僅為提示、非排序主鍵；
(c) 把每則精煉為繁體中文標題（≤70 字）＋內容（≤500 字，說清「發生什麼事＋為何對開發者重要」）。

主題降噪（選擇非 AI 候選時的優先序，DevOps 優先於後端／前端）：
- DevOps／基礎設施：優先考慮。
- 後端：只看 Node.js／Python 相關；其他語言生態系降低優先。
- 前端：以 TypeScript 為主；Vue／React 相關優先度最低；CSS 技巧／教學一律不選。

配額（無強制則數目標，實際能收錄幾則交由程式依當日 AI／非AI 供給狀況動態決定，你不需要自我設限）：
- AI 與 DevOps／後端／前端皆不設固定則數上限：逐一評估每則「是否真的重要」，凡合格皆收錄；
  不要因為已經湊到「感覺還可以」的數量就提早停手，也不要為了衝數量硬選不重要的內容。
- 全部類別合計最多 ${MAX_ITEMS} 則（程式端硬性把關；非 AI 依比例通常遠少於 AI，但實際比例由
  程式依當日 AI 供給狀況決定，你只需要誠實選出每個類別裡真正重要的候選）。

候選清單（\`[ref]\` 為索引，回應時只需回 ref，不要覆述標題）：
${lines || '（無候選）'}

候選標記說明：「★在榜」表示該候選提到目前榜上的 repo，可作為重要性判斷的正面提示（非唯一依據）。

輸出規則：
- 只回傳單一 JSON 物件：{"picks":[{"ref":<候選索引>,"title":"<繁中標題,≤70字>","content":"<繁中內容,≤500字>"}]}
- picks 的順序即你判斷的重要性由高到低排序。
- 不得回傳連結、分數、星數、名次，也不得回傳候選清單中不存在的 ref。
- 候選不足或無合適候選時，可回傳較少則數甚至空 picks，不得為了湊數選入不重要的內容。
- 不要輸出 JSON 以外的文字或說明。`;
}
