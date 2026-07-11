import { Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  BoardState,
  boardStateSchema,
  emptyBoardState,
} from './state.schema';

/** 預設狀態檔路徑（repo 根目錄；job 由此執行）。 */
export const DEFAULT_STATE_PATH = path.resolve(process.cwd(), 'state', 'board.json');

/**
 * 唯一權威狀態的讀寫（憲章 VI）。只負責落檔，不負責 git commit（由 workflow 依 diff 決定）。
 * - load：缺檔→空骨架（不擲錯）；壞檔/結構不合法→擲錯（不覆寫）
 * - save：寫入前 schema 驗證；穩定鍵序、2-space、結尾換行
 */
@Injectable()
export class StateStore {
  constructor(private readonly filePath: string = DEFAULT_STATE_PATH) {}

  async load(): Promise<BoardState> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // 缺檔：回退空骨架，不擲錯（spec Edge Case）。
        return emptyBoardState();
      }
      throw err;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`狀態檔 JSON 解析失敗：${this.filePath}`);
    }

    const result = boardStateSchema.safeParse(parsed);
    if (!result.success) {
      // 結構不合法：擲錯，不以空骨架覆寫既有壞檔。
      throw new Error(`狀態檔結構不合法：${this.filePath}`);
    }
    return result.data;
  }

  async save(state: BoardState): Promise<void> {
    // 寫入前驗證；不合法即擲錯、不寫檔。
    const validated = boardStateSchema.parse(state);
    const serialized = stableStringify(validated) + '\n';
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    // 原子寫入：先落同目錄暫存檔再 rename（同檔案系統下為原子操作），
    // 進程中途被中斷時 board.json 仍是完整的舊版，不會留下半寫入壞檔。
    const tmpPath = `${this.filePath}.tmp`;
    await fs.writeFile(tmpPath, serialized, 'utf-8');
    await fs.rename(tmpPath, this.filePath);
  }
}

/**
 * 確定性序列化：遞迴排序物件鍵，2-space 縮排，利於 git diff 乾淨、避免假變更。
 * 陣列順序保留（語意有序）。
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortKeys(obj[key]);
    }
    return sorted;
  }
  return value;
}
