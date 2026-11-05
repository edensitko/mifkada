import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertBrowsable } from "./access.js";
import { isProtectedDir } from "./paths.js";
import { projectRoots } from "./roots.js";
import type { BrowseResult, BrowseEntry } from "../../shared/protocol.js";

/*
 * בורר התיקיות של "סשן חדש": רק תיקיות (לא קבצים), בגבולות של assertBrowsable (בית, בלי מוגנות, בלי node_modules).
 * ריפואי git קודם ואז לפי שם, עד MAX רשומות.
 */
const MAX = 500;

const exists = (p: string) =>
  fs.access(p).then(
    () => true,
    () => false,
  );

async function hasSubdirs(dir: string, hidden: boolean): Promise<boolean> {
  const d = await fs.opendir(dir).catch(() => null);
  if (!d) return false;
  try {
    for await (const e of d) if ((e.isDirectory() || e.isSymbolicLink()) && e.name !== "node_modules" && (hidden || !e.name.startsWith("."))) return true;
  } catch {
    /* אין הרשאה */
  }
  return false;
}

/** ~ במקום תיקיית הבית, לתצוגה */
export function tildify(p: string, home = os.homedir()): string {
  return p === home ? "~" : p.startsWith(home + path.sep) ? "~" + p.slice(home.length) : p;
}

export async function browseDir(p: string, opts: { hidden?: boolean } = {}): Promise<BrowseResult> {
  const hidden = Boolean(opts.hidden);
  const home = await fs.realpath(os.homedir()).catch(() => os.homedir());
  // שורשים לקיצורי דרך: תיקיות הפרויקטים שקיימות ושמותר לדפדף בהן, ואם אין אז הבית
  const roots: string[] = [];
  for (const r of projectRoots()) {
    const ok = await assertBrowsable(r).catch(() => null);
    if (ok && !roots.includes(ok)) roots.push(ok);
  }
  const target = await assertBrowsable(p.trim() || roots[0] || home, { hidden });

  const items = await fs.readdir(target, { withFileTypes: true });
  const dirs: string[] = [];
  for (const it of items) {
    if (it.name === "node_modules" || (!hidden && it.name.startsWith("."))) continue;
    const full = path.join(target, it.name);
    if (isProtectedDir(full)) continue;
    if (it.isDirectory()) dirs.push(it.name);
    else if (it.isSymbolicLink()) {
      // קישור לתיקייה: רק אם הוא נשאר בתוך הבית
      const r = await fs.realpath(full).catch(() => null);
      if (r && (r === home || r.startsWith(home + path.sep)) && !isProtectedDir(r) && (await fs.stat(r).catch(() => null))?.isDirectory()) dirs.push(it.name);
    }
  }
  const truncated = dirs.length > MAX;
  const entries: BrowseEntry[] = await Promise.all(
    dirs.slice(0, MAX * 4).map(async (name) => {
      const full = path.join(target, name);
      const [isGitRepo, hasChildren] = await Promise.all([exists(path.join(full, ".git")), hasSubdirs(full, hidden)]);
      return { name, path: full, isGitRepo, hasChildren };
    }),
  );
  entries.sort((a, b) => (a.isGitRepo === b.isGitRepo ? a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }) : a.isGitRepo ? -1 : 1));
  return {
    path: target,
    display: tildify(target, home),
    parent: target === home ? null : path.dirname(target),
    home,
    isGitRepo: await exists(path.join(target, ".git")),
    roots: roots.length ? roots : [home],
    entries: entries.slice(0, MAX),
    truncated,
  };
}
