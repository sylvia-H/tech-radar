import { z } from 'zod';

const isoDatetime = z.string().datetime({ offset: true });
const nullableIso = isoDatetime.nullable();

/** 領域歸類（frontend/backend 分列）；enum 值於 F2 clarify 定案，F1 僅固定型別。 */
export const domainSchema = z.enum(['ai', 'devops', 'backend', 'frontend']);

/** 各領域榜單快照條目（F1 定義 schema、不寫入資料）。 */
export const boardEntrySchema = z.object({
  fullName: z.string(),
  url: z.string().url(),
  language: z.string().nullable(),
  domain: domainSchema,
  starsThisWeek: z.number().int().min(0),
  rank: z.number().int().min(1),
  firstSeenAt: isoDatetime,
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
  board: z.record(z.string(), boardEntrySchema),
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
