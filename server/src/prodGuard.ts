import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { systemPrefs } from "./settings.js";

/**
 * שומר הפרוד: מזהה פקודת Bash שמשנה את שרת הפרוד (ssh עם פקודה שאינה קריאה בלבד, docker push, scp/rsync לשרת,
 * gcloud compute). LiveSession עוצר פקודה כזו עד שמאשרים בחלון של מפקדה (ראו live.ts).
 *
 * הכיוון: כל מה שלא מזוהה בוודאות כקריאה בלבד מול השרת = פרוד. טעות לכיוון "לשאול" עדיפה על פריסה בלי אישור.
 * ssh prod "docker ps; df -h" עובר בלי שאלה, כדי שסוכן תפעול שרק קורא ימשיך לעבוד כרגיל.
 */

/**
 * השמות של שרת הפרוד: system.prodHosts בהגדרות (alias מ-~/.ssh/config או כתובת) ו-MIFKADA_PROD_HOSTS (מופרד בפסיקים).
 * בלי שמות, ssh/scp/rsync לא נבדקים בכלל. ה-e2e והבדיקות משתמשים במשתנה עם host שלא קיים.
 */
export function prodHosts(): string[] {
  const env = (process.env.MIFKADA_PROD_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  return [...new Set([...systemPrefs().prodHosts, ...env])];
}

export interface ProdCheck {
  prod: boolean;
  /** למה הפקודה נחשבת שינוי בפרוד (לכרטיס) */
  reasons: string[];
}

/* ---------- פירוק פקודת shell ---------- */

type Tok = { op: string } | { w: string; quoted: boolean };
const isOp = (t: Tok | undefined): t is { op: string } => Boolean(t && "op" in t);

/** פירוק פשוט: מילים (עם מרכאות ו-\), אופרטורים (; && || | & newline), והפניות (> >> <). $( ו-` מסמנים "מורכב" */
function tokenize(s: string): { toks: Tok[]; complex: boolean } {
  const toks: Tok[] = [];
  let complex = false;
  let i = 0;
  let cur = "";
  let has = false;
  let quoted = false;
  const flush = () => {
    if (has) toks.push({ w: cur, quoted });
    cur = "";
    has = false;
    quoted = false;
  };
  while (i < s.length) {
    const c = s[i];
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      const end = j < 0 ? s.length : j;
      cur += s.slice(i + 1, end);
      has = quoted = true;
      i = end + 1;
      continue;
    }
    if (c === '"') {
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === "\\" && i + 1 < s.length) {
          cur += s[i + 1];
          i += 2;
          continue;
        }
        if (s[i] === "`" || (s[i] === "$" && s[i + 1] === "(")) complex = true;
        cur += s[i++];
      }
      has = quoted = true;
      i++;
      continue;
    }
    if (c === "\\" && i + 1 < s.length) {
      if (s[i + 1] !== "\n") cur += s[i + 1];
      has = has || s[i + 1] !== "\n";
      i += 2;
      continue;
    }
    if (c === "`" || (c === "$" && s[i + 1] === "(")) complex = true;
    if (c === " " || c === "\t") {
      flush();
      i++;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (two === "&&" || two === "||" || two === ">>" || two === "<<") {
      // הפניה עם מספר (2>, 2>>) נדבקת לאופרטור
      flush();
      toks.push({ op: two });
      i += 2;
      continue;
    }
    if (c === ";" || c === "|" || c === "&" || c === "\n" || c === ">" || c === "<" || c === "(" || c === ")") {
      if (c === ">" && has && /^\d$/.test(cur)) {
        cur = "";
        has = false;
      }
      flush();
      toks.push({ op: c === "\n" ? ";" : c });
      i++;
      continue;
    }
    cur += c;
    has = true;
    i++;
  }
  flush();
  return { toks, complex };
}

interface Segment {
  words: string[];
  /** יעדי הפניה (> קובץ). "&1" ו-/dev/null לא נחשבים כתיבה */
  writes: string[];
  /** <<: heredoc או קלט מקובץ (ssh prod bash -s < x.sh) */
  stdin: boolean;
}

function segments(s: string): { segs: Segment[]; complex: boolean } {
  const { toks, complex } = tokenize(s);
  const segs: Segment[] = [];
  let seg: Segment = { words: [], writes: [], stdin: false };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (isOp(t)) {
      if (t.op === ">" || t.op === ">>") {
        const next = toks[i + 1];
        if (next && !isOp(next)) {
          i++;
          if (next.w !== "/dev/null" && !next.w.startsWith("&")) seg.writes.push(next.w);
        } else if (isOp(next) && next.op === "&") {
          i += toks[i + 2] && !isOp(toks[i + 2]) ? 2 : 1; // 2>&1
        }
        continue;
      }
      if (t.op === "<" || t.op === "<<") {
        seg.stdin = true;
        if (toks[i + 1] && !isOp(toks[i + 1])) i++;
        continue;
      }
      if (seg.words.length || seg.writes.length || seg.stdin) segs.push(seg);
      seg = { words: [], writes: [], stdin: false };
      continue;
    }
    seg.words.push(t.w);
  }
  if (seg.words.length || seg.writes.length || seg.stdin) segs.push(seg);
  return { segs, complex };
}

/** מסיר קידומות שלא משנות את הפקודה עצמה: FOO=1, sudo, env, time, nohup, nice, timeout 10, command, exec, builtin */
function stripPrefix(words: string[]): { words: string[]; env: string[] } {
  const env: string[] = [];
  let w = [...words];
  for (;;) {
    if (!w.length) break;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0])) {
      env.push(w.shift()!);
      continue;
    }
    const b = path.basename(w[0]);
    if (b === "sudo" || b === "doas") {
      w.shift();
      while (w[0]?.startsWith("-")) {
        const f = w.shift()!;
        if (/^-[ugCDhpRrT]$/.test(f)) w.shift();
      }
      continue;
    }
    if (b === "env") {
      w.shift();
      while (w[0] && (w[0].startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]))) {
        const f = w.shift()!;
        if (f.includes("=")) env.push(f);
        else if (f === "-u" || f === "-C" || f === "-S") w.shift();
      }
      continue;
    }
    if (b === "timeout") {
      w.shift();
      while (w[0]?.startsWith("-")) w.shift();
      w.shift();
      continue;
    }
    if (["time", "nohup", "nice", "command", "exec", "builtin", "caffeinate"].includes(b)) {
      w.shift();
      while (w[0]?.startsWith("-")) w.shift();
      continue;
    }
    break;
  }
  w = w.filter((x, i) => i > 0 || x !== "");
  return { words: w, env };
}

/* ---------- זיהוי השרת ---------- */

/** user@prod, prod:/path, ssh://ubuntu@prod:22 */
export function isProdHost(arg: string): boolean {
  let h = arg.replace(/^[a-z+]+:\/\//i, "");
  h = h.replace(/^[^@/]*@/, "");
  h = h.replace(/[:/].*$/, "");
  return prodHosts().includes(h.toLowerCase());
}

/** האם הטקסט מזכיר את השרת כמילה (לא prod-clients, לא prod.example.com) */
function mentionsProd(text: string): boolean {
  return prodHosts().some((h) => new RegExp(`(?:^|[\\s@"'=/])${h.replace(/\./g, "\\.")}(?=$|[\\s:"';|&)/])`, "m").test(text));
}
const NET_TOOL = /(?:^|[\s;&|("'`/[,])(ssh|scp|rsync|sftp|mosh)(?=$|[\s"',\]])/m;

/* ---------- קריאה בלבד בשרת ---------- */

const RO_COMMANDS = new Set([
  "cat", "tail", "head", "less", "more", "ls", "ll", "grep", "egrep", "fgrep", "zgrep", "zcat", "wc", "df", "free", "uptime", "ps", "pgrep",
  "whoami", "hostname", "date", "uname", "id", "stat", "file", "du", "ss", "netstat", "echo", "printf", "true", "test", "[", "sort", "uniq",
  "cut", "tr", "jq", "column", "nproc", "vmstat", "iostat", "lsblk", "last", "w", "who", "dig", "nslookup", "host", "dmesg", "cd", "pwd",
  "readlink", "realpath", "basename", "dirname", "md5sum", "sha256sum", "lscpu", "lsof", "pidof", "which", "type", "sleep", "awk", "sed",
  "tree", "diff", "cmp", "getent", "ping", "traceroute", "env", "printenv", "locale", "timedatectl", "uniq", "nl", "column", "xxd", "hexdump",
]);

const DOCKER_RO = new Set(["ps", "logs", "inspect", "images", "stats", "version", "info", "top", "port", "diff", "history", "search"]);
const DOCKER_RO_GROUP: Record<string, Set<string>> = {
  image: new Set(["ls", "list", "inspect", "history"]),
  container: new Set(["ls", "list", "ps", "inspect", "logs", "top", "port", "diff", "stats"]),
  network: new Set(["ls", "list", "inspect"]),
  volume: new Set(["ls", "list", "inspect"]),
  system: new Set(["df", "info"]),
  context: new Set(["ls", "list", "inspect", "show"]),
  compose: new Set(["ps", "logs", "config", "images", "top", "ls", "version", "port"]),
  buildx: new Set(["ls", "inspect", "version", "du"]),
};

/** הסבר אם הפקודה (שרצה בשרת) משנה משהו, או null אם היא קריאה בלבד */
function remoteMutation(cmd: string, depth: number): string | null {
  if (depth > 4) return "פקודה מקוננת מדי";
  const { segs, complex } = segments(cmd);
  if (complex) return "פקודה בשרת עם $(...) או `...`";
  if (!segs.length) return "ssh אינטראקטיבי לשרת";
  for (const seg of segs) {
    if (seg.writes.length) return `כתיבה לקובץ בשרת (${seg.writes[0]})`;
    if (seg.stdin) return "קלט מקובץ או heredoc לפקודה בשרת";
    const { words } = stripPrefix(seg.words);
    if (!words.length) continue;
    const r = commandMutation(words, depth);
    if (r) return r;
  }
  return null;
}

function commandMutation(words: string[], depth: number): string | null {
  const b = path.basename(words[0]);
  const a = words.slice(1);
  const flags = a.filter((x) => x.startsWith("-"));
  if (b === "bash" || b === "sh" || b === "zsh" || b === "dash") {
    const i = a.indexOf("-c");
    if (i >= 0 && a[i + 1] !== undefined) return remoteMutation(a[i + 1], depth + 1);
    return `${b} בשרת`;
  }
  if (b === "sed") return flags.some((f) => f.startsWith("-i") || f === "--in-place") ? "sed -i בשרת" : null;
  if (b === "awk") return /system\s*\(|>\s*"|print\s*>/.test(a.join(" ")) ? "awk שכותב או מריץ פקודות" : null;
  if (b === "find") return a.some((x) => ["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprintf", "-fls"].includes(x)) ? "find שמשנה או מריץ" : null;
  if (b === "curl") {
    const bad = a.some((x, k) => /^(-d|--data.*|-F|--form.*|-T|--upload-file|-o|-O|--output|--remote-name)$/.test(x) || ((x === "-X" || x === "--request") && !/^(GET|HEAD)$/i.test(a[k + 1] ?? "")));
    return bad ? "curl שכותב או שולח נתונים" : null;
  }
  if (b === "journalctl") return a.some((x) => /^--(vacuum|rotate|flush|relinquish)/.test(x)) ? "journalctl שמשנה יומנים" : null;
  if (b === "systemctl") {
    const verb = a.find((x) => !x.startsWith("-"));
    return !verb || ["status", "is-active", "is-enabled", "is-failed", "list-units", "list-timers", "list-unit-files", "show", "cat"].includes(verb) ? null : `systemctl ${verb}`;
  }
  if (b === "crontab") return a.includes("-l") ? null : "crontab";
  if (b === "nginx") return a.includes("-t") || a.includes("-T") || a.includes("-v") || a.includes("-V") ? null : "nginx (reload/stop)";
  if (b === "openssl") return ["x509", "s_client", "version", "verify"].includes(a[0] ?? "") ? null : "openssl";
  if (b === "certbot") return a[0] === "certificates" ? null : "certbot";
  if (b === "tailscale") return a[0] === "status" || a[0] === "ip" ? null : "tailscale";
  if (b === "fail2ban-client") return a[0] === "status" ? null : "fail2ban-client";
  if (b === "git") {
    const verb = a.find((x) => !x.startsWith("-"));
    return ["log", "status", "diff", "show", "branch", "rev-parse", "remote"].includes(verb ?? "") ? null : `git ${verb ?? ""} בשרת`;
  }
  if (b === "ip") return a.some((x) => ["add", "del", "delete", "set", "flush", "change", "replace"].includes(x)) ? "ip שמשנה רשת" : null;
  if (b === "docker") return dockerMutation(a, depth);
  if (RO_COMMANDS.has(b)) return null;
  return `${b} בשרת`;
}

function dockerMutation(a: string[], depth: number): string | null {
  // דגלים גלובליים לפני הפקודה: --context x, -H x, --log-level x
  let i = 0;
  while (a[i]?.startsWith("-")) i += /^(-H|--host|--context|-c|--config|-l|--log-level)$/.test(a[i]) ? 2 : 1;
  const sub = a[i];
  const rest = a.slice(i + 1);
  if (!sub) return null;
  if (sub === "exec") {
    // docker exec [-it] [-e K=V] [-u x] [-w dir] <container> <cmd...>
    let k = 0;
    while (rest[k]?.startsWith("-")) k += /^(-e|--env|-u|--user|-w|--workdir|--env-file)$/.test(rest[k]) ? 2 : 1;
    const inner = rest.slice(k + 1);
    if (!inner.length) return "docker exec";
    const r = commandMutation(inner, depth + 1);
    return r ? `docker exec: ${r}` : null;
  }
  if (DOCKER_RO.has(sub)) return null;
  const group = DOCKER_RO_GROUP[sub];
  if (group) {
    let k = 0;
    while (rest[k]?.startsWith("-")) k += /^(-f|--file|-p|--project-name|--project-directory|--env-file|--profile)$/.test(rest[k]) ? 2 : 1;
    if (group.has(rest[k] ?? "")) return null;
    return `docker ${sub} ${rest[k] ?? ""}`.trim();
  }
  return `docker ${sub}`;
}

/* ---------- הפקודה המקומית ---------- */

const SSH_ARG_FLAGS = new Set(["-b", "-c", "-D", "-E", "-e", "-F", "-I", "-i", "-J", "-L", "-l", "-m", "-O", "-o", "-p", "-Q", "-R", "-S", "-W", "-w", "-B"]);

/** קורא סקריפט שמריצים (bash deploy.sh, ./x.sh, python x.py) כדי לראות אם יש בו גישה לשרת */
function readScript(file: string, cwd: string): string | null {
  try {
    const p = path.resolve(cwd, file.replace(/^~(?=\/|$)/, process.env.HOME ?? "~"));
    const st = fs.statSync(p);
    if (!st.isFile() || st.size > 512 * 1024) return null;
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function localMutation(cmd: string, cwd: string, depth: number, out: string[]): void {
  if (depth > 4) {
    if (mentionsProd(cmd) || /docker\s+push/.test(cmd)) out.push("פקודה מקוננת מדי שמזכירה את השרת");
    return;
  }
  const { segs, complex } = segments(cmd);
  // $(ssh prod ...) או `...`: לא מפרקים, אבל אם יש שם גישה לשרת - שואלים
  if (complex && mentionsProd(cmd) && NET_TOOL.test(cmd)) out.push("גישה לשרת מתוך $(...) או `...`");
  for (const seg of segs) {
    const { words, env } = stripPrefix(seg.words);
    for (const e of env) if (/^DOCKER_HOST=/.test(e) && isProdHost(e.slice("DOCKER_HOST=".length))) out.push("docker מול השרת (DOCKER_HOST)");
    if (!words.length) continue;
    const b = path.basename(words[0]);
    const a = words.slice(1);
    if (b === "ssh" || b === "mosh" || b === "autossh") {
      let k = 0;
      while (k < a.length && a[k].startsWith("-")) {
        // -p22 מחובר, -p 22 נפרד
        k += SSH_ARG_FLAGS.has(a[k]) ? 2 : 1;
      }
      const host = a[k];
      if (!host || !isProdHost(host)) continue;
      if (seg.stdin) {
        out.push("ssh לשרת עם סקריפט בקלט (< קובץ או heredoc)");
        continue;
      }
      const r = remoteMutation(a.slice(k + 1).join(" "), depth);
      if (r) out.push(r);
      continue;
    }
    if (b === "scp" || b === "rsync" || b === "sftp") {
      if (a.some((x) => !x.startsWith("-") && isProdHost(x) && (b === "sftp" || /[:]/.test(x) || x.includes("@")))) out.push(`${b} לשרת`);
      else if (b === "sftp" && a.some((x) => isProdHost(x))) out.push("sftp לשרת");
      continue;
    }
    if (b === "docker") {
      let k = 0;
      let prodCtx = false;
      while (a[k]?.startsWith("-")) {
        if (/^(-H|--host)$/.test(a[k]) && isProdHost(a[k + 1] ?? "")) prodCtx = true;
        k += /^(-H|--host|--context|-c|--config|-l|--log-level)$/.test(a[k]) ? 2 : 1;
      }
      const sub = a[k];
      if (sub === "push") out.push("docker push לרגיסטרי");
      else if (sub === "buildx" && a.some((x) => x === "--push" || /^--output=.*push=true/.test(x) || x === "imagetools")) out.push("docker buildx עם push");
      else if ((sub === "image" || sub === "manifest") && a[k + 1] === "push") out.push(`docker ${sub} push`);
      else if (prodCtx) {
        const r = dockerMutation(a, depth);
        if (r) out.push(`${r} (מול השרת)`);
      }
      continue;
    }
    if (b === "gcloud") {
      if (a.includes("deploy")) out.push("gcloud deploy");
      else if (a.includes("compute") && !a.some((x) => ["list", "describe", "get-serial-port-output", "get-iam-policy", "list-zones"].includes(x))) out.push(`gcloud compute ${a.filter((x) => !x.startsWith("-")).slice(1, 3).join(" ")}`.trim());
      continue;
    }
    if (b === "bash" || b === "sh" || b === "zsh" || b === "dash") {
      const i = a.indexOf("-c");
      if (i >= 0 && a[i + 1] !== undefined) {
        localMutation(a[i + 1], cwd, depth + 1, out);
        continue;
      }
      const file = a.find((x) => !x.startsWith("-"));
      const src = file ? readScript(file, cwd) : null;
      if (src !== null) localMutation(src, path.dirname(path.resolve(cwd, file!)), depth + 1, out);
      else if (seg.stdin && (mentionsProd(cmd) || /docker\s+push/.test(cmd))) out.push(`${b} עם קלט שמזכיר את השרת`);
      continue;
    }
    if (b === "eval" || b === "xargs" || b === "watch") {
      localMutation(a.filter((x) => !x.startsWith("-")).join(" "), cwd, depth + 1, out);
      continue;
    }
    if (b === "source" || b === "." || words[0].startsWith("./") || words[0].startsWith("/") || words[0].startsWith("~/") || /\.(sh|bash|zsh)$/.test(words[0])) {
      const file = b === "source" || b === "." ? a[0] : words[0];
      const src = file ? readScript(file, cwd) : null;
      if (src !== null && !src.startsWith("\x7fELF") && !src.startsWith("\xcf\xfa")) localMutation(src, path.dirname(path.resolve(cwd, file!)), depth + 1, out);
      continue;
    }
    if (["python", "python3", "node", "ruby", "perl", "deno", "bun", "tsx"].includes(b)) {
      const inline = a.findIndex((x) => x === "-c" || x === "-e");
      const src = inline >= 0 ? a[inline + 1] ?? "" : readScript(a.find((x) => !x.startsWith("-")) ?? "", cwd) ?? "";
      if ((mentionsProd(src) && NET_TOOL.test(src)) || /docker["',\s]+push|["']push["']/.test(src)) out.push(`${b} עם גישה לשרת או push`);
      continue;
    }
    // כל שאר הפקודות: אם הן מזכירות ssh ואת השרת יחד, לא ברור מה הן עושות. שואלים
    if (mentionsProd(seg.words.join(" ")) && NET_TOOL.test(seg.words.join(" "))) out.push(`${b} עם גישה לשרת`);
  }
}

/** האם פקודת Bash הזו משנה את הפרוד. cwd: לקריאת סקריפטים שהיא מריצה */
export function classifyCommand(command: string, cwd: string): ProdCheck {
  const reasons: string[] = [];
  try {
    localMutation(command, cwd, 0, reasons);
  } catch {
    // כשל בפירוק פקודה שמזכירה את השרת = שואלים
    if (mentionsProd(command) || /docker\s+push/.test(command)) reasons.push("לא הצלחתי לפרק את הפקודה");
  }
  return { prod: reasons.length > 0, reasons: [...new Set(reasons)] };
}

/* ---------- אישור פריסה לסשן ---------- */

export const GRANT_MINUTES = 30;

export interface DeployGrant {
  cwd: string;
  commit: string | null;
  expires: number;
}

export function gitHead(cwd: string): { commit: string | null; branch: string | null } {
  const run = (args: string[]) => {
    try {
      return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
    } catch {
      return null;
    }
  };
  return { commit: run(["rev-parse", "HEAD"]), branch: run(["rev-parse", "--abbrev-ref", "HEAD"]) };
}

/** הסיבה שהאישור כבר לא תקף, או null אם הוא תקף */
export function grantProblem(g: DeployGrant | null, cwd: string, now = Date.now()): string | null {
  if (!g) return "אין אישור פריסה";
  if (now > g.expires) return "אישור הפריסה פג";
  if (path.resolve(g.cwd) !== path.resolve(cwd)) return "אישור הפריסה ניתן לתיקייה אחרת";
  if (gitHead(cwd).commit !== g.commit) return "הקומיט השתנה מאז האישור";
  return null;
}
