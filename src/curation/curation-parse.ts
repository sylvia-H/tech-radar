import { NewsDomain3 } from '../news/news.types';
import { CurationLlmPick, CurationLlmResponse, MalformedPick } from './curation.types';

/**
 * `parseCurationResponse` 遇**結構性**錯誤（非合法 JSON、非物件、缺必要鍵、某鍵非陣列）時擲出，供
 * `NewsCurationService.curate()` 改用備援型號重試或降級（FR-011、research D2；2026-10-17 起單則形狀不符
 * 不再擲錯，見 `parseCurationResponse`）。`reason` 供 log 分流，不含 prompt/回應全文（憲章 VII）。
 */
export class CurationParseError extends Error {
  readonly name = 'CurationParseError';

  constructor(public readonly reason: string) {
    super(`策展回應解析失敗：${reason}`);
  }
}

/**
 * 剝除 ```json … ``` 或 ``` … ``` 柵欄，取柵欄內文；無柵欄則原樣返回（research D2，
 * 只取出不刪除，故不沿用 F5 `stripMarkdownNoise` 的「刪除」語意，另寫此工具）。
 */
export function stripJsonFence(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return fenced ? fenced[1] : raw;
}

type PickArrayKey = MalformedPick['key'];

const KNOWN_KEYS: ReadonlySet<string> = new Set(['officialPicks', 'communityPicks', 'backfillPicks']);
const DOMAIN3_VALUES: ReadonlySet<string> = new Set(['ai', 'devops', 'frontend-backend']);
/** 每則必要鍵，順序即形狀描述中的列出順序。 */
const REQUIRED_PICK_KEYS = ['ref', 'title', 'content'] as const;
/** 形狀描述中額外鍵名的截斷長度與個數上限：鍵名由 LLM 產生，防病態長鍵把回應內容帶進 log（憲章 VII）。 */
const EXTRA_KEY_MAX_CHARS = 20;
const EXTRA_KEYS_MAX = 5;

function isNewsDomain3(value: unknown): value is NewsDomain3 {
  return typeof value === 'string' && DOMAIN3_VALUES.has(value);
}

/**
 * 三步解析：去 code fence → `JSON.parse` → 形狀淺驗證（`officialPicks`／`communityPicks` 皆為
 * 陣列、每項 `ref:number`/`title,content:string`）。越界 `ref`／超長字數／配額／重複 `ref` 不在此層
 * 判定，交由硬驗證管線收斂（curation-validate.ts）。
 *
 * 錯誤分兩級（2026-10-17，ADR 0006）：
 * - **結構性錯誤**（非合法 JSON、非物件、缺 `officialPicks`／`communityPicks`、某鍵非陣列）擲
 *   `CurationParseError`。非合法 JSON 的 `reason` 只附回應字元數，**不附 `JSON.parse` 的錯誤訊息**——V8 的
 *   訊息會夾帶回應片段（如 `Unexpected token … in "…"`），違反憲章 VII。
 * - **單則形狀不符**（非物件、`ref` 非 number、`title`／`content` 非 string）**不擲錯**：該則略過、記入
 *   `malformed`（只含鍵名與型別），其餘照常解析。研究決策 D2 原為「任一步失敗即擲錯、不做局部搶救」，
 *   2026-10-17 由使用者裁決改為逐則略過（ADR 0006）：2026-10-08 一則壞項就讓整份晨報退回原文標題，
 *   可用的繁中改寫全數丟棄，損失大於少推一則。是否改用備援型號重試、或丟棄壞項採用其餘，由
 *   `NewsCurationService.curate()` 決定。
 *
 * 兩個必要鍵以外的其他頂層鍵（如 LLM 自創的 `externalPicks`）**不擲錯、不解析內容**，只把鍵名
 * 收進 `ignoredKeys` 交呼叫端告警（2026-09-12 新增）——兩個必要鍵仍合法時整份降級反而會全部退回
 * 原文標題，寧可少幾則。
 */
export function parseCurationResponse(raw: string): CurationLlmResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(raw));
  } catch {
    throw new CurationParseError(`非合法 JSON（回應 ${raw.length} 字元）`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CurationParseError('非合法物件');
  }

  const malformed: MalformedPick[] = [];
  const officialPicks = parsePickArray(parsed, 'officialPicks', malformed);
  const communityPicks = parsePickArray(parsed, 'communityPicks', malformed);
  // `backfillPicks`（2026-09-26）：選填——缺席視為空陣列，不因一個補位用的鍵整份降級；存在時形狀同前兩者。
  const backfillPicks = 'backfillPicks' in parsed ? parsePickArray(parsed, 'backfillPicks', malformed) : [];
  const ignoredKeys = Object.keys(parsed).filter((key) => !KNOWN_KEYS.has(key));

  return { officialPicks, communityPicks, backfillPicks, ignoredKeys, malformed };
}

/**
 * 把 `malformed` 組成 log 用的診斷字串（2026-10-17 新增，ADR 0006），例
 * `officialPicks[3]{ref:string,title:string,content:缺}, communityPicks[0](string)`。只含陣列鍵、索引、
 * 鍵名與型別，不含任何標題或內容（憲章 VII）。
 */
export function describeMalformed(malformed: readonly MalformedPick[]): string {
  return malformed.map((m) => `${m.key}[${m.index}]${m.shape}`).join(', ');
}

/**
 * 把 `ignoredKeys` 組成 log 用的簡述：每鍵附「若為陣列則長度、否則型別」，例
 * `externalPicks(陣列 2 則), note(string)`。只重新解析已由 `parseCurationResponse` 驗證通過的 `raw`
 * 取長度，不回傳回應內容本身（憲章 VII：log 不含回應全文）。`raw` 若意外不可解析回純鍵名清單。
 */
export function describeIgnoredKeys(raw: string, ignoredKeys: readonly string[]): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(raw));
  } catch {
    return ignoredKeys.join(', ');
  }
  const record: Record<string, unknown> =
    typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  return ignoredKeys
    .map((key) => {
      const value = record[key];
      return Array.isArray(value) ? `${key}(陣列 ${value.length} 則)` : `${key}(${typeof value})`;
    })
    .join(', ');
}

function parsePickArray(parsed: object, key: PickArrayKey, malformed: MalformedPick[]): CurationLlmPick[] {
  if (!(key in parsed)) {
    throw new CurationParseError(`缺少 ${key} 欄位`);
  }
  const picks = (parsed as Record<string, unknown>)[key];
  if (!Array.isArray(picks)) {
    throw new CurationParseError(`${key} 非陣列`);
  }
  const result: CurationLlmPick[] = [];
  picks.forEach((pick: unknown, index) => {
    if (!isWellFormedPick(pick)) {
      malformed.push({ key, index, shape: describeShape(pick) });
      return;
    }
    // `domain`（2026-09-25 新增，僅「未歸類」候選需要）：合法值才保留，缺席或非法值一律不帶、不擲錯
    // ——其餘欄位已合規時不該為一個選填欄位丟掉該則；是否為未歸類候選由硬驗證層判斷。
    result.push(
      isNewsDomain3(pick.domain)
        ? { ref: pick.ref, title: pick.title, content: pick.content, domain: pick.domain }
        : { ref: pick.ref, title: pick.title, content: pick.content },
    );
  });
  return result;
}

interface WellFormedPick {
  ref: number;
  title: string;
  content: string;
  domain?: unknown;
}

function isWellFormedPick(pick: unknown): pick is WellFormedPick {
  if (typeof pick !== 'object' || pick === null || Array.isArray(pick)) {
    return false;
  }
  const p = pick as Record<string, unknown>;
  return typeof p.ref === 'number' && typeof p.title === 'string' && typeof p.content === 'string';
}

/** `typeof` 的細分版：`null` 與陣列分開標示（`typeof` 皆為 `object`，診斷時無從分辨）。 */
function typeLabel(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** 單則形狀描述（見 `MalformedPick.shape`）：只含鍵名與型別，不含值（憲章 VII）。 */
function describeShape(pick: unknown): string {
  if (typeof pick !== 'object' || pick === null || Array.isArray(pick)) {
    return `(${typeLabel(pick)})`;
  }
  const record = pick as Record<string, unknown>;
  const required = REQUIRED_PICK_KEYS.map((k) => `${k}:${k in record ? typeLabel(record[k]) : '缺'}`);
  const extraKeys = Object.keys(record).filter((k) => !(REQUIRED_PICK_KEYS as readonly string[]).includes(k));
  const extras = extraKeys.slice(0, EXTRA_KEYS_MAX).map((k) => `${clampKey(k)}:${typeLabel(record[k])}`);
  if (extraKeys.length > EXTRA_KEYS_MAX) {
    extras.push(`…另 ${extraKeys.length - EXTRA_KEYS_MAX} 鍵`);
  }
  return `{${[...required, ...extras].join(',')}}`;
}

function clampKey(key: string): string {
  const cps = Array.from(key);
  return cps.length <= EXTRA_KEY_MAX_CHARS ? key : `${cps.slice(0, EXTRA_KEY_MAX_CHARS).join('')}…`;
}
