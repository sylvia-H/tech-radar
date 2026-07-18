import { GithubHttpService, GithubHttpError } from './github-http';
import { fetchReadme } from './github-readme';

function makeHttp(getJson: GithubHttpService['getJson']): GithubHttpService {
  return { getJson } as unknown as GithubHttpService;
}

describe('fetchReadme', () => {
  it('解碼 base64 README 內容', async () => {
    const md = '# Hello\n這是一個 repo';
    const http = makeHttp(
      jest.fn().mockResolvedValue({
        content: Buffer.from(md, 'utf-8').toString('base64'),
        encoding: 'base64',
      }),
    );
    await expect(fetchReadme(http, 'owner', 'repo')).resolves.toBe(md);
    expect(http.getJson).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/readme',
    );
  });

  it('404（無 README）回空字串', async () => {
    const http = makeHttp(jest.fn().mockRejectedValue(new GithubHttpError(404)));
    await expect(fetchReadme(http, 'owner', 'repo')).resolves.toBe('');
  });

  it('網路錯誤回空字串', async () => {
    const http = makeHttp(jest.fn().mockRejectedValue(new Error('network down')));
    await expect(fetchReadme(http, 'owner', 'repo')).resolves.toBe('');
  });

  it('非 base64 編碼回空字串', async () => {
    const http = makeHttp(
      jest.fn().mockResolvedValue({ content: 'irrelevant', encoding: 'none' }),
    );
    await expect(fetchReadme(http, 'owner', 'repo')).resolves.toBe('');
  });
});
