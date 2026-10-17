import { buildCurationPrompt } from './curation-prompt';
import { CURATION_RESPONSE_JSON_SCHEMA } from './curation-schema';

const PICK_KEYS = ['officialPicks', 'communityPicks', 'backfillPicks'] as const;

interface ItemSchemaShape {
  type: string;
  properties: Record<string, { type: string; enum?: string[] }>;
  required: string[];
}

interface ResponseSchemaShape {
  type: string;
  properties: Record<string, { type: string; items: ItemSchemaShape }>;
  required: string[];
}

const schema = CURATION_RESPONSE_JSON_SCHEMA as unknown as ResponseSchemaShape;

describe('CURATION_RESPONSE_JSON_SCHEMA（2026-10-17，ADR 0006：與 prompt 輸出規則同步）', () => {
  const prompt = buildCurationPrompt([]);

  it('頂層為 object，三個陣列鍵皆列為 required——對應 prompt「三個鍵都必須存在」', () => {
    expect(schema.type).toBe('object');
    expect([...schema.required].sort()).toEqual([...PICK_KEYS].sort());
    expect(Object.keys(schema.properties).sort()).toEqual([...PICK_KEYS].sort());
    expect(prompt).toContain('三個鍵都必須存在');
    for (const key of PICK_KEYS) {
      expect(prompt).toContain(`"${key}"`);
      expect(schema.properties[key].type).toBe('array');
    }
  });

  it('每則 required 為 ref／title／content，型別 integer／string／string；domain 選填、enum 為三桶', () => {
    for (const key of PICK_KEYS) {
      const item = schema.properties[key].items;
      expect(item.type).toBe('object');
      expect(item.required).toEqual(['ref', 'title', 'content']);
      expect(item.properties.ref.type).toBe('integer');
      expect(item.properties.title.type).toBe('string');
      expect(item.properties.content.type).toBe('string');
      expect(item.properties.domain.enum).toEqual(['ai', 'devops', 'frontend-backend']);
    }
    expect(prompt).toContain('每則物件的鍵為 "ref"、"title"、"content"');
    expect(prompt).toContain('ai、devops、frontend-backend 三者之一');
  });

  it('只用保守子集關鍵字（不含 additionalProperties 等）', () => {
    const allowed = new Set(['type', 'properties', 'required', 'items', 'enum', 'description']);
    const visit = (node: unknown, isPropertiesMap: boolean): void => {
      if (typeof node !== 'object' || node === null || Array.isArray(node)) return;
      for (const [k, v] of Object.entries(node)) {
        if (!isPropertiesMap) expect(allowed.has(k)).toBe(true);
        visit(v, !isPropertiesMap && k === 'properties');
      }
    };
    visit(CURATION_RESPONSE_JSON_SCHEMA, false);
  });
});
