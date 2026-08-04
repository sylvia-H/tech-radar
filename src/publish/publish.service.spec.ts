jest.mock('node:fs', () => ({
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
  },
}));

import { promises as fs } from 'node:fs';
import { ConfigService } from '@nestjs/config';
import { PublishService } from './publish.service';
import { RepoVisibilityService } from './repo-visibility.service';
import { StateStore } from '../state/state.store';
import { DiscordWebhookService } from '../discord/discord.webhook.service';
import { BoardState, emptyBoardState } from '../state/state.schema';
import { RepoVisibility } from './publish.types';

const mkdir = fs.mkdir as jest.Mock;
const writeFile = fs.writeFile as jest.Mock;

function build(visibility: RepoVisibility, state: BoardState | (() => Promise<BoardState>)) {
  const check = jest.fn().mockResolvedValue(visibility);
  const load =
    typeof state === 'function' ? jest.fn(state) : jest.fn().mockResolvedValue(state);
  const save = jest.fn().mockResolvedValue(undefined);
  const postFailureAlert = jest.fn().mockResolvedValue(undefined);
  const send = jest.fn().mockResolvedValue(undefined);

  const visibilityService = { check } as unknown as RepoVisibilityService;
  const stateStore = { load, save } as unknown as StateStore;
  const discord = { postFailureAlert, send } as unknown as DiscordWebhookService;
  const config = {
    get: (k: string) => (k === 'GITHUB_REPOSITORY' ? 'owner/repo' : undefined),
  } as unknown as ConfigService;

  const service = new PublishService(visibilityService, stateStore, discord, config);
  return { service, check, load, save, postFailureAlert, send };
}

describe('PublishService.run（US1，contracts/publish-orchestration.md C2）', () => {
  beforeEach(() => {
    mkdir.mockClear();
    writeFile.mockClear();
  });

  it('(a) public → 成功寫出 index.html 與 feed.xml 兩個檔案', async () => {
    const { service, postFailureAlert } = build('public', {
      ...emptyBoardState(),
      board: {
        '1': {
          fullName: 'o/r',
          url: 'https://github.com/o/r',
          language: 'TypeScript',
          domain: 'ai',
          starsThisWeek: 100,
          rank: 1,
          firstSeenAt: '2026-08-01T00:00:00.000Z',
        },
      },
    });

    await service.run();

    expect(writeFile).toHaveBeenCalledTimes(2);
    const paths = writeFile.mock.calls.map((call) => String(call[0]));
    expect(paths.some((p) => p.endsWith('index.html'))).toBe(true);
    expect(paths.some((p) => p.endsWith('feed.xml'))).toBe(true);
    expect(postFailureAlert).not.toHaveBeenCalled();
  });

  it('(b) emptyBoardState() 仍正常寫出兩個檔案（US1 AS2 空狀態不擲錯）', async () => {
    const { service } = build('public', emptyBoardState());

    await service.run();

    expect(writeFile).toHaveBeenCalledTimes(2);
  });

  it('(c) stateStore.load() 擲錯 → 不 throw、發一則告警、不寫出任何檔案（FR-017 讀取失敗分支）', async () => {
    const { service, postFailureAlert } = build('public', () =>
      Promise.reject(new Error('狀態檔結構不合法')),
    );

    await expect(service.run()).resolves.toBeUndefined();

    expect(writeFile).not.toHaveBeenCalled();
    expect(postFailureAlert).toHaveBeenCalledTimes(1);
    expect(postFailureAlert.mock.calls[0][0]).toContain('發佈失敗');
  });

  it('(d) state 帶有舊時間戳的 publish（核心段本次跳過）→ 仍正常寫出兩個檔案並沿用既有快照內容（FR-012）', async () => {
    const state: BoardState = {
      ...emptyBoardState(),
      publish: {
        boardSummary: { summary: '舊摘要', generatedAt: '2026-07-01T00:00:00.000Z' },
      },
    };
    const { service } = build('public', state);

    await service.run();

    expect(writeFile).toHaveBeenCalledTimes(2);
    const htmlCall = writeFile.mock.calls.find((call) => String(call[0]).endsWith('index.html'));
    expect(String(htmlCall![1])).toContain('舊摘要');
  });

  it('private → 不寫檔、不告警', async () => {
    const { service, postFailureAlert } = build('private', emptyBoardState());

    await service.run();

    expect(writeFile).not.toHaveBeenCalled();
    expect(postFailureAlert).not.toHaveBeenCalled();
  });

  it('unknown → 不寫檔、發一則告警（FR-017）', async () => {
    const { service, postFailureAlert, load } = build('unknown', emptyBoardState());

    await service.run();

    expect(writeFile).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled(); // unknown 分支不讀 state
    expect(postFailureAlert).toHaveBeenCalledTimes(1);
    expect(postFailureAlert.mock.calls[0][0]).toContain('可見性查詢失敗');
  });
});

describe('PublishService.run — US3 隔離回歸測試（contracts/publish-orchestration.md C1「發佈段對 state 唯讀」）', () => {
  beforeEach(() => {
    mkdir.mockClear();
    writeFile.mockClear();
  });

  it.each<RepoVisibility>(['private', 'unknown'])(
    'visibility=%s → stateStore.save()／discord.send() 皆未被呼叫（US3 AS1/AS2）',
    async (visibility) => {
      const { service, save, send } = build(visibility, emptyBoardState());

      await service.run();

      expect(save).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    },
  );
});
