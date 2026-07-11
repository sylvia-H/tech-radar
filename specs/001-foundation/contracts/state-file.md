# Contract: `state/board.json` 狀態檔

唯一權威的跨執行狀態（憲章 VI）。F1 建立其讀寫契約與 schema 骨架。完整欄位語意見 [../data-model.md](../data-model.md)。

## StateStore 介面契約

```ts
interface StateStore {
  // 讀取；檔案不存在→回空骨架；存在但結構不合法→擲錯（觸發告警）
  load(): Promise<BoardState>;

  // 寫入；寫入前以 schema 驗證；僅落檔，不負責 git commit（由 workflow 決定 diff）
  save(state: BoardState): Promise<void>;
}
```

### `load()` 行為契約

| 情境 | 期望結果 |
|------|----------|
| 檔案不存在 | 回傳空骨架（`board/intros={}`、`seenNews=[]`、兩時間戳 `null`），不擲錯 |
| 檔案存在且合法 | 回傳解析後且通過 zod 驗證的 `BoardState`，欄位不遺失 |
| 檔案存在但 JSON 壞或結構不合法 | 擲錯（呼叫端捕獲 → 紅色告警），**不**以空骨架覆寫既有壞檔 |

### `save()` 行為契約

| 情境 | 期望結果 |
|------|----------|
| 傳入合法 `BoardState` | 序列化（穩定鍵序、2-space、結尾換行）寫入 `state/board.json` |
| 傳入不合法物件 | 擲錯，不寫檔 |
| 內容與現存檔相同 | 仍可寫入相同內容；是否 commit 由 workflow 的 `git diff --cached --quiet` 判斷（no-diff→不 commit） |

## 檔案格式不變條件

- UTF-8、JSON、以**穩定鍵序**輸出（利於 git diff 乾淨、減少假變更）。
- 五個頂層欄位恆存在。
- 檔案受 git 版本化；由 workflow 以 `radar-bot` 身分 commit（訊息含 `[skip ci]`）。
- 檔案中**不得**出現任何機密。

## 序列化範例（穩定鍵序）

```json
{
  "lastBoardPushAt": null,
  "lastNewsPushAt": null,
  "board": {},
  "intros": {},
  "seenNews": []
}
```
