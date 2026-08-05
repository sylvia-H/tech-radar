# Phase 1 Data Model: 001-foundation

本 Feature 建立唯一權威狀態 `state/board.json` 的**結構骨架**與讀寫；F1 期間多數集合為空，但 schema 需完整定義，供 F2–F7 直接沿用。所有結構以 `zod` 定義並於讀/寫時驗證。

---

## 實體：BoardState（`state/board.json` 根物件）

| 欄位 | 型別 | F1 初值 | 說明 | 來源 Feature |
|------|------|---------|------|-------------|
| `lastBoardPushAt` | `string \| null`（ISO 8601 UTC） | `null` | 榜單上次推播時間；距今 ≥3 天才再推榜單 | F3/F7 使用 |
| `lastNewsPushAt` | `string \| null`（ISO 8601 UTC） | `null` | 晨報上次推播時間；<~18h 則跳過新聞段 | F7 使用 |
| `board` | `Record<string, BoardEntry>`（key = repoId） | `{}` | 各領域榜單快照 | F2/F3 |
| `intros` | `Record<string, IntroCache>`（key = repoId） | `{}` | repo 簡介快取，獨立於 `board`（跌出榜不清除） | F5 |
| `seenNews` | `SeenNewsEntry[]` | `[]` | 已推播新聞紀錄，含時間戳供 7 天修剪 | F4/F6 |

**驗證規則**：
- 五個頂層欄位皆必須存在（缺任一即結構不合法）。
- `lastBoardPushAt` / `lastNewsPushAt` 為 `null` 或合法 ISO datetime 字串。
- 讀取時若檔案不存在 → 回傳空骨架（見下）而非擲錯（spec Edge Case「狀態檔意外缺失」）。
- 讀取時若檔案存在但**結構不合法** → 視為錯誤並觸發告警（不靜默吞掉，避免用壞狀態覆寫）。
- 寫入前必先通過 schema 驗證。

### 空骨架（seed 進 repo，FR-015）

```json
{
  "lastBoardPushAt": null,
  "lastNewsPushAt": null,
  "board": {},
  "intros": {},
  "seenNews": []
}
```

---

## 子實體：BoardEntry（F1 定義 schema、不寫入資料）

| 欄位 | 型別 | 說明 |
|------|------|------|
| `fullName` | `string` | `owner/name` |
| `url` | `string`（URL） | repo 連結 |
| `language` | `string \| null` | 主要語言 |
| `domain` | `"ai" \| "devops" \| "backend" \| "frontend"` | 三領域歸類（frontend/backend 分列） |
| `starsThisWeek` | `number`（int ≥ 0） | 上次看到的本週增星 |
| `rank` | `number`（int ≥ 1） | 上次在其領域榜的名次 |
| `firstSeenAt` | `string`（ISO 8601 UTC） | 首次進榜時間 |

> `domain` 的具體歸類鍵與 enum 值在 F2 clarify 定案；F1 僅先固定型別，避免 F2 重構。

## 子實體：IntroCache

| 欄位 | 型別 | 說明 |
|------|------|------|
| `intro` | `string`（≤250 字繁中） | 已生成的簡介 |
| `introAt` | `string`（ISO 8601 UTC） | 生成時間 |

## 子實體：SeenNewsEntry

| 欄位 | 型別 | 說明 |
|------|------|------|
| `url` | `string`（正規化後的目標 URL） | 去重／去歷史重複的 key |
| `seenAt` | `string`（ISO 8601 UTC） | 推播時間，供 7 天修剪 |

---

## 實體：EnvConfig（環境變數，非持久化）

於啟動時載入與驗證（zod），**絕不寫入任何檔案或產物**（憲章 VII）。

| 變數 | 必填 | 驗證 | 用途（F1） |
|------|------|------|-----------|
| `DISCORD_WEBHOOK_URL` | 是 | 非空，且符合樣式 `^https://(ptb\.\|canary\.)?discord(app)?\.com/api/webhooks/`（容許 discord.com / discordapp.com 及 ptb/canary 變體，與 T005 一致） | 推播與告警目的地 |
| `GH_API_TOKEN` | 是 | 非空字串 | F2+ 使用；F1 僅驗證存在（部署一致性） |
| `GEMINI_API_KEY` | 是 | 非空字串 | F5+ 使用；F1 僅驗證存在（預設必填，見 research D4） |

---

## 實體：DiscordEmbedMessage（推播 payload，非持久化）

送往 webhook 的訊息物件（詳見 [contracts/discord-webhook.md](contracts/discord-webhook.md)）。F1 使用兩種：

- **測試 embed**：橙色 `0xF5A623`，標題「📡 Tech Radar 連通測試」，description 含執行時間戳與環境標記。
- **失敗告警 embed**：紅色 `0xE74C3C`，標題「⚠️ Tech Radar 執行失敗」，description 指向可排查位置（app 內帶錯誤摘要；workflow 層帶「請查 Actions log」）。

---

## 狀態轉移（F1 執行流程對 BoardState 的影響）

```
載入設定（env 驗證，失敗→fail-fast 不推播）
  → StateStore.load()（缺檔→空骨架；壞結構→告警）
  → 推測試 embed（成功才續）
  → StateStore.save()（僅在有實質變更時，交由 workflow 依 diff 決定是否 commit）
```

F1 的成功執行對 `board` / `intros` / `seenNews` / `lastBoardPushAt` **不產生變更**（無資料來源）；`lastNewsPushAt` 是否於 F1 推測試 embed 後更新，屬「是否製造 commit」的取捨——依澄清採**不更新頂層時間戳、不製造人工 commit**，M0 的 commit-back 於首次真實狀態變更（F2+）或一次性驗證時展示。詳見 quickstart「commit-back 驗證」。
