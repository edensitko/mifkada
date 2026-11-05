import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * איזה Claude Code מריץ את הסשנים:
 * 1. MIFKADA_CLAUDE (נתיב מפורש)
 * 2. העותק שה-SDK מביא (@anthropic-ai/claude-agent-sdk-<מערכת>), כמו עד היום. ב-Electron הוא תמיד שם.
 * 3. claude שמותקן במחשב, אם הגרסה שלו לפחות זו שה-SDK דורש. האפליקציה של Tauri לא אורזת את העותק (272MB)
 *    ומשתמשת בזה של המשתמש, שגם ככה מותקן אצל כל מי שעובד עם Claude Code.
 */
export interface ClaudeExe {
  bin: string;
  source: "env" | "bundled" | "installed";
  version?: string;
}

const req = createRequire(import.meta.url);

/** הגרסה המינימלית: claudeCodeVersion של ה-SDK */
export function minClaudeVersion(): string {
  try {
    // package.json לא מיוצא ב-exports של ה-SDK, לכן דרך הקובץ הראשי שלו (בשורש החבילה)
    const dir = path.dirname(req.resolve("@anthropic-ai/claude-agent-sdk"));
    return (JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as { claudeCodeVersion?: string }).claudeCodeVersion ?? "0";
  } catch {
    return "0";
  }
}

/** השוואת גרסאות x.y.z (בלי סיומות) */
export function versionAtLeast(have: string, want: string): boolean {
  const a = have.split(".").map((n) => parseInt(n, 10) || 0);
  const b = want.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

function bundled(): string | null {
  try {
    const dir = path.dirname(req.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`));
    const bin = path.join(dir, process.platform === "win32" ? "claude.exe" : "claude");
    return existsSync(bin) ? bin : null;
  } catch {
    return null;
  }
}

/** claude מה-PATH. ב-Windows התקנת npm היא claude.cmd שה-SDK לא מריץ, לכן הבינארי שמאחוריה */
export function findInstalled(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | null {
  const sep = platform === "win32" ? ";" : ":";
  for (const dir of (env.PATH ?? "").split(sep).filter(Boolean)) {
    const names = platform === "win32" ? ["claude.exe", path.join("node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")] : ["claude"];
    for (const n of names) {
      const p = path.join(dir, n);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

function versionOf(bin: string): string | null {
  try {
    const out = execFileSync(bin, ["--version"], { timeout: 8000, encoding: "utf8", env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    return /(\d+\.\d+\.\d+)/.exec(out)?.[1] ?? null;
  } catch {
    return null;
  }
}

let cached: ClaudeExe | null | undefined;

export function claudeExe(): ClaudeExe | null {
  if (cached !== undefined) return cached;
  const env = process.env.MIFKADA_CLAUDE;
  if (env && existsSync(env)) return (cached = { bin: env, source: "env" });
  const b = bundled();
  if (b) return (cached = { bin: b, source: "bundled" });
  const inst = findInstalled();
  if (inst) {
    const real = (() => {
      try {
        return realpathSync(inst);
      } catch {
        return inst;
      }
    })();
    const v = versionOf(real);
    if (v && versionAtLeast(v, minClaudeVersion())) return (cached = { bin: real, source: "installed", version: v });
  }
  // לא נמצא (או ישן מדי): לא שומרים, כדי שהתקנה בזמן ריצה תיתפס בבדיקה הבאה
  return null;
}

/** לאפשרויות של query(): ריק כשמשתמשים בעותק של ה-SDK (ברירת המחדל שלו) */
export function sdkExe(): { pathToClaudeCodeExecutable?: string } {
  const c = claudeExe();
  return c && c.source !== "bundled" ? { pathToClaudeCodeExecutable: c.bin } : {};
}
