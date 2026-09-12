import { buildCurationPrompt } from './curation-prompt';
import { MAX_ITEMS } from './curation-quota';
import { CurationItemView } from './curation.types';

function makeView(overrides: Partial<CurationItemView> = {}): CurationItemView {
  return {
    ref: 0,
    title: 'Original Title',
    domain: 'ai',
    tier: 1,
    score: 100,
    sourceCount: 1,
    onBoard: false,
    summaryExcerpt: null,
    ageDays: 1,
    ...overrides,
  };
}

/** 擷取 `startMarker` 到其後第一個 `endMarker` 之間的文字；任一標記找不到則回傳 null（斷言交給測試本體）。 */
function sliceBetween(prompt: string, startMarker: string, endMarker: string): string | null {
  const start = prompt.indexOf(startMarker);
  if (start < 0) return null;
  const end = prompt.indexOf(endMarker, start);
  if (end < 0) return null;
  return prompt.slice(start, end);
}

/** 候選投影區：「候選清單（」到「候選標記說明」之間（唯一合法出現候選數字的區塊）。 */
function projectionBlock(prompt: string): string | null {
  return sliceBetween(prompt, '候選清單（', '候選標記說明');
}

/** 配額段落：「配額（」到「候選清單（」之間。 */
function quotaBlock(prompt: string): string | null {
  return sliceBetween(prompt, '配額（', '候選清單（');
}

/** 「不算重大」排除清單：「- 不算重大」到「不要因為候選池今天特別多」之間。 */
function exclusionBlock(prompt: string): string | null {
  return sliceBetween(prompt, '- 不算重大', '不要因為候選池今天特別多');
}

/** 輸出規則區：「輸出規則：」之後到結尾。 */
function outputRules(prompt: string): string | null {
  const start = prompt.indexOf('輸出規則：');
  return start < 0 ? null : prompt.slice(start);
}

/** 去掉候選投影區後的 prompt 指令本文（用於全文數字白名單）。 */
function withoutProjection(prompt: string): string | null {
  const block = projectionBlock(prompt);
  return block === null ? null : prompt.replace(block, '');
}

describe('buildCurationPrompt（候選投影）', () => {
  it('候選逐行投影：在榜標記、分數／天齡、摘要行只在有摘要的候選出現（FR-001／2026-09-02 天齡）', () => {
    const prompt = buildCurationPrompt([
      makeView({
        ref: 0,
        title: 'Model X released',
        domain: 'ai',
        tier: 1,
        score: 123,
        sourceCount: 2,
        onBoard: true,
        summaryExcerpt: '官方公告摘要',
        ageDays: 3,
      }),
      makeView({
        ref: 1,
        title: 'Some RSS post',
        domain: 'devops',
        tier: 2,
        score: null,
        sourceCount: 1,
        onBoard: false,
        summaryExcerpt: null,
        ageDays: null,
      }),
    ]);

    expect(prompt).toContain('[0] ★在榜 (ai/tier1/分數 123/2 來源/3 天前) Model X released');
    expect(prompt).toContain('[1] (devops/tier2/分數 無/1 來源/日期不明) Some RSS post');
    expect(prompt).toMatch(/\[0\] .*\n {4}摘要：官方公告摘要\n\[1\] /);
    expect(prompt).not.toContain('[1] ★在榜');
    expect(prompt).not.toContain('（無候選）');

    const projection = projectionBlock(prompt);
    expect(projection).not.toBeNull();
    expect((projection ?? '').match(/摘要：/g)).toHaveLength(1);
  });

  it('空候選時清單處顯示「（無候選）」', () => {
    const prompt = buildCurationPrompt([]);

    expect(prompt).toContain('（無候選）');
    expect(prompt).not.toMatch(/^\[\d+\] /m);
  });
});

describe('buildCurationPrompt（判準措辭，2026-09-12 社群熱度限縮）', () => {
  const prompt = buildCurationPrompt([makeView()]);

  it('(2)【技術深度內容】要求內容本身具技術／實作／工具面向', () => {
    expect(prompt).toMatch(/【技術深度內容】[\s\S]{0,300}技術／實作／工具面向/);
  });

  it('(2)【技術深度內容】把社群熱度定位為加分訊號、非必要條件', () => {
    expect(prompt).toMatch(/【技術深度內容】[\s\S]{0,400}加分訊號/);
  });

  it('(3)【影響開發者的外部事件】自成一類，且明列監管政策與當機', () => {
    expect(prompt).toMatch(/【影響開發者的外部事件】[\s\S]{0,400}監管政策/);
    expect(prompt).toMatch(/【影響開發者的外部事件】[\s\S]{0,400}當機/);
  });

  it('「不算重大」清單明列募資、人事、訴訟、與軟體開發無關的趣聞、廠商認證', () => {
    const section = exclusionBlock(prompt);
    expect(section).not.toBeNull();

    expect(section).toContain('募資');
    expect(section).toContain('人事');
    expect(section).toContain('訴訟');
    expect(section).toContain('與軟體開發無關的趣聞');
    expect(section).toContain('廠商認證');
  });

  it('「不算重大」清單以 (3) 為準，且訴訟例外：已生效判決依 (3) 收錄', () => {
    const section = exclusionBlock(prompt);
    expect(section).not.toBeNull();

    expect(section).toContain('以 (3) 為準');
    expect(section).toMatch(/已生效\s*判決/);
  });

  it('輸出規則：(1)(3) 歸入 officialPicks、(2) 歸入 communityPicks', () => {
    const rules = outputRules(prompt);
    expect(rules).not.toBeNull();

    expect(rules).toMatch(/\(1\)[\s\S]{0,120}\(3\)[\s\S]{0,120}`officialPicks`/);
    expect(rules).toMatch(/\(2\)[\s\S]{0,120}`communityPicks`/);
  });

  it('輸出規則：只能有兩個鍵、兩個鍵都必須存在、不得新增其他鍵', () => {
    const rules = outputRules(prompt);
    expect(rules).not.toBeNull();

    expect(rules).toContain('兩個鍵都必須存在');
    expect(rules).toContain('不得新增其他鍵');
  });

  it('內容改寫只依候選標題與摘要，不得補充來源未提供的事實（憲章 VI）', () => {
    expect(prompt).toContain('不得補充來源未提供的事實');
  });
});

describe('buildCurationPrompt（錨定防線，dev-guide §12）', () => {
  const prompt = buildCurationPrompt([makeView()]);
  const allowedNumbers = new Set(['70', '500', String(MAX_ITEMS)]);

  it('候選投影區以外的全文，阿拉伯數字只允許 70／500／MAX_ITEMS（避免 LLM 數字錨定）', () => {
    const body = withoutProjection(prompt);
    expect(body).not.toBeNull();

    // (1)(2)(3) 為判準類別編號、非數量，先剝除再檢查；並確認編號只有 1～3。
    const categoryMarks = (body ?? '').match(/\((\d+)\)/g) ?? [];
    for (const mark of categoryMarks) {
      expect(['(1)', '(2)', '(3)']).toContain(mark);
    }
    const stripped = (body ?? '').replace(/\(\d+\)/g, '');

    const numbers = stripped.match(/\d+/g) ?? [];
    expect(numbers.length).toBeGreaterThan(0);
    for (const n of numbers) {
      expect(allowedNumbers.has(n)).toBe(true);
    }
  });

  it('配額段落含 MAX_ITEMS，且除此之外不得出現其他阿拉伯數字', () => {
    const block = quotaBlock(prompt);
    expect(block).not.toBeNull();

    expect(block).toContain(`最多 ${MAX_ITEMS} 則`);
    expect((block ?? '').replace(new RegExp(String(MAX_ITEMS), 'g'), '')).not.toMatch(/\d/);
  });

  it('整份 prompt 不含「至少 N 則」「不少於 N 則」「N 則以上」等下限句', () => {
    expect(prompt).not.toMatch(/至少\s*\d+\s*則/);
    expect(prompt).not.toMatch(/不少於\s*\d+\s*則/);
    expect(prompt).not.toMatch(/\d+\s*則以上/);
  });
});

describe('buildCurationPrompt（格式約束）', () => {
  const prompt = buildCurationPrompt([makeView()]);

  it('明示繁中字數上限 ≤70／≤500、兩陣列鍵名與總數上限 MAX_ITEMS', () => {
    expect(prompt).toContain('≤70 字');
    expect(prompt).toContain('≤500 字');
    expect(prompt).toContain('officialPicks');
    expect(prompt).toContain('communityPicks');
    expect(prompt).toContain(`最多 ${MAX_ITEMS} 則`);
  });

  it('禁止 LLM 回傳連結等事實數據（憲章 VI）', () => {
    expect(prompt).toContain('不得回傳連結');
  });
});
