import { RawItem } from '../news.types';
import { SourceFetcher, truncateSummary } from './fetcher';
import { fetchAndParse } from './rss.fetcher';
import { isNoisyRelease } from '../release-filter';

/**
 * GitHub `releases.atom`（research D5/D6）。解析後套 `release-filter`：**drop pre-release 與
 * 純 patch**，只留 major/minor 或安全修補（FR-008 / SC-010）。releases 無社群分數 → `score = null`。
 */
export const githubReleasesFetcher: SourceFetcher = async (source, ctx) => {
  const items = await fetchAndParse(source, ctx);
  const out: RawItem[] = [];
  for (const item of items) {
    const title = item.title?.trim();
    const link = item.link?.trim();
    if (!title || !link) {
      continue;
    }
    if (isNoisyRelease(title)) {
      continue; // 版本噪音（pre-release／純 patch）不入候選池
    }
    out.push({
      title,
      targetUrl: link,
      summary: truncateSummary(item.contentSnippet ?? item.content),
      score: null,
      publishedAt: item.isoDate ?? null,
    });
  }
  return out;
};
