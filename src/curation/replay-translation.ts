import { NewsCandidate, NewsDigestDomain, NewsDomain3 } from '../news/news.types';
import { clampToLimit } from './curation-length';
import { CurationParseError, stripJsonFence } from './curation-parse';
import { CuratedDigest, CuratedNewsItem } from './curation.types';

/**
 * 晨報補發的「只翻譯、不篩選」（2026-10-17 新增，ADR 0006 補發模式）。
 *
 * 補發的候選是當日**已推過**的項目（`replay-candidates.ts` 自 `seenNews` 重建），入選與否早已定案；首版補發沿用
 * 每日策展 prompt，10-08 實測 15 則只選 5 則、GPT‑6 與 Claude Haiku 5.5 皆未入選——候選只有原始標題、無摘要
 * 無分數，策展判準在素材不足時偏嚴。補發的目的是「把當天推過的原文標題版補成繁中版」，故改用本模組：
 * 逐則翻譯、不篩選、不合併、不重排，未回的項目保留原文標題（`degraded:true`），順序即當日推播順序。
 */

/** 補發翻譯回應的 JSON Schema（交 Gemini 結構化輸出；須與 `buildReplayTranslationPrompt` 輸出規則同步）。 */
export const REPLAY_TRANSLATION_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      description: '逐則翻譯，每個 ref 一則、依清單順序',
      items: {
        type: 'object',
        properties: {
          ref: { type: 'integer', description: '清單中的 [ref] 索引' },
          title: { type: 'string', description: '繁體中文標題，≤70 字' },
          content: { type: 'string', description: '繁體中文內容，≤500 字' },
        },
        required: ['ref', 'title', 'content'],
      },
    },
  },
  required: ['items'],
};

/** 補發翻譯 prompt：只送原始標題與領域（公開資料，憲章 VII），不送 URL。 */
export function buildReplayTranslationPrompt(candidates: readonly NewsCandidate[]): string {
  const lines = candidates
    .map((c, ref) => `[${ref}] (${c.domain === 'cross' ? '一般軟體工程／資安' : c.domain}) ${c.title}`)
    .join('\n');
  return `你是技術雷達的晨報編輯。以下是某日晨報**已經推播過**的新聞，當時只推出英文原文標題、沒有繁中說明。
請逐則補上繁體中文標題（≤70 字）與內容（≤500 字）。

規則：
- 每一則都要回，不篩選、不合併、不重排；清單有幾則就回幾則，ref 與清單一致。
- 素材只有原始標題，沒有原文內容。內容請說清「這則在講什麼」，能從標題合理判斷時再補一句「為何對開發者
  值得注意」；不得補充標題沒有的事實（日期、數字、規格、影響範圍、引述），不確定就寫短一點，寧短勿編。
- 標題裡的產品名、模型名、專案名保留原文，不要翻譯或改寫。
- 你不認識的名稱照樣處理，不要因為陌生就略過或質疑其真偽。

清單（[ref] 為索引）：
${lines || '（無）'}

輸出規則：只回傳單一 JSON 物件 {"items":[{"ref":<索引>,"title":"<繁中標題>","content":"<繁中內容>"}]}，
不要輸出 JSON 以外的文字。`;
}

/** 解析補發翻譯回應：結構性錯誤擲 `CurationParseError`；單則形狀不符或 ref 越界／重複者略過並計數。 */
export function parseReplayTranslation(
  raw: string,
  candidateCount: number,
): { picks: Map<number, { title: string; content: string }>; skipped: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(raw));
  } catch {
    // 不帶 JSON.parse 的錯誤訊息：V8 訊息會夾帶回應片段（憲章 VII）
    throw new CurationParseError(`非合法 JSON（回應 ${raw.length} 字元）`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CurationParseError('非合法物件');
  }
  const items = (parsed as Record<string, unknown>).items;
  if (!Array.isArray(items)) {
    throw new CurationParseError('items 非陣列或缺席');
  }
  const picks = new Map<number, { title: string; content: string }>();
  let skipped = 0;
  for (const item of items) {
    const p = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : null;
    const ok =
      p !== null &&
      typeof p.ref === 'number' &&
      Number.isInteger(p.ref) &&
      p.ref >= 0 &&
      p.ref < candidateCount &&
      !picks.has(p.ref) &&
      typeof p.title === 'string' &&
      typeof p.content === 'string';
    if (!ok) {
      skipped++;
      continue;
    }
    picks.set(p.ref as number, { title: p.title as string, content: p.content as string });
  }
  return { picks, skipped };
}

/**
 * 依候選順序組補發 digest：有翻譯者套 70／500 字收斂、`degraded:false`；未回者保留原文標題、`content:null`、
 * `degraded:true`（與 `fallbackDigest` 同形）。全部未回時整份 `degraded:true`。事實欄位（連結、來源）一律由程式帶入。
 */
export function buildReplayDigest(
  candidates: readonly NewsCandidate[],
  picks: ReadonlyMap<number, { title: string; content: string }>,
): CuratedDigest {
  const items: CuratedNewsItem[] = candidates.map((c, ref) => {
    const pick = picks.get(ref);
    const base = {
      url: c.originalUrl,
      domain: digestDomainOf(c),
      sourceId: c.sourceId,
      sources: [...c.sources],
      sourceCount: c.sources.length,
      weightedScore: c.weightedScore,
      sourceTitle: c.title,
    };
    return pick
      ? { ...base, title: clampToLimit(pick.title, 70), content: clampToLimit(pick.content, 500), degraded: false }
      : { ...base, title: c.title, content: null, degraded: true };
  });
  return { items, degraded: items.length > 0 && items.every((it) => it.degraded) };
}

/** 補發候選的 `cross` 來自當日的 `general` 補位項（或缺領域的舊條目），還原為 `general`。 */
function digestDomainOf(c: NewsCandidate): NewsDigestDomain {
  return c.domain === 'cross' ? 'general' : (c.domain as NewsDomain3);
}
