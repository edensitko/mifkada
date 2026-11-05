#!/usr/bin/env node
// לוח המשימות של מפקדה משורת הפקודה. בלי תלויות, מדבר עם ה-daemon דרך קובץ השקע.
// שימוש:
//   mifkada-task add --title "..." --prompt "..." [--cwd /path] [--manual] [--status review|todo|done]
//                    [--agent <slug>] [--provider claude|codex|...] [--isolate] [--mode default|acceptEdits|plan] [--model opus|sonnet|...] [--run]
//                    [--allow-git]
//   mifkada-task allow-git <מזהה או תחילתו> [--off]   להתיר (או לחסום שוב) commit/merge/push למשימה
//   mifkada-task list [--open]
//   mifkada-task show <מזהה או תחילתו>      סטטוס, אייג'נט, ענף, והסיכום או השגיאה
//   mifkada-task agents                       האייג'נטים שאפשר להעביר אליהם משימה, והספקים (Claude, Codex...)
//   mifkada-task done <מזהה או תחילתו> [--summary "..."]
//   mifkada-task rm <מזהה או תחילתו>
// --manual: משימה לבן אדם, לא לסוכן. נוצרת בסטטוס review (ה-autoRun מפעיל רק todo) ופותחת ב"משימה ידנית".
// --isolate: ענף ו-worktree נפרדים. מופעל אוטומטית כשכבר יש משימה פתוחה (בתור/בעבודה) באותה תיקייה,
//   כדי ששני סוכנים לא יכתבו לאותו ריפו בבת אחת. --run: להפעיל מיד, בלי לחכות לתור.
// --allow-git: בסשן של משימה commit, merge, rebase, push, reset --hard, branch -D, tag ו-worktree remove חסומים
//   בקוד (server/src/gitPolicy.ts). הדגל מתיר אותם, רק באישור של המשתמש. סשן של משימה לא יכול להריץ את הדגל בעצמו.
// מצבי הרשאות שמותרים כאן: default, acceptEdits, plan. "auto" ו"מאשר הכול" רק מהממשק, באישור.
import fs from "node:fs";
import { createHash } from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";

// תיקיית הנתונים של מפקדה, כמו dataDir ב-server/src/platform.ts (הסקריפט בלי תלויות, לכן מועתק)
function defaultData() {
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "מפקדה");
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "מפקדה");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "מפקדה");
}
const DATA = process.env.MIFKADA_DATA || defaultData();
// Windows: named pipe (כמו socketPath ב-platform.ts), אחרת קובץ שקע
const SOCKET =
  process.env.MIFKADA_SOCKET ||
  (process.platform === "win32" ? `\\\\.\\pipe\\mifkada-${createHash("sha256").update(DATA.toLowerCase()).digest("hex").slice(0, 12)}` : path.join(DATA, "mifkada.sock"));

// שפה: MIFKADA_LANG, אחרת system.lang מההגדרות של מפקדה, ב-auto לפי LANG. לא ידוע = אנגלית
function lang() {
  const forced = process.env.MIFKADA_LANG;
  if (forced === "he" || forced === "en") return forced;
  try {
    const l = JSON.parse(fs.readFileSync(path.join(DATA, "settings.json"), "utf8"))?.system?.lang;
    if (l === "he" || l === "en") return l;
  } catch { /* אין הגדרות */ }
  return /^(he|iw)/i.test(process.env.LC_ALL || process.env.LANG || "") ? "he" : "en";
}
const LANG = lang();
const L = (he, en) => (LANG === "he" ? he : en);

// ההערה נשמרת בפרומפט של המשימה. מזהים את שתי הגרסאות, כדי לא להוסיף אותה פעמיים
const MANUAL_NOTES = ["משימה ידנית (לבן אדם, לא לסוכן) - לא להריץ אוטומטית. ", "Manual task (for a person, not an agent). Don't run automatically. "];
const MANUAL_NOTE = L(MANUAL_NOTES[0], MANUAL_NOTES[1]);

function call(method, url, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = http.request({ socketPath: SOCKET, path: url, method, headers: data ? { "content-type": "application/json", "content-length": data.length } : {} }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (raw += d));
      res.on("end", () => {
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch { /* לא JSON */ }
        if ((res.statusCode ?? 500) >= 400) reject(new Error(`${res.statusCode}: ${json?.error ?? raw.slice(0, 120)}`));
        else resolve(json);
      });
    });
    req.on("error", (e) => reject(new Error(e.code === "ENOENT" || e.code === "ECONNREFUSED" ? L(`מפקדה לא רצה (אין קובץ שקע ב-${SOCKET})`, `Mifkada isn't running (no socket file at ${SOCKET})`) : e.message)));
    if (data) req.write(data);
    req.end();
  });
}

function parse(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      if (k === "manual" || k === "open" || k === "isolate" || k === "run" || k === "allow-git" || k === "off") flags[k] = true;
      else flags[k] = argv[++i] ?? "";
    } else rest.push(a);
  }
  return { flags, rest };
}

async function resolveId(prefix) {
  const { tasks } = await call("GET", "/api/tasks");
  const hits = tasks.filter((t) => t.id.startsWith(prefix));
  if (hits.length !== 1) throw new Error(hits.length ? L(`המזהה "${prefix}" לא חד-משמעי (${hits.length} משימות)`, `The ID "${prefix}" is ambiguous (${hits.length} tasks)`) : L(`אין משימה עם מזהה שמתחיל ב-"${prefix}"`, `No task with an ID starting with "${prefix}"`));
  return hits[0];
}

const [cmd, ...args] = process.argv.slice(2);
const { flags, rest } = parse(args);
try {
  if (cmd === "add") {
    if (!flags.title || !flags.prompt) throw new Error(L("חובה --title ו---prompt", "--title and --prompt are required"));
    const status = flags.status || (flags.manual ? "review" : undefined);
    if (flags.manual && status === "todo") throw new Error(L("משימה ידנית לא יכולה להיות todo: ה-autoRun יפעיל אותה כסשן של סוכן", "A manual task can't be todo: autoRun would start it as an agent session"));
    const prompt = flags.manual && !MANUAL_NOTES.some((n) => flags.prompt.startsWith(n)) ? MANUAL_NOTE + flags.prompt : flags.prompt;
    const cwd = path.resolve(flags.cwd || process.cwd());
    const mode = flags.mode || "default";
    if (!["default", "acceptEdits", "plan"].includes(mode)) throw new Error(L(`--mode: רק default, acceptEdits או plan (התקבל "${mode}")`, `--mode: only default, acceptEdits or plan (got "${mode}")`));
    if (flags.agent) {
      const agents = await call("GET", "/api/agents");
      if (!agents.some((a) => a.slug === flags.agent)) throw new Error(L(`אין אייג'נט "${flags.agent}". יש: ${agents.map((a) => a.slug).join(", ")}`, `No agent "${flags.agent}". Available: ${agents.map((a) => a.slug).join(", ")}`));
    }
    if (flags.provider && flags.provider !== "claude") {
      const providers = await call("GET", "/api/providers");
      const p = providers.find((x) => x.id === flags.provider);
      if (!p) throw new Error(L(`אין ספק "${flags.provider}". יש: ${providers.map((x) => x.id).join(", ")}`, `No provider "${flags.provider}". Available: ${providers.map((x) => x.id).join(", ")}`));
      if (!p.enabled) throw new Error(L(`הספק ${p.label} כבוי בהגדרות`, `${p.label} is turned off in Settings`));
      if (!p.available) console.log(L(`אזהרה: הפקודה של ${p.label} (${p.command}) לא נמצאה במחשב`, `Warning: ${p.label}'s command (${p.command}) wasn't found on this computer`));
    }
    // שני סוכנים באותו ריפו בבת אחת דורסים זה את זה: אם כבר יש משימה פתוחה כאן, ענף נפרד
    let isolate = Boolean(flags.isolate);
    if (!isolate && !flags.manual) {
      const { tasks } = await call("GET", "/api/tasks");
      const busy = tasks.find((t) => (t.status === "todo" || t.status === "running") && (t.cwd === cwd || cwd.startsWith(t.cwd + "/") || t.cwd.startsWith(cwd + "/")));
      if (busy) {
        isolate = true;
        console.log(L(`יש כבר משימה פתוחה בתיקייה הזו (${busy.id.slice(0, 8)} ${busy.title}), אז המשימה תרוץ בענף נפרד`, `There's already an open task in this folder (${busy.id.slice(0, 8)} ${busy.title}), so this task will run on a separate branch`));
      }
    }
    const body = { title: flags.title, prompt, cwd, status, owner: flags.manual ? "me" : undefined, agent: flags.agent || undefined, provider: flags.provider || undefined, model: flags.model || undefined, permissionMode: mode, isolate, allowGit: Boolean(flags["allow-git"]) || undefined };
    const t = await call("POST", `/api/tasks${flags.run && !flags.manual ? "?run=1" : ""}`, body);
    console.log(`${L("נוצרה", "Created")}: ${t.id.slice(0, 8)}  [${t.status}]  ${t.title}${t.provider ? `  · ${t.provider}` : ""}${t.agent ? `  · ${t.agent}` : ""}${t.isolate ? `  · ${L("ענף נפרד", "separate branch")}` : ""}${t.allowGit ? `  · ${L("מותר commit", "commit allowed")}` : ""}`);
  } else if (cmd === "allow-git") {
    if (!rest[0]) throw new Error("חובה מזהה משימה");
    const t = await resolveId(rest[0]);
    const allowGit = !flags.off;
    await call("PATCH", `/api/tasks/${t.id}`, { allowGit });
    console.log(`${allowGit ? "מותר commit" : "git חסום שוב"}: ${t.id.slice(0, 8)}  ${t.title}${t.liveId ? "  (חל גם על הסשן שרץ)" : ""}`);
  } else if (cmd === "list") {
    const { tasks, settings } = await call("GET", "/api/tasks");
    const shown = flags.open ? tasks.filter((t) => t.status !== "done") : tasks;
    console.log(L(`autoRun: ${settings.autoRun ? "דלוק" : "כבוי"} (עד ${settings.maxParallel} במקביל)`, `autoRun: ${settings.autoRun ? "on" : "off"} (up to ${settings.maxParallel} in parallel)`));
    for (const t of shown) console.log(`${t.id.slice(0, 8)}  ${t.status.padEnd(8)} ${(t.agent || "-").padEnd(16)} ${path.basename(t.cwd).padEnd(16)} ${t.title}`);
  } else if (cmd === "show") {
    if (!rest[0]) throw new Error(L("חובה מזהה משימה", "A task ID is required"));
    const t = await resolveId(rest[0]);
    console.log(
      `${t.id}\n${t.title}\n${L("סטטוס", "Status")}: ${t.status}  · ${L("אייג'נט", "Agent")}: ${t.agent || "-"}  · ${L("ספק", "Provider")}: ${t.provider || "claude"}  · ${L("תיקייה", "Folder")}: ${t.cwd}${t.worktree ? `  · ${L("ענף", "Branch")}: ${t.worktree.branch}` : ""}${t.sessionId ? `\n${L("סשן", "Session")}: ${t.sessionId}` : ""}`,
    );
    console.log(`git: ${t.allowGit ? L("מותר", "allowed") : L("חסום", "blocked")}`);
    if (t.lastError) console.log(`\n${L("שגיאה", "Error")}: ${t.lastError}`);
    if (t.summary) console.log(`\n${t.summary}`);
  } else if (cmd === "agents") {
    for (const a of await call("GET", "/api/agents")) console.log(`${a.slug.padEnd(18)} ${a.description.replace(/\s+/g, " ").slice(0, 110)}`);
    const providers = await call("GET", "/api/providers").catch(() => []);
    if (providers.length) {
      console.log(`\n${L("ספקים (--provider):", "Providers (--provider):")}`);
      for (const p of providers) console.log(`${p.id.padEnd(18)} ${p.label}${p.enabled ? "" : L(" (כבוי)", " (off)")}${p.available ? "" : L(" (לא מותקן)", " (not installed)")}`);
    }
  } else if (cmd === "done") {
    if (!rest[0]) throw new Error(L("חובה מזהה משימה", "A task ID is required"));
    const t = await resolveId(rest[0]);
    const patch = { status: "done" };
    if (flags.summary) patch.summary = flags.summary;
    await call("PATCH", `/api/tasks/${t.id}`, patch);
    console.log(`${L("נסגרה", "Closed")}: ${t.id.slice(0, 8)}  ${t.title}`);
  } else if (cmd === "rm") {
    if (!rest[0]) throw new Error(L("חובה מזהה משימה", "A task ID is required"));
    const t = await resolveId(rest[0]);
    await call("DELETE", `/api/tasks/${t.id}`);
    console.log(`${L("נמחקה", "Deleted")}: ${t.id.slice(0, 8)}  ${t.title}`);
  } else {
    console.log(L("שימוש: mifkada-task add|list|show|agents|allow-git|done|rm  (ראו את ההערות בראש הקובץ)", "Usage: mifkada-task add|list|show|agents|allow-git|done|rm  (see the notes at the top of the file)"));
    process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error(L("שגיאה:", "Error:"), e.message);
  process.exit(1);
}
