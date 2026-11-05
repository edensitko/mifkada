import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { L } from "./i18n.js";

function git(cwd: string, args: string[], maxBuffer = 8 * 1024 * 1024): Promise<{ out: string; err: string; code: number }> {
  return new Promise((resolve) => {
    execFile("git", ["-C", cwd, ...args], { timeout: 15000, maxBuffer }, (e, stdout, stderr) => {
      const code = e && typeof (e as { code?: unknown }).code === "number" ? ((e as { code: number }).code) : e ? 1 : 0;
      resolve({ out: String(stdout), err: String(stderr), code });
    });
  });
}

export interface ChangedFile {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflict";
  staged: boolean;
  additions: number;
  deletions: number;
}

/** הנתיב של cwd בתוך הריפו (ריק בשורש), כדי שפרויקט בתוך monorepo יראה רק את עצמו. */
async function prefix(cwd: string): Promise<string> {
  return (await git(cwd, ["rev-parse", "--show-prefix"])).out.trim();
}

/** הקבצים שהשתנו בתיקיית הפרויקט (ולא בכל הריפו), כולל חדשים, עם ספירת שורות. */
export async function changedFiles(cwd: string): Promise<ChangedFile[]> {
  const inside = (await git(cwd, ["rev-parse", "--is-inside-work-tree"])).out.trim() === "true";
  if (!inside) return [];
  const [status, untracked, numstat, staged, unmerged] = await Promise.all([
    git(cwd, ["diff", "--relative", "--name-status", "HEAD", "--", "."]),
    git(cwd, ["ls-files", "--others", "--exclude-standard", "--", "."]),
    git(cwd, ["diff", "--relative", "--numstat", "HEAD", "--", "."]),
    git(cwd, ["diff", "--cached", "--relative", "--name-only", "--", "."]),
    git(cwd, ["diff", "--relative", "--name-only", "--diff-filter=U", "--", "."]),
  ]);
  const stats = new Map<string, { a: number; d: number }>();
  for (const line of numstat.out.split("\n")) {
    const [a, d, pth] = line.split("\t");
    if (pth) stats.set(pth, { a: Number(a) || 0, d: Number(d) || 0 });
  }
  const stagedSet = new Set(staged.out.split("\n").filter(Boolean));
  const conflicts = new Set(unmerged.out.split("\n").filter(Boolean));
  const files: ChangedFile[] = [];
  for (const line of status.out.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const code = parts[0][0];
    const pth = parts[parts.length - 1];
    let st: ChangedFile["status"] = "modified";
    if (conflicts.has(pth)) st = "conflict";
    else if (code === "A") st = "added";
    else if (code === "D") st = "deleted";
    else if (code === "R") st = "renamed";
    const n = stats.get(pth);
    files.push({ path: pth, status: st, staged: stagedSet.has(pth), additions: n?.a ?? 0, deletions: n?.d ?? 0 });
  }
  for (const pth of untracked.out.split("\n").filter(Boolean)) {
    let additions = 0;
    try {
      const buf = await fs.readFile(path.join(cwd, pth));
      if (!buf.subarray(0, 8000).includes(0)) additions = buf.toString("utf8").split("\n").length;
    } catch {
      /* נעלם */
    }
    files.push({ path: pth, status: "untracked", staged: false, additions, deletions: 0 });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

/** תוכן לפני ואחרי לקובץ אחד, ל-diff צד-לצד. */
export async function fileDiff(cwd: string, p: string): Promise<{ before: string; after: string; binary: boolean }> {
  const abs = path.resolve(cwd, p);
  if (!abs.startsWith(path.resolve(cwd) + path.sep)) throw new Error(L("מחוץ לפרויקט", "Outside the project"));
  const head = await git(cwd, ["show", `HEAD:${await prefix(cwd)}${p}`], 16 * 1024 * 1024);
  const before = head.code === 0 ? head.out : "";
  let after = "";
  try {
    const buf = await fs.readFile(abs);
    if (buf.subarray(0, 8000).includes(0)) return { before: "", after: "", binary: true };
    after = buf.toString("utf8");
  } catch {
    after = "";
  }
  return { before, after, binary: false };
}

/** ביטול השינויים בקובץ: חזרה ל-HEAD, או מחיקה אם הוא חדש. */
export async function discardFile(cwd: string, p: string): Promise<void> {
  const abs = path.resolve(cwd, p);
  if (!abs.startsWith(path.resolve(cwd) + path.sep)) throw new Error(L("מחוץ לפרויקט", "Outside the project"));
  const tracked = (await git(cwd, ["ls-files", "--error-unmatch", "--", p])).code === 0;
  if (tracked) {
    const r = await git(cwd, ["checkout", "HEAD", "--", p]);
    if (r.code !== 0) throw new Error(r.err.trim());
    await git(cwd, ["reset", "-q", "HEAD", "--", p]);
  } else {
    await fs.rm(abs, { force: true });
  }
}

export async function commitAll(cwd: string, message: string, paths?: string[]): Promise<{ hash: string }> {
  if (!message.trim()) throw new Error(L("חסרה הודעת קומיט", "Commit message is missing"));
  const add = await git(cwd, ["add", "-A", "--", ...(paths && paths.length ? paths : ["."])]);
  if (add.code !== 0) throw new Error(add.err.trim());
  const c = await git(cwd, ["commit", "-q", "-m", message.trim()]);
  if (c.code !== 0) throw new Error(c.err.trim() || c.out.trim());
  const h = await git(cwd, ["rev-parse", "--short", "HEAD"]);
  return { hash: h.out.trim() };
}
