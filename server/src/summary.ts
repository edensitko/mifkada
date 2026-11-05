import fs from "node:fs/promises";
import path from "node:path";
import { getSessionMessages, getSessionInfo, query } from "@anthropic-ai/claude-agent-sdk";
import { getProviderSession, readProviderTranscript } from "./providerSessions.js";
import { cachedProvider } from "./providers/presets.js";

import { DATA_DIR } from "./paths.js";
import { toBlocks } from "./history.js";
import type { Block, SessionSummary } from "../../shared/protocol.js";
import { L } from "./i18n.js";
import { sdkExe } from "./claudeExe.js";
import { applyClaudeAuth } from "./claudeAuth.js";

const FILE = path.join(DATA_DIR, "summaries.json");
const MAX_CHARS = 90000;

async function readAll(): Promise<Record<string, SessionSummary>> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as Record<string, SessionSummary>;
  } catch {
    return {};
  }
}

export async function getSummary(sessionId: string): Promise<SessionSummary | null> {
  return (await readAll())[sessionId] ?? null;
}

/**
 * ההודעות של הסשן כבלוקים: של Claude מה-SDK, ושל ספק אחר (Codex וכו') מהתמליל שמפקדה שומרת.
 * who = השם של הסוכן בתמליל הדחוס
 */
async function sessionBlocks(sessionId: string): Promise<{ msgs: Array<{ role: "user" | "assistant"; blocks: Block[] }>; who: string }> {
  const ps = await getProviderSession(sessionId);
  if (ps) return { msgs: await readProviderTranscript(sessionId), who: cachedProvider(ps.provider)?.label ?? ps.provider };
  const raw = await getSessionMessages(sessionId);
  const msgs = raw.filter((m) => !m.parent_tool_use_id && (m.type === "user" || m.type === "assistant")).map((m) => ({ role: m.type as "user" | "assistant", blocks: toBlocks((m.message as { content?: unknown })?.content) }));
  return { msgs, who: "Claude" };
}

/** התמליל כטקסט דחוס: פניות המשתמש, התשובות, ושמות הכלים. שומר את ההתחלה ואת הסוף. */
async function transcriptText(sessionId: string): Promise<{ text: string; count: number }> {
  const { msgs, who } = await sessionBlocks(sessionId);
  const lines: string[] = [];
  for (const m of msgs) {
    for (const b of m.blocks) {
      if (b.type === "text") lines.push(`${m.role === "user" ? L("משתמש", "User") : who}: ${b.text}`);
      else if (b.type === "tool_use") {
        const i = b.input as Record<string, unknown> | undefined;
        const hint = typeof i?.description === "string" ? i.description : typeof i?.command === "string" ? String(i.command).slice(0, 120) : typeof i?.file_path === "string" ? i.file_path : "";
        lines.push(`[${L("כלי", "tool")} ${b.name}${hint ? ": " + hint : ""}]`);
      } else if (b.type === "tool_result" && b.isError) lines.push(`[${L("שגיאה", "error")}: ${b.content.slice(0, 200)}]`);
    }
  }
  let text = lines.join("\n");
  if (text.length > MAX_CHARS) {
    const head = text.slice(0, 15000);
    const tail = text.slice(-(MAX_CHARS - 15000));
    text = `${head}\n\n[... ${L("קטע באמצע הושמט", "middle part omitted")} ...]\n\n${tail}`;
  }
  return { text, count: msgs.length };
}

function extractJson(s: string): unknown {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error(L("Claude לא החזיר JSON", "Claude didn't return JSON"));
  return JSON.parse(s.slice(start, end + 1));
}

/** מריץ סיכום חד-פעמי בלי כלים ושומר אותו. */
export async function summarize(sessionId: string, model = "sonnet"): Promise<SessionSummary> {
  const ps = await getProviderSession(sessionId);
  const cwd = ps ? ps.cwd : (await getSessionInfo(sessionId))?.cwd;
  const { text, count } = await transcriptText(sessionId);
  if (!text.trim()) throw new Error(L("אין תמליל לסכם", "No transcript to summarize"));
  const project = cwd ? path.basename(cwd) : "";
  // הסיכום מוצג למשתמש, ולכן נכתב בשפת הממשק. מבנה ה-JSON זהה בשתי השפות
  const prompt = L(
    `לפניך תמליל של סשן עבודה עם Claude Code${project ? ` בפרויקט "${project}"` : ""}.
החזר JSON בלבד, בלי טקסט לפניו או אחריו, במבנה הזה:
{"summary":["..."],"done":["..."],"open":[{"title":"...","prompt":"..."}]}

- summary: 3 עד 6 נקודות קצרות בעברית: מה קרה בסשן ומה המצב עכשיו.
- done: מה הושלם בפועל (לא מה שתוכנן).
- open: מה שנשאר פתוח, נדחה, הוצע ולא בוצע, או נשבר ולא תוקן. לכל פריט: title קצר בעברית (עד 8 מילים),
  ו-prompt בעברית שאפשר לתת ל-Claude בסשן חדש כדי לבצע את זה בלי לראות את השיחה הזו: כולל קבצים,
  שמות ונתיבים רלוונטיים מהתמליל. אם אין פריטים פתוחים, open יהיה רשימה ריקה.

התמליל:
<transcript>
${text}
</transcript>`,
    `Below is a transcript of a Claude Code work session${project ? ` in the project "${project}"` : ""}.
Return JSON only, with no text before or after it, in this shape:
{"summary":["..."],"done":["..."],"open":[{"title":"...","prompt":"..."}]}

- summary: 3 to 6 short bullet points in English: what happened in the session and where things stand now.
- done: what was actually completed (not what was planned).
- open: anything left open, postponed, suggested but not done, or broken and not fixed. For each item: a short title in English (up to 8 words),
  and a prompt in English that can be given to Claude in a new session to do it without seeing this conversation: include files,
  names and relevant paths from the transcript. If nothing is open, open is an empty list.

The transcript:
<transcript>
${text}
</transcript>`,
  );

  const env: Record<string, string | undefined> = { ...process.env };
  applyClaudeAuth(env);
  let out = "";
  let usedModel = model;
  const q = query({
    prompt,
    options: { ...sdkExe(), cwd, model, tools: [], maxTurns: 1, permissionMode: "default", settingSources: [], persistSession: false, env, systemPrompt: L("אתה מסכם סשני עבודה בעברית ומחזיר JSON תקין בלבד.", "You summarize work sessions in English and return valid JSON only.") },
  });
  for await (const m of q) {
    if (m.type === "system" && m.subtype === "init") usedModel = m.model;
    if (m.type === "assistant") for (const b of m.message.content) if (b.type === "text") out += b.text;
    if (m.type === "result" && m.is_error) throw new Error("errors" in m && Array.isArray(m.errors) ? m.errors.join("; ") : L("הסיכום נכשל", "The summary failed"));
  }
  const j = extractJson(out) as Partial<SessionSummary>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const result: SessionSummary = {
    sessionId,
    createdAt: Date.now(),
    model: usedModel,
    messages: count,
    summary: Array.isArray(j.summary) ? j.summary.map(str).filter(Boolean).slice(0, 8) : [],
    done: Array.isArray(j.done) ? j.done.map(str).filter(Boolean).slice(0, 20) : [],
    open: Array.isArray(j.open)
      ? j.open
          .map((o) => ({ title: str((o as { title?: unknown })?.title), prompt: str((o as { prompt?: unknown })?.prompt) }))
          .filter((o) => o.title && o.prompt)
          .slice(0, 20)
      : [],
  };
  const all = await readAll();
  all[sessionId] = result;
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(all, null, 2));
  return result;
}
