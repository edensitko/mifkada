import fs from "node:fs/promises";
import path from "node:path";
import { listSessions, query } from "@anthropic-ai/claude-agent-sdk";
import { DATA_DIR } from "./paths.js";
import { getSummary } from "./summary.js";
import type { Task } from "../../shared/protocol.js";
import { L } from "./i18n.js";
import { sdkExe } from "./claudeExe.js";
import { applyClaudeAuth } from "./claudeAuth.js";

const FILE = path.join(DATA_DIR, "digest.json");

export interface Digest {
  date: string;
  createdAt: number;
  bullets: string[];
  sessions: number;
  /** תקציר ישן שמוחזר מיד בזמן שחדש נכתב ברקע. */
  stale?: boolean;
}

const FRESH_MS = 2 * 3600000;
/** תקציר ישן עד כמה אפשר להציג מיד, לפני שמחכים לחדש. מעבר לזה עדיף להמתין. */
const STALE_OK_MS = 24 * 3600000;
let inflight: Promise<Digest> | null = null;

async function readCache(): Promise<Digest | null> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as Digest;
  } catch {
    return null;
  }
}

/**
 * תקציר "מאז אתמול". טרי (עד שעתיים, מהיום) מוחזר מיד. ישן עד 24 שעות מוחזר מיד עם stale=true
 * ומתחדש ברקע. רק בלי תקציר בכלל, או עם force, מחכים למודל. קריאות מקבילות חולקות יצירה אחת.
 */
export async function digest(tasks: Task[], force = false, generate: (tasks: Task[]) => Promise<Digest> = generateDigest): Promise<Digest> {
  const today = new Date().toISOString().slice(0, 10);
  const cached = force ? null : await readCache();
  const age = cached ? Date.now() - cached.createdAt : Infinity;
  if (cached && cached.date === today && age < FRESH_MS) return cached;
  const refresh = (): Promise<Digest> => {
    inflight ??= generate(tasks).finally(() => {
      inflight = null;
    });
    return inflight;
  };
  if (cached && age < STALE_OK_MS) {
    refresh().catch(() => undefined);
    return { ...cached, stale: true };
  }
  return refresh();
}

async function generateDigest(tasks: Task[]): Promise<Digest> {
  const today = new Date().toISOString().slice(0, 10);
  const since = Date.now() - 24 * 3600000;
  const sessions = (await listSessions({ limit: 500 })).filter((s) => s.lastModified >= since);
  const lines: string[] = [];
  for (const s of sessions.slice(0, 40)) {
    const sum = await getSummary(s.sessionId);
    const project = s.cwd ? path.basename(s.cwd) : "";
    lines.push(`- [${project}] ${s.customTitle || s.summary || s.firstPrompt || ""}${sum ? ` :: ${sum.summary.join(" ")}` : ""}`);
  }
  const doneTasks = tasks.filter((t) => t.status === "done" && t.updatedAt >= since).map((t) => `- ${L("הושלם", "Done")}: ${t.title}`);
  const openTasks = tasks
    .filter((t) => t.status !== "done")
    .map((t) => `- ${t.status === "review" ? L("לבדיקה", "To review") : t.status === "running" ? L("בעבודה", "In progress") : L("בתור", "Queued")}: ${t.title}`);
  if (lines.length === 0 && doneTasks.length === 0) {
    const d: Digest = { date: today, createdAt: Date.now(), bullets: [L("שקט ב-24 השעות האחרונות. אין סשנים חדשים.", "Quiet in the last 24 hours. No new sessions.")], sessions: 0 };
    return d;
  }
  const taskLines = [...doneTasks, ...openTasks].join("\n") || L("- אין", "- None");
  // התקציר מוצג למשתמש, ולכן נכתב בשפת הממשק. מבנה ה-JSON זהה
  const prompt = L(
    `כתוב תקציר בוקר קצר בעברית, 3 עד 5 נקודות, על מה קרה ב-24 השעות האחרונות ומה מחכה.
ענייני, בלי פתיחים. החזר JSON בלבד: {"bullets":["..."]}

סשנים (פרויקט, כותרת, ואם יש גם סיכום):
${lines.join("\n")}

משימות:
${taskLines}`,
    `Write a short morning digest in English, 3 to 5 bullet points, on what happened in the last 24 hours and what's waiting.
Matter-of-fact, no preamble. Return JSON only: {"bullets":["..."]}

Sessions (project, title, and a summary if there is one):
${lines.join("\n")}

Tasks:
${taskLines}`,
  );
  const env: Record<string, string | undefined> = { ...process.env };
  applyClaudeAuth(env);
  let out = "";
  const q = query({ prompt, options: { ...sdkExe(), model: "haiku", tools: [], maxTurns: 1, settingSources: [], persistSession: false, env, systemPrompt: L("אתה כותב תקצירי בוקר בעברית ומחזיר JSON תקין בלבד.", "You write morning digests in English and return valid JSON only.") } });
  for await (const m of q) if (m.type === "assistant") for (const b of m.message.content) if (b.type === "text") out += b.text;
  const start = out.indexOf("{");
  const end = out.lastIndexOf("}");
  const bullets = start >= 0 ? ((JSON.parse(out.slice(start, end + 1)) as { bullets?: unknown }).bullets as string[] | undefined) ?? [] : [];
  const d: Digest = { date: today, createdAt: Date.now(), bullets: bullets.filter((b) => typeof b === "string").slice(0, 6), sessions: sessions.length };
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(d, null, 2));
  return d;
}
