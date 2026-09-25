import { NewsCandidate } from './news.types';
import { NEWS_DOMAIN_KEYWORDS } from './news-domain-keywords';
import { normalizeTitle } from './title-similarity';

/**
 * 「同題群集」訊號（零 LLM，2026-09-25 新增）：同一個**罕見詞**當日在多則不同候選、多個不同來源的
 * 標題裡同時出現，通常代表一個正在崛起的新模型、新工具或新事件——名字陌生到不在任何關鍵字表裡，
 * 卻已被多個社群同時討論。這是給策展 LLM 的正面提示（比單一高分更強），用來補「未歸類高熱度」通道
 * 之後的第二層：LLM 對陌生名字沒有先驗知識，單看一則標題無從判斷輕重（實例：2026-09-22～25 候選池
 * 每天有 2～5 則 Jev 相關候選，來自 HN、simonwillison、reddit、lobsters、thenewstack，LLM 一則都沒選）。
 *
 * 判定：以 `normalizeTitle`（小寫、去標點、去 stop words）斷詞，剔除**不具辨識力的 token**（見
 * `CLUSTER_STOP_TOKENS`：泛用英文詞、三桶關鍵字、業界人人皆知的產品／公司名——群集的意義是「陌生
 * 名詞被多方同時討論」，`copilot`／`kubernetes` 天天多則出現不是訊號），再統計每個 token 出現在幾則
 * 候選（`count`）、幾個不同來源（`sourceCount`，取候選 `sources` 聯集）。同時達到 `CLUSTER_MIN_ITEMS`
 * 與 `CLUSTER_MIN_SOURCES` 才算群集；一則候選命中多個群集時取 `count` 最大者（同數取字母序最小）。
 * 純函式、不依賴外部狀態；停用清單是資料，增刪只改本檔常數。
 */
export interface TopicCluster {
  /** 群集鍵（小寫 token）。 */
  token: string;
  /** 當日候選池中標題含此 token 的候選則數。 */
  count: number;
  /** 上述候選涵蓋的不同來源數（`sources` 聯集）。 */
  sourceCount: number;
}

/** 同一 token 至少出現在幾則不同候選才算群集。 */
export const CLUSTER_MIN_ITEMS = 3;
/** 上述候選至少涵蓋幾個不同來源才算群集（單一來源多則可能只是該站當日主題週）。 */
export const CLUSTER_MIN_SOURCES = 2;
/** token 最短長度（過短者如 `ai`／`go` 辨識力不足）。 */
const MIN_TOKEN_LENGTH = 3;

/**
 * 不具辨識力的 token（資料，可調）：泛用英文詞（`normalizeTitle` 的 stop words 之外）、業界人人皆知的
 * 產品／公司／語言名。三桶關鍵字（`NEWS_DOMAIN_KEYWORDS`）另於程式合併，不在此重複列。
 */
const CLUSTER_STOP_TOKENS: ReadonlySet<string> = new Set([
  // 泛用英文詞
  'show', 'ask', 'tell', 'using', 'use', 'used', 'via', 'into', 'about', 'after', 'before', 'over', 'under',
  'than', 'more', 'less', 'not', 'all', 'any', 'can', 'will', 'just', 'now', 'one', 'two', 'first', 'last',
  'best', 'fast', 'faster', 'free', 'open', 'source', 'code', 'app', 'apps', 'tool', 'tools', 'web', 'data',
  'system', 'systems', 'build', 'built', 'building', 'made', 'make', 'making', 'write', 'writing', 'wrote',
  'run', 'running', 'get', 'got', 'like', 'own', 'small', 'big', 'simple', 'introducing', 'announcing',
  'release', 'released', 'releases', 'version', 'update', 'updates', 'guide', 'part', 'year', 'years', 'day',
  'days', 'week', 'time', 'people', 'world', 'way', 'things', 'thing', 'still', 'should', 'would', 'could',
  'does', 'did', 'don', 'isn', 'doesn', 'here', 'there', 'them', 'they', 'their', 'his', 'her', 'him', 'she',
  'out', 'off', 'but', 'without', 'against', 'every', 'each', 'some', 'most', 'many', 'much', 'other',
  'another', 'same', 'different', 'better', 'good', 'bad', 'real', 'really', 'very', 'too', 'also', 'only',
  'even', 'back', 'down', 'again', 'never', 'always', 'been', 'being', 'going', 'went', 'see', 'look', 'know',
  'think', 'want', 'need', 'let', 'say', 'said', 'says', 'stop', 'start', 'started', 'help', 'end', 'next',
  'top', 'line', 'lines', 'inside', 'behind', 'between', 'through', 'per', 'million', 'billion', 'blog',
  'post', 'notes', 'story', 'case', 'series', 'developer', 'developers', 'engineering', 'engineer',
  'software', 'programming', 'language', 'languages', 'project', 'projects', 'feature', 'features',
  'support', 'performance', 'security', 'production', 'local', 'cloud', 'server', 'api', 'apis', 'sdk',
  'cli', 'model', 'models', 'benchmark', 'benchmarks', 'test', 'tests', 'testing', 'paper', 'research',
  'launch', 'launches', 'launched', 'available', 'generally', 'preview', 'beta', 'alpha', 'stable', 'native',
  'official', 'edition', 'review', 'vs', 'versus', 'why', 'while', 'where', 'who', 'which', 'because',
  // 人人皆知的產品／公司／語言名（群集要抓的是「陌生名詞」）
  'github', 'google', 'apple', 'microsoft', 'amazon', 'aws', 'azure', 'meta', 'facebook', 'nvidia',
  'intel', 'amd', 'linux', 'windows', 'macos', 'ios', 'android', 'chrome', 'firefox', 'safari', 'rust',
  'java', 'kotlin', 'swift', 'ruby', 'php', 'sql', 'postgres', 'postgresql', 'sqlite', 'redis', 'copilot',
  'cursor', 'cloudflare', 'workers', 'vercel', 'wasm', 'webassembly', 'git', 'vscode', 'mcp', 'cuda', 'gpu',
  'cpu', 'chatgpt', 'openai', 'anthropic', 'claude', 'gemini', 'grok', 'qwen', 'deepseek', 'llama',
  'mistral', 'ollama', 'huggingface', 'pytorch', 'tensorflow', 'jax', 'kubernetes', 'k8s', 'docker',
  'terraform', 'react', 'vue', 'svelte', 'angular', 'nextjs', 'node', 'nodejs', 'deno', 'bun', 'python',
  'typescript', 'javascript',
]);

const DOMAIN_KEYWORD_TOKENS: ReadonlySet<string> = new Set(
  Object.values(NEWS_DOMAIN_KEYWORDS).flat().flatMap((kw) => kw.toLowerCase().split(/[^a-z0-9]+/)),
);

function isClusterable(token: string): boolean {
  return (
    token.length >= MIN_TOKEN_LENGTH &&
    /^[a-z]/.test(token) &&
    !CLUSTER_STOP_TOKENS.has(token) &&
    !DOMAIN_KEYWORD_TOKENS.has(token)
  );
}

/**
 * 偵測當日候選池的同題群集，回傳 `normalizedUrl → 該候選所屬的最強群集`（無群集者不在 map 內）。
 */
export function detectTopicClusters(cands: readonly NewsCandidate[]): Map<string, TopicCluster> {
  const byToken = new Map<string, { urls: Set<string>; sources: Set<string> }>();
  const tokensByUrl = new Map<string, string[]>();
  for (const c of cands) {
    const tokens = [...new Set(normalizeTitle(c.title).filter(isClusterable))];
    tokensByUrl.set(c.normalizedUrl, tokens);
    for (const t of tokens) {
      let entry = byToken.get(t);
      if (entry === undefined) {
        entry = { urls: new Set(), sources: new Set() };
        byToken.set(t, entry);
      }
      entry.urls.add(c.normalizedUrl);
      for (const s of c.sources) {
        entry.sources.add(s);
      }
    }
  }

  const clusters = new Map<string, TopicCluster>();
  for (const [token, entry] of byToken) {
    if (entry.urls.size >= CLUSTER_MIN_ITEMS && entry.sources.size >= CLUSTER_MIN_SOURCES) {
      clusters.set(token, { token, count: entry.urls.size, sourceCount: entry.sources.size });
    }
  }

  const out = new Map<string, TopicCluster>();
  for (const [url, tokens] of tokensByUrl) {
    let best: TopicCluster | null = null;
    for (const t of tokens) {
      const cluster = clusters.get(t);
      if (cluster === undefined) {
        continue;
      }
      if (best === null || cluster.count > best.count || (cluster.count === best.count && cluster.token < best.token)) {
        best = cluster;
      }
    }
    if (best !== null) {
      out.set(url, best);
    }
  }
  return out;
}

/** 供 log 用：群集摘要（依 count 降冪、同數字母序）。 */
export function summarizeClusters(clusterByUrl: ReadonlyMap<string, TopicCluster>): TopicCluster[] {
  const unique = new Map<string, TopicCluster>();
  for (const c of clusterByUrl.values()) {
    unique.set(c.token, c);
  }
  return [...unique.values()].sort((a, b) => b.count - a.count || (a.token < b.token ? -1 : a.token > b.token ? 1 : 0));
}
