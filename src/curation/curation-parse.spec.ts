import { CurationParseError, describeIgnoredKeys, parseCurationResponse, stripJsonFence } from './curation-parse';

describe('stripJsonFence', () => {
  it('剝除 ```json fence，取柵欄內文', () => {
    const raw = '```json\n{"officialPicks":[],"communityPicks":[]}\n```';
    expect(stripJsonFence(raw)).toBe('{"officialPicks":[],"communityPicks":[]}');
  });

  it('剝除無語言標記的 fence', () => {
    const raw = '```\n{"officialPicks":[],"communityPicks":[]}\n```';
    expect(stripJsonFence(raw)).toBe('{"officialPicks":[],"communityPicks":[]}');
  });

  it('無 fence 時原樣返回', () => {
    const raw = '{"officialPicks":[],"communityPicks":[]}';
    expect(stripJsonFence(raw)).toBe(raw);
  });
});

describe('parseCurationResponse', () => {
  it('合法 JSON（含 fence）→ 正確 officialPicks/communityPicks', () => {
    const raw =
      '```json\n{"officialPicks":[{"ref":0,"title":"標題","content":"內容"}],"communityPicks":[]}\n```';
    const result = parseCurationResponse(raw);
    expect(result.officialPicks).toEqual([{ ref: 0, title: '標題', content: '內容' }]);
    expect(result.communityPicks).toEqual([]);
  });

  it('合法 JSON（不含 fence）→ 正確 officialPicks/communityPicks', () => {
    const raw =
      '{"officialPicks":[],"communityPicks":[{"ref":1,"title":"標題2","content":"內容2"}]}';
    const result = parseCurationResponse(raw);
    expect(result.officialPicks).toEqual([]);
    expect(result.communityPicks).toEqual([{ ref: 1, title: '標題2', content: '內容2' }]);
  });

  it('非 JSON → 擲 CurationParseError', () => {
    expect(() => parseCurationResponse('這不是 JSON')).toThrow(CurationParseError);
  });

  it('截斷的 JSON → 擲 CurationParseError', () => {
    expect(() => parseCurationResponse('{"officialPicks":[{"ref":0,')).toThrow(CurationParseError);
  });

  it('缺少 officialPicks 欄位 → 擲 CurationParseError', () => {
    expect(() => parseCurationResponse('{"communityPicks":[]}')).toThrow(CurationParseError);
  });

  it('缺少 communityPicks 欄位 → 擲 CurationParseError', () => {
    expect(() => parseCurationResponse('{"officialPicks":[]}')).toThrow(CurationParseError);
  });

  it('officialPicks 非陣列 → 擲 CurationParseError', () => {
    expect(() =>
      parseCurationResponse('{"officialPicks":"not-array","communityPicks":[]}'),
    ).toThrow(CurationParseError);
  });

  it('communityPicks 非陣列 → 擲 CurationParseError', () => {
    expect(() =>
      parseCurationResponse('{"officialPicks":[],"communityPicks":"not-array"}'),
    ).toThrow(CurationParseError);
  });

  it('ref 為字串（型別不符）→ 擲 CurationParseError', () => {
    const raw = '{"officialPicks":[{"ref":"0","title":"t","content":"c"}],"communityPicks":[]}';
    expect(() => parseCurationResponse(raw)).toThrow(CurationParseError);
  });

  it('越界 ref（如 99）→ 解析通過，留給硬驗證層剔除（分層職責，D2）', () => {
    const raw = '{"officialPicks":[{"ref":99,"title":"t","content":"c"}],"communityPicks":[]}';
    const result = parseCurationResponse(raw);
    expect(result.officialPicks).toEqual([{ ref: 99, title: 't', content: 'c' }]);
  });

  it('兩陣列皆空 → 解析通過（候選稀少時允許）', () => {
    const result = parseCurationResponse('{"officialPicks":[],"communityPicks":[]}');
    expect(result.officialPicks).toEqual([]);
    expect(result.communityPicks).toEqual([]);
  });

  it('無額外鍵 → ignoredKeys 為 []', () => {
    const result = parseCurationResponse('{"officialPicks":[],"communityPicks":[]}');
    expect(result.ignoredKeys).toEqual([]);
  });

  it('有額外鍵 externalPicks → 仍成功解析（不擲錯、不解析其內容），ignoredKeys 為 [externalPicks]（2026-09-12 防禦）', () => {
    const raw = JSON.stringify({
      officialPicks: [{ ref: 0, title: '官方', content: '內容' }],
      communityPicks: [],
      externalPicks: [{ ref: 1, title: '外部事件', content: '內容' }],
    });
    const result = parseCurationResponse(raw);
    expect(result.officialPicks).toEqual([{ ref: 0, title: '官方', content: '內容' }]);
    expect(result.communityPicks).toEqual([]);
    expect(result.ignoredKeys).toEqual(['externalPicks']);
  });
});

describe('describeIgnoredKeys', () => {
  it('陣列鍵附長度、非陣列鍵附型別，不含回應內容', () => {
    const raw = JSON.stringify({
      officialPicks: [],
      communityPicks: [],
      externalPicks: [{ ref: 1, title: '機密般的標題', content: 'c' }, { ref: 2, title: 't', content: 'c' }],
      note: '說明文字',
    });
    const described = describeIgnoredKeys(raw, ['externalPicks', 'note']);
    expect(described).toBe('externalPicks(陣列 2 則), note(string)');
    expect(described).not.toContain('機密般的標題');
  });

  it('raw 不可解析時退回純鍵名清單', () => {
    expect(describeIgnoredKeys('不是 JSON', ['externalPicks'])).toBe('externalPicks');
  });
});
