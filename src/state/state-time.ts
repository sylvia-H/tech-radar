/**
 * 寫進 `state/board.json` 的時間戳一律經此產生（`Date#toISOString()`，例 `2026-10-24T00:00:00.000Z`）。
 *
 * `state.schema.ts` 的 `isoDatetime`（zod 4 `z.iso.datetime({ offset: true })`）要求有秒、時差要有冒號，
 * 改用其他格式（例如省略秒）會讓 `save()` 驗證擲錯、或下次 `load()` 把整份狀態當壞檔
 * （`board` 條目例外：`lenientBoardSchema` 只剔除該條並 warn）。`now` 可注入以便測試。
 */
export function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}
