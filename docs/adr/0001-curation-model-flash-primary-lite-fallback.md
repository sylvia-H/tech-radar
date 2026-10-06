# 0001. 晨報策展型號：Flash 主、Lite 備援，皆開 thinking

- **狀態**：Accepted
- **日期**：2026-09-27 裁決；2026-10-06 重申（否決改 Lite 為主的提案）
- **相關**：憲章 I（免費層）、V（每日一次策展）；開發指南 §2.4；`src/llm/llm.types.ts`、`src/llm/llm.service.ts`、`src/curation/curation.service.ts`

## 脈絡

每日晨報只呼叫 Gemini 一次，要對 60～80 則候選做語意去重、三類判準逐則核對、三陣列分類與繁中改寫，判斷品質直接決定晨報內容。可選型號兩級：`gemini-3.8-flash`（免費層 5 RPM／20 RPD，09-13 起幾乎每天首次呼叫即 503 過載）與 `gemini-3.5-flash-lite`（約 15 RPM／1,000 RPD，穩定但判斷較弱）。

歷程：
- 2026-09-12 策展走 Flash、失敗退 Lite。13 天裡 Flash 三天四次重試全耗盡；Lite 日只選 5～7 則、Flash 日 9～10 則。
- 2026-09-25 一度改為主備皆 Lite 系（主 3.5-flash-lite、備援 3.1-flash-lite），想避開 503 與配額餘裕問題。四個策展日則數 5／7／7／6，09-27 把 Node.js LTS 發布誤放補位陣列、Gemini 3.8 TTS 等明顯官方發布漏選。
- 2026-09-27 診斷發現策展呼叫從未帶 thinking（Actions log「思考 ?」），Lite 是在零思考 token 下做長程判斷。

## 決策

1. 策展主型號回到 `gemini-3.8-flash`、備援 `gemini-3.5-flash-lite`（實證可用的 Flash→Lite 路徑；3.1-flash-lite 從未在正式排程成功過，退場）。
2. 主備呼叫皆帶 `thinkingLevel: high`。若型號以 400 拒絕該參數，同一 prompt 不帶 thinking 重送一次，不因設定問題降級。簡介與 TL;DR 不帶 thinking。
3. 2026-10-06 重申：維持 Flash 主、Lite 備援不變。

## 否決的替代方案

- **主備皆 Lite 系（2026-09-25 使用者決策）→ 2026-09-27 由使用者自行退場**：退場條件「Lite 連續則數偏低或未歸類全不選」四天內成立。
- **Lite＋thinking 改為主型號、Flash 退備援（2026-10-06 Agent 提案）→ 使用者否決**。推翻紀錄：Agent 理由是 Flash 九天只有 2 天成功、每天白等約 90 秒退避，而 Lite 加 thinking 已能選出 11～15 則。使用者裁決理由：Lite 的免費層可重試額度是 Flash 的好幾倍，放在備援位置最保險——主型號耗盡後備援幾乎必成；Flash 成功的日子能得到一次較高品質的分析（thinking 9～12k tokens、輸出 2.2～2.4k，Lite 為 4～8k／1.3～1.7k）。90 秒是可接受的代價。
- **拉長退避跨過 503 尖峰**（2026-09-20 已做 10s／20s／40s）：只橫跨約 1.5 分鐘，實測跨不過，不再加長。
- **放棄分流、全部走 Flash**（2026-09-02 曾在本機試過）：撞免費層上限，且簡介與 TL;DR 不需要 Flash 的判斷力。

## 後果與觀察

- 則數由 Lite 日 5～7 升到 11～15（09-28～10-06 平均 13.8），thinking 是主因；Flash 日與 Lite 日則數無明顯差距。
- 代價：Flash 失敗日多約 90 秒退避、多 4 次 HTTP；每日 1 次策展對 20 RPD 仍有 5 倍餘裕。
- 退場條件：Flash 若連續數週 0 成功，重新評估是否值得保留為主型號；`gemini-3.1-flash-lite` 不再使用，2027-05-07 shutdown 無影響。
- 看什麼：Actions log「LLM 用量（型號，thinking=high，…思考 N）」、「策展主型號失敗…改以備援型號」、「LLM 拒絕 thinking 設定」（出現則改試 `thinkingBudget`）。
