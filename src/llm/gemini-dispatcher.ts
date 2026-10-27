import { Agent, Client, Dispatcher, Pool, setGlobalDispatcher } from 'undici';
import { NEWS_LLM_TIMEOUT_MS } from './llm.types';

/** Gemini API 的 origin（`@google/genai` 的預設 baseUrl）。 */
export const GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com';

/**
 * Gemini 連線層的 headers／body 逾時上限（2026-10-27 新增，決策紀錄：ADR 0009）。Node 內建 `fetch`（undici）預設兩者皆
 * 300 秒，策展開 `thinking=high` 時 Gemini 生成完整份回應才送標頭，會被這層先砍斷（UND_ERR_HEADERS_TIMEOUT）。
 * 這裡只是上限、須不小於各呼叫的逾時；實際逾時由 `LlmService` 逐呼叫以 `abortSignal` 收緊（簡介／TL;DR 仍 300 秒）。
 */
export const GEMINI_HTTP_TIMEOUT_MS = NEWS_LLM_TIMEOUT_MS;

/**
 * 依 origin 決定連線池選項：只有 Gemini 拉高 headers／body 逾時上限，其餘 origin（新聞來源、GitHub、Discord）原樣
 * 沿用 undici 預設——卡住的 RSS 來源不該跟著多等。
 */
export function poolOptionsFor(origin: string | URL, opts: Pool.Options): Pool.Options {
  if (new URL(String(origin)).origin !== GEMINI_ORIGIN) {
    return opts;
  }
  return { ...opts, headersTimeout: GEMINI_HTTP_TIMEOUT_MS, bodyTimeout: GEMINI_HTTP_TIMEOUT_MS };
}

/** `Agent` 的連線池 factory：建法同 undici 預設（`connections === 1` 用 `Client`，其餘 `Pool`），只換選項。 */
export function dispatcherFactory(origin: string | URL, opts: object): Dispatcher {
  const options = poolOptionsFor(origin, opts as Pool.Options);
  return options.connections === 1 ? new Client(origin, options) : new Pool(origin, options);
}

export function createDispatcher(): Agent {
  return new Agent({ factory: dispatcherFactory });
}

/**
 * 是否啟用了 Node 的環境代理（`NODE_USE_ENV_PROXY` 或 `--use-env-proxy`）。啟用時 Node 預設的全域 dispatcher 會依
 * `HTTP(S)_PROXY` 走代理，換成一般 `Agent` 會讓所有 `fetch` 改直連而失敗，故不換。
 */
export function usesEnvProxy(
  env: NodeJS.ProcessEnv = process.env,
  execArgv: readonly string[] = process.execArgv,
): boolean {
  const flag = env.NODE_USE_ENV_PROXY?.trim();
  if (flag !== undefined && flag !== '' && flag !== '0') {
    return true;
  }
  return execArgv.includes('--use-env-proxy') || (env.NODE_OPTIONS ?? '').includes('--use-env-proxy');
}

let installed = false;

/**
 * 換掉 Node 內建 `fetch` 的全域 dispatcher（`@google/genai` 走全域 `fetch`、不接受自訂 dispatcher），由 `LlmService`
 * 建構時呼叫，重複呼叫只裝一次。回傳 Gemini 逾時上限是否生效；偵測到環境代理時不換、回 `false`（逾時維持 300 秒）。
 *
 * 不靠 SDK 的 `httpOptions.timeout`：它會試著調大全域 dispatcher 上描述含「headers timeout」的 symbol，但 Node 24 的
 * 全域 dispatcher 是 `Agent`（Node 26 為 `Dispatcher1Wrapper`），身上都沒有這類 symbol（2026-10-27 兩版本實測），調整不會生效。
 */
export function installGeminiDispatcher(): boolean {
  if (installed) {
    return true;
  }
  if (usesEnvProxy()) {
    return false;
  }
  setGlobalDispatcher(createDispatcher());
  installed = true;
  return true;
}
