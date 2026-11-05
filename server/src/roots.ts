import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { systemPrefs } from "./settings.js";
import { isProtectedDir } from "./paths.js";

/** התיקיות שהגדרת בהגדרות ("תיקיות פרויקטים"), עם ~ פתוח לנתיב מלא */
export function projectRoots(): string[] {
  return systemPrefs().projectRoots.map((d) => (d.startsWith("~") ? path.join(os.homedir(), d.slice(1)) : d)).filter((d) => !isProtectedDir(d));
}

/** כל תת-תיקייה של תיקיות הפרויקטים היא פרויקט. מחזיר שם → נתיב */
export async function knownProjectDirs(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const base of projectRoots()) {
    for (const e of await fs.readdir(base, { withFileTypes: true }).catch(() => [])) if (e.isDirectory() && !e.name.startsWith(".")) out.set(e.name, path.join(base, e.name));
  }
  return out;
}
