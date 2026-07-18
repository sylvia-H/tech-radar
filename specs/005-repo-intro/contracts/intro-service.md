# Contract: IntroService（repo 簡介服務）

給定一個 repo（含 metadata）與當前 state，回傳其 ≤250 字繁中簡介或降級結果（FR-001）。
位置：`src/intro/intro.service.ts`。

## 介面

```ts
@Injectable()
export class IntroService {
  /**
   * 確保取得某 repo 的簡介：先查快取，未命中才取 README 並生成。
   * @param input 呼叫端傳入的完整 metadata（research D7）
   * @param state 當前 in-memory BoardState；生成成功時就地寫入 state.intros
   * @param now   時間戳來源（可注入，測試可控）；預設 () => new Date()
   * @returns IntroResult（cached / generated / degraded）
   * 不擲錯：任何失敗轉為 { status: 'degraded' }（FR-014）。
   */
  async ensureIntro(input: IntroInput, state: BoardState, now?: () => Date): Promise<IntroResult>;
}
```

型別 `IntroInput` / `IntroResult` 見 [data-model.md](../data-model.md)。

## 常數（`src/intro/` 具名匯出）

| 常數 | 值 | 依據 |
|------|----|------|
| `MAX_INTRO_CHARS` | `250` | 憲章 III、FR-006 |
| `MAX_README_CHARS` | `6000` | research D2 |
| `MIN_README_CHARS` | `200` | research D3 |

## 行為契約（決策順序）

1. **查快取**：`state.intros[String(input.repoId)]?.intro` 存在且非空 → 回 `{ status: 'cached', intro }`，
   **不呼叫 LLM、不取 README**（FR-002；SC-001/006）。
2. **取 README**：`fetchReadme(http, owner, name)`（owner/name 由 `fullName` 拆）；取不到/404 → `''`。
3. **組素材**：`buildMaterial(input, readme)` → `{ text, source, sparse }`。
   - 去雜訊後 ≥ `MIN_README_CHARS` → `source='readme'`、截斷 `MAX_README_CHARS`（FR-003）。
   - 否則 → `source='fallback'`（description+topics）；近乎空則 `sparse=true`（FR-008；US3）。
4. **生成**：`llm.generate(introPrompt(input, material))`。
5. **驗長收斂**：`clampTo250(text)` → 保證 ≤ `MAX_INTRO_CHARS` code points（FR-006；SC-002）。
   `sparse` 時 prompt 已要求末標「（資訊有限）」（FR-009）。
6. **寫快取**：`state.intros[key] = { intro, introAt: now().toISOString() }` →
   回 `{ status: 'generated', intro, introAt }`（FR-004；就地寫 in-memory state，research D9）。
7. **失敗降級**：步驟 2–6 任一失敗（LlmError、空/無效回應）→ `logger.warn`（含 repoId/fullName，
   不含 prompt 全文）→ 回 `{ status: 'degraded', description: input.description }`；
   **不寫 state.intros**（FR-015/016）。單筆失敗**不擲錯**、不影響呼叫端續處理其餘 repo（FR-014）。

## 防幻覺契約（FR-007）

- prompt 僅提供 README/metadata 素材；`starsThisWeek`/`fullName` 等事實由程式帶入語境，
  **不要求 LLM 產生或推算**星數/名次/連結。
- 簡介忠於素材；程式面不注入亦不校驗外部事實（事實防護靠「不餵可杜撰的權威數字給 LLM」的架構）。

## 依賴

- `LlmService`（同 App context 注入；F6 共用）。
- `GithubHttpService`（既有；README 取得沿用其退避/UA/認證，FR-010）。
- `BoardState` 型別與 `state.intros`（F1 既有 schema，不改）。

## 測試契約（憲章 VIII；對照 SC）

| 測試 | 斷言 | SC |
|------|------|----|
| 快取命中 | 預置 `state.intros[key]` → `cached`；**LLM.generate 與 fetchReadme 呼叫次數 = 0** | SC-001 |
| 掉出後重進榜 | 有快取者再次請求 → `cached`、0 次重生成 | SC-006 |
| 生成路徑 | 快取未命中 + README 可取 → `generated`、`intro` ≤250 繁中、`state.intros[key]` 已寫入 | SC-002 |
| 超長收斂 | LLM 回 >250 → 輸出/快取皆 ≤250 | SC-002 |
| 無/極短 README 退回 | README 取不到／< 200 → `buildMaterial` 用 fallback、仍 ≤250 | US3；SC-002 |
| 降級 | LlmService 持續失敗 → `degraded`＋description、**未寫快取**、其餘 repo 不受影響 | SC-004 |
| 空快取不命中 | `state.intros[key].intro === ''` → 視為未命中、重新生成 | Edge Case |

外部 LLM 與 README 取得以 mock 注入，全程不依賴真實網路／時間。
