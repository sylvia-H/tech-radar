# Release Gate Checklist: 專案骨架與推播通道（Foundation）

**Purpose**: 以「需求的單元測試」嚴格驗證 F1 需求（spec/plan/contracts/data-model）的完整性、清晰度、一致性與可量測性，作為進入 `/speckit-tasks` 與實作前的正式 release gate。
**Created**: 2026-07-11
**Dry-run**: 2026-07-11（43/43 通過；CHK015 於試跑時發現漏洞並已補強，見 Notes）
**Feature**: [spec.md](../spec.md)
**Depth**: 嚴格（release gate）｜**Focus**: 營運就緒與失敗可觀測、機密隔離與安全、狀態完整性與 schema、一般需求品質
**Audience**: 作者 + 審查者（PR）

> 本檢查表測的是「需求寫得好不好」，不是「程式跑得對不對」。每項回答 Yes/No 針對**文件中的需求敘述**，非實作行為。

## Requirement Completeness

- [x] CHK001 執行生命週期各階段（載入設定 → 載入狀態 → 推播 → 寫回狀態）是否都有對應需求？ [Completeness, Spec §FR-001/007/008]
- [x] CHK002 三項機密是否各自被明確列為必填且訂有載入＋驗證需求？ [Completeness, Spec §FR-002, data-model §EnvConfig]
- [x] CHK003 狀態頂層 schema 是否完整記錄全部 5 個欄位（而非部分）？ [Completeness, data-model §BoardState]
- [x] CHK004 成功與失敗兩種 Discord 訊息（測試 embed／紅色告警）是否都有需求定義？ [Completeness, Spec §FR-004/010, contracts/discord-webhook]
- [x] CHK005 Workflow 觸發需求是否完整（兩個 cron 時段＋手動 dispatch）？ [Completeness, Spec §FR-011, contracts/cli-and-workflow]
- [x] CHK006 F1 明確排除項（資料來源／LLM／新聞漏斗）是否被書面界定為範圍邊界？ [Completeness, Spec §FR-012]
- [x] CHK007 是否要求 repo 內 seed 一份合法空骨架，且其確切結構有被指定？ [Completeness, Spec §FR-015, data-model]

## Requirement Clarity & Measurability

- [x] CHK008 「明顯的紅色告警」是否以具體色值／訊息欄位量化，而非主觀描述？ [Clarity, Spec §FR-010, contracts/discord-webhook]
- [x] CHK009 「快速／早期失敗」是否有可量測時限？ [Measurability, Spec §FR-003, §SC-003（1 分鐘）]
- [x] CHK010 「收到測試 embed」的成功條件是否時間有界？ [Measurability, Spec §SC-001（5 分鐘）]
- [x] CHK011 「狀態實際變更」是否定義得足以判定 commit／不 commit？ [Clarity, Spec §FR-007, contracts/state-file]
- [x] CHK012 離峰 cron 時段是否在 UTC 與台北兩種時區都無歧義地標明？ [Clarity, Spec §Assumptions, contracts/cli-and-workflow]
- [x] CHK013 SC-006（不因用量超免費額度而失敗）是否有可客觀量測的指標／門檻？ [Measurability, Spec §SC-006 + §Assumptions（public repo 免費額度充足、每日兩次遠低於限額）]

## Requirement Consistency

- [x] CHK014 commit-on-change 行為在 spec（FR-007）、澄清、plan 與憲章 v1.0.1 間是否一致？ [Consistency]
- [x] CHK015 失敗告警需求（FR-010 app 層 vs FR-014 workflow 層）是否無縫切分、無涵蓋漏洞？ [Consistency, Spec §FR-010/FR-014] ← 試跑發現漏洞，已補強（見 Notes）
- [x] CHK016 狀態欄位名稱在 spec Key Entities、data-model 與 contracts 間是否一致？ [Consistency]
- [x] CHK017 「保活不靠人工心跳」的理由在 spec Assumptions、FR-007 與憲章約束間是否一致？ [Consistency]
- [x] CHK018 機密名稱（`GH_API_TOKEN`，非 `GITHUB_` 前綴）在各文件是否一致？ [Consistency, data-model / contracts]

## Acceptance Criteria Quality

- [x] CHK019 每條 User Story 是否都有可獨立測試的驗收場景？ [Acceptance Criteria, Spec §US1–US3]
- [x] CHK020 SC-001–006 是否各自可對映到至少一條 FR／場景？ [Traceability, Spec §Success Criteria, quickstart §對應關係速查]
- [x] CHK021 在「F1 可能不產生狀態變更」前提下，M0 的 commit-back 驗證路徑是否被明確定義？ [Acceptance Criteria, Spec §SC-002, quickstart §commit-back]

## Scenario & Edge Case Coverage

- [x] CHK022 狀態檔「缺檔」情境是否有需求（回退空骨架、不擲錯）？ [Coverage/Edge, Spec §Edge Cases, contracts/state-file]
- [x] CHK023 狀態檔「壞檔／結構不合法」是否與「缺檔」分開定義處理需求（擲錯、不覆寫）？ [Coverage/Edge, contracts/state-file]
- [x] CHK024 併發執行（手動撞排程）寫狀態的需求是否有定義？ [Coverage/Exception, Spec §FR-009, §US2-4]
- [x] CHK025 「推播成功但狀態尚未寫回即失敗」的風險窗是否有需求界定（先推播成功後寫回）？ [Recovery, Spec §Edge Cases, §FR-008]
- [x] CHK026 排程被平台延遲／跳過在 F1 範圍內的預期是否有書面說明？ [Coverage, Spec §Edge Cases, research D9]
- [x] CHK027 「連續多日無變更→不 commit」的情境是否有需求？ [Edge, Spec §Edge Cases]
- [x] CHK028 Discord 429／暫時性失敗是否在需求中被涵蓋（退避、逾次數視為失敗）？ [Coverage/Gap, contracts/discord-webhook] ← 僅於 contract 敘述，無對應 FR/AC（minor，見 Notes）

## Operational Readiness & Failure Observability

- [x] CHK029 app 啟動前失敗（checkout／build／機密載入）仍能告警的需求是否明確？ [Completeness, Spec §FR-014, contracts/cli-and-workflow]
- [x] CHK030 push 的併發防衝突需求（concurrency group）是否被指定？ [Completeness, contracts/cli-and-workflow, §FR-009]
- [x] CHK031 狀態 commit 的重試策略（rebase、重試次數、最終失敗要響）是否以需求敘明？ [Clarity, contracts/cli-and-workflow]
- [x] CHK032 成功／失敗／缺機密三種情況的 exit code 語意是否有需求？ [Completeness, contracts/cli-and-workflow]
- [x] CHK033 保活機制對「正式期每日狀態變更」的依賴是否記為待後續 Feature 驗證的假設？ [Assumption, Spec §Assumptions, research D9]

## Secrets Isolation & Security

- [x] CHK034 是否明確要求任何機密都不得出現在 `state/board.json` 或任何發佈產物？ [Security/Completeness, Spec §FR-002, contracts]
- [x] CHK035 是否要求失敗告警訊息本體排除 token／webhook URL／金鑰？ [Security/Gap, contracts/discord-webhook]
- [x] CHK036 機密來源（僅 Actions Secrets）與 `.env` 不入庫是否被書面規範？ [Security, Spec §FR-002, plan §Project Structure]

## State Integrity & Schema

- [x] CHK037 是否有「穩定鍵序／確定性序列化」需求以保 diff 乾淨、避免假變更？ [Clarity/Gap, contracts/state-file]
- [x] CHK038 是否要求 round-trip（load→save）不遺失既有欄位？ [Completeness, Spec §US2-1, contracts/state-file]（未來欄位保存非本架構需求——schema 逐 Feature 演進）
- [x] CHK039 子實體（BoardEntry／IntroCache／SeenNewsEntry）的型別是否已定義以避免 F2+ 重構？ [Completeness, data-model]

## Dependencies, Assumptions & Scope Boundary

- [x] CHK040 外部依賴（Discord webhook 可用性、GitHub Actions／免費額度）是否記為假設？ [Assumption/Dependency, Spec §Assumptions]
- [x] CHK041 `GEMINI_API_KEY` 在 F1「驗證但未使用」的角色是否書面說明以免混淆？ [Assumption, research D4, data-model §EnvConfig]

## Ambiguities & Conflicts

- [x] CHK042 Input／M0 敘述「狀態檔成功 commit 回 repo」是否與 commit-on-change（無變更→不 commit）衝突，且其調和是否被書面說明？ [Conflict/Ambiguity, Spec §Input vs §FR-007, quickstart]
- [x] CHK043 憲章約束原措辭「每次成功執行都 commit」在 v1.0.1 PATCH 後是否已與 FR-007 完全調和？ [Conflict-resolved, constitution v1.0.1]

## Notes

- **試跑結論（2026-07-11）**：43/43 通過。初次對照時 **CHK015 待補**，其餘皆通過。
- **CHK015 修補**：FR-010（app 內）＋ FR-014（app 啟動前）原本漏掉「app 成功結束後的**狀態 commit/push 階段**失敗」。已改：FR-014 重述為「應用程式自身邏輯以外的任何失敗」（含啟動前與 commit/push 階段）；contracts/cli-and-workflow 步驟 6「涵蓋步驟 1–4」→「1–5」；discord-webhook 告警描述同步。
- **CHK028（minor，未擋 gate）**：Discord 429／退避目前只在 contract 敘述、無對應 FR 或驗收；F1 僅單一 POST，影響低。可於實作或 F7 時視需要提升為 FR。
- 標記說明：`[Gap]` 缺漏、`[Ambiguity]` 語意不清、`[Conflict]` 相互矛盾、`[Assumption]` 假設待驗證、`[Traceability]` 追溯性。
- 本檔為 release gate；與 `requirements.md`（spec 品質檢查表）並存、用途不同，勿互相覆蓋。
