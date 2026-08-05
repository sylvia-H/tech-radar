# Contract: `NewsCurationService.curate()`（每日單次策展 · 階段 B）

**Feature**: `006-news-curation` | 服務：`src/curation/curation.service.ts`

## 介面

```ts
class NewsCurationService {
  constructor(private readonly llm: LlmService) {}

  /**
   * 給定 F4 候選集＋榜上 repo 名稱脈絡，回傳當日晨報精選集（≤6 則，繁中精煉版或降級原文版）。
   * @param candidates    F4 CandidateSet（已去重、過濾、排序、帶 weightedScore）
   * @param boardRepoNames 當前榜上 repo 名稱集合（呼叫端傳入的脈絡；空集合＝無榜單資料）
   * @returns CuratedDigest（永不擲錯——策展失敗回 degraded 版）
   */
  async curate(
    candidates: readonly NewsCandidate[],
    boardRepoNames: ReadonlySet<string>,
  ): Promise<CuratedDigest>;
}
```

## 前置條件（Preconditions）

- `candidates` 為 F4 漏斗產物；元素已含 `weightedScore`、`domain`（非 `cross`）、`sources`、
  `originalUrl`。呼叫端負責提供 `boardRepoNames`（可為空集合）。
- 三個機密（`GEMINI_API_KEY` 等）由環境提供、`LlmService` 已可運作（DI 注入）。

## 後置條件（Postconditions）

| 情境 | 保證 |
|------|------|
| **正常成功** | 回 `{ items, degraded:false }`；`items.length ≤ 6`、每則繁中且 `title ≤50`／`content ≤300`（code point）、配額（AI ≥4 於候選足夠時／非 AI ≤2）、每則可對回真實候選、殘留語意重複 ≤1；**恰呼叫 `llm.generate` 一次**（FR-002、SC-001~006） |
| **候選不足** | 照實輸出 < 6 則，不硬湊、不遞補未改寫候選（FR-005/010） |
| **空候選** | 回 `{ items:[], degraded:false }`，**不呼叫 LLM**（0 次，FR-020/SC-001） |
| **策展失敗**（`LlmError` exhausted/empty/error、或解析失敗） | **不擲錯**，回 `{ items, degraded:true }`（見降級契約）；`logger.warn` 記錄失敗（FR-011/014/SC-004） |

## 硬驗證管線（FR-008~010，固定順序 · 見 research D5）

對 `parseCurationResponse` 產出的 `picks` 依序套用，**只在 LLM 已改寫集合內操作、不遞補新候選**：

1. **剔幻覺＋參照去重**：`ref ∉ [0, candidates.length)` 或非整數 → 剔除；同 `ref` 重複 → 留第一個。
2. **夾非 AI ≤2**：非 AI（`devops`+`frontend-backend`）> 2 時依 FR-004 領域優先序保留前 2、其餘剔除。
3. **截總數 ≤6**：仍 > 6 時依 picks 重要性序保留前 6（優先保留 AI ＝ picks 已排序的自然結果）。
4. **字數收斂**：`title → clampToLimit(_, 50)`、`content → clampToLimit(_, 300)`（code point）。

每則以 `ref` 對回候選，附上**程式提供**的 `url`（`originalUrl`）／`domain`／`sourceCount`
（`sources.length`）／`weightedScore`；`degraded:false`。

## 副作用（Side effects）— 契約禁止項（FR-019）

- **MUST**：至多一次 `llm.generate()`（空候選 0 次）；失敗時 `logger.warn`（含失敗原因與候選規模，
  **不含** prompt／回應全文）。
- **MUST NOT**：呼叫 `StateStore.save()`；寫 `seenNews`；git commit；發 Discord 告警／推播；為策展
  發起多於一次 LLM 呼叫；引入 embeddings／向量檢索；自行抓榜單或新聞來源。

## 送交 LLM 的資料（FR-007）

僅 `CurationItemView` 的公開欄位（`ref`/`title`/`domain`/`tier`/`score`/`sourceCount`/`onBoard`/
`summaryExcerpt`）。**MUST NOT** 送機密或任何非公開資料。

## 測試點（憲章 VIII · 對應 US1/US3）

- 代表性候選＋合規 mock 回應 → ≤6、繁中、字數／配額合規、對回候選、**只呼叫一次**（US1）。
- 含殘留語意重複的輸入＋mock「同事件僅選一次」 → 最終 ≤1（SC-006，成功路徑）。
- 違規 mock 回應（7 則／標題 60 字／內容 400 字／越界 `ref`／非 AI 3 則）→ 截 ≤6、收斂 ≤50/≤300、
  剔除幻覺、夾非 AI ≤2（US3、FR-008~010）。
- 空候選 → 空 digest、`llm.generate` 呼叫次數 0（FR-020/SC-001）。
