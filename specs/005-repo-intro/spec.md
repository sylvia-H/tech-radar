# Feature Specification: LLM 封裝與 repo 250 字簡介（LLM Wrapper & Repo Intro）

**Feature Branch**: `005-repo-intro`

**Created**: 2026-07-18

**Status**: Draft

**Input**: User description: "005-repo-intro"

> 範圍依真實來源界定：`docs/tech-radar-dev-guide.md` §6（每個 repo 的 250 字簡介）、§10（LLM 使用）、
> 以及 §11.2 的 F5 條目；憲章原則 III（簡介 ≤250 字、繁中）、V（節制 LLM）、VI（簡介必快取、防幻覺、
> 狀態單一來源）、VII（來源隔離容錯）、VIII（簡介快取命中須有測試）。F5 交付三塊：**LLM 服務封裝**
> （Gemini 免費層 Flash 系，含 429 指數退避 + jitter）、**README 取得**、以及 **repo 簡介服務**
> （首次進榜生成一次 ≤250 字繁中簡介、寫入 `state.intros` 快取、無 README 退回 description+topics、
> 防幻覺約束、單筆失敗降級不阻斷整批）。
>
> **本 Feature 不含**：榜單抓取與 diff（F2/F3，已驗收；「哪些 repo 是新進／竄升」由呼叫端決定，
> F5 只負責「給定一個 repo，回傳快取或生成的簡介」）、每日新聞策展的 LLM 呼叫與繁中 50/300 改寫
> （F6，另一種 LLM 呼叫，但會**重用本 Feature 建立的 LLM 服務封裝**）、榜單日「本次變化」TL;DR
> 摘要與 Discord 組版推播（F7）。

## Clarifications

### Session 2026-07-18

- Q: 簡介素材 metadata（description / topics / language / owner-name）從何而來（BoardChange 與持久化 state.board 皆不含 description/topics）？ → A: 由呼叫端（F7）以 repoId join 當次 F2 抓取結果後，將完整 metadata 傳入 IntroService；F5 只自行取 README，不另打 GitHub metadata API。
- Q: 簡介最終生成失敗時 IntroService 該以什麼形態回傳，讓呼叫端改以 description 呈現？ → A: 回傳一個可區別的結果物件（成功／快取命中回傳 intro；降級回傳明確的 `degraded` 狀態＋備援 description），呼叫端據此渲染並可區分真簡介與降級卡；失敗不寫入快取、以 warn 記錄不無聲。
- Q: README「極短」（低於可用門檻）的判定標準？ → A: 以 stripMarkdownNoise 去雜訊後的字元數（code points）為準，低於一個門檻（建議 ~200，實際數值於 /speckit-plan 釘定）即視為極短、退回 description+topics。

## User Scenarios & Testing *(mandatory)*

本功能的「使用者」即專案擁有者（自用）。榜單每七天推一次、只呈現變化；擁有者看到一個**新進榜**或
**竄升**的 repo 時，希望卡片附上一段精簡、可信、繁體中文的介紹，快速判斷「這個 repo 在解決什麼、
值不值得點進去」，而不必自己去讀 README。同時，這段簡介的生成必須**極度節制 LLM 額度**：同一個
repo 一生只生成一次、之後永遠讀快取，且任一 repo 的簡介失敗都不能拖垮其他 repo 或整條 pipeline。

本 Feature 建立**簡介資料流**與其底層的 **LLM 服務封裝**：給定一個 repo，先查快取；未命中才取其
README（無則退回 description + topics），送 LLM 生成一段 ≤250 字、只依素材、不杜撰的繁中簡介，
寫回快取供日後重用。LLM 呼叫統一經過一層封裝，負責 429 退避重試與失敗容錯。

本 Feature **不決定「哪些 repo 需要簡介」**（那是榜單 diff 的結果，F3/F7），也**不組 Discord 版面、
不推播**。它產出的是「可被榜單卡片取用的簡介字串 + 快取」。

### User Story 1 - 新進榜 repo 的一次性繁中簡介（Priority: P1）

擁有者看到一個新進 top 10 的 repo，卡片上要有一段 ≤250 字的繁體中文簡介：說明它解決什麼問題、
核心特色、適合誰／使用情境。系統對該 repo 取其 README 作為素材（去除 badge/HTML 等雜訊並截斷以
控制 token），送 LLM 生成簡介，並把結果寫回快取。簡介只依 README/metadata，不得杜撰功能或數字。

**Why this priority**: 這是 F5 的核心產出，也是 M3 里程碑的驗收主體——「新進榜 repo 附簡介」。
沒有它，榜單卡片只剩名次與星數，缺少「這是什麼」的判讀依據。它本身即構成可展示的最小可用產品：
給一個 repo，就能得到一段可貼上卡片的繁中簡介。

**Independent Test**: 以一個具代表性 README 的 repo（快取未命中）呼叫簡介服務，檢視回傳是否為
≤250 字的繁體中文段落、內容忠於 README（無杜撰數字/連結）、且已寫入 `state.intros[repoId]`
（含生成時間戳）。README 取得與 LLM 呼叫可用 mock，全程不依賴真實網路。

**Acceptance Scenarios**:

1. **Given** 一個 `state.intros` 尚無紀錄的 repo 且其 README 可取得，**When** 請求該 repo 的簡介，
   **Then** 系統取 README、去雜訊並截斷後送 LLM，回傳一段 ≤250 字的繁體中文簡介，並寫入
   `state.intros[repoId] = { intro, introAt }`。
2. **Given** 一段成功生成的簡介，**When** 檢查其內容，**Then** 內容僅根據 README/metadata 提供的
   資訊，**不含**素材未出現的星數、名次或連結（事實數據一律由程式提供、不經 LLM）。
3. **Given** LLM 回傳的簡介超過 250 字，**When** 系統驗證長度，**Then** 系統將簡介收斂至 ≤250 字
   後才輸出與快取（不讓超長內容外流）。
4. **Given** 送入 LLM 的 README 素材很長，**When** 準備素材，**Then** 系統先去除 badge/HTML 等
   Markdown 雜訊、再截斷至一個上限長度，以控制 token 與成本。

---

### User Story 2 - 簡介必快取：一生只生成一次（Priority: P1）

同一個 repo 的簡介一生只生成一次。之後任何時候再需要該 repo 的簡介——包含它**竄升**時、或**掉出
top 10 後又重新進榜**時——系統一律直接讀快取回傳，**不再呼叫 LLM**。快取獨立於榜單快照儲存，
掉出榜時**不清除**。

**Why this priority**: 這是憲章原則 V（節制 LLM）與 VI（簡介必快取）的直接實現，也是 M3 驗收的
另一半——「同一 repo 再次進榜命中快取、不重生成」。它是額度安全的護欄：把 LLM 呼叫鎖死在「每個
repo 首次進榜一次」，穩定態每七天才 0～數次呼叫。與 US1 可獨立驗證：US1 是快取未命中路徑，US2
是命中路徑。

**Independent Test**: 預先在 `state.intros` 放入某 repo 的簡介，呼叫簡介服務，確認**回傳快取內容、
且完全未呼叫 LLM 或取 README**（以 mock 斷言呼叫次數為 0）；再模擬該 repo「掉出後重新進榜」，
確認仍讀快取、不重生成。

**Acceptance Scenarios**:

1. **Given** `state.intros[repoId]` 已有簡介，**When** 請求該 repo 的簡介，**Then** 系統直接回傳
   快取內容，**不呼叫 LLM、亦不取 README**。
2. **Given** 一個曾生成簡介、後來掉出 top 10 的 repo，**When** 它重新進榜且被再次請求簡介，
   **Then** 系統命中既有快取並回傳，不重新生成（掉出榜不清除快取）。
3. **Given** 簡介快取，**When** 榜單快照因 diff 而更新或某 repo 掉出，**Then** `state.intros` 不因
   榜單變動而被清除（快取獨立於榜單快照）。

---

### User Story 3 - 無 README 或內容過少時的保守簡介（Priority: P2）

不是每個 repo 都有豐富的 README。若 README 取不到、為空或極短，系統改以 repo 的 description 與
topics 作為素材，生成一段較保守的簡介，並可在末尾標註「（資訊有限）」，讓擁有者知道判讀依據較薄。

**Why this priority**: 保證簡介服務對「素材不足」的 repo 仍能產出可用結果、不會直接失敗或留白，
是 US1 的健全化。優先序低於 US1/US2，因為多數進榜 repo 都有 README；但缺了它，一部分新進 repo
的卡片會沒有簡介。

**Independent Test**: 以「README 取不到」與「README 極短」兩種情境各呼叫一次簡介服務，確認系統
改用 description + topics 生成簡介、仍為 ≤250 字繁中，且（在資訊明顯不足時）帶「資訊有限」標註；
全程 mock README 取得與 LLM。

**Acceptance Scenarios**:

1. **Given** 某 repo 的 README 取得失敗或回傳空內容，**When** 請求其簡介，**Then** 系統改以
   description + topics 為素材生成 ≤250 字繁中簡介，不因無 README 而失敗。
2. **Given** 某 repo 的 README 內容極短（低於一個可用門檻），**When** 請求其簡介，**Then** 系統
   以 description + topics 補強素材生成較保守的簡介，並可標註資訊有限。
3. **Given** 連 description 與 topics 都幾乎沒有內容的 repo，**When** 請求其簡介，**Then** 系統仍
   回傳一段不杜撰的最小可用簡介（例如僅陳述名稱、語言與可得的少量事實），不編造功能。

---

### User Story 4 - LLM 容錯與退避：單筆失敗不阻斷整批（Priority: P2）

LLM 呼叫可能遇到暫時性錯誤（尤其 429 額度/速率限制）。系統的 LLM 服務封裝在遇到 429 時以**指數
退避 + jitter** 重試；若某個 repo 的簡介最終仍生成失敗，系統**降級**該筆（該卡改以 repo 的
description 呈現），並**繼續處理其餘 repo**，絕不讓單一 repo 的簡介失敗中止整批或整條 pipeline。

**Why this priority**: 這是憲章原則 VII（來源隔離容錯：任一環節失敗不得使整條 pipeline 失敗、
不得無聲）在簡介環節的落實，也是把 LLM 這個外部相依的抖動隔離在單一 repo 內。優先序 P2，因為在
額度充足、網路正常時不會觸發；但少了它，一次 429 就可能讓整個榜單推播失敗。

**Independent Test**: 以 mock 讓 LLM 首次回 429、隨後成功，確認封裝有退避重試且最終成功；再讓
某個 repo 的簡介持續失敗，確認該筆降級為 description、其餘 repo 的簡介照常產出、整批不中止。

**Acceptance Scenarios**:

1. **Given** LLM 首次回應 429（速率/額度限制），**When** 呼叫簡介生成，**Then** 系統以指數退避
   + jitter 重試，並在後續成功時回傳正常簡介。
2. **Given** 某個 repo 的簡介在重試後仍失敗，**When** 該批中其他 repo 尚待生成簡介，**Then**
   系統將此 repo 降級（其卡片改以 description 呈現）、記錄該失敗，並繼續為其餘 repo 生成簡介。
3. **Given** 一批 repo 中有一筆簡介失敗，**When** 整批處理完成，**Then** 整條 pipeline 不因該筆
   失敗而中止或報整體失敗（失敗須被記錄、不得無聲）。

---

### Edge Cases

- **快取內容為空字串**：快取命中判定以「有無該 repoId 紀錄且 intro 為非空」為準，避免把一次失敗
  寫成的空簡介永久快取住而再也不重試（快取只在成功生成後寫入）。
- **README 含大量 badge / HTML / 目錄**：素材前處理須去雜訊，避免 token 被雜訊占滿、也避免雜訊
  誤導 LLM。
- **README 極長（數十萬字）**：截斷至上限長度後再送 LLM，控制 token 與成本。
- **LLM 回傳非繁體中文或夾雜英文段落**：系統**不做**嚴格語言偵測或語言比例校驗；繁中約束**以
  prompt 為主**，程式面只硬驗證長度（≤250 字，超長收斂）與非空。夾雜英文詞句為**已知且接受的
  有界風險**（研判成本/複雜度不對等，見 research §D11），非本 Feature 需消除的缺陷。
- **LLM 回傳空字串或明顯無效內容**：視為生成失敗，走降級路徑（description 備援），不寫入快取。
- **同一 repo 在同一次執行內被請求多次**：仍只生成一次（首次生成後即命中快取）。
- **repo 沒有 description 也沒有 topics 且無 README**：產出最小可用、不杜撰的簡介（見 US3-3）。

## Requirements *(mandatory)*

### Functional Requirements

**簡介生成與快取（IntroService）**

- **FR-001**: 系統 MUST 提供「給定一個 repo（含其識別碼與 metadata），回傳其 ≤250 字繁體中文
  簡介」的能力；呼叫端不需自行判斷快取或生成。**輸入契約**：`repoId`、`fullName`（可拆出
  owner/name 供 README 取得）、`description`、`language`、`topics`、`starsThisWeek` 等 metadata
  由**呼叫端傳入**（呼叫端以 `repoId` join 當次榜單抓取結果補齊）；IntroService 除自行取 README
  外 **MUST NOT** 另打 GitHub metadata API 補取 description/topics（避免重複取數、省 GitHub 額度）。
- **FR-002**: 系統 MUST 在生成前先查 `state.intros[repoId]`：**命中（存在且 intro 非空）則直接
  回傳快取內容，且不呼叫 LLM、不取 README**。
- **FR-003**: 快取未命中時，系統 MUST 取該 repo 的 README 作為主要素材，經去雜訊
  （badge/HTML/Markdown 噪音）與截斷至一個上限長度後，送 LLM 生成簡介。
- **FR-004**: 簡介成功生成後，系統 MUST 將其寫入 `state.intros[repoId] = { intro, introAt }`
  （`introAt` 為生成時間戳），且此快取 MUST 獨立於榜單快照儲存、**掉出榜時不清除**。此寫入僅止於
  呼叫端傳入的 **in-memory** state 物件——IntroService **MUST NOT** 自行呼叫 `StateStore.save()`
  落檔或做任何 git commit；持久化時機由呼叫端（F7）於推播成功後統一處理（憲章 VI「狀態必須在推播
  成功後才寫回」），避免簡介生成與推播結果脫鉤造成半套狀態。
- **FR-005**: 系統 MUST 保證同一 repo 的簡介**一生只生成一次**：任何後續請求（含竄升、掉出後
  重新進榜）一律讀快取、不重新呼叫 LLM。
- **FR-006**: 系統 MUST 驗證輸出簡介長度不超過 **250 字**；LLM 回傳超長時 MUST 先收斂至 ≤250 字
  才輸出與快取。
- **FR-007**: 簡介 MUST 為繁體中文，內容 MUST 僅依提供的 README/metadata，**MUST NOT** 杜撰
  素材未出現的功能、數字、名次或連結（星數/連結/名次一律由程式提供、不經 LLM）。簡介內容依「解決
  什麼問題→核心特色→適合誰」的結構組織（US1）為 prompt 層**指引（SHOULD）**，非程式面硬性驗證項——
  與繁中/長度不同，系統不檢查輸出是否確實依此三段結構。

**素材取得與退回（github-readme + 保守素材）**

- **FR-008**: 系統 MUST 能取得指定 repo 的 README 內容；取得失敗、內容為空或**極短**時，MUST
  **退回**以 repo 的 description + topics 作為素材，而非直接失敗或留白。「極短」以 `stripMarkdownNoise`
  去雜訊後的**字元數（code points）**低於一個門檻（建議約 200，實際數值於 `/speckit-plan` 釘定）判定。
- **FR-009**: 以退回素材（description + topics）生成時，若**連 description 與 topics 也近乎空**
  （素材整體貧乏，標記為 `sparse`），系統 MUST 於 prompt 指示在簡介末尾標註「（資訊有限）」以示
  判讀依據較薄；description / topics 尚足的一般退回情形則**不**標註。無論是否標註，皆仍 MUST
  維持 ≤250 字繁中與不杜撰約束。
- **FR-010**: README 取得 MUST 遵循抓取禮貌（自訂 User-Agent、條件式請求、失敗退避），並沿用
  F1 既有的 GitHub HTTP 基座，不另建平行的請求層。

**LLM 服務封裝（LlmService）**

- **FR-011**: 系統 MUST 提供單一的 LLM 服務封裝作為所有 LLM 呼叫的統一入口（本 Feature 由簡介
  使用，後續 F6 新聞策展 MUST 重用同一封裝，不另建平行 LLM 客戶端）。
- **FR-012**: LLM 封裝遇**暫時性錯誤**——**429**（速率/額度限制）、**503**（暫時不可用）與網路層
  錯誤——MUST 以**指數退避 + jitter** 重試；**用戶端錯誤（400 / 401 / 403 等）不重試**、直接視為
  失敗。重試須有上限次數，逾限視為該次呼叫失敗（可重試碼清單與退避參數見 research §D6）。
- **FR-013**: LLM 封裝 MUST 只將**公開資料**（README/metadata）送交 LLM，符合免費層資料使用條款；
  **MUST NOT** 引入 embeddings 或向量檢索（憲章 V）——簡介生成全程零向量比對，只有一次生成呼叫。

**容錯與降級**

- **FR-014**: 單一 repo 的簡介生成失敗（含 429 重試耗盡、空/無效回應）MUST 以**降級結果收尾、
  不向呼叫端擲錯**（回 `degraded`，見 FR-015），使呼叫端（F7）迴圈得以繼續處理其餘 repo，亦
  MUST NOT 使整條 pipeline 失敗。（F5 提供的是單筆 `ensureIntro` 的「不擲錯」保證；「其餘 repo
  照常產出」屬呼叫端迴圈的批次層行為，由 F7 達成與驗證。）
- **FR-015**: 簡介失敗的 repo MUST 降級為以其 description 呈現（供榜單卡片備援），且該失敗
  MUST 被記錄（`logger.warn`，內容 MUST 含 `repoId`／`fullName` 供追查，**MUST NOT** 含 prompt
  或 LLM 回應全文）、**不得無聲略過**。此 warn 記錄為 F5 對該失敗的唯一回報形式——**MUST NOT**
  發送 Discord 告警或任何推播；面向使用者的紅色告警 embed 屬呼叫端（F7）推播層職責，不在 F5
  範圍內（F5 本就不組版、不推播，見範圍界定）。IntroService 的回傳 MUST 為**可區別的結果物件**：
  成功／快取命中時帶簡介文字（並可標示 source 為新生成或快取），降級時帶明確的 `degraded`
  狀態與備援 description，讓呼叫端能區分「真簡介」與「降級卡」而非把 description 誤當簡介。
- **FR-016**: 生成失敗時系統 **MUST NOT** 將空字串或無效內容寫入 `state.intros` 快取（避免把
  失敗結果永久快取，之後有機會重試）。

### Key Entities *(include if feature involves data)*

- **簡介快取條目（IntroCache）**：某 repo 的一次性簡介，含簡介文字（`intro`，繁中 ≤250 字）與
  生成時間戳（`introAt`）；以 repoId 為鍵存於 `state.intros`，獨立於榜單快照、掉出榜不清除。
- **repo 素材（Intro material）**：生成簡介的輸入。主要為 README（去雜訊、截斷後）；README 不足
  時退回 description + topics。連同 `fullName / description / language / topics / starsThisWeek`
  等 metadata 一併作為 LLM 的輔助素材（其中事實數據僅供 LLM 參考語境，不由 LLM 產生）。
- **LLM 呼叫封裝（LlmService）**：所有 LLM 呼叫的統一入口，封裝生成請求、429 指數退避 + jitter
  重試與錯誤處理；本 Feature 供簡介使用，後續 Feature（F6 新聞策展）重用。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 同一 repo 的簡介一生只生成一次——對已有快取的 repoId 再次請求簡介時，LLM 呼叫次數
  為 **0**（快取命中路徑完全不觸及 LLM 與 README 取得）。
- **SC-002**: 所有輸出簡介 **100%** 為繁體中文且長度 **≤250 字**（超長輸入被收斂後仍符合）。
- **SC-003**: 冷啟動首次推播最多 10 個新進 repo → LLM 簡介呼叫 **≤10 次**；穩定態每七天新進
  0～數個 → 呼叫 0～數次，遠低於免費層每日上限。（本項為快取「一生一次」的衍生用量界限，由
  SC-001 的命中零呼叫直接保證，不另立獨立建置任務。）
- **SC-004**: 任一 repo 的簡介失敗時，`ensureIntro` 回傳 `degraded`（不擲錯）使呼叫端得以續跑
  其餘 repo、整條 pipeline 不中止——單筆失敗造成的連帶失敗數為 **0**，且該 repo 卡片以 description
  備援呈現。（批次層「其餘 repo 照常產出」由 F7 的迭代驗證。）
- **SC-005**: 簡介內容不含 README/metadata 未提供的數字或連結（抽樣檢核 0 起杜撰事實）。
  （由 prompt 防幻覺約束＋「事實數據不經 LLM」的架構保證落實，並於 quickstart 人工抽驗；屬非可
  單元化自動判定的性質項，不另立獨立建置任務。）
- **SC-006**: 曾生成簡介、掉出榜後又重新進榜的 repo，再次請求時 **100%** 命中快取、0 次重生成。
- **SC-007**: LLM 遇 429 時能以指數退避 + jitter 重試並在額度恢復後成功，不因單次 429 直接判定
  簡介失敗。

## Assumptions

- **簡介觸發由呼叫端決定**：F5 只提供「給定 repo → 回傳快取或生成的簡介」的能力；「哪些 repo 是
  新進／竄升、需要簡介」由榜單 diff（F3）與推播編排（F7）決定。F5 不做榜單 diff、不組版、不推播、
  不落檔（不呼叫 `StateStore.save()`）、不 commit——持久化與 commit 一律由 F7 於推播成功後負責。
- **「字」以 Unicode 字元（code point）計數**：與新聞 50/300 字數上限一致的計數口徑；250 字上限
  以字元數為準。
- **超長簡介以截斷收斂**：LLM 回傳超過 250 字時，採「截斷至 ≤250 字（必要時於自然邊界並加省略
  標記）」為預設收斂手段，不重呼叫 LLM 重生成（避免額外額度消耗；沿用「一切從簡」取捨）。
- **README 素材上限沿用 dev-guide 建議**：去雜訊後截斷至約 6,000 字元即可涵蓋多數專案重點、
  兼顧 token 成本（`docs/tech-radar-dev-guide.md` §6.1/§6.3）；實際數值於 `/speckit-plan` 釘定。
- **LLM 為 Gemini 免費層 Flash 系**：憲章原則 I 釘死；封裝以 `@google/genai` 實作（技術細節於
  `/speckit-plan` 確認），本規格層面只要求「單一 LLM 入口 + 429 退避 + 只送公開資料」。
- **依賴既有基座**：README 取得沿用 F1 的 GitHub HTTP 基座（`src/github/github-http.ts`）與其
  抓取禮貌；快取讀寫沿用 F1 的 `StateStore` 與 `state.intros` schema（`introCacheSchema`），
  不繞過狀態單一來源、不新建平行狀態。
- **429 重試上限與退避參數於 plan 釘定**：FR-012 要求「指數退避 + jitter、須有上限次數」；實際
  最大重試次數與退避基準/上限值屬調校參數，於 `/speckit-plan` 確認（本輪 clarify 不釘數值）。
- **降級備援素材為 description**：簡介失敗時卡片改顯示 repo 的 description（由呼叫端隨 metadata
  傳入；持久化的 `state.board` 快照本身不存 description/topics，故由呼叫端 join 當次抓取結果提供），
  屬可接受的降級，不另呼叫 LLM 生成替代文案。
