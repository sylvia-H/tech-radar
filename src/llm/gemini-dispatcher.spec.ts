import { Agent, Client, Pool } from 'undici';
import {
  GEMINI_HTTP_TIMEOUT_MS,
  GEMINI_ORIGIN,
  createDispatcher,
  dispatcherFactory,
  geminiBaseUrlOverridden,
  poolOptionsFor,
  usesEnvProxy,
} from './gemini-dispatcher';
import { LLM_TIMEOUT_MS, NEWS_LLM_TIMEOUT_MS } from './llm.types';

jest.mock('undici', () => {
  const actual = jest.requireActual('undici');
  return {
    ...actual,
    Pool: jest.fn((origin: string, opts: object) => new actual.Pool(origin, opts)),
    Client: jest.fn((origin: string, opts: object) => new actual.Client(origin, opts)),
    setGlobalDispatcher: jest.fn(),
  };
});

const MockedPool = Pool as unknown as jest.Mock;
const MockedClient = Client as unknown as jest.Mock;

afterEach(() => {
  MockedPool.mockClear();
  MockedClient.mockClear();
});

describe('gemini-dispatcher（Gemini 連線層逾時上限，2026-10-27，ADR 0009）', () => {
  it('上限等於策展逾時、不小於任何單次呼叫逾時（否則連線層會先砍斷）', () => {
    expect(GEMINI_HTTP_TIMEOUT_MS).toBe(NEWS_LLM_TIMEOUT_MS);
    expect(GEMINI_HTTP_TIMEOUT_MS).toBeGreaterThanOrEqual(LLM_TIMEOUT_MS);
  });

  it('Gemini origin（字串或 URL、帶不帶尾斜線）→ headers／body 逾時拉高，其餘選項保留且不改原物件', () => {
    const opts: Pool.Options = { connections: 10, keepAliveTimeout: 4_000 };
    const expected = {
      connections: 10,
      keepAliveTimeout: 4_000,
      headersTimeout: GEMINI_HTTP_TIMEOUT_MS,
      bodyTimeout: GEMINI_HTTP_TIMEOUT_MS,
    };
    expect(poolOptionsFor(GEMINI_ORIGIN, opts)).toEqual(expected);
    expect(poolOptionsFor(`${GEMINI_ORIGIN}/`, opts)).toEqual(expected);
    expect(poolOptionsFor(new URL(GEMINI_ORIGIN), opts)).toEqual(expected);
    expect(opts).toEqual({ connections: 10, keepAliveTimeout: 4_000 });
  });

  it('其他 origin（新聞來源、GitHub、Discord、http 版 Gemini）原樣沿用 undici 預設', () => {
    const opts: Pool.Options = { connections: 10 };
    for (const origin of ['https://api.github.com', 'https://discord.com', 'https://hnrss.org', 'http://generativelanguage.googleapis.com']) {
      expect(poolOptionsFor(origin, opts)).toBe(opts);
    }
  });

  it('dispatcherFactory：Gemini 以拉高後的選項建 Pool；connections=1 改建 Client；其他 origin 選項原樣', async () => {
    const created = [
      dispatcherFactory(GEMINI_ORIGIN, {}),
      dispatcherFactory(GEMINI_ORIGIN, { connections: 1 }),
      dispatcherFactory('https://api.github.com', { connections: 5 }),
    ];
    expect(MockedPool).toHaveBeenNthCalledWith(1, GEMINI_ORIGIN, {
      headersTimeout: GEMINI_HTTP_TIMEOUT_MS,
      bodyTimeout: GEMINI_HTTP_TIMEOUT_MS,
    });
    expect(MockedClient).toHaveBeenCalledWith(GEMINI_ORIGIN, {
      connections: 1,
      headersTimeout: GEMINI_HTTP_TIMEOUT_MS,
      bodyTimeout: GEMINI_HTTP_TIMEOUT_MS,
    });
    expect(MockedPool).toHaveBeenNthCalledWith(2, 'https://api.github.com', { connections: 5 });
    await Promise.all(created.map((d) => d.close()));
  });

  it('createDispatcher 回傳 undici Agent', async () => {
    const dispatcher = createDispatcher();
    expect(dispatcher).toBeInstanceOf(Agent);
    await dispatcher.close();
  });

  it('usesEnvProxy：比照 Node 只認 NODE_USE_ENV_PROXY=1，或 --use-env-proxy（execArgv／NODE_OPTIONS）', () => {
    expect(usesEnvProxy({}, [])).toBe(false);
    expect(usesEnvProxy({ NODE_USE_ENV_PROXY: '' }, [])).toBe(false);
    expect(usesEnvProxy({ NODE_USE_ENV_PROXY: '0' }, [])).toBe(false);
    expect(usesEnvProxy({ NODE_USE_ENV_PROXY: 'true' }, [])).toBe(false);
    expect(usesEnvProxy({ NODE_USE_ENV_PROXY: 'yes' }, [])).toBe(false);
    expect(usesEnvProxy({ HTTPS_PROXY: 'http://proxy:8080' }, [])).toBe(false);
    expect(usesEnvProxy({ NODE_USE_ENV_PROXY: '1' }, [])).toBe(true);
    expect(usesEnvProxy({ NODE_USE_ENV_PROXY: ' 1 ' }, [])).toBe(true);
    expect(usesEnvProxy({}, ['--use-env-proxy'])).toBe(true);
    expect(usesEnvProxy({ NODE_OPTIONS: '--max-old-space-size=4096 --use-env-proxy' }, [])).toBe(true);
  });
});

describe('geminiBaseUrlOverridden（2026-10-27）', () => {
  it('未設或指向 Gemini origin → false', () => {
    expect(geminiBaseUrlOverridden({})).toBe(false);
    expect(geminiBaseUrlOverridden({ GOOGLE_GEMINI_BASE_URL: '' })).toBe(false);
    expect(geminiBaseUrlOverridden({ GOOGLE_GEMINI_BASE_URL: `${GEMINI_ORIGIN}/` })).toBe(false);
    expect(geminiBaseUrlOverridden({ GOOGLE_GENAI_USE_VERTEXAI: 'false' })).toBe(false);
  });

  it('baseUrl 指向別的 origin、不可解析，或改走 Vertex／Enterprise → true', () => {
    expect(geminiBaseUrlOverridden({ GOOGLE_GEMINI_BASE_URL: 'https://proxy.example.com/gemini' })).toBe(true);
    expect(geminiBaseUrlOverridden({ GOOGLE_VERTEX_BASE_URL: 'https://us-central1-aiplatform.googleapis.com' })).toBe(true);
    expect(geminiBaseUrlOverridden({ GOOGLE_GEMINI_BASE_URL: 'not a url' })).toBe(true);
    expect(geminiBaseUrlOverridden({ GOOGLE_GENAI_USE_VERTEXAI: 'true' })).toBe(true);
    expect(geminiBaseUrlOverridden({ GOOGLE_GENAI_USE_ENTERPRISE: '1' })).toBe(true);
  });
});

describe('installGeminiDispatcher（2026-10-27）', () => {
  /** 每個案例取一份全新模組（模組內 `installed` 旗標歸零）。env／execArgv 一律注入，不受執行環境影響。 */
  function freshModule(): { install: (env: NodeJS.ProcessEnv, execArgv: string[]) => boolean; setGlobal: jest.Mock } {
    let mod!: typeof import('./gemini-dispatcher');
    let undici!: { setGlobalDispatcher: jest.Mock };
    jest.isolateModules(() => {
      mod = jest.requireActual('./gemini-dispatcher');
      undici = jest.requireMock('undici');
    });
    undici.setGlobalDispatcher.mockClear();
    return { install: mod.installGeminiDispatcher, setGlobal: undici.setGlobalDispatcher };
  }

  it('未設代理 → 換上 Agent、回 true；重複呼叫只裝一次', () => {
    const { install, setGlobal } = freshModule();
    expect(install({}, [])).toBe(true);
    expect(install({}, [])).toBe(true);
    expect(setGlobal).toHaveBeenCalledTimes(1);
    expect(setGlobal.mock.calls[0][0]).toBeInstanceOf(jest.requireActual('undici').Agent);
  });

  it('NODE_USE_ENV_PROXY=1 或 --use-env-proxy → 不換 dispatcher、回 false', () => {
    const { install, setGlobal } = freshModule();
    expect(install({ NODE_USE_ENV_PROXY: '1' }, [])).toBe(false);
    expect(install({}, ['--use-env-proxy'])).toBe(false);
    expect(setGlobal).not.toHaveBeenCalled();
  });
});
