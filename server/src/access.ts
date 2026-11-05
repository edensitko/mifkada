import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listSessions } from "@anthropic-ai/claude-agent-sdk";
import { CLAUDE_HOME, isProtectedDir } from "./paths.js";
import { projectRoots } from "./roots.js";
import { L } from "./i18n.js";

/*
 * אילו תיקיות הממשק רשאי לקרוא, לכתוב, להריץ בהן git או לפתוח בהן טרמינל: רק תיקיות שמפקדה מכירה.
 * תיקיות הפרויקטים מההגדרות, התיקיות של הסשנים (מה-SDK ומ-~/.claude/sessions), והתיקיות של הסשנים החיים, המשימות
 * והענפים הנפרדים שלהן (מ-index.ts דרך setExtraRoots). כל נתיב נבדק אחרי realpath, כך שקישור סימבולי לא מוציא החוצה.
 * בלי זה, כל לקוח שעבר את בדיקת הטוקן (או XSS בתוכן של תשובה) היה מקבל גישה לכל הדיסק.
 */

let extra: () => string[] | Promise<string[]> = () => [];
/** מקורות נוספים מהזיכרון של השרת: cwd של סשנים חיים, משימות, worktrees, רוטינות וסשנים של ספקים אחרים */
export function setExtraRoots(fn: () => string[] | Promise<string[]>): void {
  extra = fn;
}

async function real(p: string): Promise<string | null> {
  try {
    return await fs.realpath(p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p);
  } catch {
    return null;
  }
}

let cache: { at: number; roots: string[] } | null = null;
async function sessionDirs(): Promise<string[]> {
  if (cache && Date.now() - cache.at < 30_000) return cache.roots;
  const out = new Set<string>();
  try {
    for (const s of await listSessions({ limit: 1000 })) if (s.cwd) out.add(s.cwd);
  } catch {
    /* אין סשנים */
  }
  const dir = path.join(CLAUDE_HOME, "sessions");
  for (const n of await fs.readdir(dir).catch(() => [] as string[])) {
    if (!n.endsWith(".json")) continue;
    try {
      const j = JSON.parse(await fs.readFile(path.join(dir, n), "utf8"));
      if (typeof j.cwd === "string") out.add(j.cwd);
    } catch {
      /* קובץ חלקי */
    }
  }
  cache = { at: Date.now(), roots: [...out] };
  return cache.roots;
}

const inside = (p: string, root: string) => p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

/** מחזיר את ה-realpath של התיקייה אם מותר לגעת בה, אחרת זורק. שורש הדיסק אף פעם לא מותר. */
export async function assertAllowedCwd(cwd: string): Promise<string> {
  const target = await real(cwd);
  if (!target || target === path.parse(target).root) throw new Error(L("תיקייה לא מוכרת למפקדה", "Unknown folder: Mifkada doesn't know this folder"));
  const candidates = [...projectRoots(), ...(await sessionDirs()), ...(await extra())];
  for (const c of candidates) {
    const r = await real(c);
    if (r && r !== path.parse(r).root && inside(target, r)) return target;
  }
  throw new Error(L("תיקייה לא מוכרת למפקדה. אפשר להוסיף אותה בהגדרות ← כללי ← תיקיות הפרויקטים", "Unknown folder: Mifkada doesn't know this folder. You can add it in Settings → General → Project folders"));
}

/** לבדיקות: מנקה את המטמון של תיקיות הסשנים */
export function resetAccessCache(): void {
  cache = null;
}

/*
 * דפדוף בתיקיות (בורר התיקיות של "סשן חדש") ופתיחת סשן בתיקייה חדשה: רק בתוך תיקיית הבית (אחרי realpath, כך שקישור
 * סימבולי לא יוצא), בלי תיקיות מוגנות (הורדות, iCloud: גישה אליהן נתקעת) ובלי node_modules. תיקייה מוסתרת רק בדפדוף עם hidden.
 * הודעת השגיאה לא כוללת את הנתיב.
 */
export class AccessError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404,
  ) {
    super(message);
  }
}

const homeReal = async () => (await real(os.homedir())) ?? path.resolve(os.homedir());

/** מחזיר את ה-realpath של תיקייה שמותר לדפדף בה, או זורק AccessError (403 מחוץ לגבולות, 404 לא קיימת / לא תיקייה) */
export async function assertBrowsable(p: string, opts: { hidden?: boolean } = {}): Promise<string> {
  const home = await homeReal();
  const given = path.resolve(p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p);
  const out = () => new AccessError(L("מחוץ לתיקיות שמותר לדפדף בהן", "Outside the folders you can browse"), 403);
  // isProtectedDir בודק מול HOME; אם הבית עצמו קישור סימבולי, בודקים גם את הצורה האמיתית
  const prot = (x: string) => isProtectedDir(x) || (inside(x, home) && isProtectedDir(path.join(os.homedir(), path.relative(home, x))));
  // לפני realpath: לא נוגעים בתיקייה מוגנת (realpath עליה עלול להיתקע)
  if (prot(given)) throw out();
  const target = await real(given);
  if (!target) {
    if (!inside(given, home) && !inside(given, path.resolve(os.homedir()))) throw out();
    throw new AccessError(L("התיקייה לא נמצאה", "Folder not found"), 404);
  }
  if (!inside(target, home) || prot(target)) throw out();
  const parts = path.relative(home, target).split(path.sep).filter(Boolean);
  if (parts.includes("node_modules") || (!opts.hidden && parts.some((s) => s.startsWith(".")))) throw out();
  const st = await fs.stat(target).catch(() => null);
  if (!st?.isDirectory()) throw new AccessError(L("התיקייה לא נמצאה", "Folder not found"), 404);
  return target;
}

/**
 * מותר לפתוח בה סשן, משימה או רוטינה: תיקייה מוכרת (assertAllowedCwd), או תיקייה חדשה בתוך הבית שאפשר להגיע אליה
 * בבורר (לא הבית עצמו ולא תיקייה מוסתרת). בלי זה פתיחה ב-WebSocket הייתה מוסיפה כל נתיב לתיקיות המותרות.
 */
export async function assertOpenableCwd(cwd: string): Promise<string> {
  if (typeof cwd !== "string" || !cwd.trim()) throw new Error(L("חסרה תיקייה", "Missing folder"));
  try {
    return await assertAllowedCwd(cwd);
  } catch (known) {
    let target: string;
    try {
      target = await assertBrowsable(cwd);
    } catch {
      throw known;
    }
    if (target === (await homeReal())) throw known;
    return target;
  }
}
