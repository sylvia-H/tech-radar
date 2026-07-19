# Contract: `chunkEmbeds` — 單則 ≤10 embeds 通用切分（純函式）

`embed-split.ts`。取代 dev-guide §7.2「晨報改送第二則」特例，改用依序 chunk-by-10 的通用規則
（research D3，spec Assumptions）。

## 簽章

```ts
export function chunkEmbeds(embeds: DiscordEmbed[], max = 10): DiscordEmbed[][];
```

## 契約

- **輸入**：依**顯示順序**排好的 embed 序列（榜單封面 → 卡片… → 晨報 1~2）。
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
| 穩定態 | 4（封面＋2 卡＋晨報） | 1 批 ×4 |
| 恰滿 | 10 | 1 批 ×10 |
| 冷啟動 | 12（封面＋10 卡＋晨報） | 2 批：10 + 2 |
| 邊界 | 11 | 2 批：10 + 1 |
| 順序 | 任意 | `flat` 等於輸入序列（斷言參照與索引） |

呼叫端（段服務）對每批 `await discord.send({ username, embeds: batch })`；任一批擲錯即該段
push-then-commit 不提交（見 `pipeline-orchestration.md` C2/C3）。
