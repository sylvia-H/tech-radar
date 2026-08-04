import { ConfigService } from '@nestjs/config';
import { RepoVisibilityService } from './repo-visibility.service';
import { GithubHttpService, GithubHttpError } from '../github/github-http';

function build(repo: string | undefined) {
  const getJson = jest.fn();
  const github = { getJson } as unknown as GithubHttpService;
  const config = { get: (k: string) => (k === 'GITHUB_REPOSITORY' ? repo : undefined) } as unknown as ConfigService;
  const service = new RepoVisibilityService(github, config);
  return { service, getJson };
}

describe('RepoVisibilityService.check', () => {
  it('private === false → public', async () => {
    const { service, getJson } = build('owner/repo');
    getJson.mockResolvedValue({ private: false });
    await expect(service.check()).resolves.toBe('public');
    expect(getJson).toHaveBeenCalledWith('https://api.github.com/repos/owner/repo');
  });

  it('private === true → private', async () => {
    const { service, getJson } = build('owner/repo');
    getJson.mockResolvedValue({ private: true });
    await expect(service.check()).resolves.toBe('private');
  });

  it('查詢擲錯（GithubHttpError／網路錯誤）→ unknown', async () => {
    const { service, getJson } = build('owner/repo');
    getJson.mockRejectedValue(new GithubHttpError(404));
    await expect(service.check()).resolves.toBe('unknown');
  });

  it('回應缺 private 欄位 → unknown', async () => {
    const { service, getJson } = build('owner/repo');
    getJson.mockResolvedValue({});
    await expect(service.check()).resolves.toBe('unknown');
  });

  it('GITHUB_REPOSITORY 未設定 → unknown 且不發請求', async () => {
    const { service, getJson } = build(undefined);
    await expect(service.check()).resolves.toBe('unknown');
    expect(getJson).not.toHaveBeenCalled();
  });

  it('GITHUB_REPOSITORY 不含 "/" → unknown 且不發請求', async () => {
    const { service, getJson } = build('not-a-valid-repo');
    await expect(service.check()).resolves.toBe('unknown');
    expect(getJson).not.toHaveBeenCalled();
  });
});
