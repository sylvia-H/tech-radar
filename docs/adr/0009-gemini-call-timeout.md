# 0009. Gemini 呼叫逾時：策展 10 分鐘、其餘 300 秒，逾時不在同一型號重試

- **狀態**：Accepted
- **日期**：2026-10-27
- **相關**：憲章 I（免費額度）、VII（失敗不得無聲）；開發指南 §2.4；`src/llm/gemini-dispatcher.ts`、`src/llm/llm.service.ts`、
  `src/llm/llm.types.ts`（`LLM_TIMEOUT_MS`／`NEWS_LLM_TIMEOUT_MS`）、`.github/workflows/radar.yml`（Run Tech Radar 步驟）

## 脈絡

策展開 `thinking=high` 後，Gemini 要生成完整份回應才送 HTTP 標頭。2026-10-22～10-26 的 Flash 成功呼叫耗時 133～287 秒，
逐日變長。10-27 乾跑（run 40437009151）中 Flash 兩次在送出後正好 300 秒以 `fetch failed` 失敗：這是 Node 內建 `fetch`（undici）
預設的 300 秒 `headersTimeout`。每次白等 5 分鐘再退避重試，最後退到 Lite 備援。`@google/genai` 走全域 `fetch`、不接受
自訂 dispatcher；它的 `httpOptions.timeout` 會試著調大全域 dispatcher 上描述含「headers timeout」的 symbol，但 Node 24 的
全域 dispatcher 是 `Agent`（Node 26 為 `Dispatcher1Wrapper`），身上沒有這類 symbol（兩版本實測），所以調整不會生效。

## 決策

- 連線層：`LlmService` 建構時以 `installGeminiDispatcher()` 換掉全域 dispatcher（npm `undici` `Agent`），按 origin 只把
  `generativelanguage.googleapis.com` 的 headers／body 逾時上限拉到 10 分鐘，其餘 origin 沿用 undici 預設。
- 呼叫層：每次 HTTP 呼叫以 `config.abortSignal` 限時。策展（主、備援、解析失敗的備援重試、補發翻譯）10 分鐘，簡介與榜單
  TL;DR 300 秒（與修改前相同）。
- 逾時擲 `LlmError('timeout')`，**不在同一型號重試**，交呼叫端換備援或降級；429、503 與其他網路錯誤照舊退避重試 4 次。
- workflow 的 Run Tech Radar 步驟設 `timeout-minutes: 60`。

## 否決的替代方案

- 只設 SDK `httpOptions.timeout`（Agent 自評）→ 在 Node 24／26 上調不動全域 dispatcher 的逾時，300 秒照樣砍斷。
- 所有 origin 一律拉長逾時（Agent 自評）→ 卡住的 RSS 來源、GitHub、Discord 也要多等，與問題無關。
- 只在連線層對 Gemini 拉到 10 分鐘、逾時照舊重試 4 次（分支初版；合併門第 1 輪審查指出）→ 策展鏈最壞約 12 次 × 10 分鐘，
  約 2 小時才降級；逾時當下 Gemini 端可能已生成完，每次重送都可能多扣免費層 RPD。簡介／TL;DR 也會被一起拉到 10 分鐘。
- 降低 thinking 深度（Agent 自評）→ 會犧牲策展品質（2026-09-27 乾跑：thinking 讓同一候選池的 Lite 從 6 則變 12 則），不採用。
- 改用串流 `generateContentStream`（Agent 自評）→ thinking 期間未必有 chunk，`bodyTimeout` 同樣是 300 秒；改動也較大。
- 改設 job 層 `timeout-minutes`（Agent 自評）→ job 逾時會整個中止，`failure()` 告警步驟不會執行，失敗變成無聲。

## 後果與觀察

- 最壞耗時：策展主、備援各一次 10 分鐘逾時加 503 退避，約 25 分鐘；榜單日每個新進 repo 的簡介最壞再多 5 分鐘。超過 60 分鐘
  由步驟逾時中止並送紅色告警，當天不寫狀態。
- 啟用 Node 環境代理（`NODE_USE_ENV_PROXY` 或 `--use-env-proxy`）時不換 dispatcher：保留代理連線，Gemini 逾時上限維持 300 秒，
  並印 warn。
- 帶 `abortSignal` 後，不帶任何進階設定的請求體會多一個空的 `generationConfig`，等同不帶設定。
- 驗證點：Flash 呼叫在 300 秒後仍成功回應（看 Actions log「LLM 用量」行的時間戳，與前一行比對）。出現「LLM 呼叫逾時」warn
  代表真的等滿 10 分鐘；如果成為常態，要重新評估 thinking 深度或型號。
