# Quickstart: 每日晨報單次 LLM 策展與降級備援（F6）驗收與跑測指引

**Feature**: `006-news-curation` | **Plan**: [plan.md](./plan.md) |
**Contracts**: [news-curation](./contracts/news-curation.contract.md) ·
[board-summary](./contracts/board-summary.contract.md) ·
[llm-response.schema](./contracts/llm-response.schema.md)

F6 是**純記憶體服務**：吃 F4 候選集／榜單 diff 投影 → 回精選集／TL;DR，**不落檔、不推播、不打真實
網路**（LLM 全程 mock）。驗收即以 Jest 單元測試證明契約後置條件與憲章不變式成立。

## 前置

```powershell
npm ci
npm run build   # tsc strict，禁 any 逃逸
```

- 無需任何機密（測試 mock `LlmService`，不呼叫真實 Gemini）。
- 依賴：**無新增 npm 依賴**；只 import F4/F5 既有匯出（`NewsCandidate`/`weightedScore` 概念、
  `LlmService`/`LlmError`、`countCodePoints` 口徑）。

## 跑測

```powershell
npm test -- src/curation           # 只跑 F6 模組測試
npm test                           # 全套（確認未破壞 F1~F5）
```

## 驗收情境（對應 User Stories / Success Criteria）

> 每一項均以 mock `LlmService` 驅動，斷言契約後置條件。「呼叫次數」以 mock 的 call count 驗。

### US1 — 每日單次策展（P1 · SC-001/002/003/005/006）
1. 餵一份 ~15–25 則、含跨領域＋一組殘留語意重複＋足量 AI＋少量非 AI 的候選；mock 回傳合規
   `{ picks:[…] }`。
2. **預期**：回 `{ items, degraded:false }`——`items.length ≤ 6`、每則繁中且 `title ≤50`／
   `content ≤300`（code point）、配額（AI ≥4、非 AI ≤2、≤6）、每則 `url`/`domain`/`weightedScore`
   對回真實候選（無杜撰）、殘留重複事件僅 1 則、**`llm.generate` 恰呼叫 1 次**。

### US2 — 策展失敗降級備援（P1 · SC-004）
1. mock `LlmService.generate` 擲 `LlmError('exhausted')`（另測 `'empty'` 與解析失敗）。
2. **預期**：**未擲錯**，回 `{ items, degraded:true }`——成員為候選 `weightedScore` 前段套配額、
   每則原文標題＋連結（`content:null`、`degraded:true`）；`logger.warn` 被呼叫（不無聲）。

### US3 — 配額與字數硬驗證（P2 · SC-002/003/005）
1. mock 回傳**故意違規**：7 則、某則標題 60 字／內容 400 字、含一個越界 `ref`（幻覺）、AI 僅 3 則但
   塞 3 則非 AI。
2. **預期**：越界 `ref` 被剔除 → 非 AI 夾至 ≤2 → 截總數 ≤6 → 超長標題／內容收斂至 ≤50／≤300；
   夾制後不足 6 則照實輸出、**不遞補未改寫候選**。

### US4 — 榜單日 TL;DR（P3 · SC-007）
1. 一組 `BoardChangeDigest`（含新進／竄升／下降計數與領域分布）；mock 回傳繁中一句話。
2. **預期**：回 `{ summary, degraded:false }`，只依 diff 事實、不杜撰。
3. 令 `LlmService` 擲錯 → 回 `{ summary: factSummary, degraded:true }`（如「本週 N 個新進、
   M 個竄升、K 個下降」）、**未擲錯**、`logger.warn` 記錄。全 0 diff → 「無變化」摘要。

### Edge（散布於各 spec）
- **空候選** → 回空 `items`、`degraded:false`、**`llm.generate` 呼叫 0 次**（SC-001）。
- **候選全非 AI** → 照實輸出非 AI（受 ≤2／≤6），不因湊不到 4 則 AI 而失敗。
- **重複 `ref`** → 去重為一則。
- **降級遇殘留語意重複** → 可能並存（SC-006 不約束降級路徑）。

## 契約 / 憲章對照速查

| 驗收點 | 契約 | 憲章 | SC |
|--------|------|------|----|
| 只呼叫 LLM 一次／空候選 0 次 | news-curation §後置 | V | SC-001 |
| 繁中 50/300 收斂 | news-curation §硬驗證 4 | III | SC-002 |
| 配額夾制 | news-curation §硬驗證 2/3 | III | SC-003 |
| 降級不中止 | news-curation §後置「策展失敗」 | VII/VIII | SC-004 |
| 防幻覺（對回候選） | llm-response.schema §1 / news-curation §硬驗證 1 | VI | SC-005 |
| 殘留語意去重（成功路徑） | news-curation §後置 | V | SC-006 |
| TL;DR 事實型降級 | board-summary §後置 | VI/VII | SC-007 |
| 不落檔／不推播 | 兩契約 §副作用禁止項 | VI | — |

## 完成定義（Definition of Done）

- `npm run build` 通過（strict、無 `any` 逃逸）；`npm test` 全綠。
- 上列 US1~US4 ＋ Edge 皆有對應 `*.spec.ts` 且通過（憲章 VIII 必測項覆蓋：配額、字數上限、URL/標題
  去重沿用、語意去重、幻覺剔除、降級備援、TL;DR 備援、單次呼叫）。
- 未動 F4/F5 既有檔案（只 import）；未新增 npm 依賴；無 `StateStore.save()`／`seenNews`／commit／
  Discord 呼叫出現在 F6 程式。
