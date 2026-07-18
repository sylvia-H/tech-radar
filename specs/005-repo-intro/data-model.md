# Phase 1 Data Model: LLM 封裝與 repo 250 字簡介

F5 大多為記憶體型別（服務輸入／輸出、素材），唯一持久化實體 `IntroCache` 已於 F1 建立、本 Feature
不新增狀態欄位。型別集中於 `src/intro/intro.types.ts`（簡介側）與 `src/llm/llm.types.ts`（LLM 側）。

---

## 1. IntroInput（IntroService 輸入；呼叫端傳入）

由呼叫端（F7）以 `repoId` join 當次 F2 榜單抓取結果後傳入（research D7）。IntroService 除 README 外
不自取任何欄位。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `repoId` | `number` | GitHub 數字 id；快取鍵來源（`String(repoId)`），抗改名 |
| `fullName` | `string` | `owner/name`；拆出 owner/name 供 README 取得、亦入 prompt 語境 |
| `description` | `string \| null` | repo 簡述；退回素材與降級備援用 |
| `language` | `string \| null` | 主要語言；prompt 語境 |
| `topics` | `string[]` | GitHub topics；退回素材與 prompt 語境 |
| `starsThisWeek` | `number \| null` | 本週增星；**僅作 prompt 語境，事實數據由程式提供、不由 LLM 產生**（FR-007） |

**驗證規則**：`fullName` 須含一個 `/`（拆 owner/name）；欄位缺漏由 TypeScript 型別於呼叫端保證，
IntroService 不再做執行期 schema 驗證（輸入來自內部可信呼叫端，非外部邊界）。

---

## 2. IntroResult（IntroService 輸出；discriminated union）

research D8。呼叫端據 `status` 決定卡片渲染與是否需持久化。

```ts
export type IntroResult =
  | { status: 'cached'; intro: string }                    // 快取命中：未呼叫 LLM/README
  | { status: 'generated'; intro: string; introAt: string } // 新生成：已就地寫入 state.intros
  | { status: 'degraded'; description: string | null };     // 失敗降級：未寫快取，帶備援 description
```

| status | intro | introAt | description | 是否呼叫 LLM | 是否寫 state.intros |
|--------|-------|---------|-------------|:---:|:---:|
| `cached` | ✅ ≤250 繁中 | — | — | ❌ | ❌（早已存在） |
| `generated` | ✅ ≤250 繁中 | ✅ ISO 8601 | — | ✅ | ✅ |
| `degraded` | — | — | ✅（原樣） | 已試但失敗 | ❌（FR-016） |

**不變式**：
- `cached`/`generated` 的 `intro` **必為** ≤250 code points 且非空。
- `generated` ⇒ `state.intros[String(repoId)] = { intro, introAt }` 已就地設定。
- `degraded` ⇒ `state.intros` **未**因本次而新增鍵（避免快取失敗結果）。

---

## 3. IntroCache（持久化；已存在，不新增）

`src/state/state.schema.ts` 既有 `introCacheSchema`，本 Feature 沿用、不改 schema。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `intro` | `string`（繁中 ≤250） | 一次性簡介文字 |
| `introAt` | ISO 8601 datetime | 生成時間戳 |

- 存於 `state.intros: Record<string, IntroCache>`，鍵為 `String(repoId)`。
- **獨立於榜單快照**：`state.board` 更新或某 repo 掉出**不清除** `state.intros`（FR-004、憲章 VI）。
- **命中判定**：`state.intros[key]?.intro` 存在且**非空字串**才算命中（Edge Case：空字串不算命中，
  留待重試）。

---

## 4. IntroMaterial（記憶體；組素材中間產物）

`intro-material.ts` 純函式 `buildMaterial(input, readme)` 的輸出。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `text` | `string` | 送 LLM 的素材本文（README 去雜訊截斷後，或 description+topics 拼接） |
| `source` | `'readme' \| 'fallback'` | 素材來源：README 或退回（description+topics） |
| `sparse` | `boolean` | 是否資訊明顯不足（可觸發簡介末標「（資訊有限）」，FR-009） |

**規則**：
- `stripMarkdownNoise(readme)` 後 code points **≥ `MIN_README_CHARS`(200)** → `source='readme'`、
  截斷至 6,000（research D2/D3）。
- 否則 → `source='fallback'`，`text` 由 `description` + `topics` 組成；`description`/`topics` 皆近乎
  空時 `sparse=true`（US3-3 最小可用簡介）。

---

## 5. ReadmeEnvelope（記憶體；GitHub API 回應）

`github-readme.ts` 解析 `GET /repos/{o}/{n}/readme` 的最小欄位。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `content` | `string` | base64 編碼的 README 內容 |
| `encoding` | `string` | 預期 `'base64'`；非預期時保守回 `''` |

`fetchReadme` 對外回 `string`（已解碼 UTF-8；取不到/404/非 base64 → `''`）。

---

## 6. LlmError（LLM 側）

`src/llm/llm.types.ts`。LlmService 生成失敗（重試耗盡、空回應）時擲出，供 IntroService catch 後降級。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `name` | `'LlmError'` | — |
| `reason` | `'exhausted' \| 'empty' \| 'error'` | 失敗類別（供 log 分流；不含 prompt/回應全文） |

---

## 實體關係與資料流

```text
呼叫端(F7)                IntroService.ensureIntro(input, state)
  │ join repoId→候選            │
  └─ IntroInput ──────────────▶├─ state.intros[String(repoId)]?.intro 非空? ──是──▶ IntroResult{cached}
                               │                                     │否
                               ├─ fetchReadme(http, owner, name) ────▶ ReadmeEnvelope→string（取不到=''）
                               ├─ buildMaterial(input, readme) ─────▶ IntroMaterial{text,source,sparse}
                               ├─ LlmService.generate(introPrompt(input, material))
                               │       │成功                    │擲 LlmError
                               ├─ clampTo250(text) ─────────────┐   │
                               ├─ state.intros[key]={intro,introAt}  │
                               │       └────────────────────────▶ IntroResult{generated}
                               └─ catch → logger.warn ──────────▶ IntroResult{degraded, description}
```

**測試要點對照憲章 VIII**：快取命中（LLM/README 呼叫次數 0）、250 收斂、去雜訊／截斷／極短退回、
429 退避重試與耗盡降級——皆於 `*.spec.ts` 覆蓋（見 quickstart）。
