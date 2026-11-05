import { systemPrefs } from "./settings.js";

/*
 * שפה בצד השרת, להודעות שמגיעות לממשק (שגיאות, התראות) ולפרומפטים שמבקשים מהמודל לכתוב בשפה של המשתמש.
 * system.lang מההגדרות; "auto" = לפי שפת המערכת (LANG או ה-locale של Intl).
 *   throw new Error(L("תיקייה לא מוכרת", "Unknown folder"));
 */
export type Lang = "he" | "en";

export function serverLang(): Lang {
  // MIFKADA_LANG גובר על ההגדרות. נועד לבדיקות (server/test), כדי שהודעות השגיאה יהיו צפויות בלי תלות במחשב
  const forced = process.env.MIFKADA_LANG;
  if (forced === "he" || forced === "en") return forced;
  const l = systemPrefs().lang;
  if (l === "he" || l === "en") return l;
  const sys = process.env.LANG || process.env.LC_ALL || Intl.DateTimeFormat().resolvedOptions().locale || "";
  return /^(he|iw)/i.test(sys) ? "he" : "en";
}

export const L = (he: string, en: string): string => (serverLang() === "he" ? he : en);
