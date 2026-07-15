import { ClassifyService } from './classify.service';

describe('ClassifyService', () => {
  const svc = new ClassifyService();

  describe('topics 為主要訊號（詞界比對）', () => {
    it('topics 明確命中 → 歸對領域', () => {
      expect(svc.classify({ topics: ['machine-learning'], description: null })).toBe('ai');
      expect(svc.classify({ topics: ['react'], description: null })).toBe('frontend-backend');
    });

    it('topics 以連字號為界寬鬆命中（ai-agents → ai）', () => {
      expect(svc.classify({ topics: ['ai-agents'], description: null })).toBe('ai');
      expect(svc.classify({ topics: ['react-native'], description: null })).toBe('frontend-backend');
    });

    it('短關鍵字不誤命中含該字母序列的一般 topic（SC-002）', () => {
      // 子字串比對時 'blockchain'.includes('ai') 為真 → 區塊鏈專案被 AI 最高優先序吃掉
      expect(svc.classify({ topics: ['blockchain', 'solidity'], description: null })).toBeNull();
      expect(svc.classify({ topics: ['domain-driven-design'], description: null })).toBeNull();
      expect(svc.classify({ topics: ['training', 'email'], description: null })).toBeNull();
      expect(svc.classify({ topics: ['drag-and-drop'], description: null })).toBeNull();
    });

    it('詞界接不到的黏著變體由種子集 extra 群涵蓋', () => {
      expect(svc.classify({ topics: ['openai'], description: null })).toBe('ai');
      expect(svc.classify({ topics: ['genai'], description: null })).toBe('ai');
      expect(svc.classify({ topics: ['agents'], description: null })).toBe('ai');
      expect(svc.classify({ topics: ['llms'], description: null })).toBe('ai');
      expect(svc.classify({ topics: ['chatgpt'], description: null })).toBe('ai');
      expect(svc.classify({ topics: ['reactjs'], description: null })).toBe('frontend-backend');
      expect(svc.classify({ topics: ['sveltekit'], description: null })).toBe('frontend-backend');
    });

    it('榜單已無 DevOps 領域：僅靠部署/維運標籤命中者一律排除', () => {
      // 2026-07-15 移除 DevOps 榜；docker 這類「部署方式」標籤不再讓候選入榜
      expect(svc.classify({ topics: ['docker', 'steam', 'gameserver'], description: null })).toBeNull();
      expect(svc.classify({ topics: ['kubernetes', 'terraform', 'gitops'], description: null })).toBeNull();
      expect(svc.classify({ topics: ['docker-compose', 'observability'], description: null })).toBeNull();
    });

    it('原被 docker 錯置到 DevOps 的前後端專案，現歸前後端', () => {
      // teledrive 的真實 topics：曾因 docker 命中 devops、又被優先序搶走而錯置
      expect(
        svc.classify({
          topics: ['react', 'python', 'docker', 'open-source', 'typescript', 'telegram', 'vite', 'fastapi'],
          description: null,
        }),
      ).toBe('frontend-backend');
    });

    it('topics 非空但無命中 → 排除（不 fallback description）', () => {
      // description 含 llm/agent，但因 topics 非空只看 topics，cooking 無命中 → null
      expect(svc.classify({ topics: ['cooking'], description: 'an llm agent framework' })).toBeNull();
    });
  });

  describe('無 topics 時改用 description（詞界比對）', () => {
    it('description 詞界命中（AI-powered → ai）', () => {
      expect(svc.classify({ topics: [], description: 'An AI-powered assistant' })).toBe('ai');
    });

    it('短關鍵字不誤命中一般字詞（ai 不命中 domain／chain）', () => {
      expect(svc.classify({ topics: [], description: 'domain chain logic library' })).toBeNull();
    });

    it('description 命中前後端關鍵字', () => {
      expect(svc.classify({ topics: [], description: 'a fastify plugin for nodejs' })).toBe('frontend-backend');
    });

    it('description 只提 DevOps 語彙 → 排除（榜單已無此領域）', () => {
      expect(svc.classify({ topics: [], description: 'a gitops controller for kubernetes' })).toBeNull();
    });
  });

  describe('language 不參與歸類', () => {
    it('無 topics 且 description 無關鍵字命中 → 排除（語言相符不救場）', () => {
      // 「以 Rust 寫的通用工具」：rust 非任何領域關鍵字 → 不歸類
      expect(svc.classify({ topics: [], description: 'a fast general-purpose tool written in rust' })).toBeNull();
    });
  });

  describe('跨領域擇一主領域（固定優先序 AI > 前後端）', () => {
    it('AI + 前後端 同時命中 → AI', () => {
      expect(svc.classify({ topics: ['llm', 'react'], description: null })).toBe('ai');
      expect(svc.classify({ topics: ['typescript', 'openai'], description: null })).toBe('ai');
    });
  });

  it('topics 與 description 皆無命中 → null', () => {
    expect(svc.classify({ topics: ['gardening'], description: 'grow tomatoes' })).toBeNull();
    expect(svc.classify({ topics: [], description: null })).toBeNull();
  });
});
