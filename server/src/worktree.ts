import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { L } from "./i18n.js";

function git(cwd: string, args: string[]): Promise<{ out: string; err: string; code: number }> {
  return new Promise((resolve) => {
    execFile("git", ["-C", cwd, ...args], { timeout: 60000, maxBuffer: 8 * 1024 * 1024 }, (e, stdout, stderr) => {
      resolve({ out: String(stdout).trim(), err: String(stderr).trim(), code: e ? 1 : 0 });
    });
  });
}

export interface Worktree {
  path: string;
  branch: string;
  base: string;
  root: string;
  prefix: string;
}

/**
 * ענף ו-worktree נפרדים למשימה: <root>/../.mifkada-worktrees/<repo>-<id>, ענף mifkada/<id>
 * מה-HEAD הנוכחי. כך כמה משימות באותו פרויקט לא דורסות זו את זו ולא את עץ העבודה הראשי.
 */
export async function createWorktree(cwd: string, id: string, slug: string): Promise<Worktree> {
  const root = (await git(cwd, ["rev-parse", "--show-toplevel"])).out;
  if (!root) throw new Error(L("הפרויקט אינו ריפו של git, אי אפשר לפתוח ענף נפרד", "The project isn't a git repo, so a separate branch can't be created"));
  const prefix = (await git(cwd, ["rev-parse", "--show-prefix"])).out;
  const base = (await git(root, ["rev-parse", "--abbrev-ref", "HEAD"])).out || "HEAD";
  const branch = `mifkada/${slug}-${id.slice(0, 6)}`;
  const dir = path.join(path.dirname(root), ".mifkada-worktrees", `${path.basename(root)}-${id.slice(0, 8)}`);
  await fs.mkdir(path.dirname(dir), { recursive: true });
  // הפעלה חוזרת של משימה שכבר היה לה ענף (המשימה איבדה את ה-worktree שלה, או שהוא נמחק ידנית): ממשיכים את
  // הענף הקיים עם העבודה שבו. לפני זה `-b` נכשל ב-"branch already exists" והמשימה לא רצה בכלל
  const existing = worktreeOf(await git(root, ["worktree", "list", "--porcelain"]), branch);
  if (existing) return { path: existing, branch, base, root, prefix };
  const hasBranch = (await git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])).code === 0;
  const r = await git(root, hasBranch ? ["worktree", "add", dir, branch] : ["worktree", "add", "-b", branch, dir, "HEAD"]);
  if (r.code !== 0) throw new Error(L(`git worktree add נכשל: ${r.err}`, `git worktree add failed: ${r.err}`));
  return { path: dir, branch, base, root, prefix };
}

/** הנתיב של ה-worktree שהענף מוצא בו, מתוך `git worktree list --porcelain`. */
function worktreeOf(list: { out: string; code: number }, branch: string): string | null {
  if (list.code !== 0) return null;
  for (const block of list.out.split("\n\n")) {
    const lines = block.split("\n");
    const wt = lines.find((l) => l.startsWith("worktree "));
    if (wt && lines.includes(`branch refs/heads/${branch}`)) return wt.slice("worktree ".length);
  }
  return null;
}

/** כמה קבצים שונו בענף מול הבסיס, כולל שינויים שעוד לא קומטו. */
export async function worktreeStatus(wt: Worktree): Promise<{ changed: number; commits: number }> {
  const [st, log] = await Promise.all([git(wt.path, ["status", "--porcelain"]), git(wt.path, ["rev-list", "--count", `${wt.base}..HEAD`])]);
  return { changed: st.out.split("\n").filter(Boolean).length, commits: Number(log.out) || 0 };
}

/** מקמט את מה שנשאר בענף, ממזג לענף הבסיס בריפו הראשי, ומוחק את ה-worktree והענף. */
export async function mergeWorktree(wt: Worktree, title: string): Promise<string> {
  const st = await git(wt.path, ["status", "--porcelain"]);
  if (st.out) {
    await git(wt.path, ["add", "-A"]);
    const c = await git(wt.path, ["commit", "-q", "-m", L(`משימה: ${title}`, `Task: ${title}`)]);
    if (c.code !== 0) throw new Error(L(`קומיט בענף נכשל: ${c.err}`, `Commit on the branch failed: ${c.err}`));
  }
  const current = (await git(wt.root, ["rev-parse", "--abbrev-ref", "HEAD"])).out;
  if (current !== wt.base) throw new Error(L(`הריפו הראשי נמצא בענף ${current} ולא ב-${wt.base}. צריך לעבור ל-${wt.base} לפני המיזוג.`, `The main repo is on branch ${current}, not ${wt.base}. Switch to ${wt.base} before merging.`));
  const m = await git(wt.root, ["merge", "--no-ff", "-m", L(`מיזוג משימה: ${title}`, `Merge task: ${title}`), wt.branch]);
  if (m.code !== 0) {
    await git(wt.root, ["merge", "--abort"]);
    throw new Error(L(`המיזוג נכשל (כנראה שינויים לא שמורים בעץ הראשי או קונפליקט): ${m.err || m.out}`, `Merge failed (probably uncommitted changes in the main tree, or a conflict): ${m.err || m.out}`));
  }
  await removeWorktree(wt);
  return (await git(wt.root, ["rev-parse", "--short", "HEAD"])).out;
}

/** זורק את הענף: מוחק את ה-worktree ואת הענף בלי למזג. */
export async function removeWorktree(wt: Worktree): Promise<void> {
  await git(wt.root, ["worktree", "remove", "--force", wt.path]);
  await git(wt.root, ["branch", "-D", wt.branch]);
  await git(wt.root, ["worktree", "prune"]);
}
