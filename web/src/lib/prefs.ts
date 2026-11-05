/**
 * העדפות תצוגה וברירות מחדל, שמורות במחשב (localStorage). applyPrefs מחיל אותן על ה-html:
 * data-theme (בהיר / כהה / לפי המערכת), צבע הדגשה, גודל טקסט וצפיפות.
 */
import { useEffect, useState } from "react";
import type { PermissionMode } from "../../../shared/protocol";
import { pick } from "../i18n";

export type ThemeChoice = "system" | "light" | "dark";
export type Density = "comfortable" | "compact";
/** שפת העיצוב: IDE (צפוף, כרטיסיות, שורת מצב צבעונית, בלי בועות) או iOS (העיצוב של 21/10) */
export type Skin = "ide" | "ios";

export interface Prefs {
  theme: ThemeChoice;
  skin: Skin;
  accent: string;
  textScale: number;
  density: Density;
  reduceMotion: boolean;
  defaultModel: string | null;
  /** אייג'נט שנבחר לבד בסשן חדש (למשל סוכן ראשי שמחלק עבודה). ריק = בלי */
  defaultAgent: string;
  defaultMode: PermissionMode;
  enterToSend: boolean;
  /** כמה שקט (מילישניות) נחשב סוף משפט בשיחה קולית */
  voiceSilenceMs: number;
  /** מילים שמסיימות שיחה קולית, מופרדות בפסיק */
  voiceStopWords: string;
  /** לקטוע בדיבור כשהוא מדבר */
  voiceBargeIn: boolean;
  /** ⌥⌘Space פותח שיחה קולית בסשן חדש וקל (ולא בסשן הכבד שפתוח) */
  voiceFresh: boolean;
  /** המודל לשיחה קולית חדשה: מהיר יותר מ-Opus */
  voiceModel: string;
  /** פתיחת סשן מהרשימה הופכת אותו לפעיל מיד */
  autoLive: boolean;
}

export const ACCENTS = ["#007aff", "#5e5ce6", "#af52de", "#ff2d55", "#ff9500", "#34c759", "#00c7be", "#8e8e93"];

const KEY = "mifkada.prefs";
const DEFAULTS: Prefs = {
  theme: "system",
  skin: "ide",
  accent: "#007aff",
  textScale: 1,
  density: "comfortable",
  reduceMotion: false,
  defaultModel: null,
  defaultAgent: "",
  defaultMode: "default",
  enterToSend: true,
  voiceSilenceMs: 1100,
  // ברירת המחדל לפי שפת הממשק (getter, כדי שתיקבע ברגע הקריאה)
  get voiceStopWords() {
    return pick("סיים שיחה, עצור, תפסיק, ביי", "end call, stop, bye");
  },
  voiceBargeIn: true,
  voiceFresh: true,
  voiceModel: "sonnet",
  autoLive: true,
};

export function getPrefs(): Prefs {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Prefs>) };
  } catch {
    return DEFAULTS;
  }
}

const listeners = new Set<(p: Prefs) => void>();
export function onPrefsChange(cb: (p: Prefs) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function setPrefs(patch: Partial<Prefs>): Prefs {
  const next = { ...getPrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* אין אחסון */
  }
  applyPrefs(next);
  listeners.forEach((cb) => cb(next));
  return next;
}

/** האם התצוגה כרגע כהה (לבחירה, או לפי המערכת). לעורך ולטרמינל. */
export function isDark(): boolean {
  const t = getPrefs().theme;
  return t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
}

export function applyPrefs(p: Prefs = getPrefs()): void {
  const root = document.documentElement;
  if (p.theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", p.theme);
  root.style.setProperty("--user-accent", p.accent);
  root.style.fontSize = `${Math.round(16 * p.textScale)}px`;
  root.dataset.density = p.density;
  root.dataset.skin = p.skin;
  root.classList.toggle("reduce-motion", p.reduceMotion);
}

/** העדפה אחת שמתעדכנת בממשק כשמשנים אותה בהגדרות */
export function usePref<K extends keyof Prefs>(key: K): Prefs[K] {
  const [v, setV] = useState(() => getPrefs()[key]);
  useEffect(() => onPrefsChange((p) => setV(p[key])), [key]);
  return v;
}
