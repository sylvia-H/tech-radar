/**
 * 每則精選物件的 JSON Schema（2026-10-17 新增，ADR 0006）。三個陣列共用同一形狀；`domain` 只有「未歸類」
 * 候選需要（prompt 要求選入時回填），故不列入 `required`——結構化輸出若強制每則都帶，LLM 會替一般候選
 * 亂填領域，而硬驗證層對非未歸類候選本就忽略此欄。
 */
const PICK_ITEM_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    ref: { type: 'integer', description: '候選清單中的 [ref] 索引' },
    title: { type: 'string', description: '繁體中文標題，≤70 字' },
    content: { type: 'string', description: '繁體中文內容，≤500 字' },
    domain: {
      type: 'string',
      enum: ['ai', 'devops', 'frontend-backend'],
      description: '僅「未歸類」候選必填，其餘候選不需要',
    },
  },
  required: ['ref', 'title', 'content'],
};

/**
 * 每日晨報策展回應的 JSON Schema（2026-10-17 新增，ADR 0006），由 `NewsCurationService` 經
 * `LlmGenerateOptions.responseJsonSchema` 交給 Gemini 結構化輸出，主、備援型號皆帶。
 *
 * 動機：2026-10-08 gemini-3.8-flash 回應 finishReason=STOP 卻有一則形狀不符，當時形狀只靠 prompt 約束，
 * 整份晨報因此降級為原文標題。改由 API 端以 schema 約束回應形狀；`parseCurationResponse` 的形狀驗證仍保留
 * （型號以 400 拒絕 schema 時 `LlmService` 會改送不帶 schema 的純請求，回應形狀又回到只靠 prompt）。
 *
 * **必須與 `curation-prompt.ts` 的「輸出規則」同步**：三個頂層鍵 `officialPicks`／`communityPicks`／
 * `backfillPicks` 皆必須存在（prompt：「三個鍵都必須存在」），每則必帶 `ref`／`title`／`content`、未歸類
 * 候選另帶 `domain`（三桶之一）。改 prompt 輸出規則時一併改此檔，`curation-schema.spec.ts` 會核對兩者一致。
 * 注意解析器對 `backfillPicks` 較寬鬆（缺席視為空陣列），schema 照 prompt 要求列為必填。
 *
 * 保守起見只用 `type`／`properties`／`required`／`items`／`enum`／`description`（各型號都支援的子集），
 * 不用 `additionalProperties`：未知頂層鍵已由解析器的 `ignoredKeys` 揭露、不降級。純 JSON Schema 物件，
 * 不依賴 `@google/genai` 型別。
 */
export const CURATION_RESPONSE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    officialPicks: {
      type: 'array',
      description: '(1)【官方發布】與 (3)【影響開發者的外部事件】，依重要性由高到低',
      items: PICK_ITEM_SCHEMA,
    },
    communityPicks: {
      type: 'array',
      description: '(2)【技術深度內容】，依重要性由高到低',
      items: PICK_ITEM_SCHEMA,
    },
    backfillPicks: {
      type: 'array',
      description: '「未歸類」候選中的資安與一般軟體工程補位項，依重要性由高到低',
      items: PICK_ITEM_SCHEMA,
    },
  },
  required: ['officialPicks', 'communityPicks', 'backfillPicks'],
};
