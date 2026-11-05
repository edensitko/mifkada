import fs from "node:fs/promises";
import path from "node:path";
import { CLAUDE_HOME, DATA_DIR } from "./paths.js";

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { claudeExe } from "./claudeExe.js";

const SKIP_DIRS = ["node_modules", ".git", ".next", "dist", "release", ".turbo", ".cache", "build"];

/**
 * ripgrep: מ-$RG, מ-Homebrew, ואם אין אז הבינארי של Claude Code שה-SDK מביא, שמתנהג כ-rg כשמריצים אותו
 * עם argv0=rg (כך גם הפונקציה `rg` ב-shell של Claude Code עובדת).
 */
function resolveRg(): { bin: string; argv0: string } {
  if (process.env.RG) return { bin: process.env.RG, argv0: "rg" };
  if (existsSync("/opt/homebrew/bin/rg")) return { bin: "/opt/homebrew/bin/rg", argv0: "rg" };
  // הבינארי של Claude Code (של ה-SDK או המותקן) כולל ripgrep
  const c = claudeExe();
  return { bin: c?.bin ?? "rg", argv0: "rg" };
}
const RG = resolveRg();

function run(_bin: string, args: string[], cwd?: string, maxBuffer = 16 * 1024 * 1024): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(RG.bin, args, { cwd, argv0: RG.argv0, stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => child.kill(), 15000);
    child.stdout.on("data", (b: Buffer) => {
      size += b.length;
      if (size <= maxBuffer) chunks.push(b);
      else child.kill();
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve("");
    });
  });
}

/** כל הקבצים בפרויקט (ל-⌘P), בלי תיקיות כבדות, עד תקרה. */
/** נתיב יחסי מ-ripgrep עם / בכל מערכת (ב-Windows הוא מחזיר \) */
const toSlash = (p: string): string => (process.platform === "win32" ? p.replace(/\\/g, "/") : p);

export async function listFiles(cwd: string, limit = 8000): Promise<string[]> {
  const out = await run("", ["--files", "--hidden", ...SKIP_DIRS.flatMap((d) => ["-g", `!${d}`]), "-g", "!.DS_Store"], cwd);
  // Windows: ripgrep מחזיר \ ו-\r\n. הממשק עובד עם נתיבים יחסיים עם /
  const files = out.split(/\r?\n/).filter(Boolean).map(toSlash);
  if (files.length === 0) {
    // בלי ripgrep: סריקה פשוטה
    const acc: string[] = [];
    const walk = async (dir: string, rel: string) => {
      if (acc.length >= limit) return;
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.includes(e.name) || e.name === ".DS_Store") continue;
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(path.join(dir, e.name), r);
        else if (e.isFile()) acc.push(r);
      }
    };
    await walk(cwd, "");
    return acc.slice(0, limit);
  }
  return files.slice(0, limit);
}

export interface SearchHit {
  path: string;
  line: number;
  text: string;
}

/** חיפוש טקסט בפרויקט עם ripgrep. */
export async function searchText(cwd: string, q: string, limit = 300): Promise<SearchHit[]> {
  if (!q.trim()) return [];
  const out = await run("", ["--json", "-n", "-i", "-F", "--max-count", "20", "--max-filesize", "1M", ...SKIP_DIRS.flatMap((d) => ["-g", `!${d}`]), "--", q, "."], cwd);
  const hits: SearchHit[] = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line.startsWith('{"type":"match"')) continue;
    try {
      const j = JSON.parse(line) as { data: { path: { text: string }; line_number: number; lines: { text: string } } };
      hits.push({ path: toSlash(j.data.path.text).replace(/^\.\//, ""), line: j.data.line_number, text: j.data.lines.text.trimEnd().slice(0, 240) });
      if (hits.length >= limit) break;
    } catch {
      /* שורה לא תקינה */
    }
  }
  return hits;
}

export interface TranscriptHit {
  sessionId: string;
  snippet: string;
  count: number;
}

/** חיפוש בתוך תמלילי הסשנים: של Claude Code, ושל ספקים אחרים (התמלילים שמפקדה שומרת ב-<נתונים>/transcripts). */
export async function searchTranscripts(q: string, limit = 40): Promise<TranscriptHit[]> {
  if (q.trim().length < 2) return [];
  const [claude, others] = await Promise.all([searchClaudeTranscripts(q, limit), searchProviderTranscripts(q, limit)]);
  return [...claude, ...others].sort((a, b) => b.count - a.count).slice(0, limit);
}

/** תמלילים של ספקים אחרים: שורה = TranscriptMessage */
async function searchProviderTranscripts(q: string, limit: number): Promise<TranscriptHit[]> {
  const dir = path.join(DATA_DIR, "transcripts");
  const out = await run("", ["--json", "-i", "-F", "--max-count", "5", "-g", "*.jsonl", "--", q, dir]);
  const byFile = new Map<string, { count: number; snippet: string }>();
  for (const line of out.split(/\r?\n/)) {
    if (!line.startsWith('{"type":"match"')) continue;
    try {
      const j = JSON.parse(line) as { data: { path: { text: string }; lines: { text: string } } };
      const rec = JSON.parse(j.data.lines.text) as { blocks?: Array<{ type?: string; text?: string; content?: string }> };
      const text = (rec.blocks ?? []).map((b) => b.text ?? b.content ?? "").join(" ");
      const i = text.toLowerCase().indexOf(q.toLowerCase());
      const snippet = i >= 0 ? text.slice(Math.max(0, i - 60), i + q.length + 80).replace(/\s+/g, " ") : "";
      const cur = byFile.get(j.data.path.text) ?? { count: 0, snippet };
      cur.count++;
      if (!cur.snippet) cur.snippet = snippet;
      byFile.set(j.data.path.text, cur);
    } catch {
      /* שורה לא תקינה */
    }
  }
  return [...byFile.entries()].map(([file, v]) => ({ sessionId: path.basename(file, ".jsonl"), snippet: v.snippet, count: v.count })).slice(0, limit);
}

async function searchClaudeTranscripts(q: string, limit: number): Promise<TranscriptHit[]> {
  const dir = path.join(CLAUDE_HOME, "projects");
  const out = await run("", ["--json", "-i", "-F", "--max-count", "5", "-g", "*.jsonl", "--", q, dir]);
  const byFile = new Map<string, { count: number; snippet: string }>();
  for (const line of out.split(/\r?\n/)) {
    if (!line.startsWith('{"type":"match"')) continue;
    try {
      const j = JSON.parse(line) as { data: { path: { text: string }; lines: { text: string } } };
      const file = j.data.path.text;
      const raw = j.data.lines.text;
      let snippet = "";
      try {
        const rec = JSON.parse(raw) as { message?: { content?: unknown } };
        const c = rec.message?.content;
        const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (b && typeof b === "object" && (b as { type?: string }).type === "text" ? String((b as { text?: string }).text ?? "") : "")).join(" ") : "";
        const i = text.toLowerCase().indexOf(q.toLowerCase());
        snippet = i >= 0 ? text.slice(Math.max(0, i - 60), i + q.length + 80).replace(/\s+/g, " ") : "";
      } catch {
        snippet = "";
      }
      if (!snippet) {
        // ההתאמה בתוך קלט של כלי או תוצאה: קטע מהשורה הגולמית, בלי בריחות JSON
        const i = raw.toLowerCase().indexOf(q.toLowerCase());
        snippet = raw
          .slice(Math.max(0, i - 60), i + q.length + 80)
          .replace(/\\n/g, " ")
          .replace(/\\"/g, '"')
          .replace(/\s+/g, " ")
          .trim();
      }
      const cur = byFile.get(file) ?? { count: 0, snippet };
      cur.count++;
      if (!cur.snippet) cur.snippet = snippet;
      byFile.set(file, cur);
    } catch {
      /* שורה לא תקינה */
    }
  }
  return [...byFile.entries()]
    .map(([file, v]) => ({ sessionId: path.basename(file, ".jsonl"), snippet: v.snippet, count: v.count }))
    .filter((h) => /^[0-9a-f-]{36}$/.test(h.sessionId))
    .slice(0, limit);
}
