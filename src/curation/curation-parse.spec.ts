import { CurationParseError, parseCurationResponse, stripJsonFence } from './curation-parse';

describe('stripJsonFence', () => {
  it('剝除 ```json fence，取柵欄內文', () => {
    const raw = '```json\n{"picks":[]}\n```';
    expect(stripJsonFence(raw)).toBe('{"picks":[]}');
  });

  it('剝除無語言標記的 fence', () => {
    const raw = '```\n{"picks":[]}\n```';
    expect(stripJsonFence(raw)).toBe('{"picks":[]}');
  });

  it('無 fence 時原樣返回', () => {
    const raw = '{"picks":[]}';
    expect(stripJsonFence(raw)).toBe(raw);
  });
});

describe('parseCurationResponse', () => {
  it('合法 JSON（含 fence）→ 正確 picks', () => {
    const raw = '```json\n{"picks":[{"ref":0,"title":"標題","content":"內容"}]}\n```';
    const result = parseCurationResponse(raw);
    expect(result.picks).toEqual([{ ref: 0, title: '標題', content: '內容' }]);
  });

  it('合法 JSON（不含 fence）→ 正確 picks', () => {
    const raw = '{"picks":[{"ref":1,"title":"標題2","content":"內容2"}]}';
    const result = parseCurationResponse(raw);
    expect(result.picks).toEqual([{ ref: 1, title: '標題2', content: '內容2' }]);
  });

  it('非 JSON → 擲 CurationParseError', () => {
    expect(() => parseCurationResponse('這不是 JSON')).toThrow(CurationParseError);
  });

  it('截斷的 JSON → 擲 CurationParseError', () => {
    expect(() => parseCurationResponse('{"picks":[{"ref":0,')).toThrow(CurationParseError);
  });

  it('picks 非陣列 → 擲 CurationParseError', () => {
    expect(() => parseCurationResponse('{"picks":"not-array"}')).toThrow(CurationParseError);
  });

  it('ref 為字串（型別不符）→ 擲 CurationParseError', () => {
    const raw = '{"picks":[{"ref":"0","title":"t","content":"c"}]}';
    expect(() => parseCurationResponse(raw)).toThrow(CurationParseError);
  });

  it('越界 ref（如 99）→ 解析通過，留給硬驗證層剔除（分層職責，D2）', () => {
    const raw = '{"picks":[{"ref":99,"title":"t","content":"c"}]}';
    const result = parseCurationResponse(raw);
    expect(result.picks).toEqual([{ ref: 99, title: 't', content: 'c' }]);
  });

  it('空 picks → 解析通過為空陣列（候選稀少時允許）', () => {
    const result = parseCurationResponse('{"picks":[]}');
    expect(result.picks).toEqual([]);
  });
});
