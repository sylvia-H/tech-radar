# Phase 1 Data Model: 每日晨報單次 LLM 策展與降級備援（F6）

**Feature**: `006-news-curation` | **Date**: 2026-07-18 | **Plan**: [plan.md](./plan.md)

F6 全部型別皆為**單次執行的記憶體結構**，**不持久化**（FR-019：不 `save()`、不寫 `seenNews`、
不 commit）。以下型別分屬兩個服務：新聞策展（`curation.types.ts`）與榜單摘要
（`board-summary.types.ts`）。事實欄位（連結／分數／domain）一律**由程式自 F4 候選對回附上**，
非 LLM 產生（憲章 VI）。字數以 **Unicode code point** 計（`countCodePoints`，與 F5／憲章同口徑）。

---

## 1. 新聞策展型別（`src/curation/curation.types.ts`）

### 1.1 `CurationItemView` — 送交 LLM 的候選公開脈絡投影（輸入投影）

由 `curate()` 內部自 `NewsCandidate` 投影，**只含公開資料**（FR-007），供 prompt 逐行編號呈現。

| 欄位 | 型別 | 來源／語意 | 不變式 |
|------|------|-----------|--------|
| `ref` | `number` | 候選在送入清單中的 0-based 索引（穩定參照鍵，D1） | `0 ≤ ref < candidates.length`，唯一 |
| `title` | `string` | `candidate.title`（原文標題節錄） | 非空 |
| `domain` | `'ai' \| 'devops' \| 'frontend-backend'` | `candidate.domain`（配額分類依此，D4） | 不為 `cross`（F4 輸出不變式） |
| `tier` | `1 \| 2 \| 3` | `candidate.tier`（訊號層級提示） | — |
| `score` | `number \| null` | `candidate.score`（分數僅提示、非排序主鍵，FR-003c） | — |
| `sourceCount` | `number` | `candidate.sources.length`（交叉驗證強度提示，FR-017） | `≥ 1` |
| `onBoard` | `boolean` | 候選是否命中當前榜上 repo（**由呼叫端隨候選傳入**的脈絡，FR-001） | — |
| `summaryExcerpt` | `string \| null` | `candidate.summary` 節錄（供改寫 300 字內容的素材） | — |

> **只送公開資料**：不含機密、不含 prompt／回應全文。`ref` 只在單次執行內有效，不持久化。
>
> **domain 收窄（I1 決策 B）**：`candidate.domain` 靜態型別為 `NewsDomain`（含 `'cross'`），本表 `domain` 欄位型別為 `NewsDomain3`（不含 `cross`）。投影時以 `candidate.domain as NewsDomain3` 收窄，**MUST 附一行註解引用 F4 `CandidateSet` 輸出不變式（`domain !== 'cross'`，F4 已測）**；信任已驗收上游契約、**不**另加執行期防衛過濾（若不變式破壞，`cross` 落 `isAi()=false` → 計非 AI、受 `≤2` 夾制，屬已知有界缺點）。同一收窄套用於 §1.3 `CuratedNewsItem.domain` 之對回附值。

### 1.2 `CurationLlmPick` — LLM 回傳解析後的單則（解析層產物）

`parseCurationResponse()` 的輸出元素（形狀淺驗證後、硬驗證前，D2）。

| 欄位 | 型別 | 語意 |
|------|------|------|
| `ref` | `number` | LLM 選中的候選索引（可能越界／重複 → 硬驗證層剔除／去重） |
| `title` | `string` | LLM 繁中改寫標題（可能超 50 → 硬驗證層收斂） |
| `content` | `string` | LLM 繁中改寫內容（可能超 300 → 硬驗證層收斂） |

解析容器：`CurationLlmResponse = { picks: CurationLlmPick[] }`。

### 1.3 `CuratedNewsItem` — 精選輸出的一則（服務輸出元素）

策展成功（精煉版）或降級（原文版）皆用此型別，以 `degraded` 判別。事實欄位由程式對回候選附上。

| 欄位 | 型別 | 語意／來源 | 不變式 |
|------|------|-----------|--------|
| `title` | `string` | 成功：LLM 繁中標題（≤50 收斂後）；降級：候選原文標題（不收斂） | 成功版 `countCodePoints ≤ 50` |
| `content` | `string \| null` | 成功：LLM 繁中內容（≤300 收斂後）；降級：`null`（僅標題＋連結） | 成功版 `countCodePoints ≤ 300` |
| `url` | `string` | **程式提供**＝`candidate.originalUrl`（事實，非 LLM） | 對回一個真實候選 |
| `domain` | `'ai' \| 'devops' \| 'frontend-backend'` | **程式提供**＝`candidate.domain` | — |
| `sourceCount` | `number` | **程式提供**＝`candidate.sources.length` | `≥ 1` |
| `weightedScore` | `number` | **程式提供**＝`candidate.weightedScore`（供 F7 觀測，非 LLM） | — |
| `degraded` | `boolean` | `false`＝繁中精煉版；`true`＝降級原文版（FR-013） | 同一 digest 內全體一致（見 §1.4） |

> **防幻覺不變式**：每則 `CuratedNewsItem` 必可對回輸入 `candidates` 中的一個元素（其 `url`／
> `domain`／`weightedScore` 恆取自該候選）；無法對回者於硬驗證層已剔除（FR-009、SC-005）。

### 1.4 `CuratedDigest` — 當日晨報精選集（服務輸出）

`NewsCurationService.curate()` 的回傳。

| 欄位 | 型別 | 語意 | 不變式 |
|------|------|------|--------|
| `items` | `CuratedNewsItem[]` | 依開發者重要性排序的精選（成功：LLM 序；降級：`weightedScore` 序） | `length ≤ 6` |
| `degraded` | `boolean` | 整份是否為降級版（策展失敗降級路徑） | 與 `items[*].degraded` 一致 |

**集合層不變式**（`items` 對成功與降級路徑皆須成立，除註明外）：
- **總數**：`items.length ≤ 6`（FR-008/SC-003）。
- **配額**：非 AI（`domain !== 'ai'`）數量 `≤ 2`；AI 候選足夠時 AI `≥ 4`（軟性下限，候選不足照實，
  FR-004/005）。
- **不硬湊**：候選不足時 `items.length` 照實 < 6，不從未改寫候選遞補（FR-005/010）。
- **參照唯一**：`items` 內不重複對回同一候選（FR-009 去重）。
- **殘留語意去重**（**僅成功路徑**，SC-006）：刻意含殘留語意重複的輸入，最終同一事件 `≤1` 則；
  降級路徑**不保證**此點（Clarifications 2026-07-18、Edge）。
- **空輸入**：`candidates` 為空 → `items` 為空、`degraded: false`、**未呼叫 LLM**（FR-020/SC-001）。

### 1.5 `CurationInput` — `curate()` 的輸入契約

| 欄位 | 型別 | 語意 |
|------|------|------|
| `candidates` | `NewsCandidate[]`（F4 `CandidateSet`，已排序、帶 `weightedScore`） | 策展與降級的唯一候選來源；`onBoard` 脈絡由呼叫端於投影前提供（見契約） |

> 「候選是否命中榜上 repo」的脈絡由**呼叫端（F7）**傳入。實作上以 `curate(candidates, boardRepoNames)`
> 形式接收榜上 repo 名稱集合（`ReadonlySet<string>`），投影 `CurationItemView.onBoard` 時以 F4 既有的
> `mentionsBoardRepo(candidate, boardRepoNames)` 判定（引用既有的尺，不另發明）；`curate()`
> **MUST NOT** 自行抓榜單／新聞（FR-001）。空集合時 `onBoard` 全為 `false`（安全略過）。

---

## 2. 榜單摘要型別（`src/curation/board-summary.types.ts`）

### 2.1 `BoardChangeDigest` — TL;DR 輸入投影（由 F7 自 `BoardDiff` 投影，D3）

| 欄位 | 型別 | 語意 | 不變式 |
|------|------|------|--------|
| `newcomers` | `number` | 新進計數（`kind==='newcomer'`） | `≥ 0` |
| `climbed` | `number` | 竄升計數（`kind==='climbed'`） | `≥ 0` |
| `declined` | `number` | 下降計數（`kind==='declined'`） | `≥ 0` |
| `domainCounts` | `{ ai: number; 'frontend-backend': number }` | 新進＋竄升的領域分布（下降不計亮點） | 各 `≥ 0` |
| `topName` | `string \| null` | 本次綜合榜 #1 full name（語境／無變化用，可省） | — |

> F6 **不吃** F3 `BoardDiff` 整體、不碰 F3 服務；投影職責屬 F7（D3）。

### 2.2 `BoardChangeSummary` — TL;DR 輸出（`summarize()` 回傳）

| 欄位 | 型別 | 語意 | 不變式 |
|------|------|------|--------|
| `summary` | `string` | 一句繁中封面 TL;DR | 非空 |
| `degraded` | `boolean` | `false`＝LLM 改寫版；`true`＝程式事實型摘要（FR-016） | — |

**不變式**：
- 成功版 `summary` **只依 `digest` 事實**、不杜撰數字／名稱（FR-015、SC-007）。
- 降級版 `summary`＝`factSummary(digest)`（如「本週 N 個新進、M 個竄升、K 個下降」；三者皆 0 →
  「本週榜單無變化」），數字 100% 取自 `digest`（SC-007）。
- 無論成功或失敗，`summarize()` **不擲錯**（FR-016，不阻斷榜單推播）。

---

## 3. 型別關係圖

```text
F4 CandidateSet (NewsCandidate[])                     呼叫端(F7) boardRepoNames:Set<string>
        │                                                       │
        └──────────────┐          ┌───────────────────────────┘
                        ▼          ▼
              NewsCurationService.curate(candidates, boardRepoNames)
                        │  ① 空候選 → 回空 CuratedDigest（不呼叫 LLM）
                        │  ② 投影 → CurationItemView[]（含 ref/onBoard）
                        │  ③ 單次 LlmService.generate(prompt)
                        │  ④ parseCurationResponse → CurationLlmPick[]   ──解析失敗─┐
                        │  ⑤ validateCuration（剔幻覺→夾非AI≤2→截≤6→字數收斂）      │
                        ▼                                                          ▼
                 CuratedDigest{ items:CuratedNewsItem[], degraded:false }   fallbackDigest()
                                                                    （weightedScore 前段套配額
                                                                      →原文標題+連結, degraded:true）

F3 BoardDiff ──(F7 投影)──▶ BoardChangeDigest ──▶ BoardSummaryService.summarize()
                                                        │ LLM 一次 TL;DR ──失敗──▶ factSummary()
                                                        ▼
                                                 BoardChangeSummary{ summary, degraded }
```

## 4. 持久化與狀態邊界（FR-019）

F6 **不觸碰** `state/board.json`、`StateStore`、`seenNews`，**不 git commit**。所有上述型別存在於
單次執行的記憶體中，`curate()`／`summarize()` 回傳後即交 F7 組版、推播、於**推播成功後**統一落檔
（憲章 VI「狀態必須在推播成功後才寫回」）。
