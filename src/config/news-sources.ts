import { NewsSource } from '../news/news.types';
import { validateNewsSources } from './news-source.schema';

/**
 * 新聞來源的**唯一清單**（憲章 IV、FR-001）。增、刪、修來源**只改此檔**，不動任何抓取／
 * 漏斗程式碼。初始清單依 dev-guide §4.2 三層來源；前後端已合併為 `frontend-backend`
 * （F4 clarify 2026-07-16），保留三個 DevOps 專屬來源（憲章 v1.2.0 Scope note）。
 *
 * 尚無公認 RSS 端點的一手來源（Anthropic／DeepMind／HF Papers）先 `enabled: false`，
 * URL 待上線逐一驗證（§4.3「先停用觀察比直接刪安全」）；壞掉的 feed 一律以停用／替換設定
 * 處理、不動 code。
 */
const RAW_NEWS_SOURCES: NewsSource[] = [
  // ── Tier 1：常開高訊號（跨領域聚合） ──────────────────────────────────
  // HN 週熱門：fetcher 依 `now` 補上 `numericFilters=created_at_i>{7天前}`（近 7 天口徑）。
  { id: 'hn', type: 'hn-algolia', url: 'https://hn.algolia.com/api/v1/search?tags=story', domain: 'cross', tier: 1 },
  { id: 'lobsters-ai', type: 'rss', url: 'https://lobste.rs/t/ai.rss', domain: 'ai', tier: 1 },
  { id: 'lobsters-devops', type: 'rss', url: 'https://lobste.rs/t/devops.rss', domain: 'devops', tier: 1 },
  { id: 'lobsters-programming', type: 'rss', url: 'https://lobste.rs/t/programming.rss', domain: 'cross', tier: 1 },
  { id: 'reddit-localllama', type: 'reddit-weekly', url: 'https://www.reddit.com/r/LocalLLaMA/top/.rss?t=week', domain: 'ai', tier: 1 },
  { id: 'simonwillison', type: 'rss', url: 'https://simonwillison.net/atom/everything/', domain: 'ai', tier: 1 },

  // ── Tier 2：高精準一手（無社群分數 → 漏斗不設分數門檻） ─────────────────
  { id: 'gh-nodejs', type: 'github-releases', url: 'https://github.com/nodejs/node/releases.atom', domain: 'frontend-backend', tier: 2 },
  { id: 'gh-cpython', type: 'github-releases', url: 'https://github.com/python/cpython/releases.atom', domain: 'frontend-backend', tier: 2 },
  { id: 'gh-typescript', type: 'github-releases', url: 'https://github.com/microsoft/TypeScript/releases.atom', domain: 'frontend-backend', tier: 2 },
  { id: 'gh-kubernetes', type: 'github-releases', url: 'https://github.com/kubernetes/kubernetes/releases.atom', domain: 'devops', tier: 2 },
  { id: 'openai-blog', type: 'rss', url: 'https://openai.com/news/rss.xml', domain: 'ai', tier: 2 },
  { id: 'anthropic-news', type: 'rss', url: 'https://www.anthropic.com/rss.xml', domain: 'ai', tier: 2, enabled: false },
  { id: 'deepmind-blog', type: 'rss', url: 'https://deepmind.google/blog/rss.xml', domain: 'ai', tier: 2, enabled: false },
  { id: 'hf-papers', type: 'rss', url: 'https://huggingface.co/papers', domain: 'ai', tier: 2, enabled: false },

  // ── Tier 3：選配實驗（更高門檻、更低權重；可隨時砍不動 code） ────────────
  { id: 'gh-vue', type: 'github-releases', url: 'https://github.com/vuejs/core/releases.atom', domain: 'frontend-backend', tier: 3 },
  { id: 'gh-react', type: 'github-releases', url: 'https://github.com/facebook/react/releases.atom', domain: 'frontend-backend', tier: 3 },
  { id: 'thenewstack', type: 'rss', url: 'https://thenewstack.io/feed/', domain: 'devops', tier: 3 },
  // 2026-07-19 實測：GitHub Actions runner IP 持續遭 Reddit 擋 403/429（重試 3 次仍失敗），
  // 非單次抖動。四者皆 Tier 3、社群訊號可由其他來源替代，先停用觀察，不刪除設定（§4.3）。
  { id: 'reddit-devops', type: 'reddit-weekly', url: 'https://www.reddit.com/r/devops/top/.rss?t=week', domain: 'devops', tier: 3, enabled: false },
  { id: 'reddit-node', type: 'reddit-weekly', url: 'https://www.reddit.com/r/node/top/.rss?t=week', domain: 'frontend-backend', tier: 3, enabled: false },
  { id: 'reddit-python', type: 'reddit-weekly', url: 'https://www.reddit.com/r/Python/top/.rss?t=week', domain: 'frontend-backend', tier: 3, enabled: false },
  { id: 'reddit-reactjs', type: 'reddit-weekly', url: 'https://www.reddit.com/r/reactjs/top/.rss?t=week', domain: 'frontend-backend', tier: 3, enabled: false },
];

/** 已驗證的來源清單（載入時經 `validateNewsSources`：唯一 id、必填欄位、列舉）。 */
export const NEWS_SOURCES: NewsSource[] = validateNewsSources(RAW_NEWS_SOURCES);
