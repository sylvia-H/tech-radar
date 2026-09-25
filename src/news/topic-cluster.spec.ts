import { NewsCandidate } from './news.types';
import { CLUSTER_MIN_ITEMS, CLUSTER_MIN_SOURCES, detectTopicClusters, summarizeClusters } from './topic-cluster';

function cand(over: Partial<NewsCandidate> & { title: string; normalizedUrl: string }): NewsCandidate {
  return {
    originalUrl: `https://${over.normalizedUrl}`,
    summary: null,
    sourceId: 'hn',
    score: 300,
    domain: 'ai',
    tier: 1,
    sources: ['hn'],
    publishedAt: '2026-09-24T00:00:00.000Z',
    weightedScore: 300,
    ...over,
  };
}

describe('detectTopicClusters（同題群集，2026-09-25）', () => {
  it('常數：至少 3 則、至少 2 個來源', () => {
    expect(CLUSTER_MIN_ITEMS).toBe(3);
    expect(CLUSTER_MIN_SOURCES).toBe(2);
  });

  it('同一罕見詞跨 ≥2 來源出現 ≥3 則 → 每則都標上該群集（2026-09-25 候選池的 Jev 情境）', () => {
    const cands = [
      cand({ title: 'Jev in 25 Lines of Python', normalizedUrl: 'nobodywho.ai/posts/jev-in-25-lines', domain: 'frontend-backend' }),
      cand({ title: 'OpenAI is well positioned to fast-follow Jev', normalizedUrl: 'arcturus-labs.com/blog/jev' }),
      cand({
        title: 'Jev introduces a new shape of LLM - System One, aka Decision Models',
        normalizedUrl: 'simonwillison.net/2026/sep/21/jev',
        sourceId: 'simonwillison',
        sources: ['simonwillison'],
        score: null,
      }),
      cand({
        title: "Jev isn't new tech. Its marketing targets people who think AI started with LLMs.",
        normalizedUrl: 'reddit.com/r/localllama/comments/1',
        sourceId: 'reddit-localllama',
        sources: ['reddit-localllama'],
        score: null,
      }),
      cand({ title: 'Kubernetes v1.37: PVC last used time', normalizedUrl: 'kubernetes.io/blog/pvc', sourceId: 'kubernetes-blog', sources: ['kubernetes-blog'], domain: 'devops' }),
    ];

    const clusters = detectTopicClusters(cands);

    const jev = { token: 'jev', count: 4, sourceCount: 3 };
    expect(clusters.get('nobodywho.ai/posts/jev-in-25-lines')).toEqual(jev);
    expect(clusters.get('arcturus-labs.com/blog/jev')).toEqual(jev);
    expect(clusters.get('simonwillison.net/2026/sep/21/jev')).toEqual(jev);
    expect(clusters.get('reddit.com/r/localllama/comments/1')).toEqual(jev);
    expect(clusters.has('kubernetes.io/blog/pvc')).toBe(false);
    expect(summarizeClusters(clusters)).toEqual([jev]);
  });

  it('只有 2 則 → 不成群集；3 則但全部同一來源 → 不成群集（單站主題週不算）', () => {
    const two = [
      cand({ title: 'Zorblax model released', normalizedUrl: 'a.com/1' }),
      cand({ title: 'Zorblax benchmark results', normalizedUrl: 'b.com/2', sourceId: 'lobsters-ai', sources: ['lobsters-ai'] }),
    ];
    expect(detectTopicClusters(two).size).toBe(0);

    const sameSource = [
      cand({ title: 'Zorblax model released', normalizedUrl: 'a.com/1' }),
      cand({ title: 'Zorblax benchmark results', normalizedUrl: 'b.com/2' }),
      cand({ title: 'Zorblax is not new tech', normalizedUrl: 'c.com/3' }),
    ];
    expect(detectTopicClusters(sameSource).size).toBe(0);
  });

  it('來源數以候選 sources 聯集計：URL 合併後帶兩個來源的一則，可讓群集達到來源門檻', () => {
    const cands = [
      cand({ title: 'Zorblax model released', normalizedUrl: 'a.com/1', sources: ['hn', 'openai-blog'] }),
      cand({ title: 'Zorblax benchmark results', normalizedUrl: 'b.com/2' }),
      cand({ title: 'Zorblax is not new tech', normalizedUrl: 'c.com/3' }),
    ];
    expect(detectTopicClusters(cands).get('a.com/1')).toEqual({ token: 'zorblax', count: 3, sourceCount: 2 });
  });

  it('泛用詞、三桶關鍵字、人人皆知的產品名不成群集（copilot／kubernetes／models／release）', () => {
    const cands = [
      cand({ title: 'Copilot code review: new models available', normalizedUrl: 'a.com/1', sourceId: 'github-changelog-copilot', sources: ['github-changelog-copilot'] }),
      cand({ title: 'Copilot models release notes', normalizedUrl: 'b.com/2' }),
      cand({ title: 'Why Copilot models matter', normalizedUrl: 'c.com/3', sourceId: 'lobsters-ai', sources: ['lobsters-ai'] }),
      cand({ title: 'Kubernetes release', normalizedUrl: 'd.com/4', sourceId: 'kubernetes-blog', sources: ['kubernetes-blog'] }),
      cand({ title: 'Kubernetes models', normalizedUrl: 'e.com/5' }),
      cand({ title: 'Kubernetes rocks', normalizedUrl: 'f.com/6', sourceId: 'cncf-blog', sources: ['cncf-blog'] }),
    ];
    expect(detectTopicClusters(cands).size).toBe(0);
  });

  it('過短 token（≤2 字元）與數字開頭 token 不成群集', () => {
    const cands = [
      cand({ title: 'Go 1.27 is out', normalizedUrl: 'a.com/1' }),
      cand({ title: 'Go 1.27 generics', normalizedUrl: 'b.com/2', sourceId: 'lobsters-programming', sources: ['lobsters-programming'] }),
      cand({ title: 'Go 1.27 benchmarks', normalizedUrl: 'c.com/3', sourceId: 'reddit-localllama', sources: ['reddit-localllama'] }),
    ];
    expect(detectTopicClusters(cands).size).toBe(0);
  });

  it('一則命中多個群集時取 count 最大者；同 count 取字母序最小', () => {
    const cands = [
      cand({ title: 'Alpha Zorblax launch', normalizedUrl: 'a.com/1' }),
      cand({ title: 'Zorblax vs Quux', normalizedUrl: 'b.com/2', sourceId: 'lobsters-ai', sources: ['lobsters-ai'] }),
      cand({ title: 'Zorblax deep dive', normalizedUrl: 'c.com/3', sourceId: 'reddit-localllama', sources: ['reddit-localllama'] }),
      cand({ title: 'Zorblax on Quux hardware', normalizedUrl: 'd.com/4' }),
      cand({ title: 'Quux chips explained', normalizedUrl: 'e.com/5', sourceId: 'lobsters-ai', sources: ['lobsters-ai'] }),
    ];
    const clusters = detectTopicClusters(cands);
    // zorblax ×4、quux ×3 → 同時命中兩者的 b.com/2 與 d.com/4 取 zorblax
    expect(clusters.get('b.com/2')?.token).toBe('zorblax');
    expect(clusters.get('d.com/4')?.token).toBe('zorblax');
    expect(clusters.get('e.com/5')).toEqual({ token: 'quux', count: 3, sourceCount: 2 });
    expect(summarizeClusters(clusters).map((c) => c.token)).toEqual(['zorblax', 'quux']);
  });

  it('空候選 → 空 map', () => {
    expect(detectTopicClusters([]).size).toBe(0);
  });
});
