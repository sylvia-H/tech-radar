import { INestApplicationContext } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { tryPostFailureAlert } from './failure-alert';

async function tmpMarkerPath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'radar-alert-'));
  return path.join(dir, '.radar-alert-sent');
}

function appWith(postFailureAlert: jest.Mock): INestApplicationContext {
  return { get: () => ({ postFailureAlert }) } as unknown as INestApplicationContext;
}

describe('tryPostFailureAlert', () => {
  it('告警送出成功後寫入 marker', async () => {
    const marker = await tmpMarkerPath();
    const post = jest.fn().mockResolvedValue(undefined);
    await tryPostFailureAlert(appWith(post), new Error('boom'), marker);
    expect(post).toHaveBeenCalledWith('Error: boom');
    await expect(fs.access(marker)).resolves.toBeUndefined();
  });

  it('告警送出失敗：不寫 marker、不擲錯（交由 workflow 補送）', async () => {
    const marker = await tmpMarkerPath();
    const post = jest.fn().mockRejectedValue(new Error('discord down'));
    await expect(
      tryPostFailureAlert(appWith(post), new Error('boom'), marker),
    ).resolves.toBeUndefined();
    await expect(fs.access(marker)).rejects.toThrow();
  });

  it('非 Error 值以 String() 摘要', async () => {
    const marker = await tmpMarkerPath();
    const post = jest.fn().mockResolvedValue(undefined);
    await tryPostFailureAlert(appWith(post), 'plain failure', marker);
    expect(post).toHaveBeenCalledWith('plain failure');
  });

  it('marker 寫入失敗：不擲錯（最壞情況為重複告警）', async () => {
    // 指向不存在的目錄使 writeFile 失敗
    const marker = path.join(os.tmpdir(), 'radar-alert-nonexistent', 'x', '.radar-alert-sent');
    const post = jest.fn().mockResolvedValue(undefined);
    await expect(
      tryPostFailureAlert(appWith(post), new Error('boom'), marker),
    ).resolves.toBeUndefined();
  });
});
