import type { ChatSel, Selection, SplitLayout } from "../store";

/** סוג הנתונים בגרירה של סשן (מסרגל הצד, או כותרת של חלון עם from) */
export const SESSION_DRAG = "application/x-mifkada-session";

/** כמה עמודות ושורות לכל מספר חלונות, לפי הסידור שנבחר */
export function gridDims(n: number, layout: SplitLayout): { cols: number; rows: number } {
  if (layout === "cols") return { cols: n, rows: 1 };
  if (layout === "rows") return { cols: 1, rows: n };
  if (layout === "grid") {
    const cols = Math.ceil(Math.sqrt(n));
    return { cols, rows: Math.ceil(n / cols) };
  }
  if (n <= 3) return { cols: n, rows: 1 };
  if (n === 4) return { cols: 2, rows: 2 };
  return { cols: 3, rows: 2 };
}


/** זהות של חלון: אותו סשן הוא אותו חלון, גם כשאחד מוחזק כחי (liveId) והשני כהיסטורי (sessionId) */
export function paneIdentity(x: ChatSel, sessionOf: (liveId: string) => string | undefined): string {
  return x.kind === "history" ? x.sessionId : (sessionOf(x.liveId) ?? `live:${x.liveId}`);
}

/**
 * ה-split בלי סשן שכבר מוצג בחלון הראשי או בחלון קודם. כפילות נתנה ל-React שני ילדים עם אותו key ברשת,
 * ואחרי עדכון נשארו ברשת ילדים יתומים: הם פתחו שורות auto נוספות שבלעו את כל הגובה, וחלון אחד נשאר
 * בשליש רוחב ובכל הגובה (31/10). מחזיר את אותו מערך כשאין מה להוריד.
 */
export function uniqueSplit(main: Selection, split: ChatSel[], sessionOf: (liveId: string) => string | undefined): ChatSel[] {
  const seen = new Set<string>();
  if (main?.kind === "live" || main?.kind === "history") seen.add(paneIdentity(main, sessionOf));
  const out = split.filter((x) => {
    const id = paneIdentity(x, sessionOf);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return out.length === split.length ? split : out;
}
