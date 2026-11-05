/*
 * שפת הממשק: עברית (RTL) או אנגלית (LTR). בלי ספרייה.
 *
 * כל קובץ מגדיר את המחרוזות שלו ליד השימוש:
 *
 *   const S = strings({
 *     he: { title: "הגדרות", saved: "נשמר ב-{when}" },
 *     en: { title: "Settings", saved: "Saved {when}" },
 *   });
 *   // בקומפוננטה:      const t = useT(S);   t("saved", { when })
 *   // מחוץ לקומפוננטה: tr(S, "title")
 *
 * TypeScript דורש שלשתי השפות יהיו בדיוק אותם מפתחות, כך שתרגום חסר הוא שגיאת קומפילציה.
 * ההגדרה עצמה (system.lang: "auto" | "he" | "en") נשמרת בשרת, כדי שגם השרת והתפריטים של macOS ידעו אותה.
 * עד שההגדרות נטענות משתמשים בעותק ב-localStorage, כדי שהממשק לא יהבהב בשפה הלא נכונה.
 * החלפת שפה בונה את כל האפליקציה מחדש (key על השורש ב-App, דרך onLangChange), ולכן גם tr() ו-pick() בתוך render
 * מתעדכנים. אין כאן תלות ב-store, כדי שקבצי lib טהורים (ובדיקות ב-Node) יוכלו להשתמש בזה.
 */
export type Lang = "he" | "en";
export type LangSetting = "auto" | Lang;

const CACHE = "mifkada.lang";

/** "auto" = לפי שפת המערכת: עברית אם היא עברית, אחרת אנגלית */
export function resolveLang(setting: LangSetting | undefined | null): Lang {
  if (setting === "he" || setting === "en") return setting;
  const sys = (typeof navigator !== "undefined" && (navigator.languages?.[0] || navigator.language)) || "";
  return /^(he|iw)\b/i.test(sys) ? "he" : "en";
}

function cached(): Lang {
  try {
    const v = localStorage.getItem(CACHE);
    if (v === "he" || v === "en") return v;
  } catch {
    /* אין אחסון */
  }
  return resolveLang("auto");
}

let current: Lang = cached();

export function lang(): Lang {
  return current;
}
export const isRTL = (): boolean => current === "he";

const listeners = new Set<(l: Lang) => void>();
/** מי שצריך לדעת על החלפת שפה (App בונה את עצמו מחדש) */
export function onLangChange(fn: (l: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** מחיל שפה: כיוון ושפה על ה-html, שמירה לטעינה הבאה, והודעה למאזינים */
export function applyLang(l: Lang): void {
  const changed = l !== current;
  current = l;
  if (typeof document !== "undefined") {
    document.documentElement.lang = l;
    document.documentElement.dir = l === "he" ? "rtl" : "ltr";
  }
  try {
    localStorage.setItem(CACHE, l);
  } catch {
    /* אין אחסון */
  }
  if (changed) for (const fn of listeners) fn(l);
}

type Vars = Record<string, string | number>;
export type Strings<K extends string> = { he: Record<K, string>; en: Record<K, string> };

/** מגדיר מחרוזות לשתי השפות. המפתחות של en חייבים להיות בדיוק אלה של he */
export function strings<K extends string>(d: { he: Record<K, string>; en: NoInfer<Record<K, string>> }): Strings<K> {
  return d;
}

function fill(s: string, vars?: Vars): string {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** תרגום מחוץ לקומפוננטה (פונקציות, הודעות). קורא את השפה הנוכחית ברגע הקריאה */
export function tr<K extends string>(d: Strings<K>, key: K, vars?: Vars): string {
  return fill(d[current][key] ?? d.he[key] ?? key, vars);
}

/** תרגום בקומפוננטה. (החלפת שפה בונה את האפליקציה מחדש, אז אין צורך להאזין כאן) */
export function useT<K extends string>(d: Strings<K>): (key: K, vars?: Vars) => string {
  return (key, vars) => tr(d, key, vars);
}

/** בחירה קצרה לפי שפה, למקרים בודדים (למשל טקסט ב-aria או ערך מחושב) */
export const pick = <T,>(he: T, en: T): T => (current === "he" ? he : en);
