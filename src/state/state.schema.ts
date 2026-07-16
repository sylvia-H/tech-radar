import { Logger } from '@nestjs/common';
import { z } from 'zod';

const logger = new Logger('state.schema');

const isoDatetime = z.string().datetime({ offset: true });
const nullableIso = isoDatetime.nullable();

/**
 * 領域歸類：與 `src/board/board.types.ts` 的 `Domain` 一致的 2-way enum（'frontend-backend'
 * = 前端＋後端合併）。DevOps 已於 2026-07-15 自榜單移除；此 enum 於 F3 兌現（首個實際寫入
 * `state.board` 的 Feature），F1 舊有的 4-way 佔位（含 `devops`）於此對齊（FR-024）。
 */
export const domainSchema = z.enum(['ai', 'frontend-backend']);

/** 各領域榜單快照條目（F3 首次寫入；`starsThisWeek` 存的是統一尺 weeklyStarsEstimate）。 */
export const boardEntrySchema = z.object({
  fullName: z.string(),
  url: z.string().url(),
  language: z.string().nullable(),
  domain: domainSchema,
  starsThisWeek: z.number().int().min(0),
  rank: z.number().int().min(1),
  firstSeenAt: isoDatetime,
});

/**
 * `board` 的條目層寬鬆載入（FR-024）：逐條 `safeParse`，不合法者（如舊 `domain:"devops"`）
 * **剔除該條目 + warn**，其餘條目照常載入、整份狀態不失效。剔除的語意是安全的——該 repo
 * 等同「不在上次快照」，下次以新進呈現。**根層仍嚴格**：`board` 非物件 → 擲錯（憲章 VI
 * 壞檔不覆寫）；剔除**必須 warn**、不得無聲（憲章 VII）。
 */
const lenientBoardSchema = z
  .record(z.string(), z.unknown())
  .transform((raw) => {
    const board: Record<string, z.infer<typeof boardEntrySchema>> = {};
    for (const [key, value] of Object.entries(raw)) {
      const result = boardEntrySchema.safeParse(value);
      if (result.success) {
        board[key] = result.data;
      } else {
        logger.warn(
          `剔除不合法的榜單快照條目 [${key}]：${result.error.issues
            .map((i) => `${i.path.join('.') || '(root)'} ${i.message}`)
            .join('; ')}`,
        );
      }
    }
    return board;
  });

/** repo 簡介快取（獨立於 board，跌出榜不清除）。 */
export const introCacheSchema = z.object({
  intro: z.string(),
  introAt: isoDatetime,
});

/** 已推播新聞紀錄，含時間戳供 7 天修剪。 */
export const seenNewsEntrySchema = z.object({
  url: z.string(),
  seenAt: isoDatetime,
});

/** 唯一權威狀態 `state/board.json` 根物件（五欄位皆必填）。 */
export const boardStateSchema = z.object({
  lastBoardPushAt: nullableIso,
  lastNewsPushAt: nullableIso,
  board: lenientBoardSchema,
  intros: z.record(z.string(), introCacheSchema),
  seenNews: z.array(seenNewsEntrySchema),
});

export type Domain = z.infer<typeof domainSchema>;
export type BoardEntry = z.infer<typeof boardEntrySchema>;
export type IntroCache = z.infer<typeof introCacheSchema>;
export type SeenNewsEntry = z.infer<typeof seenNewsEntrySchema>;
export type BoardState = z.infer<typeof boardStateSchema>;

/** 空骨架（缺檔回退／seed 進 repo，FR-015）。 */
export function emptyBoardState(): BoardState {
  return {
    lastBoardPushAt: null,
    lastNewsPushAt: null,
    board: {},
    intros: {},
    seenNews: [],
  };
}
