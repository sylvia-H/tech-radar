# Contract: 策展 LLM 回應格式與解析（`parseCurationResponse`）

**Feature**: `006-news-curation` | 檔案：`src/curation/curation-parse.ts` | 決策來源：research D1/D2

本檔釘定新聞策展呼叫要求 LLM 回傳的**結構化格式**，與程式端解析／容錯的契約。榜單 TL;DR 呼叫回傳
**純文字一句話**（無結構），不適用本 schema。

## 1. LLM 回應格式（prompt 要求 LLM 產出）

單一 JSON 物件，鍵為 `picks`；`picks` 為陣列，每項為一則被選中的候選：

```jsonc
{
  "picks": [
    { "ref": 3, "title": "繁中標題（≤50 字）", "content": "繁中內容（≤300 字）" },
    { "ref": 0, "title": "…",                 "content": "…" }
  ]
}
```

- **`ref`**（number）：候選在**送入 prompt 的候選清單**中的 0-based 索引（prompt 內以 `[0] …／[1] …`
  逐行編號，D1）。**唯一被授權指向事實的鍵**——程式以 `ref` 對回候選後附上真實連結／分數／domain。
- **`title`**（string）：繁中改寫標題。**`content`**（string）：繁中改寫內容。此二者為 LLM 唯一被授權
  產生的內容（憲章 VI）。
- **`picks` 的順序＝開發者重要性由高到低**（LLM 已排序，程式在護欄內保留其相對順序，D1）。
- LLM **MUST NOT** 回連結、分數、星數、名次或候選中不存在的 `ref`（防幻覺；越界 `ref` 由硬驗證剔除）。
- 允許 LLM 選少於 6 則、甚至空 `picks`（候選稀少時寧缺勿濫）。

## 2. 解析步驟（`parseCurationResponse(raw): CurationLlmResponse`）

1. **去 code fence**：`stripJsonFence(raw)`——若被 ```` ```json … ``` ```` 或 ```` ``` … ``` ````
   包住，取柵欄內文；否則原樣。
2. **`JSON.parse`**：解析為物件。
3. **形狀淺驗證**：`picks` 為陣列；每項 `ref` 為 `number`、`title`／`content` 為 `string`。
4. 任一步失敗 → 擲 `CurationParseError`（不做局部搶救，D2）。

> 解析層**只保證「拿到結構正確的 picks」**，不判定越界 `ref`／超長字數／配額／重複——那些交由
> 硬驗證管線收斂（見 `news-curation.contract.md` §硬驗證管線、FR-008~010）。

## 3. 失敗語意（對應 US2 降級）

| 失敗 | 判定 | 後續 |
|------|------|------|
| `JSON.parse` 擲錯（非 JSON／截斷） | `CurationParseError` | `curate()` catch → 降級路徑（FR-011、Edge） |
| `picks` 非陣列／項欄位型別不符 | `CurationParseError` | 同上 |
| `LlmService.generate` 擲 `LlmError`（exhausted/empty/error） | 於 `curate()` 直接 catch | 降級路徑 |

一律 `logger.warn`（含失敗原因與候選規模，**不含** prompt／回應全文，FR-014）。

## 4. 降級路徑輸出（無 LLM · `curation-fallback.ts`）

策展失敗時**不使用**本 schema，改由 `fallbackDigest(candidates)` 純程式產生：沿用 F4
`weightedScore` 序（`CandidateSet` 已排序，直接取前段）套同一配額（AI ≥4 於候選足夠時／非 AI ≤2／
≤6），每則 `CuratedNewsItem` 為**原文標題＋連結**（`content: null`）、`degraded:true`；原文標題
**不套 50 字收斂**（FR-013、Edge）。降級路徑**不做語意去重**（SC-006 不適用，Clarifications 2026-07-18）。

## 5. 測試點（憲章 VIII）

- 合法 JSON（含／不含 ```json fence）→ 正確 `picks`。
- 非 JSON／截斷 JSON／`picks` 非陣列／`ref` 為字串 → 擲 `CurationParseError`。
- 越界 `ref`（如 `ref: 99`）→ 解析**通過**、由硬驗證層剔除（分層職責，D2）。
