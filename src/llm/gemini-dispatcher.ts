import { Agent, Client, Dispatcher, Pool, setGlobalDispatcher } from 'undici';

/** Gemini API 的 origin（`@google/genai` 的預設 baseUrl）。 */
export const GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com';

/**
 * Gemini 請求的 headers／body 逾時（2026-10-27 新增）。Node 內建 `fetch`（undici）預設兩者皆 300 秒，而晨報策展
 * 開 `thinking=high` 時 Gemini 要等整份回應生成完才送出標頭：2026-10-22～10-26 成功呼叫 133～287 秒，10-27 乾跑
 * 兩次在送出後正好 300 秒以 `fetch failed` 失敗（UND_ERR_HEADERS_TIMEOUT），白等 5 分鐘再退避重試、最終退到備援型號。
 * 取 10 分鐘，約為實測最長耗時的兩倍。
 */
export const GEMINI_HTTP_TIMEOUT_MS = 10 * 60_000;

/**
 * 依 origin 決定連線池選項：只有 Gemini 拉長 headers／body 逾時，其餘 origin（新聞來源、GitHub、Discord）原樣
 * 沿用 undici 預設——卡住的 RSS 來源不該跟著多等 10 分鐘。
 */
export function poolOptionsFor(origin: string | URL, opts: Pool.Options): Pool.Options {
  if (new URL(String(origin)).origin !== GEMINI_ORIGIN) {
    return opts;
  }
  return { ...opts, headersTimeout: GEMINI_HTTP_TIMEOUT_MS, bodyTimeout: GEMINI_HTTP_TIMEOUT_MS };
}

/** 建立全域 dispatcher：連線池建法同 undici `Agent` 預設（`connections === 1` 用 `Client`，其餘 `Pool`）。 */
export function createDispatcher(): Agent {
  return new Agent({
    factory: (origin: string | URL, opts: object): Dispatcher => {
      const options = poolOptionsFor(origin, opts as Pool.Options);
      return options.connections === 1 ? new Client(origin, options) : new Pool(origin, options);
    },
  });
}

/**
 * 換掉 Node 內建 `fetch` 的全域 dispatcher（`@google/genai` 走全域 `fetch`、不接受自訂 dispatcher）。須在第一次
 * 呼叫 Gemini 前執行，由 CLI 進入點呼叫一次。
 *
 * 不靠 SDK 的 `httpOptions.timeout`：它會試著調大全域 dispatcher 上描述含「headers timeout」的 symbol，但 Node 24 的
 * 全域 dispatcher 是 `Dispatcher1Wrapper`，身上沒有這類 symbol（2026-10-27 本機實測），調整不會生效。
 */
export function installGeminiDispatcher(): void {
  setGlobalDispatcher(createDispatcher());
}
