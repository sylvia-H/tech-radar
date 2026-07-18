# Contract: `BoardSummaryService.summarize()`（榜單日「本次變化」TL;DR · §10 第 (2) 種呼叫）

**Feature**: `006-news-curation` | 服務：`src/curation/board-summary.service.ts`

## 介面

```ts
class BoardSummaryService {
  constructor(private readonly llm: LlmService) {}

  /**
   * 給定榜單變化摘要投影，回傳一句繁中封面 TL;DR（LLM 改寫版或程式事實型降級版）。
   * @param digest 由呼叫端（F7）自 F3 BoardDiff 投影出的計數＋領域分布（D3）
   * @returns BoardChangeSummary（永不擲錯——失敗回 degraded 事實摘要）
   */
  async summarize(digest: BoardChangeDigest): Promise<BoardChangeSummary>;
}
```

## 前置條件

- `digest` 由 F7 自 `BoardDiff` 投影（計數皆 `≥0`）。F6 **不吃** `BoardDiff` 整體、不碰 F3 服務。
- 僅榜單日被呼叫；與每日新聞策展的「每日 1 次」相互獨立（FR-017），不使新聞策展變多次。

## 後置條件

| 情境 | 保證 |
|------|------|
| **LLM 成功** | 回 `{ summary, degraded:false }`；`summary` 為一句繁中 TL;DR，**只依 `digest` 事實**、不杜撰數字／名稱（FR-015、SC-007） |
| **LLM 失敗**（`LlmError` 任一 reason） | **不擲錯、不阻斷榜單推播**，回 `{ summary: factSummary(digest), degraded:true }`；數字 100% 取自 `digest`；`logger.warn` 記錄（FR-016、SC-007） |
| **無變化**（`newcomers`＝`climbed`＝`declined`＝0） | 回代表「本次無變化」的摘要（是否推榜由 F7 決定）（US4-3） |
| **僅下降** | 照實陳述計數（下降側純位移噪音），不因「只有下降」而略過（Edge） |

## 降級事實摘要格式（`factSummary(digest)`）

- 基本式：「本週 N 個新進、M 個竄升、K 個下降」；計數為 0 的子句省略。
- 三者皆 0：「本週榜單無變化」。
- 數字一律取自 `digest.{newcomers,climbed,declined}`（**0 起杜撰**，SC-007）。

## 副作用 — 契約禁止項

- **MUST**：至多一次 `llm.generate()`；失敗時 `logger.warn`（含失敗原因，**不含** prompt／回應全文）。
- **MUST NOT**：`StateStore.save()`／git commit／發 Discord／自行抓榜單；**MUST NOT** 另建平行 LLM
  客戶端（重用 F5 `LlmService`，FR-018）。

## 送交 LLM 的資料

僅 `BoardChangeDigest` 的計數與領域分布（皆為程式產生的公開 diff 事實）。

## 測試點（憲章 VIII · 對應 US4）

- 一組 diff＋mock 繁中回應 → 不杜撰、依 diff 事實的繁中一句話。
- `LlmService` 擲錯 → 回 `factSummary`（依計數）、`degraded:true`、未擲錯、記錄失敗（FR-016/SC-007）。
- 全 0 diff → 「無變化」摘要；僅下降 diff → 照實陳述下降計數（Edge）。
