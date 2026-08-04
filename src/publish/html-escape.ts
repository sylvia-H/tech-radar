/**
 * HTML escape（防禦性措施，research D5）：公開頁面所有插入文字一律經此處理，
 * 不對內容來源（我方 LLM 策展／簡介）的字元集做假設。
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
