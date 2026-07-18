import { NewsHttp, NewsHttpError, NEWS_USER_AGENT } from './news-http';

/** 建一個假 Response（避免依賴真實 fetch）。 */
function fakeRes(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => body,
    json: async () => JSON.parse(body),
  } as unknown as Response;
}

describe('NewsHttp', () => {
  const http = new NewsHttp();
  let fetchMock: jest.SpyInstance;

  afterEach(() => {
    fetchMock?.mockRestore();
  });

  it('getText 帶自訂 User-Agent、回傳 feed 文字', async () => {
    fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(fakeRes(200, '<rss/>'));
    const res = await http.getText('https://example.com/feed.xml');
    expect(res.text).toBe('<rss/>');
    expect(res.notModified).toBe(false);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['User-Agent']).toBe(NEWS_USER_AGENT);
  });

  it('304 → notModified、text 空', async () => {
    fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(fakeRes(304, ''));
    const res = await http.getText('https://example.com/feed.xml', { etag: 'abc' });
    expect(res.notModified).toBe(true);
    expect(res.text).toBe('');
  });

  it('getJson 解析 JSON body', async () => {
    fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(fakeRes(200, JSON.stringify({ hits: [{ title: 'x' }] })));
    const data = await http.getJson<{ hits: { title: string }[] }>('https://hn.algolia.com/api');
    expect(data.hits[0].title).toBe('x');
  });

  it('5xx 先退避重試、後續成功即回傳', async () => {
    fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(fakeRes(503, ''))
      .mockResolvedValueOnce(fakeRes(200, 'ok'));
    const res = await http.getText('https://example.com/feed.xml');
    expect(res.text).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('網路錯誤重試耗盡 → 擲錯（訊息含 URL，無機密風險）', async () => {
    fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNRESET'));
    await expect(http.getText('https://example.com/feed.xml')).rejects.toThrow(
      /網路錯誤.*example\.com/,
    );
  });

  it('4xx（404）不重試、擲 NewsHttpError 帶狀態碼', async () => {
    fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(fakeRes(404, ''));
    await expect(http.getJson('https://example.com/gone')).rejects.toBeInstanceOf(NewsHttpError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
