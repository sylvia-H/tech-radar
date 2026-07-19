import { BoardDiff } from '../../diff/diff.types';
import { BoardChangeDigest } from '../../curation/board-summary.types';

/**
 * `BoardDiff` → `BoardChangeDigest` 投影（research D6），供 F6 `BoardSummaryService.summarize`。
 * `domainCounts` 只計「新進＋竄升」（`needsIntro` 群組，與 `buildBoardSummaryPrompt` 的
 * 「新進＋竄升的領域分布」文案一致）；不計下降。`topName` 取本次綜合榜 #1（`diff.topEntry`
 * 必為非空，diffBoard 不變式保證）。
 */
export function toBoardChangeDigest(diff: BoardDiff): BoardChangeDigest {
  let newcomers = 0;
  let climbed = 0;
  let declined = 0;
  const domainCounts = { ai: 0, 'frontend-backend': 0 };

  for (const c of diff.changes) {
    switch (c.kind) {
      case 'newcomer':
        newcomers++;
        domainCounts[c.domain]++;
        break;
      case 'climbed':
        climbed++;
        domainCounts[c.domain]++;
        break;
      case 'declined':
        declined++;
        break;
    }
  }

  return {
    newcomers,
    climbed,
    declined,
    domainCounts,
    topName: diff.topEntry.fullName,
  };
}
