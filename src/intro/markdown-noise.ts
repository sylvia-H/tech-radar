/**
 * 去除 README 的 Markdown/HTML 雜訊，保留標題與內文（research D10）。純函式正則管線，依序：
 * HTML 註解 → 程式碼圍欄 → 圖片/badge → 連結收斂為顯示文字 → 參考式連結定義行 → 剩餘
 * HTML 標籤 → 收斂多餘空白。去除順序刻意先處理程式碼圍欄，避免圍欄內的 `[]()`／HTML
 * 樣式文字被連結/標籤規則誤傷。
 */
export function stripMarkdownNoise(readme: string): string {
  let text = readme;

  // HTML 註解 <!-- ... -->
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  // 程式碼圍欄 ```lang\n...\n``` （含內容一併移除，避免程式碼污染簡介素材）
  text = text.replace(/```[\s\S]*?```/g, '');

  // 圖片／badge：![alt](url) 或 ![alt][ref]（先於一般連結處理，避免被誤判成連結）
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  text = text.replace(/!\[[^\]]*\]\[[^\]]*\]/g, '');

  // 行內連結 [text](url) → text
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  // 參考式連結 [text][ref] → text
  text = text.replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1');

  // 參考式連結定義行 [label]: url "title"（README 末端常見的一整段連結定義，純噪音）
  text = text.replace(/^[ \t]*\[[^\]]+\]:[ \t]*\S.*$/gm, '');

  // 剩餘 HTML 標籤（含 badge 常用的 <img>/<a>/<div> 等）
  text = text.replace(/<[^>]+>/g, '');

  // 收斂多餘空白：連續空白 → 單一空白；三個以上換行 → 兩個換行；去除行尾空白
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/[ \t]+\n/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();

  return text;
}
