import { listSessions, query, tagSession } from "@anthropic-ai/claude-agent-sdk";
import { listAgents } from "./agents.js";
import { L } from "./i18n.js";
import { sdkExe } from "./claudeExe.js";
import { applyClaudeAuth } from "./claudeAuth.js";

/** מציע אייג'נט לכל סשן לא מתויג לפי הכותרת והפרומפט הראשון, ומתייג (אלא אם dryRun). */
export async function autotag(opts: { dryRun?: boolean; limit?: number } = {}): Promise<{ tagged: number; proposals: Array<{ sessionId: string; title: string; agent: string | null }> }> {
  const agents = await listAgents();
  if (agents.length === 0) return { tagged: 0, proposals: [] };
  const sessions = (await listSessions({ limit: 500 })).filter((s) => !s.tag).slice(0, opts.limit ?? 80);
  if (sessions.length === 0) return { tagged: 0, proposals: [] };
  const list = sessions.map((s) => ({ id: s.sessionId, title: s.customTitle || s.summary || "", prompt: (s.firstPrompt ?? "").slice(0, 200) }));
  const prompt = `יש לך רשימת אייג'נטים ורשימת סשנים. לכל סשן החלט אם הוא מתאים בבירור לאחד האייג'נטים לפי התיאור שלו,
ואם לא, null. אל תתייג בכוח: רק כשהנושא של הסשן הוא בדיוק התפקיד של האייג'נט.
החזר JSON בלבד: {"tags":{"<session id>":"<agent slug or null>", ...}}

אייג'נטים:
${agents.map((a) => `- ${a.slug}: ${a.description}`).join("\n")}

סשנים:
${list.map((s) => `- ${s.id}: ${s.title}${s.prompt ? ` | ${s.prompt}` : ""}`).join("\n")}`;
  const env: Record<string, string | undefined> = { ...process.env };
  applyClaudeAuth(env);
  let out = "";
  const q = query({ prompt, options: { ...sdkExe(), model: "haiku", tools: [], maxTurns: 1, settingSources: [], persistSession: false, env, systemPrompt: "אתה מסווג סשנים לאייג'נטים ומחזיר JSON תקין בלבד." } });
  for await (const m of q) if (m.type === "assistant") for (const b of m.message.content) if (b.type === "text") out += b.text;
  const start = out.indexOf("{");
  const end = out.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error(L("Claude לא החזיר JSON", "Claude didn't return JSON"));
  const tags = ((JSON.parse(out.slice(start, end + 1)) as { tags?: Record<string, string | null> }).tags ?? {}) as Record<string, string | null>;
  const slugs = new Set(agents.map((a) => a.slug));
  const proposals = list.map((s) => ({ sessionId: s.id, title: s.title, agent: tags[s.id] && slugs.has(String(tags[s.id])) ? String(tags[s.id]) : null }));
  let tagged = 0;
  if (!opts.dryRun) {
    for (const p of proposals) {
      if (!p.agent) continue;
      try {
        await tagSession(p.sessionId, p.agent);
        tagged++;
      } catch {
        /* סשן שנמחק בינתיים */
      }
    }
  }
  return { tagged, proposals };
}

/**
 * שיוך סשנים לפרויקט האמיתי שלהם: הרבה פעמים פותחים את Claude מתיקייה אחת גם לעבודה על פרויקטים אחרים.
 * לפי הכותרת והפרומפט הראשון בוחרים תיקיית פרויקט קיימת, ונשמר ב-meta.project. ה-cwd עצמו לא משתנה (ממנו הסשן ממשיך לרוץ).
 */
export async function autoproject(opts: { dryRun?: boolean; onlyNew?: boolean } = {}): Promise<{ assigned: number; proposals: Array<{ sessionId: string; title: string; from: string; to: string | null }> }> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { readThemes, writeSessionMeta } = await import("./store.js");
  const { knownProjectDirs } = await import("./roots.js");
  const dirs = await knownProjectDirs();
  const meta = (await readThemes()).sessions;
  // onlyNew: רק סשנים שעוד לא נבדקו (נשמר ב-autoproject-checked.json), ושיש להם כבר כותרת (לפחות 10 דקות)
  const { DATA_DIR } = await import("./paths.js");
  const checkedFile = path.join(DATA_DIR, "autoproject-checked.json");
  const checked = new Set<string>(opts.onlyNew ? ((JSON.parse(await fs.readFile(checkedFile, "utf8").catch(() => "[]")) as string[]) ?? []) : []);
  const sessions = (await listSessions({ limit: 500 })).filter(
    (s) => !meta[s.sessionId]?.archived && !meta[s.sessionId]?.project && !checked.has(s.sessionId) && (!opts.onlyNew || Date.now() - (s.createdAt ?? s.lastModified) > 10 * 60_000),
  );
  if (!sessions.length || !dirs.size) return { assigned: 0, proposals: [] };
  const list = sessions.map((s) => ({ id: s.sessionId, cwd: s.cwd ?? "", title: s.customTitle || s.summary || "", prompt: (s.firstPrompt ?? "").slice(0, 240) }));
  const prompt = `לכל סשן, בחר את תיקיית הפרויקט שהוא באמת עוסק בו מתוך הרשימה, לפי הכותרת והפרומפט הראשון.
אם הסשן עוסק בפרויקט של התיקייה שהוא כבר בה, או שהוא כללי ולא שייך לפרויקט אחד, החזר null. אל תנחש: רק כשברור.
החזר JSON בלבד: {"p":{"<session id>":"<שם תיקייה מהרשימה או null>", ...}}

תיקיות פרויקטים: ${[...dirs.keys()].join(", ")}

סשנים:
${list.map((s) => `- ${s.id} [עכשיו ב: ${path.basename(s.cwd)}]: ${s.title}${s.prompt ? ` | ${s.prompt}` : ""}`).join("\n")}`;
  const env: Record<string, string | undefined> = { ...process.env };
  applyClaudeAuth(env);
  let out = "";
  const q = query({ prompt, options: { ...sdkExe(), model: "sonnet", tools: [], maxTurns: 1, settingSources: [], persistSession: false, env, systemPrompt: "אתה משייך סשני עבודה לתיקיות פרויקטים ומחזיר JSON תקין בלבד." } });
  for await (const m of q) if (m.type === "assistant") for (const b of m.message.content) if (b.type === "text") out += b.text;
  const a = out.indexOf("{");
  const b = out.lastIndexOf("}");
  if (a < 0 || b < 0) throw new Error(L("Claude לא החזיר JSON", "Claude didn't return JSON"));
  const picks = ((JSON.parse(out.slice(a, b + 1)) as { p?: Record<string, string | null> }).p ?? {}) as Record<string, string | null>;
  const proposals = list.map((s) => {
    const name = picks[s.id];
    const to = name && dirs.has(name) && dirs.get(name) !== s.cwd ? dirs.get(name)! : null;
    return { sessionId: s.id, title: s.title, from: s.cwd, to };
  });
  let assigned = 0;
  if (!opts.dryRun) {
    for (const p of proposals) {
      if (!p.to) continue;
      await writeSessionMeta(p.sessionId, { project: p.to });
      assigned++;
    }
    // מה שנבדק לא נשאל שוב (גם אם נשאר במקום), כדי שהבדיקה השעתית תעלה רק על סשנים חדשים
    for (const s of list) checked.add(s.id);
    await fs.writeFile(checkedFile, JSON.stringify([...checked])).catch(() => undefined);
  }
  return { assigned, proposals };
}
