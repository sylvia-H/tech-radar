import { Domain } from '../board/board.types';

/** 單一領域的關鍵字種子集，對應 spec「領域關鍵字種子集」的兩群結構。 */
export interface DomainKeywordSet {
  /** 前群：同時兼作補位 Search `q` 的 OR 群（見 github-search.service）。 */
  search: string[];
  /** 補充群：只參與 topics／description 比對，不進 Search `q`。 */
  extra: string[];
}

/**
 * 兩領域關鍵字種子集（v1 canonical）。**增刪只改此檔、不動分類邏輯**（憲章 IV 精神）。
 *
 * 兩群分工由 spec 定義：`search` 兼作補位 Search 的 OR 群，`extra` 只參與比對。
 * `DOMAIN_KEYWORDS`（完整集）與 `SEARCH_QUERIES`（OR 群）皆由此衍生，兩邊不再各自
 * 維護字面量——否則加一個關鍵字只擴大分類、不擴大搜尋，兩份清單會無聲漂移。
 *
 * 比對語意為**小寫詞界**（以非英數字元為界），topics 與 description 共用同一集合（A2）。
 * 詞界比對不會讓 `ai` 誤命中 `blockchain`／`domain`，代價是接不到 `openai`／`agents`
 * 這類黏著變體，故將常見變體逐一列入 `extra`（增刪仍只改此檔）。
 *
 * **DevOps 群已於 2026-07-15 隨榜單 DevOps 領域一併移除**——其命中主力 `docker` 是
 * 「部署方式」而非「領域」標籤（self-hosted 應用幾乎都貼），實測歸類正確率為 0。
 * 此處僅指**榜單**；新聞側的 DevOps 領域與來源不受影響（另一條資料流，憲章 III）。
 */
export const DOMAIN_KEYWORD_SETS: Record<Domain, DomainKeywordSet> = {
  ai: {
    search: ['llm', 'rag', 'agent', 'gpt'],
    extra: [
      'ai',
      'machine-learning',
      'deep-learning',
      'llmops',
      'transformers',
      // 詞界比對接不到的常見黏著變體（子字串語意下原本由 llm／agent／ai／gpt 涵蓋）
      'llms',
      'agents',
      'agentic',
      'openai',
      'genai',
      'chatgpt',
    ],
  },
  'frontend-backend': {
    search: ['nextjs', 'react', 'svelte', 'nodejs', 'golang'],
    extra: [
      'typescript',
      'vue',
      'fastapi',
      'frontend',
      'backend',
      // 同上：react／svelte／vue 的黏著變體
      'reactjs',
      'sveltekit',
      'vuejs',
    ],
  },
};

function mergeKeywords(set: DomainKeywordSet): string[] {
  return [...set.search, ...set.extra];
}

/** 各領域完整關鍵字集（`search` ＋ `extra`），供 topics／description 比對共用。 */
export const DOMAIN_KEYWORDS: Record<Domain, string[]> = {
  ai: mergeKeywords(DOMAIN_KEYWORD_SETS.ai),
  'frontend-backend': mergeKeywords(DOMAIN_KEYWORD_SETS['frontend-backend']),
};
