import { renderFeed } from './render-feed';
import { BoardState, emptyBoardState } from '../state/state.schema';

const PAGES_URL = 'https://owner.github.io/repo/';

describe('renderFeed（US1，feed-page-contract.md C2）', () => {
  it('0 entries 時仍輸出合法 Atom XML，不擲錯', () => {
    const xml = renderFeed(emptyBoardState(), PAGES_URL);
    expect(xml).toContain('<?xml');
    expect(xml).toContain('<feed');
    expect(xml).toContain('Tech Radar');
    expect(xml).not.toContain('<entry>');
  });

  it('state.publish 存在但 feed 缺席時同樣輸出 0 entries 的合法 feed', () => {
    const state: BoardState = { ...emptyBoardState(), publish: {} };
    const xml = renderFeed(state, PAGES_URL);
    expect(xml).toContain('<feed');
    expect(xml).not.toContain('<entry>');
  });
});
