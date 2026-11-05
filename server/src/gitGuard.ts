import os from "node:os";
import path from "node:path";
import { L } from "./i18n.js";
import { activeInRepo, repoRoot, type RepoSession } from "./activity.js";

/*
 * שומר git לסשנים של ספקים אחרים (ACP). אצל Claude Code אותה בדיקה רצה כ-hook (bin/mifkada-git-guard.mjs, בלי תלויות),
 * כאן היא רצה בתוך בקשת האישור. הביטוי והפענוח זהים לסקריפט: שינוי באחד מחייב שינוי בשני.
 */

const MUTATING = "commit|reset|rebase|stash|checkout|switch|merge|cherry-pick|revert|restore|clean|pull|am";
// git [-C dir | -c k=v ...] <פקודה>. stash list/show הן קריאה בלבד
const GIT_RE = new RegExp(String.raw`(?:^|[;&|(\s])git((?:\s+(?:-C\s+(?:"[^"]+"|'[^']+'|\S+)|-c\s+\S+|--no-pager))*)\s+(${MUTATING})\b(?!\s+(?:list|show)\b)`, "g");

const unquote = (s: string) => s.replace(/^(["'])(.*)\1$/, "$2");

/** פעולות git שמשנות את הריפו בפקודה, עם התיקייה שבה כל אחת רצה (cd בתחילת הפקודה, -C) */
export function gitOps(cmd: string, cwd: string): Array<{ op: string; dir: string }> {
  if (!/\bgit\b/.test(cmd)) return [];
  const cdDir = /^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*&&/.exec(cmd)?.[1];
  const base = cdDir ? path.resolve(cwd, unquote(cdDir).replace(/^~(?=\/|$)/, os.homedir())) : cwd;
  const ops: Array<{ op: string; dir: string }> = [];
  for (const m of cmd.matchAll(GIT_RE)) {
    const dashC = /-C\s+("[^"]+"|'[^']+'|\S+)/.exec(m[1] ?? "")?.[1];
    ops.push({ op: m[2], dir: dashC ? path.resolve(base, unquote(dashC)) : base });
  }
  return ops;
}

export function whereLabel(entrypoint: string): string {
  if (entrypoint.startsWith("mifkada-")) return `${entrypoint.slice(8)} · ${L("מפקדה", "Mifkada")}`;
  return entrypoint.includes("vscode") ? "VS Code" : entrypoint.startsWith("sdk") ? L("מפקדה", "Mifkada") : L("טרמינל", "terminal");
}

/**
 * אזהרה לפקודה שמשנה ריפו שסשן חי אחר עובד בו עכשיו, או null.
 * exclude: מזהי הסשן של מי ששואל (כדי לא להזהיר מעצמו). כל כשל = null: עדיף שומר שמפספס מאשר שומר שחוסם
 */
export async function gitConflictWarning(cmd: string, cwd: string, exclude: Iterable<string> = []): Promise<string | null> {
  try {
    for (const { op, dir } of gitOps(cmd, cwd)) {
      if (!(await repoRoot(dir))) continue;
      const { root, sessions } = await activeInRepo(dir, exclude);
      if (!root || !sessions.length) continue;
      const list = sessions
        .slice(0, 4)
        .map((o: RepoSession) => `${o.name || path.basename(o.cwd)} (${whereLabel(o.entrypoint)}, ${o.cwd.replace(os.homedir(), "~")})`)
        .join("; ");
      const repo = root.replace(os.homedir(), "~");
      return L(
        `git ${op} בריפו ${repo}, ועוד ${sessions.length} סשנים עובדים בו עכשיו: ${list}${sessions.length > 4 ? " ועוד" : ""}. פעולה כזו יכולה לדרוס או לבטל עבודה שלהם (commit, reset, stash). כדאי לוודא שהם לא באמצע משהו, או לעבוד בענף נפרד (worktree).`,
        `git ${op} in the repo ${repo}, and ${sessions.length} other sessions are working in it right now: ${list}${sessions.length > 4 ? " and more" : ""}. This can overwrite or undo their work (commit, reset, stash). Make sure they're not in the middle of something, or work on a separate branch (worktree).`,
      );
    }
  } catch {
    /* לא מתערבים */
  }
  return null;
}
