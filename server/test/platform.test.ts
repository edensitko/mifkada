import { test } from "node:test";
import assert from "node:assert/strict";

const P = await import("../src/platform.ts");
const { parseLsof, parseSs, parseNetstat } = await import("../src/ports.ts");

test("תיקיית נתונים לכל מערכת", () => {
  assert.equal(P.dataDir("darwin", {}, "/Users/a"), "/Users/a/Library/Application Support/מפקדה");
  assert.equal(P.dataDir("linux", {}, "/home/a"), "/home/a/.config/מפקדה");
  assert.equal(P.dataDir("linux", { XDG_CONFIG_HOME: "/x" }, "/home/a"), "/x/מפקדה");
  assert.equal(P.dataDir("win32", { APPDATA: "C:\\Users\\a\\AppData\\Roaming" }, "C:\\Users\\a"), "C:\\Users\\a\\AppData\\Roaming\\מפקדה");
});

test("שקע: קובץ במק וב-Linux, named pipe יציב ב-Windows", () => {
  assert.equal(P.socketPath("/home/a/.config/מפקדה", "linux"), "/home/a/.config/מפקדה/mifkada.sock");
  const pipe = P.socketPath("C:\\Users\\a\\AppData\\Roaming\\מפקדה", "win32");
  assert.match(pipe, /^\\\\\.\\pipe\\mifkada-[0-9a-f]{12}$/);
  assert.ok(P.isPipe(pipe));
  // אותו שם בלי קשר לאותיות גדולות/קטנות בנתיב (Windows לא רגיש להן), ושונה לתיקייה אחרת
  assert.equal(P.socketPath("c:\\users\\a\\appdata\\roaming\\מפקדה", "win32"), pipe);
  assert.notEqual(P.socketPath("D:\\other", "win32"), pipe);
});

test("shell, which, פתיחה וכלי קול לפי מערכת", () => {
  assert.deepEqual(P.defaultShell("darwin", {}), { cmd: "/bin/zsh", args: ["-il"] });
  assert.deepEqual(P.defaultShell("linux", {}), { cmd: "/bin/bash", args: ["-il"] });
  assert.deepEqual(P.defaultShell("linux", { SHELL: "/usr/bin/fish" }), { cmd: "/usr/bin/fish", args: ["-il"] });
  assert.equal(P.defaultShell("win32", {}).cmd, "powershell.exe");
  assert.equal(P.whichCommand("win32"), "where");
  assert.equal(P.whichCommand("darwin"), "/usr/bin/which");
  assert.deepEqual(P.openCommand("vscode", "/p", "darwin"), { cmd: "open", args: ["-a", "Visual Studio Code", "/p"] });
  assert.deepEqual(P.openCommand("finder", "/p", "linux"), { cmd: "xdg-open", args: ["/p"] });
  assert.deepEqual(P.openCommand("finder", "C:\\p", "win32"), { cmd: "explorer.exe", args: ["C:\\p"] });
  assert.deepEqual(P.openCommand("vscode", "C:\\p", "win32"), { cmd: "cmd.exe", args: ["/c", "code", "C:\\p"] });
  assert.equal(P.voiceTools("linux").whisper, "whisper-cli");
  assert.equal(P.voiceTools("win32").ffmpeg, "ffmpeg.exe");
  assert.equal(P.registryPlatformKey("linux", "x64"), "linux-x86_64");
  assert.equal(P.registryPlatformKey("win32", "arm64"), "windows-aarch64");
});

test("תיקיית worktree של משימה מזוהה גם עם \\", () => {
  assert.deepEqual(P.WORKTREE_DIR.exec("/p/.mifkada-worktrees/app-0123abcd/web")?.slice(1, 4), ["/p", "app", "/web"]);
  assert.deepEqual(P.WORKTREE_DIR.exec("C:\\p\\.mifkada-worktrees\\app-0123abcd")?.slice(1, 3), ["C:\\p", "app"]);
  assert.equal(P.WORKTREE_DIR.exec("/p/app"), null);
});

test("פורטים: lsof, ss ו-netstat", () => {
  assert.deepEqual(parseLsof("p123\ncnode\nn*:5173\nn127.0.0.1:3000\n"), [
    { port: 5173, pid: 123, command: "node" },
    { port: 3000, pid: 123, command: "node" },
  ]);
  assert.deepEqual(parseSs('LISTEN 0      511          *:5173            *:*    users:(("node",pid=4321,fd=20))\nLISTEN 0 128 127.0.0.1:631 0.0.0.0:*\n'), [{ port: 5173, pid: 4321, command: "node" }]);
  assert.deepEqual(parseNetstat("  Proto  Local Address  Foreign Address  State  PID\r\n  TCP    0.0.0.0:3000   0.0.0.0:0   LISTENING   1234\r\n  TCP    [::]:8080   [::]:0   LISTENING   55\r\n  TCP    10.0.0.2:5555   1.2.3.4:443   ESTABLISHED   9\r\n"), [
    { port: 3000, pid: 1234, command: "" },
    { port: 8080, pid: 55, command: "" },
  ]);
});

test("Claude Code מותקן: השוואת גרסאות וחיפוש ב-PATH", async () => {
  const { versionAtLeast, findInstalled } = await import("../src/claudeExe.js");
  assert.equal(versionAtLeast("2.1.316", "2.1.306"), true);
  assert.equal(versionAtLeast("2.1.306", "2.1.306"), true);
  assert.equal(versionAtLeast("2.1.99", "2.1.306"), false);
  assert.equal(versionAtLeast("3.0.0", "2.9.999"), true);
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-bin-"));
  // macOS/Linux: רק כשהבדיקה רצה עליהן (ב-Windows ה-PATH עם ":" מתנגש באות הכונן)
  if (process.platform !== "win32") {
    assert.equal(findInstalled({ PATH: dir }, "darwin"), null);
    fs.writeFileSync(path.join(dir, "claude"), "");
    assert.equal(findInstalled({ PATH: `/nope:${dir}` }, "darwin"), path.join(dir, "claude"));
  }
  // Windows: npm מתקין claude.cmd, ומה שמריצים הוא ה-exe שמאחוריו
  const npmBin = path.join(dir, "node_modules", "@anthropic-ai", "claude-code", "bin");
  fs.mkdirSync(npmBin, { recursive: true });
  fs.writeFileSync(path.join(npmBin, "claude.exe"), "");
  assert.equal(findInstalled({ PATH: dir }, "win32"), path.join(npmBin, "claude.exe"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("הגרסה המינימלית של Claude Code נקראת מה-SDK", async () => {
  const { minClaudeVersion } = await import("../src/claudeExe.js");
  assert.match(minClaudeVersion(), /^\d+\.\d+\.\d+$/);
});
