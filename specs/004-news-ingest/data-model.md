# Phase 1 Data Model: 004-news-ingest

實體來自 spec「Key Entities」與 Functional Requirements。除 `SeenNews` 外皆為**單次執行的記憶體
型別**（不持久化）；`SeenNews` 沿用 `state.schema.ts` 既有欄位、本 Feature 只讀取與修剪。

## 1. NewsSource（新聞來源；設定即資料，憲章 IV）

`src/config/news-sources.ts` 清單中的一筆來源定義。

| 欄位 | 型別 | 規則 |
|------|------|------|
| `id` | `string` | **唯一**（抓取告警與 `seenNews` 統計引用鍵）；清單層驗證重複即擲錯（FR-002） |
| `type` | `'hn-algolia' \| 'reddit-weekly' \| 'rss' \| 'github-releases'` | 決定分派哪個抓取器（FR-004） |
| `url` | `string`（URL） | feed／端點位址 |
| `domain` | `'ai' \| 'devops' \| 'frontend-backend' \| 'cross'` | 非 `cross` 直接沿用；`cross` 交關鍵字歸類（FR-006；Clarifications 2026-07-16） |
| `tier` | `1 \| 2 \| 3` | 漏斗門檻／權重差異化（FR-016/019） |
| `enabled?` | `boolean` | 預設 `true`；停用者完全略過（FR-003） |

**驗證規則（`news-source.schema.ts`）**：zod 逐筆 schema ＋ 跨筆唯一 `id`；缺必填或列舉不符或 id
重複 → 擲帶 id 的明確錯誤，MUST NOT 靜默載入（FR-002）。

## 2. RawItem（抓取器統一輸出；正規化前）

各抓取器把來源原始格式收斂成的中間結構。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `title` | `string` | 原始標題 |
| `targetUrl` | `string` | 新聞本體連結；HN 無外部連結時為自身 permalink（FR-015） |
| `summary` | `string \| null` | feed 摘要／描述節錄（截 ~500 字，FR-007） |
| `score` | `number \| null` | 社群分數；RSS 無分數者為 `null`（D8） |
| `publishedAt` | `string \| null` | ISO 8601 新鮮度 |

## 3. NewsCandidate（新聞候選；正規化後的統一結構，FR-005）

| 欄位 | 型別 | 說明 |
|------|------|------|
| `title` | `string` | |
| `normalizedUrl` | `string` | **去重主鍵**（`normalizeTargetUrl` 產出，FR-011） |
| `originalUrl` | `string` | 正規化前的 target-URL（供輸出/觀測） |
| `summary` | `string \| null` | 摘要節錄 |
| `sourceId` | `string` | 代表項來源 id |
| `score` | `number \| null` | 代表項分數（合併時取最高分者為代表，FR-012） |
| `domain` | `'ai' \| 'devops' \| 'frontend-backend'` | 已解析領域（`cross` 經歸類後落定；輸出不留 `cross`） |
| `tier` | `1 \| 2 \| 3` | 代表項 tier |
| `sources` | `string[]` | 合併後的多來源 id 清單；`length >= 2` 為交叉驗證強訊號（FR-017） |
| `publishedAt` | `string \| null` | 新鮮度（決勝用，FR-020） |
| `weightedScore` | `number` | 漏斗加權後的排序輔助分（記憶體計算，非事實數據） |

**狀態轉換（生命週期，單次執行內）**：
`RawItem`（抓取）→ `NewsCandidate`（正規化：填 `normalizedUrl`/`domain`/`sources=[sourceId]`）
→ URL 合併（同 `normalizedUrl` 併為一筆，取最高分為代表、`sources[]` 累積）
→ 標題 Jaccard 合併（無共同 URL 但標題近似者再併）
→ `cross` 歸類（`domain` 落定為三桶之一）
→ 漏斗過濾（低分 Tier1/3 丟；Tier2/無分數保留）＋加權（`weightedScore`）
→ 排除 seen（`normalizedUrl` 命中 `seenNews` 則移除）
→ 排序（全序決勝）＋收斂 → 進入 `CandidateSet`。

**驗證/不變式**：
- 去重後 `normalizedUrl` 在集合內唯一（SC-001/009）。
- URL 合併之代表項於**同分（含皆為 `null`）時**以 `sourceId`→`originalUrl` 字典序決勝，確保代表項唯一（FR-012、SC-011）。
- `domain` 於輸出必為 `ai|devops|frontend-backend`（`cross` 僅存在於來源設定與歸類前）。
- Tier 2 或 `score === null` 之候選不因分數門檻被丟（SC-005）。
- 相同輸入 → 相同成員與排序（SC-011，四層全序）。

## 4. SeenNews（已見新聞紀錄；跨執行持久化，既有 schema）

沿用 `state.schema.ts` 的 `seenNewsEntrySchema`：`{ url: string, seenAt: ISO8601 }[]`。

| 操作 | 本 Feature | 規則 |
|------|-----------|------|
| 讀取 | ✅ 經 `StateStore.load()` | 唯一狀態存取（FR-024，憲章 VI） |
| 修剪 | ✅ 記憶體 `pruneSeenNews` | 剔除 `seenAt` 逾 7 天者（FR-023, SC-008） |
| 排除比對 | ✅ `excludeSeen` | 以**正規化 URL**比對（FR-022, SC-007） |
| 寫回 | ❌ 屬 F6/F7 | 推播成功後才標記已見並寫回（FR-024） |

> 注意：`seenNews[].url` 之既存值語意應為「正規化後 target-URL」；排除比對時對候選 `normalizedUrl`
> 與 `seenNews[].url` 皆套同一 `normalizeTargetUrl`（對已正規化字串為冪等），確保表面差異不漏排除。

## 5. CandidateSet（候選清單；F4 最終產物 → F6 輸入）

- 形狀：`NewsCandidate[]`（已去重、已過濾、已排序、已排除 seen）。
- 規模：目標約 15–25 則（候選充足時）；稀少時照實較少、不硬湊（FR-021, SC-006）。
- 產出面：僅記憶體 ＋ `news-log.ts` 觀測輸出；**不推播、不寫狀態**（本 Feature 邊界）。

## 領域列舉關係圖

```text
來源設定 domain:  ai | devops | frontend-backend | cross
                                                  │ (cross 專屬)
                                                  ▼  news-classify（關鍵字，含 devops）
候選 domain:      ai | devops | frontend-backend            （輸出無 cross）
```

榜單（board）的 `Domain` 為 `ai | frontend-backend`（無 devops、無 cross）——**兩條資料流列舉
刻意不同**，故新聞不复用 `board.types.ts` 的 `Domain`，另定新聞自己的列舉（見 `news.types.ts`）。
