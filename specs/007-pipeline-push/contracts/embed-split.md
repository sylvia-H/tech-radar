# Contract: `chunkEmbeds` — 單則 ≤10 embeds 通用切分（純函式）

`embed-split.ts`。取代 dev-guide §7.2「晨報改送第二則」特例，改用依序 chunk-by-10 的通用規則
（research D3，spec Assumptions）。

## 簽章

```ts
export function chunkEmbeds(embeds: DiscordEmbed[], max = 10): DiscordEmbed[][];
```

## 契約

- **輸入**：依**顯示順序**排好的 embed 序列。純函式對輸入的語意無感——**呼叫端各自傳入自己那份**：
  榜單段傳 `[cover, ...cards]`、晨報段傳 `digestEmbeds`（**不合併兩段**成單一陣列再呼叫，見
  `pipeline-orchestration.md` C1/C4、`discord-layout.md` L5：合併會使一次 Discord 失敗同時波及兩段
  的 push-then-commit，牴觸 FR-013 段間隔離）。
- **輸出**：`DiscordEmbed[][]`，每個內層陣列即一則 Discord 訊息的 `embeds`。
- **保證**（對應 SC-005）：
  1. 每批 `length ≤ max`（預設 10）；**任一批 MUST NOT > 10**。
  2. **順序保持**：`flat(output)` 逐一等於 `input`（同物件參照、同索引順序）。
  3. **無遺漏、無重複**：`flat(output).length === input.length`。
  4. `input.length === 0` → 回 `[]`（呼叫端不送空訊息）。
  5. `0 < input.length ≤ max` → 回 `[input]`（一批）。

## 必測案例（憲章 VIII）

| 案例 | 輸入 embeds 數 | 期望批數 / 各批數 |
|------|----------------|-------------------|
| 空 | 0 | `[]`（0 批） |
| 穩定態（榜單段） | 4（封面＋3 卡） | 1 批 ×4 |
| 恰滿 | 10 | 1 批 ×10 |
| 冷啟動（榜單段自身） | 12（純函式邊界案例，任意輸入皆適用） | 2 批：10 + 2 |
| 邊界（榜單段冷啟動實際情境） | 11（封面＋10 卡） | 2 批：10 + 1 |
| 順序 | 任意 | `flat` 等於輸入序列（斷言參照與索引） |

呼叫端（**每段服務各自**呼叫一次，不跨段合併輸入）對每批 `await discord.send({ username, embeds: batch })`；
任一批擲錯即該段 push-then-commit 不提交（見 `pipeline-orchestration.md` C2/C3）。
