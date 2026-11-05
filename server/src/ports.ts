import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";

const run = promisify(execFile);

export interface DevPort {
  port: number;
  /** שם התהליך (node, python...) */
  command: string;
  pid: number;
  /** תיקיית העבודה של התהליך, כדי לשייך לפרויקט */
  cwd: string | null;
}

type Listener = { port: number; pid: number; command: string };

/** lsof -F: שורות p<pid>, c<command>, n<כתובת> (macOS, ו-Linux כשמותקן) */
export function parseLsof(out: string): Listener[] {
  const res: Listener[] = [];
  let pid = 0;
  let command = "";
  for (const line of out.split("\n")) {
    const tag = line[0];
    const val = line.slice(1);
    if (tag === "p") pid = Number(val);
    else if (tag === "c") command = val;
    else if (tag === "n") {
      const m = /(?:^|[:\]])(\d+)$/.exec(val);
      if (m) res.push({ port: Number(m[1]), pid, command });
    }
  }
  return res;
}

/** ss -ltnpH (Linux בלי lsof): LISTEN 0 511 *:5173 *:* users:(("node",pid=123,fd=20)) */
export function parseSs(out: string): Listener[] {
  const res: Listener[] = [];
  for (const line of out.split("\n")) {
    const port = /\s\S*:(\d+)\s+\S+:\S+/.exec(line)?.[1];
    const user = /users:\(\("([^"]+)",pid=(\d+)/.exec(line);
    if (port && user) res.push({ port: Number(port), pid: Number(user[2]), command: user[1] });
  }
  return res;
}

/** netstat -ano -p TCP (Windows):   TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    1234 */
export function parseNetstat(out: string): Listener[] {
  const res: Listener[] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*TCP\s+\S*:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i.exec(line);
    if (m) res.push({ port: Number(m[1]), pid: Number(m[2]), command: "" });
  }
  return res;
}

async function stdout(cmd: string, args: string[], timeout = 4000): Promise<string> {
  try {
    return (await run(cmd, args, { timeout, maxBuffer: 2 * 1024 * 1024 })).stdout;
  } catch (e) {
    return (e as { stdout?: string }).stdout ?? "";
  }
}

async function listeners(): Promise<Listener[]> {
  if (process.platform === "win32") return parseNetstat(await stdout("netstat", ["-ano", "-p", "TCP"]));
  const lsof = parseLsof(await stdout("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"]));
  if (lsof.length || process.platform === "darwin") return lsof;
  return parseSs(await stdout("ss", ["-ltnpH"]));
}

/** תיקיית העבודה של תהליך: /proc ב-Linux, lsof ב-macOS. ב-Windows אין דרך פשוטה (null, בלי שיוך לפרויקט) */
async function processCwd(pid: number): Promise<string | null> {
  if (process.platform === "win32") return null;
  if (process.platform === "linux") {
    try {
      return await fs.readlink(`/proc/${pid}/cwd`);
    } catch {
      return null;
    }
  }
  const out = await stdout("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], 2000);
  const n = out.split("\n").find((l) => l.startsWith("n"));
  return n ? path.normalize(decodeLsof(n.slice(1))) : null;
}

/** שרתי פיתוח שמאזינים במחשב, לתצוגה המקדימה. בלי מפקדה עצמה ובלי פורטים של המערכת. */
export async function devPorts(ignore: number[]): Promise<DevPort[]> {
  const found = new Map<number, DevPort>();
  for (const { port, pid, command } of await listeners()) {
    // שרתי פיתוח: 1024-65535, בלי הפורטים של מפקדה
    // 49152+ הם פורטים זמניים (דפדפנים בלי ראש, עורכים), לא שרתי פיתוח
    if (port < 1024 || port >= 49152 || ignore.includes(port) || found.has(port)) continue;
    if (/^(postgres|mysqld|redis|mongod|ssh|adb|Code Helper|chrome|Google|com\.apple|rapportd|ControlCe|ControlCenter|Spotify|Dropbox|com\.docke|figma_age|Raycast|tailscale|IPNExtens|Electron|Mifkada)/i.test(command)) continue;
    found.set(port, { port, command, pid, cwd: null });
  }
  await Promise.all([...found.values()].map(async (p) => void (p.cwd = await processCwd(p.pid))));
  return [...found.values()].sort((a, b) => a.port - b.port);
}

/** lsof מקודד בתים שאינם ASCII כ-\\xd7. מחזיר טקסט רגיל (עברית בשמות תיקיות). */
function decodeLsof(s: string): string {
  if (!s.includes("\\x")) return s;
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "x" && /^[0-9a-f]{2}$/i.test(s.slice(i + 2, i + 4))) {
      bytes.push(parseInt(s.slice(i + 2, i + 4), 16));
      i += 3;
    } else bytes.push(...Buffer.from(s[i], "utf8"));
  }
  return Buffer.from(bytes).toString("utf8");
}
