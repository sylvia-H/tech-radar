import {
  CurationParseError,
  describeIgnoredKeys,
  describeMalformed,
  parseCurationResponse,
  stripJsonFence,
} from './curation-parse';

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

  it('domain 為三桶之一時保留；缺席、非法值或非字串一律不帶（2026-09-25，未歸類候選回填）', () => {
    const raw =
      '{"officialPicks":[{"ref":0,"title":"a","content":"c","domain":"devops"},{"ref":1,"title":"b","content":"c","domain":"gaming"},{"ref":2,"title":"d","content":"c","domain":3}],' +
      '"communityPicks":[{"ref":3,"title":"e","content":"c"}]}';
    const result = parseCurationResponse(raw);
    expect(result.officialPicks).toEqual([
      { ref: 0, title: 'a', content: 'c', domain: 'devops' },
      { ref: 1, title: 'b', content: 'c' },
      { ref: 2, title: 'd', content: 'c' },
    ]);
    expect('domain' in result.officialPicks[1]).toBe(false);
    expect(result.communityPicks).toEqual([{ ref: 3, title: 'e', content: 'c' }]);
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

  it('ref 為字串（型別不符）→ 不擲錯，該則略過並記入 malformed（2026-10-17，ADR 0006）', () => {
    const raw = '{"officialPicks":[{"ref":"0","title":"t","content":"c"}],"communityPicks":[]}';
    const result = parseCurationResponse(raw);
    expect(result.officialPicks).toEqual([]);
    expect(result.malformed).toEqual([{ key: 'officialPicks', index: 0, shape: '{ref:string,title:string,content:string}' }]);
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

describe('parseCurationResponse — backfillPicks（2026-09-26）', () => {
  it('存在時解析同前兩陣列；不列入 ignoredKeys', () => {
    const raw = '{"officialPicks":[],"communityPicks":[],"backfillPicks":[{"ref":2,"title":"F-Droid 2.0","content":"c"}]}';
    const result = parseCurationResponse(raw);
    expect(result.backfillPicks).toEqual([{ ref: 2, title: 'F-Droid 2.0', content: 'c' }]);
    expect(result.ignoredKeys).toEqual([]);
  });

  it('缺席視為空陣列、不擲錯（不因補位鍵整份降級）', () => {
    const result = parseCurationResponse('{"officialPicks":[],"communityPicks":[]}');
    expect(result.backfillPicks).toEqual([]);
  });

  it('存在但非陣列 → 擲 CurationParseError', () => {
    expect(() => parseCurationResponse('{"officialPicks":[],"communityPicks":[],"backfillPicks":{}}')).toThrow(CurationParseError);
  });
});

describe('parseCurationResponse — 逐則略過形狀不符項（2026-10-17，ADR 0006）', () => {
  it('形狀不符項略過、其餘照常解析；malformed 記陣列鍵、原始索引與形狀（只含鍵名與 typeof）', () => {
    const raw = JSON.stringify({
      officialPicks: [
        { ref: 0, title: '好標題一', content: '好內容一' },
        { ref: 1, title: '壞項標題', domain: 'ai' },
        { ref: 2, title: '好標題二', content: '好內容二' },
        '一段不該在這裡的字串',
      ],
      communityPicks: [null, { ref: 3, title: '好標題三', content: '好內容三' }],
      backfillPicks: [[1, 2], { ref: 4, title: 7, content: '壞內容', note: '附註' }],
    });
    const result = parseCurationResponse(raw);
    expect(result.officialPicks).toEqual([
      { ref: 0, title: '好標題一', content: '好內容一' },
      { ref: 2, title: '好標題二', content: '好內容二' },
    ]);
    expect(result.communityPicks).toEqual([{ ref: 3, title: '好標題三', content: '好內容三' }]);
    expect(result.backfillPicks).toEqual([]);
    expect(result.malformed).toEqual([
      { key: 'officialPicks', index: 1, shape: '{ref:number,title:string,content:缺,domain:string}' },
      { key: 'officialPicks', index: 3, shape: '(string)' },
      { key: 'communityPicks', index: 0, shape: '(null)' },
      { key: 'backfillPicks', index: 0, shape: '(array)' },
      { key: 'backfillPicks', index: 1, shape: '{ref:number,title:number,content:string,note:string}' },
    ]);
    const described = JSON.stringify(result.malformed);
    for (const leaked of ['壞項標題', '一段不該在這裡的字串', '壞內容', '附註']) {
      expect(described).not.toContain(leaked);
    }
  });

  it('全部合規 → malformed 為 []', () => {
    const result = parseCurationResponse('{"officialPicks":[{"ref":0,"title":"t","content":"c"}],"communityPicks":[]}');
    expect(result.malformed).toEqual([]);
  });

  it('病態長鍵名截斷、額外鍵過多只列前 5 個（防鍵名把回應內容帶進 log，憲章 VII）', () => {
    const longKey = '這是一段被模型誤當成鍵名的很長很長的內容文字共有超過二十個字';
    const pick: Record<string, unknown> = { ref: 0, title: 't', [longKey]: 'x' };
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f']) pick[k] = 1;
    const result = parseCurationResponse(JSON.stringify({ officialPicks: [pick], communityPicks: [] }));
    const shape = result.malformed[0].shape;
    expect(shape).toBe(
      `{ref:number,title:string,content:缺,${Array.from(longKey).slice(0, 20).join('')}…:string,a:number,b:number,c:number,d:number,…另 2 鍵}`,
    );
    expect(shape).not.toContain(longKey);
  });
});

describe('parseCurationResponse — 結構性錯誤仍擲錯（2026-10-17，ADR 0006）', () => {
  function reasonOf(raw: string): string {
    try {
      parseCurationResponse(raw);
    } catch (err) {
      if (err instanceof CurationParseError) return err.reason;
      throw err;
    }
    throw new Error('預期擲 CurationParseError');
  }

  it('非合法 JSON：reason 附回應字元數，不含回應內容與 JSON.parse 的錯誤訊息', () => {
    const raw = '{"officialPicks":[{"ref":0,"title":"機密般的半截標題';
    const reason = reasonOf(raw);
    expect(reason).toBe(`非合法 JSON（回應 ${raw.length} 字元）`);
    expect(reason).not.toContain('機密般');
    expect(reason).not.toMatch(/Unexpected|Unterminated|position/i);
  });

  it('頂層非物件（陣列／數字）→ 非合法物件', () => {
    expect(reasonOf('[1,2]')).toBe('非合法物件');
    expect(reasonOf('42')).toBe('非合法物件');
  });

  it('缺必要鍵、某鍵非陣列 → reason 指名鍵', () => {
    expect(reasonOf('{"communityPicks":[]}')).toBe('缺少 officialPicks 欄位');
    expect(reasonOf('{"officialPicks":[],"communityPicks":{}}')).toBe('communityPicks 非陣列');
  });
});

describe('describeMalformed（2026-10-17，ADR 0006）', () => {
  it('格式為「鍵[索引]形狀」以逗號分隔', () => {
    expect(
      describeMalformed([
        { key: 'officialPicks', index: 3, shape: '{ref:string,title:string,content:缺}' },
        { key: 'communityPicks', index: 0, shape: '(string)' },
      ]),
    ).toBe('officialPicks[3]{ref:string,title:string,content:缺}, communityPicks[0](string)');
  });

  it('空陣列 → 空字串', () => {
    expect(describeMalformed([])).toBe('');
  });
});
