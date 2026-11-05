import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { CLAUDE_HOME, DATA_DIR } from "./paths.js";
import { sdkExe } from "./claudeExe.js";
import { applyClaudeAuth } from "./claudeAuth.js";

/**
 * ניקוי הרשימה באפליקציה של Claude: סשן שהיה זמין בטלפון (Remote Control) ונסגר בלי כיבוי מסודר
 * (כיבוי של מפקדה, בנייה בעדכון חם) נשאר שם עם "keepSessionOnExit". כאן מתחברים אליו לרגע ומכבים,
 * וזה מעביר אותו לארכיון באפליקציה. לא נשלחת שום הודעה ל-Claude ואין עלות.
 * רק סשנים שלא זזו רבע שעה, שלא חיים במפקדה ולא רצים בטרמינל, ושעוד לא נוקו.
 */
const DONE_FILE = path.join(DATA_DIR, "rc-retired.json");
// רבע שעה בלי תזוזה: סשן שנקטע בבנייה כבר חזר עד אז, וכל השאר לא אמור להופיע בטלפון
const IDLE_MS = 15 * 60_000;

async function readDone(): Promise<Record<string, number>> {
  try {
    return JSON.parse(await fs.readFile(DONE_FILE, "utf8")) as Record<string, number>;
  } catch {
    return {};
  }
}

interface Candidate {
  sessionId: string;
  bridgeId: string;
  cwd: string;
}

async function candidates(skip: Set<string>, idleMs: number): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const base = path.join(CLAUDE_HOME, "projects");
  const done = await readDone();
  for (const dir of await fs.readdir(base).catch(() => [] as string[])) {
    for (const f of await fs.readdir(path.join(base, dir)).catch(() => [] as string[])) {
      if (!f.endsWith(".jsonl")) continue;
      const sessionId = f.slice(0, -6);
      if (skip.has(sessionId)) continue;
      const file = path.join(base, dir, f);
      const st = await fs.stat(file).catch(() => null);
      // רק מהימים האחרונים, ורק כאלה שלא זזו שעתיים (לא סשן שרק נקטע בבנייה ויחזור עוד רגע)
      if (!st || Date.now() - st.mtimeMs < idleMs || Date.now() - st.mtimeMs > 3 * 86_400_000) continue;
      // שורה-שורה: תמליל יכול להיות עשרות MB, ואין צורך להחזיק אותו כולו בזיכרון
      let last = "";
      let cwdMatch: RegExpExecArray | null = null;
      try {
        for await (const line of createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity })) {
          const at = line.indexOf('{"type":"bridge-session"');
          if (at >= 0) last = line.slice(at);
          if (!cwdMatch && line.includes('"cwd"')) cwdMatch = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(line);
        }
      } catch {
        continue;
      }
      if (!last) continue;
      let rec: { bridgeSessionId?: string } = {};
      try {
        rec = JSON.parse(last) as { bridgeSessionId?: string };
      } catch {
        continue;
      }
      if (!rec.bridgeSessionId || done[rec.bridgeSessionId]) continue;
      if (!cwdMatch) continue;
      out.push({ sessionId, bridgeId: rec.bridgeSessionId, cwd: JSON.parse(`"${cwdMatch[1]}"`) as string });
    }
  }
  return out;
}

async function retireOne(c: Candidate): Promise<boolean> {
  // ההתחברות כותבת לקובץ הסשן, וזה היה מקפיץ אותו לראש הרשימה ומאפס את הארכיון האוטומטי. מחזירים את הזמן המקורי
  const file = await findFile(c.sessionId);
  const before = file ? await fs.stat(file).catch(() => null) : null;
  try {
    return await retireInner(c);
  } finally {
    if (file && before) await fs.utimes(file, before.atime, before.mtime).catch(() => undefined);
  }
}

async function findFile(sessionId: string): Promise<string | null> {
  const base = path.join(CLAUDE_HOME, "projects");
  for (const dir of await fs.readdir(base).catch(() => [] as string[])) {
    const f = path.join(base, dir, `${sessionId}.jsonl`);
    if (await fs.stat(f).then(() => true, () => false)) return f;
  }
  return null;
}

async function retireInner(c: Candidate): Promise<boolean> {
  const env: Record<string, string | undefined> = { ...process.env };
  applyClaudeAuth(env);
  for (const k of Object.keys(env)) if (k.startsWith("CLAUDE")) delete env[k];
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  async function* idle() {
    await hold;
  }
  const q = query({ prompt: idle(), options: { ...sdkExe(), cwd: c.cwd, resume: c.sessionId, env, tools: [], stderr: () => undefined } });
  void (async () => {
    for await (const _ of q) void _;
  })().catch(() => undefined);
  const rc = q as unknown as { enableRemoteControl: (on: boolean, name?: string, o?: { keepSessionOnExit?: boolean }) => Promise<unknown> };
  try {
    await Promise.race([q.initializationResult(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 30_000))]);
    await rc.enableRemoteControl(true, undefined, { keepSessionOnExit: false });
    await rc.enableRemoteControl(false);
    return true;
  } catch (e) {
    console.error(`rc retire ${c.sessionId.slice(0, 8)}:`, (e as Error).message);
    return false;
  } finally {
    await new Promise((r) => setTimeout(r, 1000));
    release();
    q.close();
  }
}

let running = false;
/** skip: סשנים שחיים עכשיו במפקדה או רצים בטרמינל/VS Code */
export async function retireStaleRemote(skip: Set<string>, max = 6, idleMs = IDLE_MS): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const list = (await candidates(skip, idleMs)).slice(0, max);
    const done = await readDone();
    let n = 0;
    for (const c of list) {
      if (await retireOne(c)) {
        done[c.bridgeId] = Date.now();
        n++;
      }
    }
    if (n) {
      await fs.writeFile(DONE_FILE, JSON.stringify(done, null, 2));
      console.log(`Remote Control: ${n} סשנים ישנים הוסרו מהרשימה באפליקציה של Claude`);
    }
    return n;
  } finally {
    running = false;
  }
}
