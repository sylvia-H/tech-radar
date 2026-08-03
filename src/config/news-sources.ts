import { NewsSource } from '../news/news.types';
import { validateNewsSources } from './news-source.schema';

/**
 * 新聞來源的**唯一清單**（憲章 IV、FR-001）。增、刪、修來源**只改此檔**，不動任何抓取／
 * 漏斗程式碼。初始清單依 dev-guide §4.2 三層來源；前後端已合併為 `frontend-backend`
 * （F4 clarify 2026-07-16），保留三個 DevOps 專屬來源（憲章 v1.2.0 Scope note）。
 *
 * DeepMind 已改用官方 basic feed 啟用；Anthropic 仍無公認官方 RSS，維持 `enabled: false`
 * （dev-guide §12「沒有就先不收」——不以第三方社群中轉站替代，避免把不可控節點放進每日關鍵路徑）。
 * 壞掉的 feed 一律以停用／替換設定處理、不動 code。
 *
 * **新增大型 feed 前先確認量體**：漏斗對 Tier 2 不設分數門檻（`scoreThresholds[2] = null`），
 * 無分數者一律以 `nullScoreBaseline = 100` 入池、決勝鍵為 `publishedAt ↓`。單日產出上百筆且
 * 全為當天的來源（如 arXiv 分類 RSS）會吃光 `convergeMax = 25` 名額、擠掉一手公告；在漏斗補上
 * 新鮮度視窗與單一來源入池上限之前，不收這類來源。
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
  // DeepMind 官方未公開宣傳的 basic feed（2026-08-03 實測 200／100 筆），取代原本停用的
  // `blog/rss.xml`。
  { id: 'deepmind-blog', type: 'rss', url: 'https://deepmind.google/blog/feed/basic/', domain: 'ai', tier: 2 },
  // HF **Blog** 官方 feed（非 Papers）。回溯至 2020 的全站封存（實測 834 筆），但舊文在
  // `publishedAt ↓` 決勝時自然沉底、不佔 convergeMax 名額，故可收。
  { id: 'hf-blog', type: 'rss', url: 'https://huggingface.co/blog/feed.xml', domain: 'ai', tier: 2 },
  // HF Papers 仍無官方 feed，故清單中無此項。**不以 arXiv 分類 RSS 代替**：實測單日 261 筆且
  // 全為當天，會吃光候選集名額（見檔頭量體說明）。待漏斗補新鮮度視窗後再議。
  //
  // Anthropic：2026-08-03 覆測 `www.anthropic.com/rss.xml` 仍非公認端點，維持停用。
  { id: 'anthropic-news', type: 'rss', url: 'https://www.anthropic.com/rss.xml', domain: 'ai', tier: 2, enabled: false },
  // 領域補充（2026-08-03 實測皆 200、量體正常）。
  { id: 'vue-blog', type: 'rss', url: 'https://blog.vuejs.org/feed.rss', domain: 'frontend-backend', tier: 2 },
  { id: 'web-dev', type: 'rss', url: 'https://web.dev/feed.xml', domain: 'frontend-backend', tier: 2 },
  { id: 'cloudflare-blog', type: 'rss', url: 'https://blog.cloudflare.com/rss/', domain: 'devops', tier: 2 },
  { id: 'cncf-blog', type: 'rss', url: 'https://www.cncf.io/feed/', domain: 'devops', tier: 2 },

  // ── Tier 3：選配實驗（更高門檻、更低權重；可隨時砍不動 code） ────────────
  { id: 'gh-vue', type: 'github-releases', url: 'https://github.com/vuejs/core/releases.atom', domain: 'frontend-backend', tier: 3 },
  { id: 'gh-react', type: 'github-releases', url: 'https://github.com/facebook/react/releases.atom', domain: 'frontend-backend', tier: 3 },
  { id: 'thenewstack', type: 'rss', url: 'https://thenewstack.io/feed/', domain: 'devops', tier: 3 },
  { id: 'github-next', type: 'rss', url: 'https://githubnext.com/rss.xml', domain: 'ai', tier: 3 },
  // 2026-07-19 實測：GitHub Actions runner IP 持續遭 Reddit 擋 403/429（重試 3 次仍失敗），
  // 非單次抖動。四者皆 Tier 3、社群訊號可由其他來源替代，先停用觀察，不刪除設定（§4.3）。
  // 2026-08-03：曾評估改走第三方 Reddit RSS 代理繞過，但候選節點 `pullfeed.co` 實測 DNS 不存在；
  // 且第三方中轉不符「零維運、不引入不可控依賴」的取向，維持停用。
  { id: 'reddit-devops', type: 'reddit-weekly', url: 'https://www.reddit.com/r/devops/top/.rss?t=week', domain: 'devops', tier: 3, enabled: false },
  { id: 'reddit-node', type: 'reddit-weekly', url: 'https://www.reddit.com/r/node/top/.rss?t=week', domain: 'frontend-backend', tier: 3, enabled: false },
  { id: 'reddit-python', type: 'reddit-weekly', url: 'https://www.reddit.com/r/Python/top/.rss?t=week', domain: 'frontend-backend', tier: 3, enabled: false },
  { id: 'reddit-reactjs', type: 'reddit-weekly', url: 'https://www.reddit.com/r/reactjs/top/.rss?t=week', domain: 'frontend-backend', tier: 3, enabled: false },
];

/** 已驗證的來源清單（載入時經 `validateNewsSources`：唯一 id、必填欄位、列舉）。 */
export const NEWS_SOURCES: NewsSource[] = validateNewsSources(RAW_NEWS_SOURCES);
