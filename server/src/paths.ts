import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dataDir } from "./platform.js";

export const CLAUDE_HOME = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");

/** שורש הריפו: עולים מהתיקייה של הקובץ עד package.json עם workspaces. עובד גם מ-src וגם מ-dist. */
function findRoot(from: string): string {
  let dir = from;
  for (let i = 0; i < 8; i++) {
    const pkg = path.join(dir, "package.json");
    if (fs.existsSync(pkg)) {
      try {
        if (JSON.parse(fs.readFileSync(pkg, "utf8")).workspaces) return dir;
      } catch {
        /* ממשיכים לעלות */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(from, "../..");
}

export const ROOT_DIR = process.env.MIFKADA_ROOT ?? findRoot(import.meta.dirname);
/**
 * תיקיית נתונים אחת לכל המצבים (אפליקציה, עדכון חם, npm run dev), כדי שלא יהיו שני עותקים של הקנבן וההגדרות.
 * MIFKADA_DATA גובר (בדיקות ושרתי ניסיון משתמשים בתיקייה זמנית).
 */
export const DATA_DIR = process.env.MIFKADA_DATA ?? dataDir();
export const WEB_DIST = path.join(ROOT_DIR, "web", "dist");

/**
 * תיקיות שמוגנות בפרטיות של macOS (הורדות, iCloud Drive). גישה אליהן בלי אישור נתקעת בלי שגיאה,
 * ותופסת חוט של libuv לתמיד. סריקות רקע מדלגות עליהן.
 */
export function isProtectedDir(p: string): boolean {
  const home = process.env.HOME ?? "";
  return [path.join(home, "Downloads"), path.join(home, "Library", "Mobile Documents")].some((d) => p === d || p.startsWith(d + path.sep));
}
