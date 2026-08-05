import { BoardChangeDigest } from './board-summary.types';

/**
 * 榜單日 TL;DR 的 LLM 呼叫失敗時退回的程式產生事實型摘要：「本週 N 個新進、M 個竄升、
 * K 個下降」，計數為 0 的子句省略；三者皆 0 時輸出「本週榜單無變化」。數字 100% 取自
 * `digest`，不杜撰（FR-016、SC-007、research D3）。
 */
export function factSummary(digest: BoardChangeDigest): string {
  const clauses: string[] = [];
  if (digest.newcomers > 0) {
    clauses.push(`${digest.newcomers} 個新進`);
  }
  if (digest.climbed > 0) {
    clauses.push(`${digest.climbed} 個竄升`);
  }
  if (digest.declined > 0) {
    clauses.push(`${digest.declined} 個下降`);
  }

  if (clauses.length === 0) {
    return '本週榜單無變化';
  }
  return `本週 ${clauses.join('、')}`;
}
