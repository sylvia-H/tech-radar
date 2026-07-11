# Contract: Discord Channel Webhook（outbound）

F1 對外唯一的網路互動：以 HTTP POST 將訊息送到 `DISCORD_WEBHOOK_URL`。只推播、不收訊息（無 bot / gateway）。

## Endpoint

```
POST {DISCORD_WEBHOOK_URL}
Content-Type: application/json
```

- `DISCORD_WEBHOOK_URL` 形如 `https://discord.com/api/webhooks/{id}/{token}`（亦接受 `discordapp.com` 及 `ptb.`/`canary.` 子域名變體），僅來自 Actions Secrets。
- **成功**：HTTP `204 No Content`（無 body）。
- **失敗**：4xx/5xx；`429` 帶 `retry_after`（F1 以有限次退避重試，逾次數視為失敗）。

## Request Body（F1 使用子集）

```jsonc
{
  "username": "Tech Radar",          // 選填，覆寫顯示名稱
  "avatar_url": "https://…",         // 選填
  "embeds": [                          // ≤10 筆／訊息
    {
      "title": "string ≤256",
      "description": "string ≤4096",  // 選填
      "color": 16097315,               // 十進位色值（0xF5A623）
      "timestamp": "ISO-8601",         // 選填
      "url": "https://…",              // 選填：設在 embed 上→點標題開連結
      "fields": [                       // 選填，≤25；F1 未使用
        { "name": "≤256", "value": "≤1024", "inline": true }
      ]
    }
  ]
}
```

## F1 具體訊息

### 連通測試（PipelineService 成功時）

```jsonc
{
  "username": "Tech Radar",
  "embeds": [{
    "title": "📡 Tech Radar 連通測試",
    "description": "骨架執行成功 · <執行時間戳 ISO> · env=<ci|local>",
    "color": 16097315   // 0xF5A623 橙
  }]
}
```

### 失敗告警（app 內 catch，FR-010）

```jsonc
{
  "username": "Tech Radar",
  "embeds": [{
    "title": "⚠️ Tech Radar 執行失敗",
    "description": "<步驟/錯誤摘要，不含機密> · 請查 Actions log",
    "color": 15158322   // 0xE74C3C 紅
  }]
}
```

### 失敗告警（workflow `if: failure()`，FR-014）

同上紅色 embed，description 為固定字串（如「workflow 失敗，請查 Actions log」），由 workflow 內 `curl` 送出，涵蓋 checkout/build/機密載入**與 app 成功後的狀態 commit/push** 失敗。

## 契約性質不變條件

- **機密不外洩**：任何 embed 的 title/description/fields **絕不**包含 token、webhook URL 或金鑰（憲章 VII）。
- **失敗不無聲**：app 內失敗與 app 啟動前失敗各由一層負責，至少一則紅色告警必達（除非 Discord 本身不可用）。
- 單則訊息 `embeds` ≤10；F1 每次僅送 1 筆。
