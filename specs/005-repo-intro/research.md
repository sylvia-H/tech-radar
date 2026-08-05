# Phase 0 Research: LLM 封裝與 repo 250 字簡介

本檔釘定 spec 明列「於 `/speckit-plan` 確認」的數值與技術決策，並記錄 clarify 已定案項的落地做法。
所有決策以憲章（I/V/VI/VII）與 dev-guide §6、§10、§2.4 為據。

---

## D1 — README 取得方式

**Decision**：以 GitHub REST `GET /repos/{owner}/{name}/readme` 經**既有** `GithubHttpService.getJson`
取回，回應為 `{ content: <base64>, encoding: 'base64' }`，於 `github-readme.ts` 內 `Buffer.from(content,
'base64').toString('utf-8')` 解碼。取得失敗（404 無 README、其他 `GithubHttpError`、網路錯誤）一律
`catch` 後回 `''`，交由組素材邏輯走退回路徑。

**Rationale**：FR-010 要求沿用 F1 GitHub HTTP 基座、不另建平行請求層。`getJson` 已內建自訂 UA、Bearer
認證、5xx/429/secondary-limit 退避、rate-limit 監看，README 取得直接複用即符合抓取禮貌。API 端點會
自動解析預設分支與 README 路徑，無需自行猜測。≤10 次 core 呼叫遠在 5,000/hr 限額內。

**Alternatives considered**：
- `raw.githubusercontent.com/{o}/{n}/{branch}/README.md`（getText、不計 API）：需先知道預設分支與確切
  檔名（README.md / README.rst / readme.markdown…），還得再打一次 API 取分支——比 API 端點更脆更繞。
  Rejected。
- 為 README 走 `Accept: application/vnd.github.raw`（免解 base64）：`getJson` 的 Accept header 寫死為
  `application/vnd.github+json`，改它會擴散影響其他呼叫端；解 base64 是 2 行純函式，成本更低。Rejected。

---

## D2 — README 素材上限（截斷長度）

**Decision**：`stripMarkdownNoise` 去雜訊後，截斷至 **6,000 code points**（`[...text].slice(0, 6000)`）
再送 LLM。

**Rationale**：dev-guide §6.1/§6.3 明列 ~6k 字元即涵蓋多數專案重點、兼顧 token 成本。Gemini Flash 有
1M context，6k 遠低於上限但足夠——簡介只需 repo 的「解決什麼／特色／適合誰」，README 開頭段落即足。

**Alternatives considered**：不截斷（送全文）——長 README 白耗 token、且雜訊稀釋重點，違背憲章 I 用量
護欄。Rejected。

---

## D3 — README「極短」可用門檻（退回 description+topics）

**Decision**：`stripMarkdownNoise` 去雜訊後的 **code point 數 < 200** 即視為極短，退回以
`description + topics` 為素材（clarify Session 2026-07-18 Q3 已定計數口徑，此處釘定門檻值 200）。

**Rationale**：200 字元約為「一句話 description + 少量標題」的量級，低於此難以支撐一段忠實簡介，退回
description+topics 反而較穩。門檻集中為 `intro-material.ts` 的一個具名常數 `MIN_README_CHARS = 200`，
利於單測邊界（199 → 退回、200 → 用 README）與日後調整。

**Alternatives considered**：不設長度門檻、只在「取不到／空」才退回（clarify 選項 B）——一行字的 README
仍會單獨送 LLM，素材品質差。Rejected（已於 clarify 排除）。

---

## D4 — 250 字上限的計數與收斂

**Decision**：以 **Unicode code point** 計數（`[...str].length`，正確處理 surrogate pair 與 emoji），
與新聞 50/300 口徑一致。LLM 回傳 > 250 時**截斷收斂**：於 ≤250 範圍內找最後一個自然邊界（句號／
問號／驚嘆號／換行，全形半形皆計），截到該處並附「…」；找不到邊界則硬截至 249 + 「…」。**不重呼叫
LLM 重生成**。

**Rationale**：spec Assumptions 已定「截斷收斂、不重生成」以省額度（憲章 I、「一切從簡」）。code point
計數與既有新聞字數驗證同尺，避免 UTF-16 length 對 emoji/罕用字高估。

**Alternatives considered**：要求 LLM 重生成更短版本——多一次呼叫、違背用量護欄。Rejected。
`Intl.Segmenter` 以「字（grapheme）」計數——對中文與 code point 幾乎等價，卻多一層相依與複雜度，
不符「一切從簡」。Rejected。

---

## D5 — Gemini 封裝（LlmService）

**Decision**：以 `@google/genai` 的 `new GoogleGenAI({ apiKey })` 建客戶端，呼叫
`client.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt })`，取
`response.text` 為結果字串。model 名收斂為模組常數 `GEMINI_MODEL = 'gemini-2.5-flash'`（dev-guide
§2.4）。`apiKey` 由 `ConfigService.get('GEMINI_API_KEY')` 取得（已於 F1 env.schema 驗證存在）。

封裝對外只暴露 `generate(prompt: string): Promise<string>`：
- 空 prompt 或空回應（trim 後為空）→ 擲 `LlmError`（交由呼叫端走降級）。
- 只送呼叫端給的 prompt 字串（內容為公開 README/metadata，FR-013）；不記錄 prompt/回應全文於 log。

**Rationale**：`@google/genai` 為憲章技術釘死之 SDK；單一封裝滿足 FR-011（F6 重用）。model 用 dev-guide
指名的 `gemini-2.5-flash`（Flash 系、~1,500 RPD 免費）。

**Alternatives considered**：舊 `@google/generative-ai` 套件——已被 `@google/genai` 取代，憲章釘死後者。
Rejected。

---

## D6 — 429／暫時性錯誤的退避重試

**Decision**：`LlmService.generate` 內建重試迴圈，鏡射 `github-http.ts` 的退避形狀但參數獨立：
- `LLM_MAX_RETRIES = 4`（最多 4 次嘗試）。
- 指數退避 + jitter：`base × 2^(attempt-1) + random[0, base)`，`LLM_BACKOFF_BASE_MS = 1000`、
  `LLM_MAX_BACKOFF_MS = 8000`。
- 觸發退避的錯誤：**429**（速率/額度）、**503**（暫時不可用）、網路層錯誤。其餘（400/401/403 憑證型）
  不重試、直接視為失敗。
- `@google/genai` 拋出的錯誤以其 `status`／HTTP code 屬性判別（無明確碼時保守：僅網路例外重試）。
- 退避以可注入的 `sleep(ms)` 執行，測試以 mock/fake timer 免真實等待。

**Rationale**：憲章技術約束明列「Gemini 429 用指數退避 + jitter」。上限 4 次、單次 ≤8s、總等待有界
（不會拖垮跑完即退的 CLI）；若為當日 RPD 耗盡則重試無益，故次數刻意不高——耗盡即降級（FR-014）。

**Alternatives considered**：無上限重試——可能長時間卡住 CLI、且 RPD 耗盡時徒勞。Rejected。

---

## D7 — IntroService 輸入契約與素材來源（clarify Q1 落地）

**Decision**：`IntroService.ensureIntro(input, state)` 的 `input` 由**呼叫端（F7）傳入**完整 metadata：
`{ repoId, fullName, description, language, topics, starsThisWeek }`。owner/name 由 `fullName.split('/')`
拆出供 README 取得。IntroService **只自行取 README**，**不另打 `GET /repos`** 補 description/topics。

**Rationale**：持久化的 `state.board`（`BoardEntry`）與 F3 `BoardChange` 皆不存 description/topics，
唯一持有處是 F2 當次抓取的 `CandidateRepo`。由 F7 以 `repoId` join 當次候選補齊後傳入，可省一次 GitHub
呼叫（憲章 I）、且讓 IntroService 保持（除 README 外）純輸入→輸出、易測。已同步落地至 dev-guide §6.1。

**Alternatives considered**：IntroService 自行 `GET /repos` 補 metadata——與 F2 重複取數、多耗額度。
Rejected（clarify 已選 A）。

---

## D8 — IntroResult 回傳形態與降級（clarify Q2 落地）

**Decision**：`ensureIntro` 回傳**可區別的結果物件** `IntroResult`（discriminated union，見 data-model）：
- `{ status: 'cached', intro }`：快取命中，未呼叫 LLM／README。
- `{ status: 'generated', intro, introAt }`：新生成並**已就地寫入** `state.intros[repoId]`。
- `{ status: 'degraded', description }`：生成失敗，帶備援 description，**未寫快取**。

失敗（README 有無皆試 LLM、429 耗盡、空/無效回應）以 `logger.warn` 記錄（含 repoId/fullName，不含
prompt 全文），**不擲錯**、不阻斷其餘 repo（FR-014/015）；**不寫入空/失敗快取**（FR-016）。

**Rationale**：呼叫端（F7）據 `status` 區分「真簡介卡」與「降級卡（顯示 description）」；`degraded`
明確攜帶備援素材，F7 不需自行再查 description。F5 不推播，故失敗只 warn；紅色告警屬 F7 推播層。

**Alternatives considered**：失敗直接回 description 字串當簡介（clarify 選項 B）——呼叫端無法區分真偽。
擲例外/回 null（選項 C）——把容錯責任推給呼叫端，弱化 F5 的隔離。皆 Rejected（clarify 已選 A）。

---

## D9 — 快取鍵與寫入時機

**Decision**：快取鍵 = `String(repoId)`（與 F3 `state.board` 鍵一致、抗改名，board-diff FR-006）。
生成成功即 `state.intros[key] = { intro, introAt: now.toISOString() }`（IntroService 就地寫入傳入的
in-memory `state`）。**IntroService 不呼叫 `StateStore.save()`**——持久化由 F7 於推播成功後統一落檔
（憲章 VI「狀態必須在推播成功後才寫回」）。`now` 以注入方式提供，測試可控。

**Rationale**：US1 Independent Test 斷言「已寫入 `state.intros[repoId]`」係對 service 驗證 → service
須就地寫 in-memory state；持久化時機與 save 原子性屬 F1/F7。鍵用 numeric repoId 字串確保改名/轉移
擁有者仍命中同一快取（不重生成，FR-005/SC-006）。

**Alternatives considered**：以 `fullName` 為鍵——改名即 miss、重生成一次，牴觸 FR-005。Rejected。

---

## D10 — stripMarkdownNoise 去雜訊策略

**Decision**：純函式正則管線，依序移除／收斂：HTML 註解 `<!-- -->`、HTML 標籤 `<...>`、圖片與 badge
`![alt](url)`、行內／參考式連結收斂為其顯示文字（`[text](url)` → `text`）、程式碼圍欄 ``` ``` 區塊、
連續空白與多餘空行。保留標題文字與段落內文。輸出再交 D2 截斷。

**Rationale**：dev-guide §6.1 `stripMarkdownNoise(readme).slice(0, 6000)`；badge/HTML/連結 URL 是純
token 雜訊，去除後同樣 6k 額度能塞進更多實質內容，也降低 LLM 被 URL 誤導的機會（Edge Cases）。以正則
而非 `cheerio`——README 是 Markdown 非結構化 HTML，正則管線足夠且不引入 DOM 相依（「一切從簡」）。

**Alternatives considered**：`cheerio` 解析——README 多為 Markdown，DOM 解析對 badge/連結收斂並無優勢，
徒增相依。Rejected。

---

## D11 — 語言與內容有效性驗證

**Decision**：繁中約束**以 prompt 為主**（明確要求繁體中文、只依素材、不杜撰數字/連結）；程式面**只硬
驗證兩件事**：(a) 回應 trim 後非空（空/全空白 → 失敗降級）；(b) 長度 ≤250（超長截斷收斂，D4）。**不**做
嚴格語言偵測或事實查核。

**Rationale**：符合「一切從簡、接受有界缺點」偏好——嚴格語言偵測/事實比對成本高且易誤判；prompt 約束
＋長度硬驗證已覆蓋 SC-002 的可測部分，事實防護靠「數據一律由程式提供、不經 LLM」的架構保證（FR-007，
prompt 不餵可杜撰的權威數字即無從造假）。已知有界風險：LLM 偶夾英文詞句——可接受，日後如頻繁再加驗證。

**Alternatives considered**：CJK 佔比門檻偵測 + 不足則重呼叫——多一次呼叫且門檻難定。Rejected。

---

## 已解決的 NEEDS CLARIFICATION 對照

| 項目 | 來源 | 落地 |
|------|------|------|
| 素材 metadata 來源 | spec Q1 | D7（呼叫端傳入，不自取） |
| 降級回傳形態 | spec Q2 | D8（discriminated `IntroResult`） |
| README 極短門檻計數口徑 | spec Q3 | D3（去雜訊後 code points） |
| README 極短門檻值 | plan | D3（`MIN_README_CHARS = 200`） |
| README 截斷上限 | plan | D2（6,000 code points） |
| 250 字計數與收斂 | plan | D4（code points、截斷+省略號、不重生成） |
| 429 重試上限與退避參數 | plan | D6（4 次、base 1000／cap 8000／jitter） |
| Gemini 型號與 SDK 用法 | plan | D5（`gemini-2.5-flash`、`@google/genai`） |

**無殘留 NEEDS CLARIFICATION。**
