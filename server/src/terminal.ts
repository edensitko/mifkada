import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { WebSocketServer, WebSocket } from "ws";
import { defaultShell } from "./platform.js";

/** טרמינל אמיתי דרך node-pty. אם הבינארי הנייטיבי לא נטען (ABI אחר), נופלים ל-`script` (macOS/Linux), בלי resize. */
interface PtyLike {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (d: string) => void): void;
  onExit(cb: (code: number) => void): void;
}

type NodePty = typeof import("node-pty");
let nodePty: NodePty | null | undefined;

/** npm עם allow-scripts לא מריץ את ה-postinstall של node-pty, ו-spawn-helper נשאר בלי הרשאת הרצה ("posix_spawnp failed"). */
async function ensureSpawnHelper(): Promise<void> {
  try {
    const { createRequire } = await import("node:module");
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const pkg = createRequire(import.meta.url).resolve("node-pty/package.json");
    if (process.platform === "win32") return; // ב-Windows node-pty עובד דרך ConPTY, בלי spawn-helper
    const helper = path.join(path.dirname(pkg), "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper");
    await fs.chmod(helper, 0o755);
  } catch {
    /* אין prebuild לפלטפורמה הזו, node-pty ייפול ל-script */
  }
}

export async function loadPty(): Promise<NodePty | null> {
  if (nodePty !== undefined) return nodePty;
  try {
    await ensureSpawnHelper();
    nodePty = await import("node-pty");
  } catch (e) {
    console.error("node-pty לא נטען, עוברים ל-script:", (e as Error).message);
    nodePty = null;
  }
  return nodePty;
}

function shellEnv(): NodeJS.ProcessEnv {
  return { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", LANG: process.env.LANG ?? "en_US.UTF-8", MIFKADA: "1" };
}

async function openPty(cwd: string, cols: number, rows: number): Promise<PtyLike> {
  const { cmd: shell, args: shellArgs } = defaultShell();
  const pty = await loadPty();
  if (pty) {
    const p = pty.spawn(shell, shellArgs, { name: "xterm-256color", cols, rows, cwd, env: shellEnv() as Record<string, string> });
    return {
      write: (d) => p.write(d),
      resize: (c, r) => p.resize(Math.max(2, c), Math.max(1, r)),
      kill: () => p.kill(),
      onData: (cb) => p.onData(cb),
      onExit: (cb) => p.onExit(({ exitCode }) => cb(exitCode)),
    };
  }
  // בלי node-pty: script נותן tty (התחביר שונה בין macOS ל-Linux). ב-Windows אין script, ה-shell רץ בלי tty
  const [cmd, args] =
    process.platform === "darwin" ? ["script", ["-q", "/dev/null", shell, ...shellArgs]] : process.platform === "win32" ? [shell, shellArgs] : ["script", ["-q", "-c", [shell, ...shellArgs].join(" "), "/dev/null"]];
  const child: ChildProcessWithoutNullStreams = spawn(cmd as string, args as string[], { cwd, env: { ...shellEnv(), COLUMNS: String(cols), LINES: String(rows) } });
  return {
    write: (d) => child.stdin.write(d),
    resize: () => undefined,
    kill: () => child.kill(),
    onData: (cb) => {
      child.stdout.on("data", (b: Buffer) => cb(b.toString("utf8")));
      child.stderr.on("data", (b: Buffer) => cb(b.toString("utf8")));
    },
    onExit: (cb) => child.on("exit", (code) => cb(code ?? 0)),
  };
}

type ClientMsg = { t: "open"; cwd: string; cols: number; rows: number } | { t: "input"; data: string } | { t: "resize"; cols: number; rows: number };

/** WebSocket של טרמינל: הודעות JSON מהלקוח, פלט כטקסט גולמי מהשרת. */
export function createTerminalServer(allow: (cwd: string) => Promise<string> = async (c) => c): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", (ws: WebSocket) => {
    let pty: PtyLike | null = null;
    ws.on("message", async (raw) => {
      let m: ClientMsg;
      try {
        m = JSON.parse(String(raw)) as ClientMsg;
      } catch {
        return;
      }
      if (m.t === "open" && !pty) {
        try {
          // טרמינל רק בתיקייה שמפקדה מכירה (access.ts)
          pty = await openPty(await allow(m.cwd), m.cols || 80, m.rows || 24);
        } catch (e) {
          ws.send(JSON.stringify({ t: "error", message: (e as Error).message }));
          return;
        }
        pty.onData((d) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(Buffer.from(d, "utf8"));
        });
        pty.onExit((code) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "exit", code }));
          pty = null;
        });
      } else if (m.t === "input" && pty) pty.write(m.data);
      else if (m.t === "resize" && pty) pty.resize(m.cols, m.rows);
    });
    ws.on("close", () => pty?.kill());
  });
  return wss;
}
