# Feature Specification: 榜單來源與三領域歸類（Board Sources）

**Feature Branch**: `002-board-sources`

**Created**: 2026-07-11

**Status**: Draft

**Input**: User description: "F2 榜單來源與三領域歸類（002-board-sources）。抓取近一週最受關注、新崛起的 GitHub repo 作為榜單來源，並歸入三領域（AI / DevOps / 前後端）。主力來源為 GitHub Trending weekly 的官方「stars this week」週增量，補位來源為 GitHub Search API 近 7 天新建且已累積不少星的 repo；兩來源以 GitHub 數字 id 合併去重，套用穩定排序鍵，每領域取 top 15 作為當前榜單。不自存星星歷史。本 Feature 只產生可觀測的當前榜單（log 可印出正確三領域週增星榜），不含榜單狀態快照、變化偵測、Discord 推播、簡介與新聞漏斗。驗收（M1）：本機／Actions log 印出正確的三領域週增星榜。"

## User Scenarios & Testing *(mandatory)*

本功能的「使用者」即專案擁有者（自用）。目標是把「近一週最受關注、新崛起的 GitHub repo」轉成一份分好三領域、可觀測的**當前榜單**，作為後續變化偵測（F3）、簡介（F5）與推播（F7）的資料地基。此階段**只產出當前榜單快照供觀測，不做跨執行的變化比對，也不推播到 Discord**。

### User Story 1 - 三領域週增星榜可被觀測（Priority: P1）

擁有者執行任務後，能在執行紀錄（log）看到 **AI / DevOps / 前後端** 三領域各自的當前榜單，每項含 repo 名稱、本週增星量、所屬領域與排序位置，且榜單內容與實際本週熱門情形相符。

**Why this priority**: 這是里程碑 M1 的核心價值，也是「只看變化」（F3）與其後所有功能的前置。沒有一份可信、分好領域的當前榜單，之後的 diff、簡介與推播都無所依附。它本身即構成可展示的最小可用產品：擁有者能看到「這週三領域各有哪些 repo 在竄升」。

**Independent Test**: 於已備妥 GitHub token 的環境執行一次任務，檢視 log 是否印出三領域榜單、每項欄位齊備（名稱／本週增星／領域／名次），並人工抽查數個 repo 的領域歸類與週增星數是否合理；不依賴狀態快照、LLM 或 Discord 即可完整驗證。

**Acceptance Scenarios**:

1. **Given** GitHub token 已設定且來源可達，**When** 擁有者執行任務，**Then** log 印出 AI / DevOps / 前後端三領域的當前榜單，每領域至多 15 筆，每筆含 repo 識別（owner/name）、本週增星量、所屬領域與名次。
2. **Given** 某個 repo 的主題（topics）明確屬於某一領域，**When** 榜單產出，**Then** 該 repo 被歸入對應領域，不會落入其他領域或被漏掉。
3. **Given** 某個 repo 無法歸入任一目標領域，**When** 榜單產出，**Then** 該 repo 不出現在任何領域榜單中（寧缺勿濫，不強行歸類）。

---

### User Story 2 - 新崛起 repo 被補位收錄（Priority: P2）

除了已擠上熱門榜的 repo，擁有者也希望看到「近 7 天內剛誕生就爆紅、尚未進入主榜」的新星，避免只追熱門而漏掉真正的新崛起。

**Why this priority**: 主力來源涵蓋既有熱度，但會漏掉「剛建立就快速累星」的 repo；補位來源正是本專案「新崛起」定位的關鍵。它可與主力來源獨立驗證，但價值略低於「先有一份可觀測榜單」，故列 P2。

**Independent Test**: 只啟用補位來源執行一次，檢視是否取得「建立時間在近 7 天內、且已累積一定星數」的 repo，並確認這些 repo 能被歸入三領域；與主力來源分開即可驗證。

**Acceptance Scenarios**:

1. **Given** 近 7 天內有新建且已累積相當星數的 repo，**When** 補位來源查詢執行，**Then** 這些 repo 被納入候選並依領域關鍵字分組查詢（AI／DevOps／前後端各一組）。
2. **Given** 一個 repo 同時出現在主力與補位來源，**When** 兩來源合併，**Then** 最終榜單中該 repo 只出現一次（見 User Story 3 的去重）。
3. **Given** 補位來源回傳的是「當前總星數」而非週增量，**When** 排序，**Then** 以「總星數 ÷ 建立天數」近似其崛起速度作為排序依據，與主力來源的週增星排序鍵可並存比較。

---

### User Story 3 - 跨來源合併、去重與穩定排序（Priority: P2）

擁有者希望兩個來源合併後，同一個 repo 不重複出現，即使它改了名字也能被視為同一個；且每領域以一致的排序規則取前 15 名，作為穩定的「當前榜單」交給後續比對。

**Why this priority**: 合併去重與穩定排序是「當前榜單」可被 F3 正確 diff 的前提——若同一 repo 因改名而重複、或排序不穩定，之後的「新進／竄升／下降」判定會失真。它與資料抓取可分開驗證，故與 US2 並列 P2。

**Independent Test**: 餵入包含「同一 repo 出現在兩來源」與「repo 改名」的樣本，驗證合併後只保留一筆、且以數字 id 而非名稱判定同一性；再驗證每領域輸出恰為排序後的前 15 名。

**Acceptance Scenarios**:

1. **Given** 同一 repo 同時來自主力與補位來源，**When** 合併，**Then** 以 GitHub 數字 id 判定為同一 repo 並只保留一筆（抗改名）。
2. **Given** 某領域候選超過 15 筆，**When** 產出當前榜單，**Then** 只保留排序後的前 15 筆（追蹤深度 15 大於推播呈現，保留竄升／下降的偵測空間）。
3. **Given** 兩來源使用不同的排序鍵，**When** 於同一領域排序，**Then** 排序規則明確且可重現（同輸入必得同順序），不因執行順序改變結果。

---

### User Story 4 - 單一來源失敗不拖垮整體（Priority: P3）

當某一個來源（主力或補位）暫時失敗或解析不到資料時，擁有者仍能拿到另一個來源的榜單，並收到明顯告警知道哪個來源出問題，而非整條流程無聲中斷或無聲少了一半資料。

**Why this priority**: 容錯與可見失敗是無人值守自用任務的護欄（憲章 VII）；但它不阻擋 M1 的主要驗收（正常路徑印出榜單），故列 P3。

**Independent Test**: 分別故意讓（a）主力來源解析失敗或回 0 筆、（b）補位來源查詢失敗，確認另一來源仍產出榜單，且兩種情況都發出帶「來源識別」的告警，不無聲略過。

**Acceptance Scenarios**:

1. **Given** 主力來源解析失敗或解析到 0 筆，**When** 任務執行，**Then** 補位來源仍照常產出其榜單，且系統發出一則指明失敗來源識別的告警。
2. **Given** 補位來源查詢失敗，**When** 任務執行，**Then** 主力來源仍照常產出其榜單，且系統發出一則指明失敗來源識別的告警。
3. **Given** 兩來源皆正常，**When** 任務執行，**Then** 不發出任何來源告警。

---

### Edge Cases

- **主力來源頁面改版**：熱門榜的頁面結構若改變導致解析失敗，須被偵測並告警（不得無聲回 0 筆當成「本週沒有熱門」）。
- **repo 改名 / 轉移擁有者**：名稱變了但仍是同一個 repo，須以數字 id 視為同一筆，避免重複收錄。
- **repo 無主題標籤（topics）**：MUST **退而以 description 比對領域關鍵字歸類，language 僅加權輔助、不單獨定領域；仍無命中則排除**（見 FR-003）。
- **跨領域 repo**：同時符合多個領域關鍵字的 repo，**擇一主領域，優先序 AI > DevOps > 前後端**，只入單一領域榜（見 FR-011）。
- **候選不足 15 筆**：某領域本週候選少於 15 筆時，榜單就呈現實際筆數，不硬湊。
- **API 限額**：對每個候選查詢主題等中繼資料時，須留意 GitHub API 限額，避免逼近免費上限（憲章 I）。
- **建立天數為 0（今日新建）**：補位來源以「總星數 ÷ 建立天數」排序時，須避免除以零。

## Clarifications

### Session 2026-07-11

本 Feature（F2）範圍內：

- Q: 榜單範圍是三領域還是全網熱門？ → A: 維持 **AI / DevOps / 前後端 三領域**（沿用憲章對本專案的定義，非全網熱門），但歸類規則採**寬鬆傾向**，以免漏掉確屬三領域的好工具（如 codegraph 這類開發者工具本就在範圍內）。
- Q: 一個 repo 的 topics／關鍵字同時命中多個領域時如何歸屬？ → A: **擇一主領域**，依固定優先序 **AI > DevOps > 前後端**，只入單一領域榜（去重乾淨、名額不被同一 repo 重複佔用）。
- Q: 候選 repo 沒有任何 topics 標籤時如何歸類？ → A: **topics 為主要訊號**；無 topics 時改以 **description** 比對領域關鍵字，命中才歸類；**language 僅作加權輔助、不單獨決定領域**；topics 與 description 皆無命中則排除（寧缺勿濫）。
- Q: 主力 Trending 要涵蓋哪些語言頁？ → A: 全站 `/trending?since=weekly` ＋ `typescript` / `javascript` / `python` / `rust` / `shell` 語言頁。
- Q: 補位 Search 星數門檻與三領域關鍵字集是否採開發指南 §3.2 種子集？ → A: **採用 §3.2 為 v1 canonical**（AI `stars:>30`、DevOps／前後端 `stars:>20`、`created:>今天−7天`；關鍵字種子集見「領域關鍵字種子集」），可日後擴充、只改設定不改 pipeline。

推播規則（**屬 F3 變化偵測／F7 推播，本 F2 不實作**，記錄備查，本 F2 只需保留計算所需原始欄位）：

- Q: 冷啟動首次推播會不會一次噴 45 張卡片？推播精簡到幾張？ → A: 推播改用**跨領域綜合排名取 top 10**（追蹤深度仍每領域 15）；diff（新進 top 10／竄升／下降；**掉出 top 10 當次靜默、不另報「跌出」，日後重回即以新進呈現**）**針對 top 10** 計算；**首次推播即為 10 張**（全數新進、皆帶簡介）。
- Q: 綜合排名用哪把尺（兩來源不同標度）？ → A: 統一為**「估算本週增星」**——Trending repo 用 `starsThisWeek`；Search-only repo 用 `(總星數÷建立天數)×7`；同時在兩來源者以 `starsThisWeek` 為準。
- Q: 綜合 top 10 要不要保證三領域都有代表？ → A: **保底每領域至少 2 席**，其餘名額比熱度；推播卡片 **MUST 標示週增星數**以呈現人氣落差。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系統 MUST 從 GitHub 官方「本週熱門」週增量取得主力候選 repo，並解析出每個 repo 的**本週增星量**作為排序依據；**MUST NOT** 自建每日星星快照或 day-over-day 對比（憲章 II）。
- **FR-002**: 系統 MUST 從 GitHub Search 取得「建立時間在近 7 天內、且已累積一定星數」的補位候選，並針對 AI／DevOps／前後端分別查詢，以補足尚未擠上主榜的新崛起 repo。
- **FR-003**: 系統 MUST 將候選 repo 歸入三領域之一：**AI / DevOps / 前後端**。歸類**主要訊號為 repo 的 topics**；當 repo **無 topics** 時，MUST 退而以 **description** 比對三領域關鍵字集合，且主要語言（language）**僅作加權輔助、MUST NOT 單獨決定領域**；topics 與 description 皆無命中者 MUST 被排除，不強行歸類（寧缺勿濫）。歸類採**寬鬆傾向**：確屬三領域的開發者工具（工具鏈／框架／平台等，如 codegraph）不應因關鍵字過嚴而被漏收。
- **FR-004**: 系統 MUST 以 GitHub 數字 id 作為 repo 同一性依據來合併兩來源並去重，確保同一 repo（含改名後）在最終榜單只出現一次。
- **FR-005**: 系統 MUST 對每個領域套用可重現的排序規則（主力來源用本週增星量；補位來源用「總星數 ÷ 建立天數」近似崛起速度），並取**每領域前 15 名**作為當前榜單。
- **FR-006**: 系統 MUST 將產出的三領域當前榜單以可觀測方式輸出（log 可印出，含 repo 識別、本週增星量、領域、名次），供人工驗收與後續 Feature 取用；本 Feature **MUST NOT** 進行狀態快照寫回、變化偵測或 Discord 推播。
- **FR-007**: 任一來源失敗或解析到 0 筆時，系統 MUST 發出**帶來源識別**的告警，且 MUST NOT 使整條流程失敗——另一來源仍須照常產出榜單（憲章 VII 來源隔離容錯）。
- **FR-008**: 系統 MUST 只讀取並處理**公開**的 repo 資料，抓取時 MUST 表現抓取禮貌（自訂 User-Agent、失敗退避），並使 API 用量與呼叫次數維持在免費上限內（憲章 I）。
- **FR-009**: 主力來源的頁面解析 MUST 有守著頁面改版的回歸保護（以快照為基準比對），解析失敗須被偵測並告警，不得靜默視為「本週無熱門」。
- **FR-010**: 本 Feature 的關鍵設定已於 `/speckit-clarify`（Session 2026-07-11）定案並回填如下，屬**可日後擴充的 v1 canonical**（調整只改設定、不改 pipeline）：
  - **主力 Trending 語言頁**：全站 `/trending?since=weekly` ＋ `typescript` / `javascript` / `python` / `rust` / `shell`。
  - **補位 Search 星數門檻**（沿用開發指南 §3.2）：AI `stars:>30`、DevOps `stars:>20`、前後端 `stars:>20`，皆配合 `created:>今天−7天`。
  - **跨領域歸屬**：擇一主領域，優先序 AI > DevOps > 前後端（見 FR-011）。
  - **三領域關鍵字種子集（v1）**：見下方「領域關鍵字種子集」。
- **FR-011**: 當一個 repo 同時命中多個領域時，系統 MUST 依固定優先序 **AI > DevOps > 前後端** 擇一**主領域**，該 repo 只出現在**單一領域榜**、不同時入多榜（確保去重乾淨、每領域 top 15 名額不被同一 repo 重複佔用）。

### 領域關鍵字種子集（v1 canonical，可日後擴充）

> 沿用開發指南 §3.2 為起始集合；**topics 為主要比對來源，無 topics 時比對 description**（見 FR-003）。日後增刪關鍵字只改設定、不動 pipeline（憲章 IV 精神）。

- **AI**：`llm`、`rag`、`agent`、`gpt`（＋ topics：`ai`、`machine-learning`、`deep-learning`、`llmops`、`transformers`）
- **DevOps**：`kubernetes`、`terraform`、`gitops`（＋ topics：`devops`、`ci-cd`、`docker`、`observability`、`platform-engineering`）
- **前後端**：`nextjs`、`react`、`svelte`、`nodejs`、`golang`（＋ topics：`typescript`、`vue`、`fastapi`、`frontend`、`backend`）

### Key Entities *(include if feature involves data)*

- **候選 Repo（Candidate Repo）**：一個被納入考量的 GitHub repo。關鍵屬性：GitHub 數字 id（同一性依據、抗改名）、owner/name、描述、主要語言、主題（topics）、本週增星量（主力來源提供）、當前總星數與建立日期（補位來源提供）、歸屬領域、排序分數、來源標記（主力／補位）。
- **領域（Domain）**：榜單的三個分類之一——**AI / DevOps / 前後端**。由關鍵字／主題集合定義（集合內容於 clarify 定案）。
- **當前榜單（Current Board）**：每領域一份、排序後至多 15 筆候選 repo 的清單，代表「本次執行觀測到的近一週三領域熱門與新崛起」。為本 Feature 的最終產出（僅供觀測，不持久化為狀態快照——狀態快照屬 F3）。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 執行一次任務後，擁有者能在執行紀錄看到 **AI / DevOps / 前後端三領域**的當前榜單，每領域至多 15 筆且欄位齊備（repo 識別、本週增星量、領域、名次）。
- **SC-002**: 對榜單中的 repo 人工抽查，**至少 90%** 的領域歸類判斷為合理（歸對領域），無明顯錯置。
- **SC-003**: 同一個 repo（含改名情境）在最終三領域榜單中**只出現一次**，去重正確率 100%（以含重複與改名的樣本驗證）。
- **SC-004**: 當任一來源失敗時，另一來源的榜單**仍能產出**，且擁有者收到一則指明失敗來源的告警；正常情況則無任何來源告警。
- **SC-005**: 相同輸入重複執行，各領域榜單的**排序結果一致可重現**（不因來源處理順序而改變名次）。
- **SC-006**: 單次完整執行所用的外部 API 呼叫次數維持在免費上限的安全範圍內（不逼近 GitHub API 限額）。

## Assumptions

- **三領域定義沿用專案既定分類**：AI / DevOps / 前後端（前端 + 後端合為一領域，與卡片領域配色一致）。**關鍵字／主題種子集已於 clarify 定案**（見 FR-010 與「領域關鍵字種子集」），為可日後擴充的 v1。
- **排序鍵沿用開發指南 §3.3**：主力來源用本週增星量、補位來源用「總星數 ÷ 建立天數」；**在本 F2 的各領域榜內排序不需換算成同一標度**（跨領域綜合排名的統一尺「估算本週增星」屬 F7 推播，見「追蹤深度」項）。
- **追蹤深度 15 > 推播呈現**：每領域保留 top 15 以利後續（F3）偵測竄升／下降；**本 Feature 不決定也不實作推播**。已於本次 clarify 為 F3/F7 預定推播規則：推播取**跨領域綜合 top 10**、**保底每領域至少 2 席**、以**「估算本週增星」**（Trending 用 `starsThisWeek`；Search-only 用 `(總星數÷建立天數)×7`）為統一排名尺、diff 針對 top 10、卡片標示週增星數——**本 F2 只需保留 `starsThisWeek`／總星數／建立日期等原始欄位**供其計算，不建立綜合排名。
- **不引入新狀態**：本 Feature 不寫回 `state/board.json`，也不做變化偵測；當前榜單僅存在於單次執行的記憶體與 log，狀態化留待 F3。
- **依賴 F1 既有基礎**：沿用 F1 建立的一次性 CLI 執行骨架、環境變數載入、GitHub token 機制與失敗告警通道；本 Feature 只新增資料來源與歸類，不改動推播與狀態骨架。
- **補位來源查詢門檻**：**已於 clarify 定案採開發指南 §3.2 門檻**（AI 星數 > 30、DevOps／前後端星數 > 20，建立時間 > 今天−7 天）（見 FR-010）。
