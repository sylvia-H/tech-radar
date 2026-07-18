# Contract: README 取得（github-readme）

沿用既有 `GithubHttpService` 取回指定 repo 的 README（FR-010，不另建平行請求層）。
位置：`src/github/github-readme.ts`。

## 介面

```ts
/**
 * 取得 repo 的 README 純文字內容（UTF-8）。
 * @returns 解碼後的 README 字串；取不到 / 404 / 非預期編碼 → ''（交由呼叫端走退回素材）
 */
export async function fetchReadme(
  http: GithubHttpService,
  owner: string,
  name: string,
): Promise<string>;
```

## 行為契約

| 條件 | 行為 |
|------|------|
| 正常 | `http.getJson<ReadmeEnvelope>('https://api.github.com/repos/{owner}/{name}/readme')` → `Buffer.from(content, 'base64').toString('utf-8')` |
| 404（無 README） | `catch GithubHttpError(404)` → 回 `''` |
| 其他 `GithubHttpError` / 網路錯誤 | `catch` → 回 `''`（不阻斷；簡介走退回素材） |
| `encoding !== 'base64'` | 保守回 `''` |

`ReadmeEnvelope` = `{ content: string; encoding: string }`（見 data-model）。

## 抓取禮貌與機密（沿用 F1）

- `getJson` 已帶自訂 `User-Agent`、`Bearer GH_API_TOKEN`、5xx/429/secondary-limit 退避、rate-limit
  監看；README 取得直接複用，不重造。
- token 只在 `getJson` 內部使用，錯誤訊息/log 不含 URL 與 token（憲章 VII）。
- 每次 README 取得計 1 次 `core` 呼叫；≤10 repo → ≤10 core，遠低於 5,000/hr（憲章 I）。

## 測試契約

- mock `GithubHttpService.getJson`：
  - 回 `{ content: base64(<md>), encoding: 'base64' }` → 斷言解碼正確。
  - 拋 `GithubHttpError(404)` → 回 `''`。
  - 拋網路錯誤 → 回 `''`。
  - `encoding: 'none'` → 回 `''`。
