import { CurationLlmResponse } from './curation.types';

/**
 * `parseCurationResponse` 解析失敗時擲出，供 `NewsCurationService.curate()` catch 後降級
 * （FR-011、research D2）。`reason` 供 log 分流，不含 prompt/回應全文（憲章 VII）。
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

const KNOWN_KEYS: ReadonlySet<string> = new Set(['officialPicks', 'communityPicks']);

/**
 * 三步解析：去 code fence → `JSON.parse` → 形狀淺驗證（`officialPicks`／`communityPicks` 皆為
 * 陣列、每項 `ref:number`/`title,content:string`）。任一步失敗擲 `CurationParseError`，不做局部
 * 搶救（research D2）。越界 `ref`／超長字數／配額／重複 `ref` 不在此層判定，交由硬驗證管線收斂
 * （curation-validate.ts）。
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
    throw new CurationParseError('非合法 JSON');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new CurationParseError('非合法物件');
  }

  const officialPicks = parsePickArray(parsed, 'officialPicks');
  const communityPicks = parsePickArray(parsed, 'communityPicks');
  const ignoredKeys = Object.keys(parsed).filter((key) => !KNOWN_KEYS.has(key));

  return { officialPicks, communityPicks, ignoredKeys };
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

function parsePickArray(parsed: object, key: 'officialPicks' | 'communityPicks'): CurationLlmResponse['officialPicks'] {
  if (!(key in parsed)) {
    throw new CurationParseError(`缺少 ${key} 欄位`);
  }
  const picks = (parsed as Record<string, unknown>)[key];
  if (!Array.isArray(picks)) {
    throw new CurationParseError(`${key} 非陣列`);
  }
  for (const pick of picks) {
    if (
      typeof pick !== 'object' ||
      pick === null ||
      typeof (pick as { ref: unknown }).ref !== 'number' ||
      typeof (pick as { title: unknown }).title !== 'string' ||
      typeof (pick as { content: unknown }).content !== 'string'
    ) {
      throw new CurationParseError(`${key} 項目形狀不符`);
    }
  }
  return picks as CurationLlmResponse['officialPicks'];
}
