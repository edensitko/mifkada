import { lang, pick } from "../i18n";
import { ask } from "./dialog";

/** locale לתאריכים לפי שפת הממשק */
export const dateLocale = (): string => (lang() === "he" ? "he-IL" : "en-US");

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** זמן יחסי. בעברית לא דרך Intl, שמחזיר "לפני שעה (1)". */
export function relTime(ms: number): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const m = Math.round(diff / 60000);
  const he = lang() === "he";
  if (m < 1) return he ? "עכשיו" : "just now";
  if (m < 60) return he ? `לפני ${m} דק׳` : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return he ? (h === 1 ? "לפני שעה" : `לפני ${h} שעות`) : h === 1 ? "an hour ago" : `${h} hours ago`;
  const d = Math.round(h / 24);
  if (d === 1) return he ? "אתמול" : "yesterday";
  if (d < 7) return he ? `לפני ${d} ימים` : `${d} days ago`;
  return new Date(ms).toLocaleDateString(dateLocale(), { day: "numeric", month: "short" });
}

/** זמן קצר לרשימות צפופות: "עכשיו", "24 ד׳", "4 ש׳", "אתמול", "3 ימ׳", "12 באוק׳" */
export function shortTime(ms: number): string {
  if (!ms) return "";
  const m = Math.round((Date.now() - ms) / 60000);
  const he = lang() === "he";
  if (m < 1) return he ? "עכשיו" : "now";
  if (m < 60) return he ? `${m} ד׳` : `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return he ? `${h} ש׳` : `${h}h`;
  const d = Math.round(h / 24);
  if (d === 1) return he ? "אתמול" : "yesterday";
  if (d < 7) return he ? `${d} ימ׳` : `${d}d`;
  return new Date(ms).toLocaleDateString(dateLocale(), { day: "numeric", month: "short" });
}

/**
 * זמן לשורה ברשימת הסשנים, כשכבר יש כותרת "היום / אתמול / השבוע": היום יחסי ("5 ד׳"), אתמול שעה,
 * השבוע יום בשבוע, ומעבר לזה תאריך. כך הזמן מוסיף מידע ולא חוזר על הכותרת.
 */
export function listTime(ms: number, now = new Date()): string {
  if (!ms) return "";
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const d = new Date(ms);
  if (ms >= day) return shortTime(ms);
  if (ms >= day - 6 * 86_400_000) {
    const hm = d.toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit" });
    return ms >= day - 86_400_000 ? hm : d.toLocaleDateString(dateLocale(), { weekday: "short" });
  }
  return d.toLocaleDateString(dateLocale(), { day: "numeric", month: "numeric" });
}

/** צבע אייג'נט כטקסט: מעורבב עם צבע הטקסט, כדי שגם צבע כהה ייקרא על רקע כהה (ובהיר על בהיר) */
export const readableColor = (c: string) => `color-mix(in oklab, ${c} 62%, var(--color-foreground))`;

export function basename(p: string): string {
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}

/** תקציר קריא של קלט לכלי: הפקודה, הקובץ, הדפוס. */
export function summarizeToolInput(name: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const i = input as Record<string, unknown>;
  const s = (k: string) => (typeof i[k] === "string" ? (i[k] as string) : "");
  switch (name) {
    case "Bash":
      return s("description") || s("command");
    case "Read":
    case "Write":
    case "Edit":
    case "NotebookEdit":
      return s("file_path") || s("notebook_path");
    case "Glob":
    case "Grep":
      return s("pattern") + (s("path") ? `  (${s("path")})` : "");
    case "WebFetch":
    case "WebSearch":
      return s("url") || s("query");
    case "Agent":
      return s("description") || s("prompt").slice(0, 80);
    case "Skill":
      return s("skill");
    default: {
      const first = Object.entries(i).find(([, v]) => typeof v === "string");
      return first ? String(first[1]).slice(0, 120) : "";
    }
  }
}

// label/hint כ-getter: מחושבים לפי השפה ברגע הקריאה, וכל מי שמשתמש ב-.label לא צריך לדעת על השפה
export const MODEL_OPTIONS: Array<{ value: string | null; readonly label: string }> = [
  { value: null, get label() { return pick("ברירת מחדל", "Default"); } },
  { value: "fable", label: "Fable" },
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
];

type ModeValue = "default" | "acceptEdits" | "plan" | "auto" | "dontAsk" | "bypassPermissions";
const mode = (value: ModeValue, he: [string, string], en: [string, string]) => ({
  value,
  get label() {
    return pick(he[0], en[0]);
  },
  get hint() {
    return pick(he[1], en[1]);
  },
});
export const MODE_OPTIONS: Array<{ value: ModeValue; readonly label: string; readonly hint: string }> = [
  mode("default", ["שואל", "כל פעולה שדורשת אישור עוצרת ושואלת"], ["Ask", "Anything that needs approval stops and asks"]),
  mode("acceptEdits", ["מאשר עריכות", "עריכות קבצים עוברות, פקודות עדיין שואלות"], ["Accept edits", "File edits go through, commands still ask"]),
  mode("plan", ["תכנון", "קריאה בלבד, בלי שינויים"], ["Plan", "Read only, no changes"]),
  mode("auto", ["אוטומטי", "מסווג מאשר פעולות שגרתיות, השאר שואל"], ["Auto", "A classifier approves routine actions, the rest asks"]),
  mode("dontAsk", ["לא שואל", "מה שלא אושר מראש נדחה"], ["Don't ask", "Anything not pre-approved is denied"]),
  mode("bypassPermissions", ["מאשר הכול", "הכול רץ בלי לשאול, כולל מחיקה, פריסה וחיבור לשרת. רק הפעולות החסומות לגמרי נעצרות"], ["Bypass", "Everything runs without asking, including deletes, deploys and server access. Only fully blocked actions stop"]),
];

/** מצב "אוטומטי" מאשר פעולות בלי לשאול אותך: אישור מפורש לפני שעוברים אליו */
export function confirmMode(mode: string): Promise<boolean> {
  if (mode === "bypassPermissions")
    return ask(pick("מאשר הכול: Claude יריץ כל פעולה בלי לשאול, כולל מחיקה, פריסה וחיבור לשרת הפרוד.\n\nלעבור למצב הזה?", "Bypass: Claude will run every action without asking, including deletes, deploys and production server access.\n\nSwitch to this mode?"));
  if (mode !== "auto") return Promise.resolve(true);
  return ask(pick("מצב אוטומטי: מסווג של Claude יאשר לבד פעולות שהוא מחשיב בטוחות, כולל פקודות בטרמינל, בלי לשאול אותך.\n\nלעבור למצב הזה?", "Auto mode: a Claude classifier will approve actions it considers safe, including terminal commands, without asking you.\n\nSwitch to this mode?"));
}

export function modelLabel(id: string | null): string {
  if (!id) return pick("ברירת מחדל", "Default");
  const m = MODEL_OPTIONS.find((o) => o.value === id);
  if (m) return m.label;
  const short = id.replace(/^claude-/, "").replace(/-\d{8}$/, "");
  return short.replace(/-(\d)-(\d)/, " $1.$2").replace(/-(\d)$/, " $1").replace(/^\w/, (c) => c.toUpperCase());
}

const PROJECT_PALETTE = ["#60a5fa", "#f472b6", "#34d399", "#fbbf24", "#a78bfa", "#fb923c", "#2dd4bf", "#f87171", "#c084fc", "#38bdf8"];

export function hashString(str: string): number {
  let h = 0;
  for (const ch of str) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return h;
}

export function projectColor(cwd: string): string {
  return PROJECT_PALETTE[hashString(cwd) % PROJECT_PALETTE.length];
}

/** שם תצוגה לפרויקט: שם התיקייה, ואם יש כפילות גם התיקייה שמעליה. */
export function projectName(cwd: string, allCwds: Iterable<string>): string {
  const base = basename(cwd);
  let dup = 0;
  for (const c of allCwds) if (basename(c) === base) dup++;
  if (dup <= 1) return base;
  const parts = cwd.replace(/\/+$/, "").split("/");
  return parts.length >= 2 ? `${parts[parts.length - 2]}/${base}` : base;
}

/** אות ראשונה לאווטאר של פרויקט בלי אימוג'י. */
export function initial(name: string): string {
  const ch = [...name.trim()][0] ?? "?";
  return ch.toUpperCase();
}

/**
 * הסבר בעברית לסיבות אישור נפוצות ש-Claude Code מחזיר באנגלית.
 * הטקסט המקורי נשאר מוצג מתחת, ההסבר רק מתרגם ואומר מה אפשר לעשות.
 */
export function explainPermissionReason(reason: string | undefined, canAlways: boolean): string | null {
  if (!reason) return null;
  if (/changes directory before running a version-control command/i.test(reason)) {
    return pick(
      "הפקודה משלבת cd עם פקודת git. Claude Code מבקש אישור על זה בכל פעם ו'אשר תמיד' לא נשמר לה, כי ריפו שנכנסים אליו עם cd יכול להכיל הגדרות או hooks לא מהימנים. כדי להפסיק לשאול: להריץ git -C <נתיב> או מתוך התיקייה הנוכחית, בלי cd באותה פקודה.",
      "The command combines cd with a git command. Claude Code asks every time and 'Always allow' isn't saved for it, because a repo you cd into can contain untrusted config or hooks. To stop the prompts: use git -C <path>, or run it from the current folder without cd in the same command.",
    );
  }
  if (!canAlways) return pick("לבקשה הזו אין 'אשר תמיד', ולכן היא תישאל בכל פעם.", "This request has no 'Always allow', so it will be asked every time.");
  return null;
}

/** תצוגה מקדימה של טקסט markdown: בלי סימוני כותרת, הדגשה, קוד וטבלאות, בשורה רציפה. */
export function plainPreview(md: string, max = 220): string {
  const t = md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*\|?[-:| ]{3,}\|?\s*$/gm, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s*\|\s*/g, " · ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? t.slice(0, max).trimEnd() + "…" : t;
}
