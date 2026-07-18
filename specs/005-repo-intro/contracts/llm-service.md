# Contract: LlmService（通用 LLM 封裝）

所有 LLM 呼叫的唯一入口（FR-011）。本 Feature 由簡介使用，F6 新聞策展 MUST 重用同一封裝、
不另建平行 LLM 客戶端。位置：`src/llm/llm.service.ts`。

## 介面

```ts
@Injectable()
export class LlmService {
  /**
   * 對 Gemini Flash 送一段 prompt 生成文字。
   * @param prompt 純文字 prompt（內容為公開 README/metadata，FR-013）
   * @returns 生成文字（trim 後非空）
   * @throws LlmError 空 prompt / 空回應 / 重試耗盡 / 不可重試錯誤
   */
  async generate(prompt: string): Promise<string>;
}
```

## 常數（模組層具名匯出，利於測試與調整）

| 常數 | 值 | 依據 |
|------|----|------|
| `GEMINI_MODEL` | `'gemini-2.5-flash'` | dev-guide §2.4；Flash 系免費 |
| `LLM_MAX_RETRIES` | `4` | research D6 |
| `LLM_BACKOFF_BASE_MS` | `1000` | research D6 |
| `LLM_MAX_BACKOFF_MS` | `8000` | research D6 |

## 行為契約

| 條件 | 行為 |
|------|------|
| 正常 | `generateContent({ model: GEMINI_MODEL, contents: prompt })` → 回 `response.text`（trim 後） |
| `prompt` 為空/全空白 | 立即擲 `LlmError('empty')`，不呼叫 API |
| 回應 `text` 空/全空白 | 擲 `LlmError('empty')` |
| **429**（速率/額度） | 指數退避 + jitter 重試至 `LLM_MAX_RETRIES`；仍失敗 → `LlmError('exhausted')` |
| **503** / 網路錯誤 | 同 429 退避重試；耗盡 → `LlmError('exhausted')` |
| 400/401/403（憑證/請求型） | 不重試，擲 `LlmError('error')` |
| 退避計時 | `base × 2^(attempt-1) + random[0, base)`，上限 `LLM_MAX_BACKOFF_MS`；經可注入 `sleep` |

## 機密與安全

- `apiKey` 由 `ConfigService.get('GEMINI_API_KEY')` 取得（F1 env.schema 已驗證存在）；**絕不**寫入
  log／錯誤訊息／任何產物（憲章 VII）。
- **只送公開資料**：`generate` 只接受呼叫端給的 prompt，不自行附加任何機密（FR-013）。
- log 不輸出 prompt／回應全文（避免噪音與潛在敏感內容）；失敗只記類別與必要脈絡。

## 測試契約（憲章 VIII）

- 注入 mock 的 `@google/genai` 客戶端（或 `generateContent` 函式）。
- 首次 429 → 隨後成功：斷言有退避、最終回正常文字（SC-007）。
- 持續 429 至耗盡：斷言擲 `LlmError('exhausted')`、重試次數 = `LLM_MAX_RETRIES`。
- 空回應：擲 `LlmError('empty')`。
- 400/403：不重試、擲 `LlmError('error')`。
- 退避以 fake timer／注入 `sleep` 驗證，不真實等待、不打真實 API。
