import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./paths.js";

const KEEP = 14;

/** גיבוי יומי של קבצי הנתונים (קנבן, רוטינות, סיכומים, ערכות) ל-data/backups/<תאריך>. שומר 14 אחרונים. */
export async function backupNow(): Promise<string | null> {
  const day = new Date().toISOString().slice(0, 10);
  const dir = path.join(DATA_DIR, "backups", day);
  let files: string[] = [];
  try {
    files = (await fs.readdir(DATA_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  await fs.mkdir(dir, { recursive: true });
  for (const f of files) await fs.copyFile(path.join(DATA_DIR, f), path.join(dir, f));
  const all = (await fs.readdir(path.join(DATA_DIR, "backups"))).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP))) await fs.rm(path.join(DATA_DIR, "backups", old), { recursive: true, force: true });
  return dir;
}

export function scheduleBackups(): void {
  setTimeout(() => void backupNow().catch(() => undefined), 20000);
  setInterval(() => void backupNow().catch(() => undefined), 6 * 3600000);
}

export async function listBackups(): Promise<string[]> {
  try {
    return (await fs.readdir(path.join(DATA_DIR, "backups"))).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
  } catch {
    return [];
  }
}
