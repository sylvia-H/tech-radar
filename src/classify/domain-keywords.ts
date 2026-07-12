import { Domain } from '../board/board.types';

/**
 * 三領域關鍵字種子集（v1 canonical）。**增刪只改此檔、不動分類邏輯**（憲章 IV 精神）。
 *
 * 每個領域為單一完整關鍵字集，**topics 與 description 比對共用同一集合**（A2）：
 * - topics：小寫**子字串**比對（topic slug 為結構化標籤，寬鬆命中風險低）。
 * - description：小寫**詞界**比對（以非英數字元為界，避免 `ai`／`rag`／`gpt` 誤命中
 *   `domain`／`chain` 等一般字詞）。
 * 前段關鍵字同時兼作補位 Search `q` 的 OR 群（見 github-search.service）。
 */
export const DOMAIN_KEYWORDS: Record<Domain, string[]> = {
  ai: ['llm', 'rag', 'agent', 'gpt', 'ai', 'machine-learning', 'deep-learning', 'llmops', 'transformers'],
  devops: [
    'kubernetes',
    'terraform',
    'gitops',
    'devops',
    'ci-cd',
    'docker',
    'observability',
    'platform-engineering',
  ],
  'frontend-backend': [
    'nextjs',
    'react',
    'svelte',
    'vue',
    'nodejs',
    'golang',
    'typescript',
    'fastapi',
    'frontend',
    'backend',
  ],
};
