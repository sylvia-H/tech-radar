import { NewsDomain3 } from '../news/news.types';
import { clampNonAi, clampSourceDiversity, isAi, MAX_ITEMS, MAX_NON_AI, MAX_PER_SOURCE_NON_AI } from './curation-quota';

interface Item {
  id: string;
  domain: NewsDomain3;
}

interface SourcedItem extends Item {
  sources: string[];
}

const domainOf = (it: Item) => it.domain;
const sourcesOf = (it: SourcedItem) => it.sources;

describe('isAi', () => {
  it('ai → true；devops/frontend-backend → false（research D4）', () => {
    expect(isAi('ai')).toBe(true);
    expect(isAi('devops')).toBe(false);
    expect(isAi('frontend-backend')).toBe(false);
  });
});

describe('常數', () => {
  it('MAX_ITEMS=10、MAX_NON_AI=3（憲章 III）', () => {
    expect(MAX_ITEMS).toBe(10);
    expect(MAX_NON_AI).toBe(3);
  });
});

describe('clampNonAi', () => {
  it('非 AI ≤3 時原樣返回（不觸發夾制）', () => {
    const items: Item[] = [
      { id: 'a', domain: 'ai' },
      { id: 'b', domain: 'devops' },
      { id: 'c', domain: 'frontend-backend' },
      { id: 'd', domain: 'devops' },
    ];
    expect(clampNonAi(items, domainOf)).toEqual(items);
  });

  it('AI 不受限：AI 數量不論多少皆保留', () => {
    const items: Item[] = Array.from({ length: 5 }, (_, i) => ({ id: `ai${i}`, domain: 'ai' as const }));
    expect(clampNonAi(items, domainOf)).toEqual(items);
  });

  it('依領域優先序（DevOps 優先）保留前 3、其餘剔除，AI 不受影響（FR-004/010）', () => {
    const items: Item[] = [
      { id: 'ai1', domain: 'ai' },
      { id: 'fe1', domain: 'frontend-backend' },
      { id: 'devops1', domain: 'devops' },
      { id: 'fe2', domain: 'frontend-backend' },
      { id: 'devops2', domain: 'devops' },
    ];
    const out = clampNonAi(items, domainOf);
    // DevOps 優先 → devops1/devops2 保留，第 3 名額給 frontend-backend 依序取 fe1；fe2 剔除（3 名額已滿）
    expect(out.map((it) => it.id)).toEqual(['ai1', 'fe1', 'devops1', 'devops2']);
  });

  it('devops 本身超過上限時，同領域內依原順序（重要性序）只保留前 3', () => {
    const items: Item[] = [
      { id: 'devops1', domain: 'devops' },
      { id: 'devops2', domain: 'devops' },
      { id: 'devops3', domain: 'devops' },
      { id: 'devops4', domain: 'devops' },
    ];
    const out = clampNonAi(items, domainOf);
    expect(out.map((it) => it.id)).toEqual(['devops1', 'devops2', 'devops3']);
  });

  it('保留原相對順序（不重排 AI 與夾制後的非 AI）', () => {
    const items: Item[] = [
      { id: 'fe1', domain: 'frontend-backend' },
      { id: 'ai1', domain: 'ai' },
      { id: 'devops1', domain: 'devops' },
      { id: 'fe2', domain: 'frontend-backend' },
      { id: 'fe3', domain: 'frontend-backend' },
    ];
    const out = clampNonAi(items, domainOf);
    // 非 AI 有 fe1/devops1/fe2/fe3 四則超過 3 → devops1 優先、frontend-backend 依序取 2 則(fe1/fe2)
    expect(out.map((it) => it.id)).toEqual(['fe1', 'ai1', 'devops1', 'fe2']);
  });
});

describe('常數：MAX_PER_SOURCE_NON_AI', () => {
  it('MAX_PER_SOURCE_NON_AI=2', () => {
    expect(MAX_PER_SOURCE_NON_AI).toBe(2);
  });
});

describe('clampSourceDiversity', () => {
  it('非 AI 候選池 ≤MAX_NON_AI 時不生效，同來源再多也原樣返回（2026-08-04 決策：候選不足時不特別限制）', () => {
    const items: SourcedItem[] = [
      { id: 'cf1', domain: 'devops', sources: ['cloudflare-blog'] },
      { id: 'cf2', domain: 'devops', sources: ['cloudflare-blog'] },
      { id: 'cf3', domain: 'devops', sources: ['cloudflare-blog'] },
    ];
    // nonAiPoolSize=3 = MAX_NON_AI，未超過門檻
    expect(clampSourceDiversity(items, domainOf, sourcesOf, 3)).toEqual(items);
  });

  it('非 AI 候選池 >MAX_NON_AI 時生效，同一來源累計達上限即剔除多餘者、不遞補', () => {
    const items: SourcedItem[] = [
      { id: 'cf1', domain: 'devops', sources: ['cloudflare-blog'] },
      { id: 'cf2', domain: 'devops', sources: ['cloudflare-blog'] },
      { id: 'cf3', domain: 'devops', sources: ['cloudflare-blog'] },
    ];
    // nonAiPoolSize=4 > MAX_NON_AI(3) → 生效，同來源上限 2
    const out = clampSourceDiversity(items, domainOf, sourcesOf, 4);
    expect(out.map((it) => it.id)).toEqual(['cf1', 'cf2']);
  });

  it('AI 項目不受影響、不計入來源計數', () => {
    const items: SourcedItem[] = [
      { id: 'ai1', domain: 'ai', sources: ['cloudflare-blog'] },
      { id: 'cf1', domain: 'devops', sources: ['cloudflare-blog'] },
      { id: 'cf2', domain: 'devops', sources: ['cloudflare-blog'] },
      { id: 'cf3', domain: 'devops', sources: ['cloudflare-blog'] },
    ];
    const out = clampSourceDiversity(items, domainOf, sourcesOf, 4);
    expect(out.map((it) => it.id)).toEqual(['ai1', 'cf1', 'cf2']);
  });

  it('不同來源各自計數、互不影響，保留原相對順序', () => {
    const items: SourcedItem[] = [
      { id: 'cf1', domain: 'devops', sources: ['cloudflare-blog'] },
      { id: 'cncf1', domain: 'devops', sources: ['cncf-blog'] },
      { id: 'cf2', domain: 'devops', sources: ['cloudflare-blog'] },
      { id: 'cf3', domain: 'devops', sources: ['cloudflare-blog'] },
      { id: 'cncf2', domain: 'devops', sources: ['cncf-blog'] },
    ];
    const out = clampSourceDiversity(items, domainOf, sourcesOf, 5);
    expect(out.map((it) => it.id)).toEqual(['cf1', 'cncf1', 'cf2', 'cncf2']);
  });
});
