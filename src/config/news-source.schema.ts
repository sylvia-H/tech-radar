import { z } from 'zod';
import { NewsSource } from '../news/news.types';

/**
 * 單筆來源的 zod schema（research D1、FR-002）。`tier` 以字面量聯集鎖 `1|2|3`。
 */
export const newsSourceSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['hn-algolia', 'reddit-weekly', 'rss', 'github-releases']),
  url: z.string().url(),
  domain: z.enum(['ai', 'devops', 'frontend-backend', 'cross']),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  enabled: z.boolean().optional(),
});

/**
 * 來源清單驗證（憲章 IV、FR-002）：逐筆 schema ＋ **跨筆唯一 `id`**。
 *
 * 任何違規（缺必填、列舉不符、`url` 非法、`id` 重複）一律**擲帶 `id` 的明確錯誤**，
 * MUST NOT 靜默載入不合法清單。`id` 是抓取告警與 `seenNews` 統計的引用鍵，重複會讓兩者
 * 失真，故唯一性須顯式檢查（zod 的 object/enum 不涵蓋跨筆唯一）。
 */
export function validateNewsSources(list: unknown): NewsSource[] {
  if (!Array.isArray(list)) {
    throw new Error('新聞來源清單必須是陣列');
  }
  const result: NewsSource[] = [];
  const seen = new Set<string>();
  list.forEach((raw, i) => {
    const parsed = newsSourceSchema.safeParse(raw);
    if (!parsed.success) {
      const ref = idOf(raw) ?? `#${i}`;
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`)
        .join('; ');
      throw new Error(`新聞來源 [${ref}] schema 驗證失敗：${detail}`);
    }
    if (seen.has(parsed.data.id)) {
      throw new Error(`新聞來源清單有重複 id：${parsed.data.id}`);
    }
    seen.add(parsed.data.id);
    result.push(parsed.data);
  });
  return result;
}

function idOf(raw: unknown): string | null {
  if (raw !== null && typeof raw === 'object' && 'id' in raw) {
    const id = (raw as { id: unknown }).id;
    return typeof id === 'string' ? id : null;
  }
  return null;
}
