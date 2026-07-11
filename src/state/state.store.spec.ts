import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { StateStore, stableStringify } from './state.store';
import { emptyBoardState, BoardState } from './state.schema';

async function tmpFile(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'radar-state-'));
  return path.join(dir, 'board.json');
}

describe('StateStore.load', () => {
  it('缺檔回退空骨架、不擲錯', async () => {
    const store = new StateStore(path.join(os.tmpdir(), 'radar-nonexistent', 'board.json'));
    await expect(store.load()).resolves.toEqual(emptyBoardState());
  });

  it('合法檔 round-trip 不遺失既有欄位', async () => {
    const file = await tmpFile();
    const state: BoardState = {
      ...emptyBoardState(),
      lastBoardPushAt: '2026-07-11T22:07:00.000Z',
      board: {
        'owner/name': {
          fullName: 'owner/name',
          url: 'https://github.com/owner/name',
          language: 'TypeScript',
          domain: 'frontend',
          starsThisWeek: 5,
          rank: 2,
          firstSeenAt: '2026-07-01T00:00:00.000Z',
        },
      },
    };
    await fs.writeFile(file, JSON.stringify(state), 'utf-8');
    await expect(new StateStore(file).load()).resolves.toEqual(state);
  });

  it('JSON 壞檔擲錯且不覆寫', async () => {
    const file = await tmpFile();
    await fs.writeFile(file, '{ not json', 'utf-8');
    const store = new StateStore(file);
    await expect(store.load()).rejects.toThrow();
    // 原檔未被覆寫
    await expect(fs.readFile(file, 'utf-8')).resolves.toBe('{ not json');
  });

  it('結構不合法擲錯且不覆寫', async () => {
    const file = await tmpFile();
    await fs.writeFile(file, JSON.stringify({ board: {} }), 'utf-8');
    const store = new StateStore(file);
    await expect(store.load()).rejects.toThrow();
  });
});

describe('StateStore.save', () => {
  it('穩定鍵序、2-space、結尾換行', async () => {
    const file = await tmpFile();
    await new StateStore(file).save(emptyBoardState());
    const written = await fs.readFile(file, 'utf-8');
    expect(written.endsWith('\n')).toBe(true);
    expect(written).toBe(stableStringify(emptyBoardState()) + '\n');
    // 鍵序穩定（字典序）
    const keyOrder = written
      .split('\n')
      .filter((l) => /^ {2}"/.test(l))
      .map((l) => l.trim().split(':')[0].replace(/"/g, ''));
    expect(keyOrder).toEqual([...keyOrder].sort());
  });

  it('不合法物件擲錯、不寫檔', async () => {
    const file = await tmpFile();
    await fs.rm(file, { force: true });
    const bad = { board: {} } as unknown as BoardState;
    await expect(new StateStore(file).save(bad)).rejects.toThrow();
    await expect(fs.access(file)).rejects.toThrow();
  });

  it('覆寫既有檔後內容完整且不殘留暫存檔', async () => {
    const file = await tmpFile();
    const store = new StateStore(file);
    await store.save(emptyBoardState());
    const updated: BoardState = {
      ...emptyBoardState(),
      lastBoardPushAt: '2026-07-11T22:07:00.000Z',
    };
    await store.save(updated);
    await expect(store.load()).resolves.toEqual(updated);
    // 原子寫入的暫存檔已 rename 掉，不殘留
    await expect(fs.access(`${file}.tmp`)).rejects.toThrow();
  });

  it('save 後可被 load 還原（round-trip）', async () => {
    const file = await tmpFile();
    const store = new StateStore(file);
    const state: BoardState = {
      ...emptyBoardState(),
      seenNews: [{ url: 'https://example.com/a', seenAt: '2026-07-11T22:07:00.000Z' }],
    };
    await store.save(state);
    await expect(store.load()).resolves.toEqual(state);
  });
});
