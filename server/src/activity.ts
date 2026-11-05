import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { CLAUDE_HOME, DATA_DIR } from "./paths.js";

/*
 * מי עוד עובד באותו ריפו: כל סשן חי של Claude Code (מפקדה, טרמינל, VS Code, סוכנים שרצים ברקע) כותב
 * ~/.claude/sessions/<pid>.json עם התיקייה שלו. שני סשנים באותו שורש git (לא worktree נפרד) יכולים לדרוס זה
 * את זה, כמו ב-30/10: reset של סשן אחד ביטל commit של סשן אחר שתי שניות קודם.
 * סשנים של ספקים אחרים (Codex וכו', דרך ACP) לא כותבים לשם, לכן מפקדה רושמת אותם באותו פורמט ב-<נתונים>/sessions
 * (pid = תהליך הסוכן, entrypoint = "mifkada-<ספק>"). שתי התיקיות נסרקות.
 * את אותה בדיקה עושה גם bin/mifkada-git-guard.mjs (hook גלובלי, בלי תלויות), ולכן שני המימושים צריכים להישאר זהים.
 */

/** רישום הסשנים החיים של ספקים שאינם Claude, בפורמט של ~/.claude/sessions */
export const MIFKADA_SESSIONS = path.join(DATA_DIR, "sessions");

export async function registerLiveSession(s: { pid: number; sessionId: string; cwd: string; provider: string; name: string; status: string }): Promise<void> {
  await fs.mkdir(MIFKADA_SESSIONS, { recursive: true });
  const body = { pid: s.pid, sessionId: s.sessionId, cwd: s.cwd, entrypoint: `mifkada-${s.provider}`, name: s.name, status: s.status, updatedAt: Date.now() };
  await fs.writeFile(path.join(MIFKADA_SESSIONS, `${s.pid}.json`), JSON.stringify(body));
}

export async function unregisterLiveSession(pid: number): Promise<void> {
  await fs.rm(path.join(MIFKADA_SESSIONS, `${pid}.json`), { force: true });
}

export interface RepoSession {
  sessionId: string;
  pid: number;
  cwd: string;
  entrypoint: string;
  status: string;
  name: string;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** שורש העץ של git (worktree נפרד מחזיר את עצמו, ולכן לא נחשב התנגשות). null אם זו לא תיקיית git */
export function repoRoot(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { timeout: 3000 }, (err, out) => resolve(err ? null : out.trim() || null));
  });
}

export async function activeInRepo(cwd: string, exclude: Iterable<string> = []): Promise<{ root: string | null; sessions: RepoSession[] }> {
  const root = await repoRoot(cwd);
  if (!root) return { root: null, sessions: [] };
  const skip = new Set(exclude);
  const dirs = [path.join(CLAUDE_HOME, "sessions"), MIFKADA_SESSIONS];
  const files = (await Promise.all(dirs.map(async (d) => (await fs.readdir(d).catch(() => [] as string[])).filter((n) => n.endsWith(".json")).map((n) => path.join(d, n))))).flat();
  const roots = new Map<string, Promise<string | null>>();
  const out: RepoSession[] = [];
  await Promise.all(
    files.map(async (file) => {
      try {
        const j = JSON.parse(await fs.readFile(file, "utf8"));
        if (typeof j.sessionId !== "string" || typeof j.pid !== "number" || typeof j.cwd !== "string") return;
        if (skip.has(j.sessionId) || !alive(j.pid)) return;
        if (!roots.has(j.cwd)) roots.set(j.cwd, repoRoot(j.cwd));
        if ((await roots.get(j.cwd)) !== root) return;
        out.push({ sessionId: j.sessionId, pid: j.pid, cwd: j.cwd, entrypoint: String(j.entrypoint ?? ""), status: String(j.status ?? ""), name: String(j.name ?? "") });
      } catch {
        /* קובץ חלקי או פגום */
      }
    }),
  );
  return { root, sessions: out };
}
