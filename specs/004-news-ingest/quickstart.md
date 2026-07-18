# Quickstart / 驗證指南: 004-news-ingest

驗證「從設定檔抓到候選清單」的完整鏈路，並逐一對照 Success Criteria。**全部情境不需真實網路**
（抓取以 mock／注入，時間以 `now` 注入）。

## 前置

```powershell
npm ci
npm i rss-parser          # 本 Feature 新增相依（憲章技術釘死清單內）
npm run build             # tsc strict 應無錯
```

- 三個機密（`GH_API_TOKEN`／`GEMINI_API_KEY`／`DISCORD_WEBHOOK_URL`）**本 Feature 不需**：新聞 feed
  皆公開、F4 不呼叫 LLM、不推播。告警路徑於單測以 mock `DiscordWebhookService` 驗證。

## 單元測試（憲章 VIII，實作完成的判準）

```powershell
npm test
```

須涵蓋（對照 spec Independent Test 與 SC）：

| 測試主題 | 檔案 | 對應 |
|----------|------|------|
| 來源 schema 驗證：重複 id／缺欄位擲錯 | `config/news-source.schema.spec.ts` | FR-002 |
| 啟用/停用抓取分派 | `news/fetchers/fetcher.spec.ts` | FR-003/004、US1-2/3 |
| 四抓取器解析（快照） | `news/fetchers/*.fetcher.spec.ts` | FR-005/007/010、US1-1 |
| releases 版本過濾（drop pre-release/patch） | `news/release-filter.spec.ts` | FR-008、**SC-010** |
| target-URL 正規化（追蹤參數/大小寫/尾斜線/短網址） | `news/url-normalize.spec.ts` | FR-011、**SC-009** |
| URL 去重合併（最高分代表、sources[] 合併） | `news/dedup.spec.ts` | FR-012、**SC-001** |
| 標題 Jaccard 去重（近似合併／低於門檻不合併） | `news/title-similarity.spec.ts`、`dedup.spec.ts` | FR-013、US2-3/4 |
| 無目標連結以自身連結為鍵、不崩潰 | `news/dedup.spec.ts` | FR-015、Edge |
| cross 關鍵字歸類（前後端 → 單一桶；含 devops） | `news/news-classify.spec.ts` | FR-006、US1-7 |
| 分數門檻：Tier2/無分數不被丟 | `news/funnel.spec.ts` | FR-016、**SC-005** |
| 交叉驗證／榜單相關加權；無榜單安全略過 | `news/funnel.spec.ts` | FR-017/018、Edge |
| tier 差異化門檻與權重 | `news/funnel.spec.ts` | FR-019 |
| 全序決勝與收斂規模；確定性 | `news/funnel.spec.ts` | FR-020/021、**SC-006/011** |
| seenNews 7 天修剪 | `news/seen-news.spec.ts` | FR-023、**SC-008** |
| seen 以正規化 URL 排除 | `news/seen-news.spec.ts` | FR-022、**SC-007** |
| 0 筆發帶 id 告警（含 Tier 2）／單源失敗不斷全線 | `news/news-ingest.service.spec.ts` | FR-025/026、**SC-003/004** |

## 端到端觀測（手動 smoke，非必需）

以少數真實 feed（四型各一）跑一次抓取，於 log 檢視候選清單（`news-log.ts` 輸出）：
- 統一結構、`domain`/`tier` 取自設定；
- 跨來源同一則只一筆、`sources[]` 合併；
- 規模收斂約 15–25 則。

> 端到端串接進 `PipelineService` 與推播屬 F7；本 Feature 到「候選清單可觀測」為止。

## 驗收出口（= M2，與 F3 合併）

- 跨來源同一則新聞只出現一筆、`sources[]` 正確合併（SC-001）。
- 候選收斂至約 15–25 則（SC-006）。
- 上述單測全綠、`tsc` strict 無錯。
