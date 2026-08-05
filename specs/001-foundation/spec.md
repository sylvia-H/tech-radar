# Feature Specification: 專案骨架與推播通道（Foundation）

**Feature Branch**: `001-foundation`

**Created**: 2026-07-11

**Status**: Draft

**Input**: User description: "F1 專案骨架與推播通道（001-foundation）。以一次性 CLI job 建立專案骨架、環境變數載入、唯一權威狀態 `state/board.json` 的讀寫、Discord 最小推播與失敗告警，以及每日雙 cron 的排程 workflow（含執行後把狀態 commit 回 repo）。不含任何資料來源抓取、LLM、新聞過濾漏斗邏輯。驗收（M0）：以手動觸發後手機能收到測試訊息，且狀態檔成功 commit 回 repo。"

## Clarifications

### Session 2026-07-11

- Q: F1 每次執行是否需要人工心跳 commit 以維持排程活躍？ → A: 否；**僅在狀態實際變更時才 commit**（沿用開發指南 §8 workflow 的 no-diff 早退）。排程保活由開發期的程式碼 commit 與正式期每日 `lastNewsPushAt` 變更自然滿足，避免雜亂的空 commit。
- Q: 失敗告警要涵蓋哪些層級的失敗？ → A: **兩層**——應用程式內任一步失敗發紅色 embed；另在排程（workflow）層以 `if: failure()` 補一則，涵蓋 app 啟動前（checkout / 建置 / 機密載入）的失敗，確保任何層級都不會無聲失敗。
- Q: 是否於本 Feature 先 seed 一份空白 `state/board.json` 骨架進 repo？ → A: 是；commit 一份合法的空白骨架作為 schema 基準與乾淨 diff 起點。

## User Scenarios & Testing *(mandatory)*

本功能的「使用者」即專案擁有者（自用）。目標是先把整條管道的**骨幹與通道**打通並可觀測，讓後續每個 Feature 都能安全地掛上真實資料來源與 LLM。此階段**不產生任何真實榜單或新聞內容**。

### User Story 1 - 一鍵驗證推播管道打通（Priority: P1）

擁有者手動觸發排程任務後，手機上的私人 Discord 頻道立即收到一則來自本專案的測試 embed（含標題與時間戳），確認「執行環境 → Discord 通道」端到端可用。

**Why this priority**: 這是里程碑 M0 的核心價值，也是所有後續功能的前置條件——若推播通道不通，之後產生的內容也送不出去。它本身即構成一個可展示的最小可用產品（收得到通知）。

**Independent Test**: 設定好 secrets 後，以手動觸發執行任務一次，觀察手機是否在數分鐘內收到測試 embed；不依賴任何資料來源或 LLM 即可完整驗證。

**Acceptance Scenarios**:

1. **Given** 三個必要機密（GitHub token、LLM 金鑰、Discord webhook URL）已設定於執行環境的 Secrets，**When** 擁有者手動觸發任務，**Then** 指定的 Discord 頻道在數分鐘內收到一則含標題與執行時間的測試 embed。
2. **Given** 缺少必要機密或機密格式錯誤，**When** 任務啟動，**Then** 任務以清楚的錯誤訊息快速失敗，且不會送出半套或誤導性的推播。

---

### User Story 2 - 執行狀態被持久化並可跨執行沿用（Priority: P2）

每次任務執行後，唯一權威狀態檔 `state/board.json` 會被寫回並保存在版本庫中；下一次執行能讀到上一次留下的狀態。此為後續「只看變化」「冪等推播」「簡介快取」的地基。

**Why this priority**: 沒有可靠的跨執行狀態，之後的 diff、去重、冪等與快取都無從實作。排程保活不依賴人工心跳：開發期由程式碼 commit、正式期由每日 `lastNewsPushAt` 變更自然達成（見澄清）。

**Independent Test**: 以一次「會使狀態實際變更」的執行驗證變更被 commit + push 回版本庫；再以一次「無變更」的執行驗證不產生任何 commit；並驗證 repo 中已 seed 的空白骨架能被正確讀入且欄位齊備。

**Acceptance Scenarios**:

1. **Given** 版本庫已含 seed 的空白狀態骨架，**When** 任務讀取狀態，**Then** 能以合法結構載入（`board` / `intros` / `seenNews` / `lastBoardPushAt` / `lastNewsPushAt` 欄位齊備）且不遺失既有欄位。
2. **Given** 某次執行使狀態產生實質變更，**When** 執行結束，**Then** 變更後的狀態被 commit 並 push 回版本庫。
3. **Given** 某次執行未使狀態產生任何實質變更，**When** 執行結束，**Then** 不產生任何 commit（保持乾淨歷史）。
4. **Given** 多個執行可能同時發生（手動觸發撞上排程），**When** 兩者都嘗試寫回狀態，**Then** 狀態寫回不致互相覆蓋而遺失資料（採序列化與衝突重試）。

---

### User Story 3 - 失敗看得見（Priority: P3）

當任務任一環節失敗時，擁有者會收到一則明顯的紅色告警訊息（而非無聲失敗），以便及時察覺並排查。

**Why this priority**: 自用且無人值守的排程任務，最大的隱性風險是「壞掉了但沒人知道」。可見的失敗告警是低成本卻高價值的護欄；但它不阻擋 M0 的主要驗收，故列為 P3。

**Independent Test**: 分別故意讓（a）應用程式內一步失敗、（b）應用程式啟動前一步失敗（如建置或機密載入失敗），確認兩種情況擁有者都收到一則紅色告警訊息且訊息指向可排查的位置。

**Acceptance Scenarios**:

1. **Given** 應用程式內某一步拋出錯誤，**When** 任務結束，**Then** 擁有者收到一則紅色告警訊息（含可排查資訊），且任務被標記為失敗。
2. **Given** 應用程式尚未啟動就失敗（checkout / 建置 / 機密載入失敗），**When** 任務結束，**Then** 排程層仍補送一則紅色告警訊息，失敗不會無聲。
3. **Given** 任務全程成功，**When** 任務結束，**Then** 不會送出任何失敗告警。

---

### Edge Cases

- **機密缺失或格式錯誤**：任務必須快速、明確地失敗，不得送出半套推播（見 US1 場景 2）。
- **狀態檔意外缺失**：repo 已 seed 空白骨架；若骨架意外缺失，仍須能自初始的空白骨架容錯初始化，而非崩潰。
- **狀態寫回衝突**：手動觸發與排程同時執行導致推送衝突時，需先同步再重試，重試多次仍失敗則發告警。
- **推播成功但狀態尚未寫回時失敗**：狀態更新須發生在推播成功之後，並盡快持久化，將「重複推播」的風險窗縮到最小。
- **排程被執行平台延遲或跳過**：以雙離峰時段的自動觸發降低單次漏跑的影響；漏跑由後續 Feature 的冪等機制補足，本階段僅需確保兩個觸發都能各自完整執行。
- **連續多日無變更**：狀態無實質變更時**不製造 commit**（保持乾淨歷史）；排程保活不依賴人工心跳，而是靠正式期每日 `lastNewsPushAt` 變更與開發期程式碼 commit。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系統 MUST 以一次性、跑完即退的批次任務形式執行（不常駐、不啟動長時間服務），適合排程環境。
- **FR-002**: 系統 MUST 從執行環境的機密設定載入三項機密（GitHub API token、LLM 金鑰、Discord webhook URL），且這些機密 MUST NOT 出現在版本庫或任何輸出產物中。
- **FR-003**: 系統 MUST 在任一必要機密缺失或明顯無效時，於執行早期以清楚訊息失敗，並且不送出任何內容推播。
- **FR-004**: 系統 MUST 能將一則含標題與執行時間戳的訊息推播到設定的 Discord 頻道，作為通道連通性的最小驗證。
- **FR-005**: 系統 MUST 維護單一權威狀態檔 `state/board.json`，並定義其結構雛形，至少涵蓋：榜單快照、簡介快取、已推新聞紀錄、榜單上次推播時間、新聞上次推播時間。
- **FR-006**: 系統 MUST 能在狀態檔不存在時以合法的空白骨架初始化，並能讀取既有狀態而不遺失欄位。
- **FR-007**: 系統 MUST **僅在狀態實際變更時**才將其寫回版本庫並保存；MUST NOT 製造空 commit 或人工心跳 commit。排程保活由開發期的程式碼 commit 與正式期每日 `lastNewsPushAt` 變更自然滿足。
- **FR-008**: 系統 MUST 僅在推播成功之後才寫回相關狀態，避免寫入半套狀態。
- **FR-009**: 系統 MUST 在寫回狀態發生併發衝突時先同步再重試；重試多次仍失敗 MUST 被視為失敗並觸發告警。
- **FR-010**: 系統 MUST 在**應用程式內**任一步驟失敗時送出一則明顯的紅色告警訊息到 Discord（含可排查資訊），並將該次執行標記為失敗；全程成功時 MUST NOT 送出告警。
- **FR-011**: 系統 MUST 提供每日自動觸發的排程，採兩個離峰時段作為主排與補跑保險，並 MUST 提供手動觸發入口供隨時驗證。
- **FR-012**: 系統 MUST NOT 於本階段納入任何資料來源抓取、LLM 呼叫或新聞過濾/策展邏輯（範圍邊界）。
- **FR-013**: 系統 MUST 以模組化、可注入相依的結構組織程式碼，使後續 Feature 能新增元件而不需重構骨架。
- **FR-014**: 排程層 MUST 以 workflow 層級（`if: failure()`）在**應用程式未成功送出告警**的任何失敗時補送一則紅色告警——涵蓋 app 啟動前與啟動中（checkout、建置、機密載入/env 驗證導致 pipeline 未能執行）、應用程式內告警送出本身失敗、**以及 app 成功結束後的狀態 commit/push 階段**失敗，確保任何層級的失敗都不會無聲。去重 MUST 以應用程式明確回報「已送出」為準（而非推測步驟結果）；極端情況下寧可重複一則、不可兩邊沉默。
- **FR-015**: 版本庫 MUST 內含一份合法的空白 `state/board.json` 骨架，作為 schema 基準與首次執行的乾淨起點。

### Key Entities *(include if feature involves data)*

- **執行狀態（state/board.json）**：本專案唯一權威的跨執行狀態。屬性雛形包含——`board`（各領域榜單快照，鍵為 repo 識別碼）、`intros`（repo 簡介快取，獨立於榜單快照）、`seenNews`（已推播新聞紀錄，含時間戳以供修剪）、`lastBoardPushAt`（榜單上次推播時間）、`lastNewsPushAt`（新聞上次推播時間）。本階段建立其結構雛形與讀寫能力，欄位內容多為空。
- **推播訊息（Discord embed）**：送往私人頻道的一則結構化訊息，具標題、內容與顏色；本階段有兩種——測試 embed（連通性驗證）與紅色失敗告警。
- **機密（Secrets）**：GitHub API token、LLM 金鑰、Discord webhook URL 三項；僅存於執行環境的機密設定，絕不入庫或入產物。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 擁有者手動觸發任務後，於 5 分鐘內在手機 Discord 頻道收到測試 embed。
- **SC-002**: 當某次執行使狀態實際變更時，變更於該次執行後被 commit + push 回版本庫；無實質變更的執行不產生任何 commit；後續執行能正確讀入先前狀態。
- **SC-003**: 在缺少任一必要機密的情況下觸發，任務於 1 分鐘內失敗並且完全沒有內容推播送出。
- **SC-004**: 故意注入失敗時，擁有者於 5 分鐘內收到一則紅色告警——無論失敗發生在應用程式內或應用程式啟動前（建置/機密載入）；全程成功的執行則收不到任何告警。
- **SC-005**: 單次成功執行不涉及任何外部資料來源抓取或 LLM 呼叫（範圍邊界可由執行紀錄驗證）。
- **SC-006**（持續性營運護欄，非單次 quickstart 可驗）：一個月內排程自動觸發的執行不因基礎設施用量超出免費額度而失敗。本項屬跨月結果指標，於本 Feature 以**設計檢查**佐證即可——每日僅兩次 cron 觸發、單次 1–3 分鐘、無資料抓取/LLM，用量遠低於 Actions 免費額度；實際達標由後續營運期監看，不納入 quickstart 的單次逐項驗證。

## Assumptions

- 執行環境為排程型 CI（GitHub Actions）：public repo 免費額度充足；每日兩次觸發遠低於限額。此為既有架構決策（見開發指南 §2、§8），非本 spec 重新評估。
- 機密以執行平台的 Secrets 提供，命名沿用開發指南（GitHub token 因平台保留字而命名為 `GH_API_TOKEN`）。
- 狀態持久化採「commit 回同一版本庫」的方式，兼作免費歷史紀錄；此為既有架構決策（見開發指南 §2.1、§2.2）。排程保活由正式期每日 `lastNewsPushAt` 變更與開發期程式碼 commit 自然達成，不需人工心跳 commit（見澄清；與開發指南 §8 workflow 的 no-diff 早退一致）。
- 每日兩個自動觸發時段採離峰分鐘（台北 06:07 / 06:37，對應 UTC 22:07 / 22:37）以降低平台排程延遲/跳過的影響；漏跑補推與冪等去重屬後續 Feature（F3、F7）範圍，本階段僅確保單次執行可完整跑通。
- 「測試 embed」為本階段暫時性的連通性驗證用途，後續 Feature 會以真實晨報/榜單內容取代其執行時的實際輸出。
- 本階段不需要一般性資料庫；唯一持久狀態即 `state/board.json`。
- 技術選型（NestJS application context CLI、爬蟲/RSS/LLM 等函式庫、cron 表達式與 workflow 細節）於 `/speckit-plan` 釘死，不在本 spec 決定。
