#!/usr/bin/env node
// שומר git לכל סשני Claude Code (hook מסוג PreToolUse על Bash ב-~/.claude/settings.json). בלי תלויות.
//
// לפני פעולת git שמשנה את הריפו המשותף (commit, reset, rebase, stash, checkout, merge...) בודק אם סשן חי אחר של
// Claude Code (מפקדה, טרמינל, VS Code), או סשן של ספק אחר שמפקדה מריצה (Codex וכו', <נתונים>/sessions), עובד באותו שורש git. אם כן, מחזיר "ask" עם הסבר מי עוד שם, כדי
// שסשן אחד לא יבטל לסשן אחר commit (קרה ב-30/10: reset שתי שניות אחרי commit של סשן אחר).
// worktree נפרד הוא שורש אחר, ולכן לא נחשב התנגשות. אותה בדיקה ב-server/src/activity.ts.
// כל כשל (קלט לא צפוי, git לא זמין) = לא מתערבים: עדיף שומר שמפספס מאשר שומר שחוסם עבודה.
// זה שומר התנגשויות, לא הרשאות. חסימת git בסשנים של משימות היא ב-server/src/gitPolicy.ts (hook של ה-SDK ב-live.ts).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const MUTATING = "commit|reset|rebase|stash|checkout|switch|merge|cherry-pick|revert|restore|clean|pull|am";
// git [-C dir | -c k=v ...] <פקודה>. stash list/show הן קריאה בלבד
const GIT_RE = new RegExp(String.raw`(?:^|[;&|(\s])git((?:\s+(?:-C\s+(?:"[^"]+"|'[^']+'|\S+)|-c\s+\S+|--no-pager))*)\s+(${MUTATING})\b(?!\s+(?:list|show)\b)`, "g");

// שפת ההסבר: MIFKADA_LANG, אחרת system.lang מההגדרות של מפקדה, ב-auto לפי LANG. לא ידוע = אנגלית
// תיקיית הנתונים של מפקדה, כמו dataDir ב-server/src/platform.ts (הסקריפט בלי תלויות, לכן מועתק)
function defaultData() {
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "מפקדה");
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "מפקדה");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "מפקדה");
}
const DATA = process.env.MIFKADA_DATA || defaultData();

function lang() {
  const forced = process.env.MIFKADA_LANG;
  if (forced === "he" || forced === "en") return forced;
  try {
    const data = DATA;
    const l = JSON.parse(fs.readFileSync(path.join(data, "settings.json"), "utf8"))?.system?.lang;
    if (l === "he" || l === "en") return l;
  } catch {
    /* אין הגדרות */
  }
  return /^(he|iw)/i.test(process.env.LC_ALL || process.env.LANG || "") ? "he" : "en";
}
const L = (he, en) => (lang() === "he" ? he : en);

function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

function root(dir) {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

const unquote = (s) => s.replace(/^(["'])(.*)\1$/, "$2");

const input = readStdin();
const cmd = input?.tool_input?.command;
if (typeof cmd !== "string" || !/\bgit\b/.test(cmd)) process.exit(0);
const cwd = typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd();
// "cd <dir> && git ..." בתחילת הפקודה: התיקייה האמיתית
const cdDir = /^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*&&/.exec(cmd)?.[1];
const base = cdDir ? path.resolve(cwd, unquote(cdDir).replace(/^~(?=\/|$)/, os.homedir())) : cwd;

const ops = [];
for (const m of cmd.matchAll(GIT_RE)) {
  const dashC = /-C\s+("[^"]+"|'[^']+'|\S+)/.exec(m[1] ?? "")?.[1];
  ops.push({ op: m[2], dir: dashC ? path.resolve(base, unquote(dashC)) : base });
}
if (!ops.length) process.exit(0);

// הסשנים של Claude Code, והסשנים של ספקים אחרים שמפקדה רושמת באותו פורמט
const sessionDirs = [path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "sessions"), path.join(DATA, "sessions")];
const files = [];
for (const d of sessionDirs) {
  try {
    for (const n of fs.readdirSync(d)) if (n.endsWith(".json")) files.push(path.join(d, n));
  } catch {
    /* אין תיקייה */
  }
}
const others = [];
for (const file of files) {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof j.sessionId !== "string" || typeof j.pid !== "number" || typeof j.cwd !== "string") continue;
    if (j.sessionId === input.session_id || !alive(j.pid)) continue;
    others.push(j);
  } catch {
    /* קובץ חלקי */
  }
}
if (!others.length) process.exit(0);

const rootCache = new Map();
const rootOf = (d) => {
  if (!rootCache.has(d)) rootCache.set(d, root(d));
  return rootCache.get(d);
};
const where = (e = "") => (e.startsWith("mifkada-") ? `${e.slice(8)} · ${L("מפקדה", "Mifkada")}` : e.includes("vscode") ? "VS Code" : e.startsWith("sdk") ? L("מפקדה", "Mifkada") : L("טרמינל", "terminal"));

for (const { op, dir } of ops) {
  const r = rootOf(dir);
  if (!r) continue;
  const same = others.filter((o) => rootOf(o.cwd) === r);
  if (!same.length) continue;
  const list = same
    .slice(0, 4)
    .map((o) => `${o.name || path.basename(o.cwd)} (${where(o.entrypoint)}, ${o.cwd.replace(os.homedir(), "~")})`)
    .join("; ");
  const repo = r.replace(os.homedir(), "~");
  const reason = L(
    `git ${op} בריפו ${repo}, ועוד ${same.length} סשנים עובדים בו עכשיו: ${list}${same.length > 4 ? " ועוד" : ""}. ` +
      `פעולה כזו יכולה לדרוס או לבטל עבודה שלהם (commit, reset, stash). כדאי לוודא שהם לא באמצע משהו, או לעבוד בענף נפרד (worktree).`,
    `git ${op} in the repo ${repo}, and ${same.length} other sessions are working in it right now: ${list}${same.length > 4 ? " and more" : ""}. ` +
      `This can overwrite or undo their work (commit, reset, stash). Make sure they're not in the middle of something, or work on a separate branch (worktree).`,
  );
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: reason } }));
  process.exit(0);
}
process.exit(0);
