import { buildMaterial } from './intro-material';
import { IntroInput } from './intro.types';

function makeInput(overrides: Partial<IntroInput> = {}): IntroInput {
  return {
    repoId: 1,
    fullName: 'owner/repo',
    description: 'A sample repo',
    language: 'TypeScript',
    topics: ['cli', 'tooling'],
    starsThisWeek: 42,
    ...overrides,
  };
}

describe('buildMaterial', () => {
  it('README 去雜訊後足夠長時使用 README 分支', () => {
    const readme = '# 標題\n' + 'x'.repeat(300);
    const result = buildMaterial(makeInput(), readme);
    expect(result.source).toBe('readme');
    expect(result.sparse).toBe(false);
    expect(result.text.startsWith('# 標題')).toBe(true);
  });

  it('README 截斷至 MAX_README_CHARS（6000）', () => {
    const readme = 'x'.repeat(10_000);
    const result = buildMaterial(makeInput(), readme);
    expect(result.source).toBe('readme');
    expect([...result.text].length).toBe(6000);
  });

  it('README 取不到（空字串）→ 退回 description+topics', () => {
    const input = makeInput({ description: 'A sample repo', topics: ['cli'] });
    const result = buildMaterial(input, '');
    expect(result.source).toBe('fallback');
    expect(result.sparse).toBe(false);
    expect(result.text).toContain('A sample repo');
    expect(result.text).toContain('cli');
  });

  it('README 去雜訊後 < MIN_README_CHARS（極短）→ 退回 description+topics', () => {
    const shortReadme = '簡短';
    const result = buildMaterial(makeInput(), shortReadme);
    expect(result.source).toBe('fallback');
  });

  it('description 與 topics 皆近乎空 → sparse=true', () => {
    const input = makeInput({ description: null, topics: [] });
    const result = buildMaterial(input, '');
    expect(result.source).toBe('fallback');
    expect(result.sparse).toBe(true);
    expect(result.text).toBe('');
  });

  it('description 或 topics 任一有內容則 sparse=false', () => {
    const input = makeInput({ description: null, topics: ['cli'] });
    const result = buildMaterial(input, '');
    expect(result.sparse).toBe(false);
  });
});
