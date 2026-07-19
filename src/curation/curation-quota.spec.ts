import { NewsDomain3 } from '../news/news.types';
import { clampNonAi, isAi, MAX_ITEMS, MAX_NON_AI, MIN_AI } from './curation-quota';

interface Item {
  id: string;
  domain: NewsDomain3;
}

const domainOf = (it: Item) => it.domain;

describe('isAi', () => {
  it('ai → true；devops/frontend-backend → false（research D4）', () => {
    expect(isAi('ai')).toBe(true);
    expect(isAi('devops')).toBe(false);
    expect(isAi('frontend-backend')).toBe(false);
  });
});

describe('常數', () => {
  it('MAX_ITEMS=10、MAX_NON_AI=3、MIN_AI=5（憲章 III）', () => {
    expect(MAX_ITEMS).toBe(10);
    expect(MAX_NON_AI).toBe(3);
    expect(MIN_AI).toBe(5);
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
