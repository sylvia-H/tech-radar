# Quickstart & Validation: LLM 封裝與 repo 250 字簡介

驗證 F5 三塊（LlmService／README 取得／IntroService）符合 spec 的 SC-001…SC-007。F5 不推播、不
commit——驗證以**單元測試**與可選的**一次性本機生成**為主，全程可 mock、不必真連 Gemini。

## 前置

```powershell
npm ci
npm run build            # tsc，strict，零 error
```

新增相依（tasks 階段執行）：

```powershell
npm install @google/genai
```

機密（僅「可選的真實生成」需要；單元測試不需要）：`GEMINI_API_KEY`、`GH_API_TOKEN` 以環境變數提供，
**勿寫入檔案**（憲章 VII）。

## 主驗證：單元測試

```powershell
npm test                 # Jest 全綠
npm test -- intro        # 只跑簡介相關
npm test -- llm          # 只跑 LLM 封裝
```

### 對照表（測試 → SC / FR）

| 驗證情境 | 檔案 | 對應 |
|----------|------|------|
| 快取命中回 `cached`、**LLM/README 呼叫次數 = 0** | `intro/intro.service.spec.ts` | SC-001、FR-002 |
| 掉出後重進榜仍命中、0 次重生成 | `intro/intro.service.spec.ts` | SC-006、FR-005 |
| 生成路徑 → `generated`、≤250 繁中、寫入 `state.intros[key]` | `intro/intro.service.spec.ts` | SC-002、FR-004 |
| LLM 回 >250 → 收斂 ≤250 才輸出/快取 | `intro/intro-length.spec.ts` | SC-002、FR-006 |
| README < 200 或取不到 → 退回 description+topics | `intro/intro-material.spec.ts` | US3、FR-008 |
| `stripMarkdownNoise` 去 badge/HTML/連結、截斷 6000 | `intro/markdown-noise.spec.ts` | FR-003 |
| 降級 → `degraded`＋description、**未寫快取**、其餘 repo 不受影響 | `intro/intro.service.spec.ts` | SC-004、FR-014/015/016 |
| 空快取（`intro === ''`）不算命中、重生成 | `intro/intro.service.spec.ts` | Edge Case |
| LLM 首次 429 → 退避後成功 | `llm/llm.service.spec.ts` | SC-007、FR-012 |
| LLM 持續 429 → 耗盡擲 `LlmError('exhausted')`、重試 = `LLM_MAX_RETRIES` | `llm/llm.service.spec.ts` | FR-012/014 |
| README 404/網路錯誤 → 回 `''` | `github/github-readme.spec.ts` | FR-010、US3 |

**通過準則**：上述全綠；`npm run build` 零 error；快取命中測試以 mock 斷言呼叫次數 0（額度安全的核心
護欄）。

## 可選：一次性本機真實生成（人工抽驗品質，非 CI）

在具 `GEMINI_API_KEY` / `GH_API_TOKEN` 的本機，以一支臨時腳本或 REPL 取一個代表性 repo 的 `IntroInput`
呼叫 `ensureIntro`，人工檢視：

- 回傳為 ≤250 字**繁體中文**段落，結構為「解決什麼 → 特色 → 適合誰」（SC-002）。
- 內容忠於 README，**不含**素材未出現的星數/名次/連結（抽樣 0 起杜撰，SC-005）。
- 再呼叫一次同 repo → `status: 'cached'`、無新的 LLM 呼叫（SC-001）。

> 此步驟只為人工品質抽驗；**不納入自動化、不推播、不寫入 repo 內的 state**。額度消耗 1 次，符合憲章 I。

## 冷啟動用量預估（對照 SC-003）

冷啟動首次最多 10 個新進 repo → ≤10 次 LLM 呼叫（每 repo 一次）；穩定態每七天 0～數個 → 0～數次，
遠低於 ~1,500 RPD。快取命中恆為 0 呼叫。無 embeddings/向量檢索（憲章 V）。
