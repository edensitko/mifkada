import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { L } from "./i18n.js";
import { openCommand } from "./platform.js";

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile("git", ["-C", cwd, ...args], { timeout: 5000, maxBuffer: 1024 * 1024 }, (err, stdout) => resolve(err ? "" : String(stdout)));
  });
}

export interface GitInfo {
  isRepo: boolean;
  branch: string | null;
  changed: number;
  ahead: number;
  behind: number;
  lastCommit: { subject: string; time: number } | null;
}

/** מצב ה-git של תיקיית פרויקט, בלי לגעת בכלום. */
export async function gitInfo(cwd: string): Promise<GitInfo> {
  const empty: GitInfo = { isRepo: false, branch: null, changed: 0, ahead: 0, behind: 0, lastCommit: null };
  try {
    if (!(await fs.stat(cwd)).isDirectory()) return empty;
  } catch {
    return empty;
  }
  const inside = (await git(cwd, ["rev-parse", "--is-inside-work-tree"])).trim();
  if (inside !== "true") return empty;
  const [branch, status, log, counts] = await Promise.all([
    git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(cwd, ["status", "--porcelain"]),
    git(cwd, ["log", "-1", "--format=%s%n%ct"]),
    git(cwd, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]),
  ]);
  const [subject, ts] = log.trim().split("\n");
  const [a, b] = counts.trim().split(/\s+/).map((n) => Number(n) || 0);
  return {
    isRepo: true,
    branch: branch.trim() || null,
    changed: status.split("\n").filter((l) => l.trim()).length,
    ahead: a ?? 0,
    behind: b ?? 0,
    lastCommit: subject ? { subject, time: Number(ts) * 1000 || 0 } : null,
  };
}

/** פותח את תיקיית הפרויקט באפליקציה חיצונית (VS Code, מנהל הקבצים, טרמינל), לפי מערכת ההפעלה (platform.ts). */
export async function openIn(cwd: string, app: string): Promise<void> {
  if (app !== "vscode" && app !== "finder" && app !== "terminal") throw new Error(L("אפליקציה לא מוכרת", "Unknown app"));
  try {
    if (!(await fs.stat(cwd)).isDirectory()) throw new Error(L("התיקייה לא קיימת", "The folder doesn't exist"));
  } catch {
    throw new Error(L("התיקייה לא קיימת", "The folder doesn't exist"));
  }
  const { cmd, args } = openCommand(app, cwd);
  await new Promise<void>((resolve, reject) => {
    execFile(cmd, args, { timeout: 8000, cwd }, (err) => (err ? reject(new Error(L(`הפתיחה נכשלה: ${err.message}`, `Opening failed: ${err.message}`))) : resolve()));
  });
}
