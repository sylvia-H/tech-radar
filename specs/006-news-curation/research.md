# Phase 0 Research: 每日晨報單次 LLM 策展與降級備援（F6）

**Feature**: `006-news-curation` | **Date**: 2026-07-18 | **Plan**: [plan.md](./plan.md)

本檔解掉 `spec.md` Assumptions 標記「於 `/speckit-plan` 釘定」的三個 plan-deferred 未知，
並記錄若干沿用既有實作（F3/F4/F5）的紀律決策。所有決策以「引用既有的尺、不另發明」與
「一切從簡」為原則；每項含 Decision／Rationale／Alternatives considered。

---

## D1 — 策展 LLM 回傳的結構化格式與候選參照鍵（解 Assumptions「結構化回傳格式」）

**Decision**：策展呼叫要求 LLM 回傳**單一 JSON 物件**，形狀為

```jsonc
{ "picks": [ { "ref": <候選索引:number>, "title": "<繁中標題>", "content": "<繁中內容>" }, … ] }
```

- **候選參照鍵 `ref` 用「候選在送入 prompt 之候選清單中的 0-based 陣列索引」**（整數），不用 URL、
  不用雜湊。prompt 內每一則候選以 `[0] title…／[1] title…` 逐行編號呈現，LLM 只回索引＋改寫文字。
- LLM 回傳的 `picks` **順序即「開發者重要性」由高到低的排序**（LLM 已依重要性排列，程式不再重排、
  只在護欄內剔除／截斷後**保留其相對順序**）。
- `title`／`content` 為 LLM 唯一被授權產生的內容（繁中改寫）；**連結、分數、domain、sources 數、
  publishedAt 等事實一律由程式以 `ref` 對回輸入候選後附上**（FR-006、憲章 VI）。

**Rationale**：
- 索引是最短、最不易被 LLM 抄錯的參照（長 URL 易被截斷／改寫，雜湊對 LLM 不可讀）。硬驗證時
  `ref` 是否為 `0..N-1` 的合法整數即可判定幻覺（`ref` 越界或非整數 → 剔除，FR-009）。
- 「picks 順序＝重要性序」讓 spec 的「分數僅為提示、非排序主鍵」（FR-003c）自然落地：排序主鍵是
  LLM 的重要性判斷，程式不引入替代排序公式（與降級路徑的 `weightedScore` 排序刻意分屬兩條）。
- 單一 JSON 物件（而非裸陣列）留一層 `picks` 命名，日後若需附帶策展層級註記（如 LLM 自陳丟棄理由）
  可擴充而不破格；目前只用 `picks`。

**Alternatives considered**：
- **以 `normalizedUrl` 當參照鍵**：URL 長、LLM 容易改寫或截斷，對回失敗率高、且浪費 token；否決。
- **讓 LLM 直接回連結／分數**：牴觸憲章 VI 防幻覺（事實須由程式提供）；否決。
- **裸 JSON 陣列 `[{ref,title,content}]`**：可行但無擴充餘地；選物件包一層 `picks` 一致性更好。
- **要求 LLM 回傳 domain**：非必要——domain 由 `ref` 對回候選即得（程式事實），且讓 LLM 回 domain
  等於多一個可被幻覺污染的欄位；配額分類一律用 `candidate.domain`（見 D4）。否決。

---

## D2 — LLM 回應的 JSON 解析與容錯策略（解 Assumptions「可對回輸入候選、可硬驗證」之解析前置）

**Decision**：`parseCurationResponse(raw)` 採「**去 code fence → `JSON.parse` → 形狀淺驗證**」三步，
**任一步失敗一律擲 `CurationParseError`**，由 `NewsCurationService.curate()` catch 後走 US2 降級路徑
（FR-011、Edge「LLM 回傳格式無法解析」）；**不做局部搶救**（不嘗試正則挖出片段 picks）。

- **去 fence**：若回應被 ```` ```json … ``` ```` 或 ```` ``` … ``` ```` 包住，剝除柵欄再解析
  （沿用 `src/intro/markdown-noise.ts` 對三引號區塊的處理精神，但此處是「取出」柵欄內文而非「刪除」，
  故另寫一個小工具 `stripJsonFence()`，不改 F5 檔案）。
- **形狀淺驗證**：`picks` 為陣列、每項 `ref` 為數字、`title`／`content` 為字串；不符即視為解析失敗。
  更細的界限（越界 `ref`、超長字數、配額、重複 `ref`）**不在解析層判定**，交由硬驗證管線收斂
  （D5／FR-008~010）——解析層只分「能不能拿到一份結構正確的 picks」，不分「內容合不合規」。

**Rationale**：
- 「解析失敗 = 策展失敗 = 降級」是 spec Edge 明列語意（非預期結構／非 JSON／截斷視同策展失敗）；
  局部搶救會讓降級判定變模糊，也違背「寧缺勿濫、一切從簡」。
- 解析層與硬驗證層職責切開：解析只保證「拿到結構」，硬驗證只保證「內容合規」。兩層各自可單元測試
  （憲章 VIII），且硬驗證永遠吃到「形狀正確」的輸入，邏輯單純。
- Gemini 免費層常把 JSON 包在 ```` ```json ```` fence 內，去 fence 是最常見且必要的一步；除此不做
  其他寬鬆化（不吞逗號尾巴、不修引號），保持解析可預期。

**Alternatives considered**：
- **要求 Gemini responseSchema / JSON mode**：可減少 fence 問題，但增加對 `@google/genai` 特定 API
  的耦合、且 F6 刻意**只透過 F5 `LlmService.generate(prompt)` 純文字入口**（FR-018，不改 F5 簽名、
  不另建客戶端）。故維持「純文字回應 + 自行解析」；否決在 F6 動 LlmService。
- **局部容錯（正則挖 picks）**：增加複雜度、降級判定變糊；否決。
- **解析層即做字數／配額收斂**：混淆兩層職責、難測；否決（收斂歸硬驗證層 D5）。

---

## D3 — 榜單 TL;DR 的輸入投影與事實型降級摘要（解 §10 第 (2) 種呼叫的輸入契約）

**Decision**：`BoardSummaryService.summarize(digest)` 的輸入 `BoardChangeDigest` 是**由呼叫端（F7）
自 F3 `BoardDiff` 投影**出的「計數＋領域分布」純資料，**F6 不吃整個 `BoardDiff`、不碰 F3 服務**：

```ts
interface BoardChangeDigest {
  newcomers: number;   // kind==='newcomer' 計數
  climbed: number;     // kind==='climbed' 計數
  declined: number;    // kind==='declined' 計數
  domainCounts: { ai: number; 'frontend-backend': number }; // 新進+竄升的領域分布（下降不計入亮點）
  topName: string | null;  // 本次綜合榜 #1 full name（供「無變化」與封面語境），可省
}
```

- LLM 成功：回一句繁中 TL;DR，**只依上列數字**（FR-015、憲章 VI 不杜撰數字／名稱）。
- LLM 失敗：退回**程式產生的事實型摘要** `factSummary(digest)`，格式為
  「本週 N 個新進、M 個竄升、K 個下降」（K 為 0 時該子句省略；三者皆 0 時輸出「本週榜單無變化」）
  ——數字 100% 取自 `digest`（SC-007），並 `logger.warn` 記錄失敗（FR-016，不無聲）。

**Rationale**：
- F6 的邊界是「給定 diff 事實 → 回一句摘要」；讓 F7 負責把 `BoardDiff`（含 repoId／URL／rank 等
  F3 內部結構）投影成最小事實集，F6 不依賴 F3 型別的完整形狀，耦合最小、可獨立測試（吃純數字）。
- `domainCounts` 只計新進＋竄升（亮點側），與 dev-guide §5「下降側純位移噪音、只做封面一行式」
  一致（Edge「僅有下降」仍照實陳述計數，但領域亮點不摻下降）。
- 事實摘要語法比照憲章 III／spec SC-007 例句「本週 N 個新進、M 個竄升、K 個下降」，不另發明措辭。

**Alternatives considered**：
- **F6 直接吃 `BoardDiff`**：使 F6 耦合 F3 內部型別、且 F6 得自行數 kind／算領域分布，超出「摘要」
  職責；否決（投影歸 F7）。
- **降級摘要也列 repo 名稱**：名稱屬 F7 組版素材，且會擴大 F6 對 diff 結構的依賴；否決，降級只陳述計數。

---

## D4 — 配額分類（AI vs 非 AI）以 `candidate.domain` 判定（沿用 F4 型別）

**Decision**：配額分類**一律以對回候選的 `candidate.domain`（`ai` / `devops` / `frontend-backend`）
判定**：`ai` 計入 AI；`devops`＋`frontend-backend` 計入「非 AI」（合計 ≤2）。**不讓 LLM 回 domain**、
不新增分類邏輯。非 AI 內部的取捨優先序（FR-004：DevOps 優先，後端 Node.js/Python、前端 TypeScript
為主）**由 prompt 外顯指示 LLM 執行**（主題降噪屬階段 B，F4 階段 A 刻意不做，見 `004-news-ingest`
FR-028）；程式面只硬夾「非 AI 合計 ≤2」的**數量**上限，不重做主題語意判斷。

**Rationale**：domain 是 F4 已定的候選事實欄位，直接沿用即為「引用既有的尺」；程式只管數量夾制
（可測、確定性），語意層（哪一則非 AI 更重要）交 LLM 的重要性排序＋prompt 優先序指示。

**Alternatives considered**：讓 LLM 回領域標籤再據以夾配額——多一個可被幻覺污染的欄位、且與候選事實
可能不一致；否決。以關鍵字在程式端重算主題優先序——等於把 F4 刻意不做的主題硬篩搬進 F6 程式層、
且易誤殺（dev-guide §11.2 F4 註明語意判斷交 LLM 更準）；否決。

---

## D5 — 硬驗證管線順序與字數收斂一般化（落實 FR-008~010 的固定護欄順序）

**Decision**：硬驗證管線 `validateCuration(picks, candidates)` 依 spec Clarifications 2026-07-18 與
FR-010 的**固定順序**執行，且**只在「LLM 已選且已繁中改寫」的集合內操作，永不遞補新候選**：

1. **剔除幻覺項＋重複參照去重**（FR-009）：`ref` 非合法索引（越界／非整數）者剔除；同一 `ref` 出現
   多次者只留第一個（保留重要性序）。
2. **依領域優先序夾非 AI ≤2**（FR-010）：非 AI（devops＋frontend-backend）超過 2 則時，依 FR-004
   優先序（DevOps 優先，其餘依 picks 重要性序）保留前 2、其餘剔除；AI 不受此步限制。
3. **依重要性序截總數 ≤6**（FR-008）：仍超過 6 則時，依 picks 順序保留前 6（6-截斷時優先保留 AI 即
   「picks 已把 AI 排前」的自然結果，非引入新候選）。
4. **字數收斂**：每則 `title` 收斂至 ≤50、`content` 收斂至 ≤300 code points（FR-008）。

字數收斂**一般化 F5 `clampTo250` 的邊界收斂邏輯**為 `clampToLimit(text, max)`——同一套「先找 ≤max 內
最後一個自然邊界截斷、找不到硬截至 `max-1` 加『…』」規則，只把上限參數化（50／300／250 共用）。
F5 的 `clampTo250` 與 `countCodePoints`、`BOUNDARY_CHARS` 定義**不改動**；F6 的 `clampToLimit` 為
`src/curation/curation-length.ts` 內的一般化版本（避免改 F5 簽名破壞既有測試；邊界字元集合沿用同一份
語意，於 F6 檔內各自定義常數，屬可接受的小重複而非改動 F5）。

**Rationale**：順序是 spec 已 clarify 的硬約束，直接落為管線步驟即可測（US3 專測違規 mock 回應的
收斂與剔除）。字數收斂沿用 F5 已驗證的自然邊界邏輯，只參數化上限，不重寫、不改 F5。

**Alternatives considered**：
- **改 F5 `clampTo250` 為 `clampToLimit` 並讓 F5 呼叫 `clampToLimit(t,250)`**：更 DRY，但會動到已驗收的
  F5 檔案與測試、擴大本 Feature 改動面（plan Structure Decision 明訂「不改 F4/F5」）。取捨「一切從簡、
  不擴大爆炸半徑」→ F6 自帶一般化版本，接受與 F5 的小邏輯重複。
- **先截 6 再夾配額**：會讓「非 AI 佔滿前 6 → 截後仍超配額」需要二次夾制；固定「先夾配額再截總數」
  順序（spec clarify）一次到位，否決其他順序。

---

## D6 — 空候選短路與「單次呼叫」保證（落實 FR-002/020、SC-001）

**Decision**：`curate()` 進入時若 `candidates.length === 0`，**直接回傳空精選集、不呼叫 LLM**
（SC-001 空候選為 0 次呼叫，FR-020）。非空時**整個策展流程只呼叫 `llm.generate()` 一次**：投影 →
單次 generate → 解析 → 硬驗證，全程無迴圈重呼叫；超長輸出以 D5 收斂處理、**不因超長重生成**
（spec Assumptions「超長以收斂處理，不重呼叫」）。榜單 TL;DR 是**另一個服務、僅榜單日、獨立一次呼叫**
（FR-017），與新聞策展的「每日 1 次」互不相干，兩者都不會使對方變多次。

**Rationale**：直接對應 SC-001／FR-002／FR-017／FR-020，無替代方案；列此條使「呼叫次數」成為可測
不變式（US1 Independent Test 明確驗「只呼叫 LLM 一次」、空候選 0 次）。

---

## 沿用既有實作彙整（無新依賴、不改 F3/F4/F5）

| 重用項 | 來源 | F6 用途 |
|--------|------|---------|
| `LlmService.generate()`（含 429/503 退避＋jitter、`LlmError`） | F5 `src/llm/` | 策展與 TL;DR 的唯一 LLM 入口（FR-018） |
| `LlmError`（`exhausted`/`empty`/`error`） | F5 `src/llm/llm.types.ts` | catch 後降級的判別（FR-011/016） |
| `NewsCandidate` / `CandidateSet`（含 `weightedScore`、`domain`、`sources`、`normalizedUrl`） | F4 `src/news/news.types.ts` | 策展輸入投影與降級排序來源 |
| `weightedScore`（`runFunnel` 已填、`CandidateSet` 已排序） | F4 `src/news/funnel.ts` | 降級路徑取前段，不重寫排序公式（FR-012） |
| `countCodePoints` 字數口徑、自然邊界收斂邏輯 | F5 `src/intro/intro-length.ts` | 一般化為 `clampToLimit`（D5） |
| code fence 剝除精神 | F5 `src/intro/markdown-noise.ts` | `stripJsonFence()` 參考（D2） |
| `BoardDiff`/`BoardChange`（型別，僅 F7 投影用） | F3 `src/diff/diff.types.ts` | F7 據此組 `BoardChangeDigest`；F6 只吃投影後結果（D3） |

**未解 NEEDS CLARIFICATION**：無。Technical Context 全部已定，可進入 Phase 1。
