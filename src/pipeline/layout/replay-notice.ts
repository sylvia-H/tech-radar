import { COLOR_WARNING, DiscordEmbed } from '../../discord/discord.embed';

/** `buildReplayNoticeEmbed` 的輸入：皆為程式提供的計數／旗標（非 LLM 產生，憲章 VI）。 */
export interface ReplayNoticeInput {
  /** 補發的台北日期 `YYYY-MM-DD`。 */
  date: string;
  /** 當日已推（`seenNews` 帶標題）的則數＝補發則數（逐則翻譯、不篩選）。 */
  seenCount: number;
  /** 成功翻譯的則數；其餘保留原文標題。 */
  translatedCount: number;
  /** 翻譯是否整份失敗（仍為原文標題版）。 */
  degraded: boolean;
}

/**
 * 晨報補發的開頭說明 embed（2026-10-17 新增，黃色警示樣式；純函式）。補發推到告警頻道，緊接其後的
 * 是 `buildDigestEmbeds` 的橙色晨報本體；本則先交代「這是什麼、與原推播差在哪、有哪些限制」，
 * 避免讀者把補發誤認為當日新晨報。
 */
export function buildReplayNoticeEmbed(input: ReplayNoticeInput): DiscordEmbed {
  const { date, seenCount, translatedCount, degraded } = input;
  const dateSlash = date.replace(/-/g, '/');
  const title = degraded
    ? `⚠️ 晨報補發：${dateSlash}（翻譯失敗，仍為原文標題版）`
    : `⚠️ 晨報補發：${dateSlash}（翻譯摘要版）`;
  const lines = [
    `用途：當日原推播為策展降級（原文標題、無翻譯摘要），本則把當日已推的 ${seenCount} 則逐則補上繁中標題與說明，不重新篩選、順序同原推播。`,
    '・素材僅有原始標題（無原文內容），說明依標題撰寫、篇幅較短，細節以原文連結為準。',
    `・本次翻譯 ${translatedCount} 則${translatedCount < seenCount ? `，${seenCount - translatedCount} 則未回、保留原文標題` : ''}。`,
    '・不寫狀態：不影響已推紀錄、明日晨報與 Pages。',
  ];
  if (degraded) {
    lines.push('・本次翻譯失敗（LLM 呼叫或解析失敗），以下仍為原文標題版，請查 Actions log。');
  }
  return { title, color: COLOR_WARNING, description: lines.join('\n') };
}
