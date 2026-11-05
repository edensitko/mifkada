import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { L } from "./i18n.js";

const SKIP = new Set(["node_modules", ".git", ".next", "dist", ".DS_Store", ".turbo", ".cache"]);
const MAX_READ = 2 * 1024 * 1024;

/**
 * נתיב יחסי בתוך הפרויקט בלבד. נבדק גם אחרי realpath: קישור סימבולי בתוך הפרויקט שמצביע החוצה (או ../) נחסם.
 * לקובץ שעוד לא קיים (כתיבה) נבדקת התיקייה שמעליו.
 */
export function resolveInside(root: string, rel: string): string {
  const given = path.resolve(root);
  const abs = path.resolve(given, rel || ".");
  if (abs !== given && !abs.startsWith(given + path.sep)) throw new Error(L("מחוץ לפרויקט", "Outside the project"));
  // הבדיקה על הנתיבים האמיתיים; מחזירים את הנתיב כפי שהתקבל, כדי לא לשנות לקוראים את הצורה שלו
  const r = fsSync.realpathSync(given);
  let probe = abs;
  while (!fsSync.existsSync(probe) && probe !== given) probe = path.dirname(probe);
  const realProbe = fsSync.realpathSync(probe);
  if (realProbe !== r && !realProbe.startsWith(r + path.sep)) throw new Error(L("מחוץ לפרויקט (קישור סימבולי)", "Outside the project (symbolic link)"));
  return abs;
}

export interface Entry {
  name: string;
  path: string;
  type: "dir" | "file";
  size: number;
  skipped?: boolean;
}

export async function listDir(root: string, rel: string): Promise<Entry[]> {
  const abs = resolveInside(root, rel);
  const items = await fs.readdir(abs, { withFileTypes: true });
  const out: Entry[] = [];
  for (const it of items) {
    const p = path.join(rel || "", it.name);
    if (it.isDirectory()) out.push({ name: it.name, path: p, type: "dir", size: 0, skipped: SKIP.has(it.name) });
    else if (it.isFile()) {
      let size = 0;
      try {
        size = (await fs.stat(path.join(abs, it.name))).size;
      } catch {
        /* קובץ נעלם */
      }
      out.push({ name: it.name, path: p, type: "file", size });
    }
  }
  out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
  return out;
}

export async function readFile(root: string, rel: string): Promise<{ content: string; size: number; truncated: boolean }> {
  const abs = resolveInside(root, rel);
  const st = await fs.stat(abs);
  if (!st.isFile()) throw new Error(L("לא קובץ", "Not a file"));
  const buf = await fs.readFile(abs);
  const slice = buf.subarray(0, MAX_READ);
  if (slice.includes(0)) throw new Error(L("קובץ בינארי", "Binary file"));
  return { content: slice.toString("utf8"), size: st.size, truncated: buf.length > MAX_READ };
}

export async function writeFile(root: string, rel: string, content: string): Promise<void> {
  const abs = resolveInside(root, rel);
  await fs.writeFile(abs, content, "utf8");
}
