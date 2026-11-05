import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

/*
 * כל מה שתלוי במערכת ההפעלה, במקום אחד: macOS (המקורית), Linux ו-Windows.
 * פונקציות טהורות שמקבלות את הפלטפורמה כפרמטר, כדי שאפשר לבדוק את Linux ו-Windows גם מהמק.
 * במק ההתנהגות זהה למה שהיה לפני הקובץ הזה.
 */

type Env = Record<string, string | undefined>;

/** תיקיית הנתונים של מפקדה (קנבן, הגדרות, תמלילים). אותה תיקייה ש-Electron נותן ל-userData באותה מערכת */
export function dataDir(platform: NodeJS.Platform = process.platform, env: Env = process.env, home = os.homedir()): string {
  if (platform === "darwin") return path.posix.join(home, "Library", "Application Support", "מפקדה");
  if (platform === "win32") return path.win32.join(env.APPDATA || path.win32.join(home, "AppData", "Roaming"), "מפקדה");
  return path.posix.join(env.XDG_CONFIG_HOME || path.posix.join(home, ".config"), "מפקדה");
}

/**
 * השקע שבו ה-daemon מאזין באפליקציה. macOS ו-Linux: קובץ שקע (600) בתיקיית הנתונים. Windows: named pipe,
 * כי אין שם קבצי שקע; השם נגזר מתיקיית הנתונים, כך ששתי התקנות (או משתמשים) לא מתנגשות.
 */
export function socketPath(dir: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== "win32") return path.posix.join(dir, "mifkada.sock");
  return `\\\\.\\pipe\\mifkada-${createHash("sha256").update(dir.toLowerCase()).digest("hex").slice(0, 12)}`;
}

export const isPipe = (p: string): boolean => p.startsWith("\\\\.\\pipe\\");

/** ה-shell של הטרמינל המובנה */
export function defaultShell(platform: NodeJS.Platform = process.platform, env: Env = process.env): { cmd: string; args: string[] } {
  if (platform === "win32") return { cmd: env.MIFKADA_SHELL || "powershell.exe", args: ["-NoLogo"] };
  return { cmd: env.SHELL || (platform === "darwin" ? "/bin/zsh" : "/bin/bash"), args: ["-il"] };
}

/** הפקודה שמחזירה את הנתיב של פקודה אחרת ב-PATH */
export function whichCommand(platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") return "where";
  return platform === "darwin" ? "/usr/bin/which" : "which";
}

export type OpenApp = "vscode" | "finder" | "terminal";

/**
 * פתיחת תיקיית פרויקט באפליקציה חיצונית: VS Code, מנהל הקבצים, טרמינל.
 * ב-Windows דרך cmd /c, כי code ו-wt הם .cmd/alias ש-execFile לא מריץ ישירות.
 */
export function openCommand(app: OpenApp, cwd: string, platform: NodeJS.Platform = process.platform): { cmd: string; args: string[] } {
  if (platform === "darwin") {
    const args = { vscode: ["-a", "Visual Studio Code"], finder: [], terminal: ["-a", "Terminal"] }[app];
    return { cmd: "open", args: [...args, cwd] };
  }
  if (platform === "win32") {
    if (app === "finder") return { cmd: "explorer.exe", args: [cwd] };
    if (app === "vscode") return { cmd: "cmd.exe", args: ["/c", "code", cwd] };
    // Windows Terminal אם יש, אחרת חלון PowerShell בתיקייה
    return { cmd: "cmd.exe", args: ["/c", "start", "", "wt.exe", "-d", cwd, "||", "start", "", "powershell.exe", "-NoExit", "-Command", `Set-Location -LiteralPath '${cwd.replace(/'/g, "''")}'`] };
  }
  if (app === "finder") return { cmd: "xdg-open", args: [cwd] };
  if (app === "vscode") return { cmd: "code", args: [cwd] };
  // x-terminal-emulator (Debian/Ubuntu) נפתח בתיקייה הנוכחית של התהליך: cwd של execFile
  return { cmd: "x-terminal-emulator", args: [] };
}

/** נתיבי ברירת המחדל לכלי התמלול: Homebrew במק, ה-PATH בשאר */
export function voiceTools(platform: NodeJS.Platform = process.platform): { whisper: string; ffmpeg: string } {
  if (platform === "darwin") return { whisper: "/opt/homebrew/bin/whisper-cli", ffmpeg: "/opt/homebrew/bin/ffmpeg" };
  const exe = platform === "win32" ? ".exe" : "";
  return { whisper: `whisper-cli${exe}`, ffmpeg: `ffmpeg${exe}` };
}

/** המפתח של הבינארי במחשב הזה ב-ACP Registry (distribution.binary) */
export function registryPlatformKey(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string {
  const os_ = platform === "darwin" ? "darwin" : platform === "win32" ? "windows" : "linux";
  return `${os_}-${arch === "arm64" ? "aarch64" : "x86_64"}`;
}

/** תיקייה של worktree של משימה: <אב>/.mifkada-worktrees/<repo>-<id>, עם / או \ */
export const WORKTREE_DIR = /^(.*)[\\/]\.mifkada-worktrees[\\/](.+)-[0-9a-f]{8}([\\/].*)?$/;
