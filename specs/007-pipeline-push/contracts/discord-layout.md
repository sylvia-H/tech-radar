# Contract: Discord 組版（封面／卡片／晨報）

依 dev-guide §7.1/§7.2/§7.4。所有組版函式為**純函式**（可無 mock 單測，憲章 VIII）；事實欄位由程式填、
敘事欄位來自 LLM（憲章 VI）。上限：`title ≤256`、`description ≤4096`、`fields ≤25`、單則 `≤10 embeds`。

## L1. 色值（`discord.embed.ts` 常數）

| 用途 | 常數 | 值 |
|------|------|-----|
| 榜單封面藍 | `COLOR_BOARD_COVER` | `0x5865F2` |
| 晨報橙 | `COLOR_DIGEST` | `0xF5A623` |
| 卡片 AI | `COLOR_AI` | `0x10A37F` |
| 卡片 前後端 | `COLOR_FRONTEND_BACKEND` | `0xF7DF1E` |
| 失敗告警紅 | `COLOR_FAILURE`（沿用 F1） | `0xE74C3C` |

`domainColor(domain)`：`ai → COLOR_AI`；`'frontend-backend' → COLOR_FRONTEND_BACKEND`。

## L2. 榜單封面 `buildCoverEmbed(summary, diff, dateLabel): DiscordEmbed`

- `title`: `📊 榜單變化 · ${dateLabel}`；`color`: `COLOR_BOARD_COVER`。
- `description`: `**本次榜單變化**\n${summary.summary}`（`summary` 來自 F6，或降級事實型）；
  若 `diff.changes` 有 `declined`，追加一段 `🔻 下降` 一行式：每項 `[fullName](url) #prev → #curr`。
  `diff.unchanged`（三類皆空）時 `summary` 呈「本次無變化」摘要（F6 事實型），**仍推封面**（FR-012）。
- **掉出 top10 者當次靜默**：不列於封面、不出卡（FR-010，SC-006）。

## L3. 榜單卡片 `buildRepoCard(change, introResult, row): DiscordEmbed`

僅對 `newcomer` / `climbed`（`needsIntro=true`）。`isNew = change.kind === 'newcomer'`。
- `title`: `${isNew ? '🆕' : '🔺'} ${change.fullName}`；`url`: `change.url`（標題可點）；
  `color`: `domainColor(change.domain)`。
- `description`:
  - `introResult.status ∈ {cached, generated}` → 該 250 字 `intro`（正常簡介卡）。
  - `introResult.status === 'degraded'` → 以**可區分**的 description 卡呈現（如前綴標記「（簡介暫缺）」＋
    `introResult.description`），與正常簡介卡可辨（FR-010，SC-006）。
- `fields`（`inline: true`）：
  1. `本週增星` → `⭐ +${fmt(row.starsThisWeek ?? change.weeklyStarsEstimate)}`。
  2. `語言` → `` `${row.language ?? '—'}` ``。
  3. `isNew` → `領域` = `DOMAIN_LABELS[change.domain]`；否則 `名次` = `#${change.previousRank} →
     #${change.currentRank}`。

> 事實（增星／名次／語言／連結）一律取自程式（`change`/`row`）——**非 LLM 產生**（憲章 VI，FR-004）。

## L4. 晨報 `buildDigestEmbeds(digest, dateLabel): DiscordEmbed[]`（research D4）

- 逐則（AI 優先在前，順序沿用 F6 `digest.items`）組 markdown：
  - 正常（`item.content !== null`）：`N. [${item.title}](${item.url})` 換行 `${item.content}`。
  - 降級（`digest.degraded` 或 `item.content === null`）：`N. [${item.title}](${item.url})`（原文標題＋
    連結，**不套 300 字改寫**，FR-004）。
- 一張橙 embed：`title` `📡 Tech Radar 晨報 · ${dateLabel}`、`color` `COLOR_DIGEST`、`description`
  為上述串接。
- **若 description code-point 長度 > 4096** → 貪婪把 items 拆成**兩張**晨報 embed（皆橙），皆回傳於陣列
  （併入 `chunkEmbeds`，仍受單則 ≤10 約束，FR-018）。

## L5. 顯示順序與訊息組裝

**榜單段與晨報段各自獨立組裝、獨立切分、獨立送出**（不合併為同一個待切分陣列——合併會使一次 Discord
失敗同時波及兩段的 push-then-commit，牴觸 FR-013 段間隔離）：
- 榜單段（僅榜單日執行）：`boardEmbeds = [cover, ...cards]`（榜單封面 → 卡片），交
  `chunkEmbeds(boardEmbeds, 10)`（見 `embed-split.md`）逐批 `send`。
- 晨報段（每日執行）：`newsEmbeds = digestEmbeds`（1~2 張），交 `chunkEmbeds(newsEmbeds, 10)` 逐批 `send`
  （通常僅 1 批）。

兩段皆用 `payload = { username: 'Tech Radar', avatar_url?, embeds: batch }`。

## L6. 邊界

- 穩定態（榜單段封面＋0~數卡 ≤10）→ 榜單段一則訊息；晨報段（1~2 張）另一則訊息。
- 冷啟動（榜單段封面＋10 卡＝11）→ 榜單段 `chunkEmbeds` 切成 2 則，順序不亂、無遺漏（SC-005）；晨報段
  仍照常獨立送出自己的 1~2 張（不併入榜單段的切分）。
- 非榜單日 → 只有晨報段的 embed（1~2 張），一則訊息。
