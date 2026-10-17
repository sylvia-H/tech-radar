import { NewsCandidate } from '../news/news.types';
import { CurationParseError } from './curation-parse';
import {
  buildReplayDigest,
  buildReplayTranslationPrompt,
  parseReplayTranslation,
  REPLAY_TRANSLATION_JSON_SCHEMA,
} from './replay-translation';

function cand(overrides: Partial<NewsCandidate> = {}): NewsCandidate {
  return {
    title: 'Claude Haiku 5.5',
    normalizedUrl: 'https://a.com/1',
    originalUrl: 'https://a.com/1',
    summary: null,
    sourceId: 'hn',
    score: null,
    domain: 'ai',
    tier: 1,
    sources: ['hn'],
    publishedAt: null,
    weightedScore: 2,
    ...overrides,
  };
}

describe('replay-translation — 晨報補發只翻譯不篩選（2026-10-17）', () => {
  it('prompt 列出每則 ref 與原始標題、明示不篩選不重排，不含 URL', () => {
    const prompt = buildReplayTranslationPrompt([
      cand(),
      cand({ title: 'GPT‑6 and Intelligent UI for everyone', normalizedUrl: 'https://a.com/2', originalUrl: 'https://a.com/2' }),
      cand({ title: 'Some general item', domain: 'cross' }),
    ]);
    expect(prompt).toContain('[0] (ai) Claude Haiku 5.5');
    expect(prompt).toContain('[1] (ai) GPT‑6 and Intelligent UI for everyone');
    expect(prompt).toContain('[2] (一般軟體工程／資安) Some general item');
    expect(prompt).toContain('不篩選、不合併、不重排');
    expect(prompt).not.toContain('https://');
  });

  it('schema：items 陣列必填，每則 ref／title／content 必填', () => {
    const schema = REPLAY_TRANSLATION_JSON_SCHEMA as {
      required: string[];
      properties: { items: { items: { required: string[] } } };
    };
    expect(schema.required).toEqual(['items']);
    expect(schema.properties.items.items.required).toEqual(['ref', 'title', 'content']);
  });

  it('parse：合法項收下；形狀不符、越界、重複 ref 略過並計數', () => {
    const raw = JSON.stringify({
      items: [
        { ref: 0, title: '甲', content: '甲內容' },
        { ref: 0, title: '重複', content: 'x' },
        { ref: 5, title: '越界', content: 'x' },
        { ref: 1, title: '缺內容' },
        'oops',
      ],
    });
    const { picks, skipped } = parseReplayTranslation(raw, 2);
    expect([...picks.entries()]).toEqual([[0, { title: '甲', content: '甲內容' }]]);
    expect(skipped).toBe(4);
  });

  it('parse：容許 code fence；非 JSON 擲 CurationParseError，reason 帶字元數不帶內容', () => {
    expect(parseReplayTranslation('```json\n{"items":[]}\n```', 1).picks.size).toBe(0);
    const bad = '{"items": [ 機密內容';
    try {
      parseReplayTranslation(bad, 1);
      throw new Error('should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CurationParseError);
      expect((err as CurationParseError).reason).toBe(`非合法 JSON（回應 ${bad.length} 字元）`);
      expect((err as Error).message).not.toContain('機密內容');
    }
    expect(() => parseReplayTranslation('{"foo":[]}', 1)).toThrow('items 非陣列或缺席');
    expect(() => parseReplayTranslation('[]', 1)).toThrow('非合法物件');
  });

  it('digest：順序與則數同候選；有翻譯者套字數上限、未回者保留原文標題 degraded；cross 還原為 general；事實欄位由程式帶入', () => {
    const cands = [
      cand(),
      cand({ title: 'Untranslated', normalizedUrl: 'https://a.com/2', originalUrl: 'https://a.com/2', weightedScore: 1, domain: 'cross', sources: ['hn', 'lobsters-programming'] }),
    ];
    const longTitle = '長'.repeat(80);
    const digest = buildReplayDigest(cands, new Map([[0, { title: longTitle, content: '說明' }]]));
    expect(digest.degraded).toBe(false);
    expect(digest.items).toHaveLength(2);
    expect(Array.from(digest.items[0].title).length).toBeLessThanOrEqual(70);
    expect(digest.items[0]).toEqual(
      expect.objectContaining({ content: '說明', degraded: false, url: 'https://a.com/1', domain: 'ai', sourceTitle: 'Claude Haiku 5.5' }),
    );
    expect(digest.items[1]).toEqual(
      expect.objectContaining({ title: 'Untranslated', content: null, degraded: true, domain: 'general', sourceCount: 2 }),
    );
  });

  it('digest：全部未回 → 整份 degraded；空候選 → 空且不 degraded', () => {
    expect(buildReplayDigest([cand()], new Map()).degraded).toBe(true);
    expect(buildReplayDigest([], new Map())).toEqual({ items: [], degraded: false });
  });
});
