import fs from "node:fs";
import net from "node:net";
import { isProtectedDir } from "./paths.js";
import { retireStaleRemote } from "./rcRetire.js";
import { BROWSER_TOKEN, SECURITY_HEADERS, TOKEN_COOKIE, hasBrowserToken, isAllowedRequest } from "./origin.js";
import { hasUiSecret } from "./uiTrust.js";
import os from "node:os";
import fsp from "node:fs/promises";
import { planUsage } from "./planUsage.js";
import { listCommands } from "./commands.js";
import { devPorts } from "./ports.js";
import path from "node:path";
import { execFile } from "node:child_process";
import type { Server } from "node:http";
import { Hono, type MiddlewareHandler } from "hono";
import { serve, createAdaptorServer } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { deleteSession, listSessions, renameSession, tagSession } from "@anthropic-ai/claude-agent-sdk";
import { WebSocketServer } from "ws";
import { Hub } from "./ws.js";
import { createTerminalServer } from "./terminal.js";
import { listDir, readFile, writeFile } from "./fs.js";
import { sttAvailable, transcribe } from "./stt.js";
import { getSummary, summarize } from "./summary.js";
import { changedFiles, commitAll, discardFile, fileDiff } from "./git.js";
import { usageReport } from "./usage.js";
import { readUpload, saveUpload } from "./uploads.js";
import { readSafety, setDefaultMode, setRule, type RuleList } from "./safety.js";
import { readProfiles, setProfile } from "./profiles.js";
import { autotag, autoproject } from "./autotag.js";
import { digest } from "./digest.js";
import { listFiles, searchText, searchTranscripts } from "./search.js";
import { TaskStore } from "./tasks.js";
import { RoutineStore } from "./routines.js";
import { deleteTemplate, listTemplates, saveTemplate } from "./templates.js";
import { exportData, importData, openaiSpeech, publicSettings, setAnthropicKey, setNotifyPrefs, setOpenaiKey, setProviderSettings, setSystemPrefs, systemPrefs } from "./settings.js";
import { allRepos } from "./repos.js";
import { capabilities } from "./capabilities.js";
import { activeInRepo } from "./activity.js";
import { knownProjectDirs, projectRoots } from "./roots.js";
import { addMcp, listMarketplaces, listMcp, listPlugins, marketplaceAction, pluginAction, removeMcp, type McpInput, type McpScope } from "./extensions.js";
import { doctor } from "./doctor.js";
import { AccessError, assertAllowedCwd, assertOpenableCwd, setExtraRoots } from "./access.js";
import { browseDir } from "./browse.js";
import { buildMap, memoryNotes, readNote } from "./map.js";
import { backupNow, listBackups, scheduleBackups } from "./backup.js";
import { gitInfo, openIn } from "./projects.js";
import { deleteAgent, listAgents, writeAgent } from "./agents.js";
import { readThemes, writeSessionMeta, writeTheme } from "./store.js";
import { readExternalLives } from "./external.js";
import { readTranscript } from "./history.js";
import { deleteProviderSession, getProviderSession, listProviderSessions, readProviderTranscript, upsertProviderSession } from "./providerSessions.js";
import { refreshProviders, which } from "./providers/presets.js";
import { acpRegistry } from "./providers/acpRegistry.js";
import { authStatus, claudeLoginCode, invalidateAuth, startLogin } from "./providers/auth.js";
import { agentSessionsStatus, knownAgentSessions, syncAgentSessions, syncAllAgentSessions } from "./providers/agentSessions.js";
import { WEB_DIST, DATA_DIR } from "./paths.js";
import { isPipe, WORKTREE_DIR } from "./platform.js";
import type { AgentInput, AgentTheme, PermissionMode, SessionBackground, SessionMeta, SessionRow, Task, TaskInput, TaskStatus } from "../../shared/protocol.js";
import { L } from "./i18n.js";
const SESSION_BACKGROUNDS: readonly SessionBackground[] = ["tint", "sunrise", "ocean", "forest", "lavender", "graphite", "dots"];

const PORT = Number(process.env.MIFKADA_PORT ?? 4777);
// דגל של המעטפת (Tauri) בלבד. נמחק כדי שסשנים של Claude ותהליכים שהם מריצים לא יירשו אותו (ראו למטה)
const PARENT_STDIN = process.env.MIFKADA_PARENT_STDIN === "1";
delete process.env.MIFKADA_PARENT_STDIN;
const HOST = "127.0.0.1";

let hub: Hub;
let tasks: TaskStore;
let routines: RoutineStore;

const MODES: PermissionMode[] = ["default", "acceptEdits", "plan", "auto", "dontAsk"];
const STATUSES: TaskStatus[] = ["todo", "running", "review", "done"];

/** ספק ממשימה/רוטינה: claude או ריק = undefined (ברירת המחדל), אחרת מזהה בפורמט של ההגדרות */
function pickProvider(v: unknown): string | undefined {
  return typeof v === "string" && v !== "claude" && /^[a-z][a-z0-9-]{0,30}$/.test(v) ? v : undefined;
}

function pickTaskInput(body: unknown): TaskInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : "");
  return {
    title: str("title").slice(0, 120),
    prompt: str("prompt").slice(0, 20000),
    cwd: str("cwd"),
    provider: pickProvider(b.provider),
    agent: typeof b.agent === "string" && b.agent ? b.agent : null,
    model: typeof b.model === "string" && b.model ? b.model : null,
    permissionMode: MODES.includes(b.permissionMode as PermissionMode) ? (b.permissionMode as PermissionMode) : "default",
    status: STATUSES.includes(b.status as TaskStatus) ? (b.status as TaskStatus) : undefined,
    owner: b.owner === "me" ? "me" : undefined,
    isolate: b.isolate === true,
    allowGit: b.allowGit === true,
  };
}

async function sessionRows(): Promise<SessionRow[]> {
  const [rows, external, themes] = await Promise.all([listSessions({ limit: 500 }), readExternalLives(), readThemes()]);
  const seen = new Set<string>();
  // סשן שרץ בענף נפרד של משימה (worktree) שייך לפרויקט של המשימה, לא ל"פרויקט" זמני בשם התיקייה של ה-worktree
  const worktreeOwner = (cwd: string): string | null => {
    for (const t of tasks?.list() ?? []) if (t.worktree && (cwd === t.worktree.path || cwd.startsWith(t.worktree.path + path.sep))) return t.cwd;
    // משימה שכבר נמחקה: worktree.ts יוצר <אב>/.mifkada-worktrees/<repo>-<id 8 תווים>, אז הפרויקט המקורי הוא <אב>/<repo>/<המשך>
    const m = WORKTREE_DIR.exec(cwd);
    return m ? path.join(m[1], m[2] + (m[3] ?? "")) : null;
  };
  const out: SessionRow[] = rows.map((r) => {
    seen.add(r.sessionId);
    const live = hub.liveBySession(r.sessionId);
    const ext = live ? null : (external.get(r.sessionId) ?? null);
    const cwd = r.cwd ?? "";
    return {
      sessionId: r.sessionId,
      title: r.customTitle || ext?.name || r.summary || r.firstPrompt || L("(ללא כותרת)", "(untitled)"),
      cwd,
      project: path.basename(themes.sessions[r.sessionId]?.project || cwd) || cwd,
      projectCwd: themes.sessions[r.sessionId]?.project || worktreeOwner(cwd) || cwd,
      lastModified: r.lastModified,
      createdAt: r.createdAt,
      tag: r.tag ?? null,
      gitBranch: r.gitBranch,
      external: ext,
      live: live?.info() ?? null,
    };
  });
  // סשנים של ספקים אחרים (Codex וכו'): הרישום של מפקדה, לא listSessions
  for (const p of await listProviderSessions()) {
    if (seen.has(p.sessionId)) continue;
    seen.add(p.sessionId);
    const live = hub.liveBySession(p.sessionId);
    out.push({
      sessionId: p.sessionId,
      title: live?.title || p.title || L("(ללא כותרת)", "(untitled)"),
      cwd: p.cwd,
      project: path.basename(themes.sessions[p.sessionId]?.project || p.cwd) || p.cwd,
      projectCwd: themes.sessions[p.sessionId]?.project || worktreeOwner(p.cwd) || p.cwd,
      lastModified: p.lastModified,
      createdAt: p.createdAt,
      provider: p.provider,
      tag: p.agent,
      external: null,
      live: live?.info() ?? null,
    });
  }
  // סשנים של אותם ספקים שנפתחו מחוץ למפקדה (Codex מהטרמינל), מ-session/list. נפתחים כאן עם ההיסטוריה (load)
  for (const a of knownAgentSessions()) {
    if (seen.has(a.sessionId)) continue;
    seen.add(a.sessionId);
    out.push({
      sessionId: a.sessionId,
      title: a.title || L("(ללא כותרת)", "(untitled)"),
      cwd: a.cwd,
      project: path.basename(themes.sessions[a.sessionId]?.project || a.cwd) || a.cwd,
      projectCwd: themes.sessions[a.sessionId]?.project || worktreeOwner(a.cwd) || a.cwd,
      lastModified: a.updatedAt,
      provider: a.provider,
      tag: null,
      external: null,
      live: null,
    });
  }
  out.sort((a, b) => b.lastModified - a.lastModified);
  // סשנים חיים שעוד אין להם קובץ (לפני ההודעה הראשונה)
  for (const l of hub.lives.values()) {
    if (l.sessionId && seen.has(l.sessionId)) continue;
    out.unshift({
      sessionId: l.sessionId ?? l.liveId,
      title: l.title,
      cwd: l.cwd,
      project: path.basename(l.cwd) || l.cwd,
      projectCwd: l.cwd,
      lastModified: l.startedAt,
      provider: l.provider,
      tag: l.agent,
      external: null,
      live: l.info(),
    });
  }
  return out;
}

function pickTheme(body: unknown): AgentTheme {
  const b = (body ?? {}) as Record<string, unknown>;
  const t: AgentTheme = {};
  if (typeof b.color === "string" && /^#[0-9a-f]{6}$/i.test(b.color)) t.color = b.color;
  if (typeof b.emoji === "string" && b.emoji.length <= 8) t.emoji = b.emoji;
  if (typeof b.displayName === "string" && b.displayName.length <= 40) t.displayName = b.displayName;
  if (typeof b.pinned === "boolean") t.pinned = b.pinned;
  if (typeof b.hidden === "boolean") t.hidden = b.hidden;
  // תמונה: data URL של תמונה עד 200KB, או "" להסרה (undefined נעלם ב-JSON ולכן מוחק את הקיימת)
  if (b.image === "") t.image = undefined;
  else if (typeof b.image === "string" && /^data:image\/(png|jpeg|webp|gif);base64,/.test(b.image) && b.image.length <= 200_000) t.image = b.image;
  return t;
}

const app = new Hono();

// לפני הכול: רק מפקדה עצמה מדברת עם השרת (ראו origin.ts)
app.use("*", async (c, next) => {
  const h = { host: c.req.header("host"), origin: c.req.header("origin"), cookie: c.req.header("cookie"), "sec-fetch-site": c.req.header("sec-fetch-site") };
  if (!isAllowedRequest(h)) {
    console.error(`[origin] נחסם: ${c.req.method} ${c.req.path} מ-${h.origin ?? "?"} (host ${h.host})`);
    return c.json({ error: L("בקשה מחוץ למפקדה נחסמה", "A request from outside Mifkada was blocked") }, 403);
  }
  // הדף הראשי (ניווט ישיר, לא מתוך דף אחר) מקבל את הטוקן. כל השאר ב-/api דורש אותו
  const isDoc = !c.req.path.startsWith("/api/") && c.req.header("sec-fetch-dest") !== "iframe";
  if (c.req.path.startsWith("/api/") && !hasBrowserToken(h)) {
    console.error(`[token] נחסם: ${c.req.method} ${c.req.path} בלי טוקן`);
    return c.json({ error: L("חסר טוקן. טען מחדש את מפקדה", "Missing token. Reload Mifkada") }, 401);
  }
  await next();
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) c.res.headers.set(k, v);
  if (isDoc && (c.req.path === "/" || c.req.path === "/index.html")) {
    c.res.headers.append("Set-Cookie", `${TOKEN_COOKIE}=${BROWSER_TOKEN}; Path=/; HttpOnly; SameSite=Strict`);
  }
});
// גישה לקבצים, git, טרמינל ופקודות רק בתיקיות שמפקדה מכירה (access.ts). ה-cwd מגיע ב-query או בגוף הבקשה
const CWD_ROUTES = ["/api/fs/", "/api/git/", "/api/projects/git", "/api/projects/open", "/api/commands", "/api/ext/mcp"];
// משימות ורוטינות מגדירות תיקייה חדשה (שנכנסת אחר כך לתיקיות המותרות דרך setExtraRoots), לכן הן עוברות את
// assertOpenableCwd: תיקייה מוכרת, או תיקייה בבית שאפשר לבחור בבורר. כמו פתיחת סשן ב-WebSocket (ws.ts)
const OPEN_ROUTES = ["/api/tasks", "/api/routines"];
app.use("/api/*", async (c, next) => {
  const strict = CWD_ROUTES.some((r) => c.req.path.startsWith(r));
  const opening = !strict && c.req.method !== "GET" && OPEN_ROUTES.some((r) => c.req.path === r || c.req.path.startsWith(r + "/"));
  if (!strict && !opening) return next();
  let cwd: unknown = c.req.query("cwd");
  if (!cwd && c.req.method !== "GET") cwd = ((await c.req.json().catch(() => ({}))) as { cwd?: unknown }).cwd;
  if (cwd === undefined || cwd === "") return next();
  try {
    if (typeof cwd !== "string") throw new Error("cwd");
    await (strict ? assertAllowedCwd(cwd) : assertOpenableCwd(cwd));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 403);
  }
  return next();
});


/*
 * רשת ביטחון לכל ה-API: בקשה שלא נענית תוך 45 שניות (120 לסיכומים והקראה) מקבלת 504 במקום להיתקע לנצח,
 * ובקשה איטית (מעל 5 שניות) נרשמת ב-daemon.log. כך תקיעה כמו זו של תיקיית ההורדות נראית מיד.
 */
app.use("/api/*", async (c, next) => {
  const t0 = Date.now();
  const limit = /\/(summary|summarize|digest|tts|stt|plan-usage|import)\b/.test(c.req.path) ? 120_000 : 45_000;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((r) => (timer = setTimeout(() => r("timeout"), limit)));
  const r = await Promise.race([next().then(() => "ok" as const), timeout]);
  clearTimeout(timer);
  const ms = Date.now() - t0;
  if (r === "timeout") {
    console.error(`[timeout] ${c.req.method} ${c.req.path} לא נענה תוך ${limit / 1000} שניות`);
    return c.json({ error: L("השרת לא ענה בזמן", "The server didn't respond in time") }, 504);
  }
  if (ms > 5000) console.error(`[slow] ${c.req.method} ${c.req.path} ${ms}ms`);
});

app.post("/api/uploads", async (c) => {
  const name = c.req.query("name") ?? "file";
  const body = Buffer.from(await c.req.arrayBuffer());
  return c.json(await saveUpload(name, body, c.req.header("content-type") ?? undefined));
});
app.get("/api/uploads/file", async (c) => {
  const p = c.req.query("path") ?? "";
  const buf = await readUpload(p);
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  const type = ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", pdf: "application/pdf" } as Record<string, string>)[ext] ?? "application/octet-stream";
  return new Response(new Uint8Array(buf), { headers: { "content-type": type, "cache-control": "private, max-age=86400" } });
});
app.get("/api/commands", async (c) => {
  const cwd = c.req.query("cwd");
  if (!cwd) return c.json({ error: L("חסר cwd", "Missing cwd") }, 400);
  try {
    return c.json(await listCommands(cwd, c.req.query("force") === "1"));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});
app.get("/api/ports", async (c) => c.json(await devPorts([PORT, Number(process.env.MIFKADA_REMOTE_PORT ?? 4799), 5173])));
app.get("/api/health", async (c) => {
  // בדיקה אמיתית של פעולת קבצים: אם חוטי הקבצים תקועים, זה יופיע כאן ולא רק כ"השרת חי"
  const fsOk = await Promise.race([fsp.stat(DATA_DIR).then(() => true, () => true), new Promise<boolean>((r) => setTimeout(() => r(false), 2000))]);
  return c.json({ ok: fsOk, fs: fsOk, lives: hub.lives.size, hot: process.env.MIFKADA_HOT === "1", root: process.env.MIFKADA_ROOT ?? null, trustedUi: hasUiSecret() });
});
/** כמה זיכרון תופסים תהליכי Claude שרצים במחשב (של מפקדה ושל טרמינלים), לתצוגה בלוח */
app.get("/api/resources", async (c) => {
  const out = await new Promise<string>((res) => execFile("ps", ["-axo", "pid=,rss=,command="], { maxBuffer: 8 * 1024 * 1024, timeout: 4000 }, (_e, so) => res(String(so ?? ""))));
  let mifkadaMB = 0;
  let otherMB = 0;
  let mifkadaCount = 0;
  let otherCount = 0;
  for (const line of out.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!m) continue;
    const cmd = m[3];
    const mb = Number(m[2]) / 1024;
    if (cmd.includes("claude-agent-sdk") && /\/claude(\s|$)/.test(cmd)) {
      mifkadaMB += mb;
      mifkadaCount++;
    } else if (/(^|\/)claude(\.exe)?(\s|$)/.test(cmd) && !cmd.includes("Claude.app")) {
      otherMB += mb;
      otherCount++;
    }
  }
  return c.json({ mifkada: { count: mifkadaCount, mb: Math.round(mifkadaMB) }, other: { count: otherCount, mb: Math.round(otherMB) }, daemonMB: Math.round(process.memoryUsage().rss / 1048576), totalGB: Math.round(os.totalmem() / 1073741824) });
});
app.get("/api/agents", async (c) => c.json(await listAgents()));
app.post("/api/agents", async (c) => {
  const b = (await c.req.json()) as Partial<AgentInput>;
  const input: AgentInput = { slug: String(b.slug ?? "").trim(), description: String(b.description ?? ""), prompt: String(b.prompt ?? ""), tools: typeof b.tools === "string" ? b.tools : undefined, model: typeof b.model === "string" ? b.model : undefined };
  await writeAgent(input);
  return c.json(await listAgents());
});
app.delete("/api/agents/:slug", async (c) => {
  await deleteAgent(c.req.param("slug"));
  return c.json(await listAgents());
});
app.put("/api/agents/:slug/theme", async (c) => c.json(await writeTheme("agents", c.req.param("slug"), pickTheme(await c.req.json()))));
app.get("/api/themes", async (c) => c.json(await readThemes()));
app.put("/api/themes/:kind", async (c) => {
  const kind = c.req.param("kind");
  if (kind !== "agents" && kind !== "projects") return c.json({ error: "kind" }, 400);
  const body = (await c.req.json()) as { key?: string };
  if (typeof body.key !== "string" || !body.key) return c.json({ error: "key" }, 400);
  return c.json(await writeTheme(kind as "agents" | "projects", body.key, pickTheme(body)));
});
app.get("/api/sessions", async (c) => c.json(await sessionRows()));

/** סשן של ספק אחר: מהרישום, או (סשן שנפתח מחוץ למפקדה) נרשם עכשיו כדי שאפשר יהיה לשנות לו שם או אייג'נט */
async function providerSessionFor(id: string) {
  const ps = await getProviderSession(id);
  if (ps) return ps;
  const a = knownAgentSessions().find((x) => x.sessionId === id);
  if (!a) return undefined;
  await upsertProviderSession({ sessionId: a.sessionId, provider: a.provider, cwd: a.cwd, title: a.title, lastModified: a.updatedAt });
  return getProviderSession(id);
}
app.get("/api/sessions/:id/messages", async (c) => {
  const id = c.req.param("id");
  if (await getProviderSession(id)) return c.json(await readProviderTranscript(id));
  // סשן של ספק אחר שעוד לא נפתח כאן: ההיסטוריה מגיעה כשפותחים אותו (load)
  if (knownAgentSessions().some((a) => a.sessionId === id)) return c.json([]);
  return c.json(await readTranscript(id));
});
app.put("/api/sessions/:id/tag", async (c) => {
  const { tag } = (await c.req.json()) as { tag?: string | null };
  const ps = await providerSessionFor(c.req.param("id"));
  if (ps) {
    await upsertProviderSession({ ...ps, agent: tag ? String(tag) : null, lastModified: ps.lastModified });
    return c.json({ ok: true });
  }
  await tagSession(c.req.param("id"), tag ? String(tag) : null);
  return c.json({ ok: true });
});
app.get("/api/sessions/:id/summary", async (c) => c.json(await getSummary(c.req.param("id"))));
app.post("/api/sessions/:id/summary", async (c) => {
  const { model } = (await c.req.json().catch(() => ({}))) as { model?: string };
  return c.json(await summarize(c.req.param("id"), typeof model === "string" && model ? model : "sonnet"));
});
app.put("/api/sessions/:id/rename", async (c) => {
  const { title } = (await c.req.json()) as { title?: string };
  if (!title?.trim()) return c.json({ error: "title" }, 400);
  const ps = await providerSessionFor(c.req.param("id"));
  if (ps) {
    await upsertProviderSession({ ...ps, title: title.trim().slice(0, 120), lastModified: ps.lastModified });
    return c.json({ ok: true });
  }
  await renameSession(c.req.param("id"), title.trim().slice(0, 120));
  return c.json({ ok: true });
});
app.put("/api/sessions/:id/meta", async (c) => {
  const body = (await c.req.json()) as { archived?: boolean; pinned?: boolean; project?: string; color?: string; background?: string; scheme?: string };
  const patch: SessionMeta = {};
  if (typeof body.archived === "boolean") patch.archived = body.archived;
  // הוצאה ידנית מהארכיון: הארכיון האוטומטי לא יחזיר אותו לשם
  if (body.archived === false) patch.kept = true;
  if (typeof body.pinned === "boolean") patch.pinned = body.pinned;
  if (typeof body.project === "string") patch.project = body.project || undefined;
  // עיצוב לסשן: מחרוזת ריקה = חזרה לעיצוב של הפרויקט/האייג'נט
  if (typeof body.color === "string") patch.color = /^#[0-9a-f]{6}$/i.test(body.color) ? body.color : undefined;
  if (typeof body.background === "string") patch.background = (SESSION_BACKGROUNDS as readonly string[]).includes(body.background) ? (body.background as SessionBackground) : undefined;
  if (typeof body.scheme === "string") patch.scheme = body.scheme === "light" || body.scheme === "dark" ? body.scheme : undefined;
  return c.json(await writeSessionMeta(c.req.param("id"), patch));
});
app.delete("/api/sessions/:id", async (c) => {
  const id = c.req.param("id");
  const live = hub.liveBySession(id);
  if (live) {
    live.close();
    hub.lives.delete(live.liveId);
  }
  if (!(await getProviderSession(id)) && knownAgentSessions().some((a) => a.sessionId === id)) {
    return c.json({ error: L("את הסשן הזה אפשר למחוק רק מתוך הסוכן שלו. אפשר להעביר אותו לארכיון", "This session can only be deleted from its own agent. You can archive it") }, 400);
  }
  if (!(await deleteProviderSession(id))) await deleteSession(id);
  await writeSessionMeta(id, { archived: false });
  return c.json({ ok: true });
});
app.get("/api/projects", async (c) => {
  const rows = await listSessions({ limit: 500 });
  const counts = new Map<string, number>();
  for (const r of rows) if (r.cwd) counts.set(r.cwd, (counts.get(r.cwd) ?? 0) + 1);
  return c.json([...counts].map(([cwd, sessions]) => ({ cwd, sessions })).sort((a, b) => b.sessions - a.sessions));
});

app.get("/api/projects/git", async (c) => {
  const cwd = c.req.query("cwd") ?? "";
  if (!cwd) return c.json({ error: "cwd" }, 400);
  return c.json(await gitInfo(cwd));
});
app.post("/api/projects/open", async (c) => {
  const { cwd, app: target } = (await c.req.json()) as { cwd?: string; app?: string };
  if (!cwd || !target) return c.json({ error: "cwd, app" }, 400);
  await openIn(cwd, target);
  return c.json({ ok: true });
});
app.get("/api/usage", async (c) => c.json(await usageReport(Number(c.req.query("days") ?? 30))));
app.get("/api/project-dirs", async (c) => {
  const dirs = new Set<string>((await knownProjectDirs()).values());
  for (const r of await listSessions({ limit: 500 })) if (r.cwd && !isProtectedDir(r.cwd)) dirs.add(r.cwd);
  return c.json([...dirs].sort((a, b) => path.basename(a).localeCompare(path.basename(b))));
});
app.post("/api/sessions/autoproject", async (c) => {
  const { dryRun } = (await c.req.json().catch(() => ({}))) as { dryRun?: boolean };
  return c.json(await autoproject({ dryRun: Boolean(dryRun) }));
});
app.post("/api/sessions/autotag", async (c) => {
  const { dryRun, limit } = (await c.req.json().catch(() => ({}))) as { dryRun?: boolean; limit?: number };
  return c.json(await autotag({ dryRun: Boolean(dryRun), limit: typeof limit === "number" ? limit : undefined }));
});
// התקציר נכתב על ידי מודל: רק אם הפעלת "עוזרי רקע" בהגדרות, או כשביקשת במפורש (force)
app.get("/api/digest", async (c) => {
  const force = c.req.query("force") === "1";
  if (!systemPrefs().aiHelpers && !force) return c.json({ disabled: true });
  return c.json(await digest(tasks.list(), force));
});
app.get("/api/git/changes", async (c) => {
  const cwd = c.req.query("cwd") ?? "";
  if (!cwd) return c.json({ error: "cwd" }, 400);
  return c.json(await changedFiles(cwd));
});
app.get("/api/git/diff", async (c) => {
  const cwd = c.req.query("cwd") ?? "";
  const p = c.req.query("path") ?? "";
  if (!cwd || !p) return c.json({ error: "cwd, path" }, 400);
  return c.json(await fileDiff(cwd, p));
});
app.post("/api/git/discard", async (c) => {
  const { cwd, path: p } = (await c.req.json()) as { cwd?: string; path?: string };
  if (!cwd || !p) return c.json({ error: "cwd, path" }, 400);
  await discardFile(cwd, p);
  return c.json({ ok: true });
});
app.post("/api/git/commit", async (c) => {
  const { cwd, message, paths } = (await c.req.json()) as { cwd?: string; message?: string; paths?: string[] };
  if (!cwd || !message) return c.json({ error: "cwd, message" }, 400);
  return c.json(await commitAll(cwd, message, Array.isArray(paths) ? paths : undefined));
});
app.get("/api/fs/files", async (c) => {
  const cwd = c.req.query("cwd") ?? "";
  if (!cwd) return c.json({ error: "cwd" }, 400);
  return c.json(await listFiles(cwd));
});
app.get("/api/fs/search", async (c) => {
  const cwd = c.req.query("cwd") ?? "";
  if (!cwd) return c.json({ error: "cwd" }, 400);
  return c.json(await searchText(cwd, c.req.query("q") ?? ""));
});
app.get("/api/sessions/search", async (c) => c.json(await searchTranscripts(c.req.query("q") ?? "")));
// בורר התיקיות: רק תיקיות, רק בתוך הבית (access.ts → assertBrowsable). לא ב-CWD_ROUTES כי אין cwd
app.get("/api/fs/browse", async (c) => {
  try {
    return c.json(await browseDir(c.req.query("path") ?? "", { hidden: c.req.query("hidden") === "1" }));
  } catch (e) {
    if (e instanceof AccessError) return c.json({ error: e.message }, e.status);
    return c.json({ error: L("אי אפשר לקרוא את התיקייה", "Can't read this folder") }, 403);
  }
});
app.get("/api/fs/list", async (c) => {
  const cwd = c.req.query("cwd") ?? "";
  if (!cwd) return c.json({ error: "cwd" }, 400);
  return c.json(await listDir(cwd, c.req.query("path") ?? ""));
});
app.get("/api/fs/read", async (c) => {
  const cwd = c.req.query("cwd") ?? "";
  const p = c.req.query("path") ?? "";
  if (!cwd || !p) return c.json({ error: "cwd, path" }, 400);
  return c.json(await readFile(cwd, p));
});
app.put("/api/fs/write", async (c) => {
  const { cwd, path: p, content } = (await c.req.json()) as { cwd?: string; path?: string; content?: string };
  if (!cwd || !p || typeof content !== "string") return c.json({ error: "cwd, path, content" }, 400);
  await writeFile(cwd, p, content);
  return c.json({ ok: true });
});
app.get("/api/stt/available", async (c) => c.json({ available: await sttAvailable() }));
app.post("/api/stt", async (c) => {
  const audio = Buffer.from(await c.req.arrayBuffer());
  if (audio.length < 1000) return c.json({ text: "" });
  // בלי lang בבקשה: שפת הממשק (הגדרות)
  const text = await transcribe(audio, c.req.query("lang"));
  return c.json({ text });
});
app.get("/api/tasks", (c) => c.json({ tasks: tasks.list(), settings: tasks.settings }));
app.put("/api/tasks/settings", async (c) => c.json(await tasks.updateSettings((await c.req.json()) as Partial<import("../../shared/protocol.js").TaskSettings>)));
app.post("/api/tasks", async (c) => {
  const input = pickTaskInput(await c.req.json());
  if (!input.prompt.trim() || !input.cwd.trim()) return c.json({ error: "prompt and cwd required" }, 400);
  const t = await tasks.create(input);
  if ((await c.req.query("run")) === "1" && t.owner !== "me") return c.json(await tasks.run(t.id));
  return c.json(t);
});
app.patch("/api/tasks/:id", async (c) => {
  const b = (await c.req.json()) as Record<string, unknown>;
  const patch: Partial<Task> = {};
  if (typeof b.title === "string") patch.title = b.title.slice(0, 120);
  if (typeof b.prompt === "string") patch.prompt = b.prompt.slice(0, 20000);
  if (typeof b.cwd === "string") patch.cwd = b.cwd;
  if ("provider" in b) patch.provider = pickProvider(b.provider);
  if ("agent" in b) patch.agent = typeof b.agent === "string" && b.agent ? b.agent : null;
  if ("model" in b) patch.model = typeof b.model === "string" && b.model ? b.model : null;
  if (MODES.includes(b.permissionMode as PermissionMode)) patch.permissionMode = b.permissionMode as PermissionMode;
  if (STATUSES.includes(b.status as TaskStatus)) patch.status = b.status as TaskStatus;
  if (b.owner === "me" || b.owner === "agent") patch.owner = b.owner;
  if (typeof b.order === "number") patch.order = b.order;
  if (typeof b.isolate === "boolean") patch.isolate = b.isolate;
  if (typeof b.allowGit === "boolean") patch.allowGit = b.allowGit;
  return c.json(await tasks.update(c.req.param("id"), patch));
});
app.delete("/api/tasks/:id", async (c) => {
  await tasks.remove(c.req.param("id"));
  return c.json({ ok: true });
});
app.post("/api/tasks/:id/run", async (c) => c.json(await tasks.run(c.req.param("id"))));
app.post("/api/tasks/:id/merge", async (c) => c.json(await tasks.merge(c.req.param("id"))));
app.post("/api/tasks/:id/discard-branch", async (c) => c.json(await tasks.discardBranch(c.req.param("id"))));
// משימה שנמחקה בינתיים (או מזהה לא תקין): null ולא 500 עם stack ביומן
app.get("/api/tasks/:id/branch", async (c) => c.json(await tasks.branchStatus(c.req.param("id")).catch(() => null)));
app.get("/api/repos", async (c) => c.json(await allRepos({ github: c.req.query("github") === "1", force: c.req.query("force") === "1" })));
app.get("/api/capabilities", async (c) => c.json(await capabilities()));
/** מי עוד עובד בריפו של התיקייה הזו (לאזהרה בסשן חדש) */
app.get("/api/activity", async (c) => {
  const cwd = c.req.query("cwd") ?? "";
  if (!cwd) return c.json({ error: "cwd" }, 400);
  return c.json(await activeInRepo(cwd));
});
/** המפה: הכול בגרף אחד. מאגרים עם מגבלת זמן (git על הרבה תיקיות), כדי שהמפה לא תחכה להם */
app.get("/api/map", async (c) => {
  const dirs = [...(await knownProjectDirs()).values()];
  const [sessions, agents, caps, repos, mem] = await Promise.all([
    sessionRows(),
    listAgents(),
    capabilities().catch(() => []),
    Promise.race([allRepos().catch(() => []), new Promise<[]>((res) => setTimeout(() => res([]), 4000))]),
    memoryNotes(),
  ]);
  return c.json(buildMap({ sessions, agents, capabilities: caps, repos, tasks: tasks.list(), routines: routines.list(), notes: mem.notes, projectDirs: dirs, projectRoots: projectRoots(), centerLabel: systemPrefs().displayName }));
});
app.get("/api/map/note", async (c) => {
  try {
    return c.json({ text: await readNote(c.req.query("path") ?? "") });
  } catch {
    return c.json({ error: "not found" }, 404);
  }
});
app.get("/api/settings", async (c) => c.json(await publicSettings()));
// ספקים (ACP): הרשימה עם זמינות הפקודה. ערכי env לא חוזרים, רק השמות
app.get("/api/providers", async (c) => {
  const list = await refreshProviders();
  const out = await Promise.all(
    list.map(async (p) => ({
      id: p.id,
      label: p.label,
      command: p.command,
      args: p.args,
      envKeys: Object.keys(p.env),
      login: p.login ?? null,
      enabled: p.enabled,
      builtin: p.builtin,
      available: Boolean(await which(p.requires ?? p.command)),
      sessions: agentSessionsStatus(p.id),
    })),
  );
  return c.json([{ id: "claude", label: "Claude", command: "claude-agent-sdk", args: [], envKeys: [], login: null, enabled: true, builtin: true, available: true }, ...out]);
});
// הקטלוג של ACP Registry, עם סימון של מה שכבר מוגדר (preset עם אותו סוכן, או ספק שנוסף בשם הזה)
app.get("/api/providers/registry", async (c) => {
  const [agents, list] = await Promise.all([acpRegistry(c.req.query("refresh") === "1"), refreshProviders()]);
  // Claude דרך ACP מיותר: הוא כבר מחובר ישירות דרך ה-SDK, עם כל היכולות
  return c.json(agents.filter((a) => a.id !== "claude-acp").map((a) => ({ ...a, added: list.find((p) => p.registryId === a.id || p.id === a.id)?.id ?? null })));
});
// מצב ההתחברות: claude ותמיד, ושאר הספקים הפעילים והמותקנים. קאש של דקה, refresh=1 בודק מחדש
app.get("/api/providers/auth", async (c) => {
  const refresh = c.req.query("refresh") === "1";
  const list = await refreshProviders();
  const ids = ["claude", ...(await Promise.all(list.map(async (p) => (p.enabled && (await which(p.requires ?? p.command)) ? p.id : null)))).filter((x): x is string => Boolean(x))];
  return c.json(await Promise.all(ids.map((id) => authStatus(id, refresh))));
});
app.post("/api/providers/:id/login", async (c) => c.json(await startLogin(c.req.param("id"))));
// Claude: קוד שמדביקים כשהדפדפן לא החזיר אותו לבד
app.post("/api/providers/claude/login-code", async (c) => {
  const { code } = (await c.req.json().catch(() => ({}))) as { code?: string };
  if (!code?.trim() || code.length > 2000) return c.json({ error: "code" }, 400);
  claudeLoginCode(code);
  return c.json({ ok: true });
});
// סנכרון סשנים שהתחילו מחוץ למפקדה (session/list של הסוכן)
app.post("/api/providers/:id/sync", async (c) => {
  const list = await syncAgentSessions(c.req.param("id"));
  return c.json({ count: list.length, status: agentSessionsStatus(c.req.param("id")) });
});
app.put("/api/providers/:id", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Parameters<typeof setProviderSettings>[1];
  await setProviderSettings(c.req.param("id"), body);
  await refreshProviders();
  return c.json({ ok: true });
});
app.get("/api/doctor", async (c) => c.json(await doctor()));
app.post("/api/open-voice-settings", async (c) => {
  // הגדרות המערכת → נגישות → תוכן מדובר, שם מורידים קול משופר (Carmit Enhanced/Premium)
  const { execFile } = await import("node:child_process");
  // רק ב-macOS יש מסך כזה; בשאר המערכות הממשק מסביר איפה להוריד קולות
  if (process.platform !== "darwin") return c.json({ ok: false });
  execFile("open", ["x-apple.systempreferences:com.apple.Accessibility-Settings.extension?SpokenContent"]);
  return c.json({ ok: true });
});
app.put("/api/settings/anthropic-key", async (c) => {
  const { key } = (await c.req.json()) as { key?: string | null };
  if (key && !/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key.trim())) return c.json({ error: L("המפתח לא נראה כמו מפתח API של Anthropic (sk-ant-...)", "This doesn't look like an Anthropic API key (sk-ant-...)") }, 400);
  await setAnthropicKey(key ?? null);
  invalidateAuth("claude");
  return c.json(await publicSettings());
});
app.put("/api/settings/openai-key", async (c) => {
  const { key } = (await c.req.json()) as { key?: string | null };
  if (key && !/^sk-[A-Za-z0-9_-]{20,}$/.test(key.trim())) return c.json({ error: L("המפתח לא נראה כמו מפתח OpenAI (sk-...)", "This doesn't look like an OpenAI key (sk-...)") }, 400);
  await setOpenaiKey(key ?? null);
  return c.json(await publicSettings());
});
app.put("/api/settings/notify", async (c) => c.json(await setNotifyPrefs((await c.req.json()) as Record<string, boolean>)));
app.post("/api/data/open", async (c) => {
  const { publicSettings: ps } = await import("./settings.js");
  const { openIn } = await import("./projects.js");
  await openIn((await ps()).dataDir, "finder");
  return c.json({ ok: true });
});
app.get("/api/plan-usage", async (c) => {
  try {
    return c.json(await planUsage(c.req.query("force") === "1"));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});
app.put("/api/settings/system", async (c) => {
  const next = await setSystemPrefs((await c.req.json()) as Record<string, never>);
  hub.broadcast({ t: "app", launchAtLogin: next.launchAtLogin });
  return c.json(next);
});
app.get("/api/safety", async (c) => c.json(await readSafety()));
app.put("/api/safety/rule", async (c) => {
  const { rule, list } = (await c.req.json()) as { rule?: string; list?: RuleList | null };
  if (!rule) return c.json({ error: "rule" }, 400);
  return c.json(await setRule(rule, list && ["allow", "ask", "deny"].includes(list) ? list : null));
});
app.put("/api/safety/mode", async (c) => c.json(await setDefaultMode(String(((await c.req.json()) as { mode?: string }).mode ?? ""))));
app.get("/api/profiles", async (c) => c.json(await readProfiles()));
app.put("/api/profiles", async (c) => {
  const { cwd, profile } = (await c.req.json()) as { cwd?: string; profile?: Record<string, string | null> | null };
  if (!cwd) return c.json({ error: "cwd" }, 400);
  return c.json(await setProfile(cwd, profile ?? null));
});
app.get("/api/export", async (c) => c.json(await exportData()));
app.post("/api/import", async (c) => c.json({ written: await importData((await c.req.json()) as Record<string, unknown>) }));
app.post("/api/tts", async (c) => {
  const { text, voice, speed } = (await c.req.json()) as { text?: string; voice?: string; speed?: number };
  if (!text?.trim()) return c.json({ error: "text" }, 400);
  const audio = await openaiSpeech(text, voice ?? "coral", Number(speed) || 1);
  return new Response(audio, { headers: { "content-type": "audio/mpeg" } });
});
app.get("/api/templates", async (c) => c.json(await listTemplates()));
app.post("/api/templates", async (c) => {
  const b = (await c.req.json()) as Record<string, unknown>;
  if (typeof b.name !== "string" || !b.name.trim() || typeof b.prompt !== "string" || !b.prompt.trim()) return c.json({ error: "name, prompt" }, 400);
  return c.json(
    await saveTemplate({
      id: typeof b.id === "string" ? b.id : undefined,
      name: b.name,
      prompt: b.prompt,
      title: typeof b.title === "string" ? b.title : undefined,
      agent: typeof b.agent === "string" && b.agent ? b.agent : null,
      permissionMode: MODES.includes(b.permissionMode as PermissionMode) ? (b.permissionMode as string) : "default",
      isolate: b.isolate === true,
    }),
  );
});
app.delete("/api/templates/:id", async (c) => c.json(await deleteTemplate(c.req.param("id"))));
app.get("/api/routines", (c) => c.json(routines.list()));
app.post("/api/routines", async (c) => {
  const b = (await c.req.json()) as Record<string, unknown>;
  const sch = b.schedule as { kind?: string; time?: string; days?: number[]; minutes?: number } | undefined;
  const schedule =
    sch?.kind === "interval"
      ? { kind: "interval" as const, minutes: Math.max(5, Number(sch.minutes) || 60) }
      : { kind: "daily" as const, time: /^\d{1,2}:\d{2}$/.test(String(sch?.time)) ? String(sch?.time) : "09:00", days: Array.isArray(sch?.days) ? sch!.days.filter((d) => d >= 0 && d <= 6) : [0, 1, 2, 3, 4] };
  if (typeof b.prompt !== "string" || !b.prompt.trim() || typeof b.cwd !== "string" || !b.cwd) return c.json({ error: "prompt, cwd" }, 400);
  return c.json(
    await routines.upsert({
      id: typeof b.id === "string" ? b.id : undefined,
      title: typeof b.title === "string" && b.title.trim() ? b.title : b.prompt.slice(0, 50),
      prompt: b.prompt,
      cwd: b.cwd,
      provider: pickProvider(b.provider),
      agent: typeof b.agent === "string" && b.agent ? b.agent : null,
      model: typeof b.model === "string" && b.model ? b.model : null,
      permissionMode: MODES.includes(b.permissionMode as PermissionMode) ? (b.permissionMode as PermissionMode) : "default",
      enabled: b.enabled !== false,
      schedule,
    }),
  );
});
app.delete("/api/routines/:id", async (c) => {
  await routines.remove(c.req.param("id"));
  return c.json({ ok: true });
});
app.post("/api/routines/:id/run", async (c) => {
  await routines.runNow(c.req.param("id"));
  return c.json({ ok: true });
});
app.get("/api/backups", async (c) => c.json(await listBackups()));
app.post("/api/backups", async (c) => c.json({ dir: await backupNow() }));

// הרחבות (Extensions): שרתי MCP, פלאגינים ו-marketplaces דרך ה-CLI של Claude Code. cwd (לא חובה) = פרויקט, בשביל
// שרתים ברמת פרויקט (.mcp.json) ובהקשר שלו; עובר את אותה בדיקת תיקיות של שאר הנתיבים (CWD_ROUTES)
app.get("/api/ext/mcp", async (c) => c.json(await listMcp(c.req.query("cwd") || undefined, c.req.query("refresh") === "1")));
app.post("/api/ext/mcp", async (c) => {
  const body = (await c.req.json()) as McpInput & { cwd?: string };
  await addMcp(body, body.cwd || undefined);
  return c.json({ ok: true });
});
app.delete("/api/ext/mcp/:name", async (c) => {
  await removeMcp(c.req.param("name"), (c.req.query("scope") as McpScope) || null, c.req.query("cwd") || undefined);
  return c.json({ ok: true });
});
app.get("/api/ext/plugins", async (c) => c.json(await listPlugins(c.req.query("refresh") === "1")));
app.post("/api/ext/plugins/:action", async (c) => {
  const action = c.req.param("action");
  if (!["install", "uninstall", "enable", "disable", "update"].includes(action)) return c.json({ error: "action" }, 400);
  const { id } = (await c.req.json()) as { id: string };
  await pluginAction(action as "install", id);
  return c.json({ ok: true });
});
app.get("/api/ext/marketplaces", async (c) => c.json(await listMarketplaces()));
app.post("/api/ext/marketplaces/:action", async (c) => {
  const action = c.req.param("action");
  if (!["add", "remove", "update"].includes(action)) return c.json({ error: "action" }, 400);
  const { arg } = (await c.req.json()) as { arg: string };
  await marketplaceAction(action as "add", arg);
  return c.json({ ok: true });
});

app.onError((e, c) => {
  console.error(e);
  return c.json({ error: e.message }, 500);
});

// בפרודקשן השרת מגיש גם את ה-UI הבנוי. בעדכון חם הנתיבים נרשמים תמיד ו-index.html נבדק בכל בקשה:
// vite מרוקן את web/dist באמצע הבילד, ו-daemon שעלה ברגע הזה נשאר בלי ממשק ("404 Not Found") עד ההפעלה הבאה
if (process.env.MIFKADA_HOT === "1" || fs.existsSync(WEB_DIST)) {
  const root = path.relative(process.cwd(), WEB_DIST) || ".";
  const index = serveStatic({ root, path: "index.html" });
  app.use("/*", serveStatic({ root }));
  const spa: MiddlewareHandler = async (c, next) =>
    fs.existsSync(path.join(WEB_DIST, "index.html"))
      ? index(c, next)
      : c.html(
          L(
            `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="2"><body dir="rtl" style="font-family:system-ui;padding:2rem">הממשק נבנה מחדש, נטען שוב בעוד רגע...</body>`,
            `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="2"><body dir="ltr" style="font-family:system-ui;padding:2rem">The interface is being rebuilt. Reloading in a moment...</body>`,
          ),
          503,
        );
  app.get("*", spa);
}

/*
 * באפליקציה (MIFKADA_SOCKET): אין פורט ברשת בכלל. השרת מאזין על קובץ שקע בתיקיית הנתונים, עם הרשאות 600,
 * כך שרק המשתמש שלך יכול להתחבר, ושום דף בדפדפן לא יכול אפילו לראות שהוא קיים. החלון של מפקדה מגיע אליו
 * דרך התהליך הראשי של Electron. בפיתוח, בבדיקות ובדפדפן: פורט על 127.0.0.1 כמו קודם.
 */
const SOCKET = process.env.MIFKADA_SOCKET;
let server: ReturnType<typeof serve>;
if (SOCKET) {
  // שקע שמישהו עונה בו שייך ל-daemon חי. מחיקה שלו מנתקת אותו מהחלון לתמיד (קרה 24/10: שרת בדיקה מתוך סשן
  // ירש את MIFKADA_SOCKET ודרס את השקע של האפליקציה). מוחקים רק שקע מת
  const alive = await new Promise<boolean>((res) => {
    const sock = net.connect(SOCKET);
    sock.once("connect", () => {
      sock.destroy();
      res(true);
    });
    sock.once("error", () => res(false));
  });
  if (alive) {
    console.error(`daemon אחר כבר מאזין על ${SOCKET}. יוצא בלי לגעת בו (להרצה נפרדת: env -u MIFKADA_SOCKET)`);
    process.exit(1);
  }
  // Windows: named pipe, בלי קובץ למחוק ובלי הרשאות קובץ (הצינור שייך למשתמש שיצר אותו)
  if (!isPipe(SOCKET)) {
    try {
      fs.unlinkSync(SOCKET);
    } catch {
      /* לא היה */
    }
  }
  server = createAdaptorServer({ fetch: app.fetch });
  (server as Server).listen(SOCKET, () => {
    if (!isPipe(SOCKET)) fs.chmodSync(SOCKET, 0o600);
    console.log(`מפקדה מאזינה על שקע מקומי ${SOCKET} (בלי פורט ברשת)`);
  });
} else {
  server = serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
    console.log(`מפקדה מאזינה על http://${HOST}:${info.port}  (UI בפיתוח: http://127.0.0.1:4778)`);
  });
}
const hubWss = new WebSocketServer({ noServer: true });
const termWss = createTerminalServer(assertAllowedCwd);
hub = new Hub(hubWss);
(server as Server).on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url ?? "/", "http://127.0.0.1");
  const target = pathname === "/ws" ? hubWss : pathname === "/ws/term" ? termWss : null;
  if (!target || !isAllowedRequest(req.headers) || !hasBrowserToken({ origin: req.headers.origin, cookie: req.headers.cookie, "sec-fetch-site": req.headers["sec-fetch-site"] })) {
    if (target) console.error(`[origin] WebSocket נחסם מ-${req.headers.origin ?? "?"} (host ${req.headers.host})`);
    socket.destroy();
    return;
  }
  target.handleUpgrade(req, socket, head, (ws) => target.emit("connection", ws, req));
});
// כל סשן חי זמין גם באפליקציה של Claude (Remote Control בתוך הסשן, כמו ב-VS Code)
hub.onOpen = (live) => {
  if (systemPrefs().rcLive) setTimeout(() => void live.setRemote(true).catch((e: Error) => console.error("rc live:", e.message)), 300);
};
tasks = new TaskStore(hub);
tasks.on("change", (list: Task[]) => hub.broadcast({ t: "tasks", tasks: list, settings: tasks.settings }));
// לפני המשימות: משימה של ספק אחר שמופעלת אוטומטית צריכה את רשימת הספקים
await refreshProviders().catch((e: unknown) => console.error("[providers]", e));
void tasks.load();
routines = new RoutineStore(tasks);
setExtraRoots(async () => [
  ...[...hub.lives.values()].map((l) => l.cwd),
  // סשנים של Codex ושאר ספקי ACP (נפתחו במפקדה או סונכרנו מהסוכן): לא מופיעים ב-listSessions של Claude
  ...(await listProviderSessions().catch(() => [])).map((s) => s.cwd),
  ...knownAgentSessions().map((s) => s.cwd),
  ...tasks.list().flatMap((t) => [t.cwd, ...(t.worktree ? [t.worktree.path] : [])]),
  ...routines.list().map((r) => r.cwd),
]);
routines.on("change", (list) => hub.broadcast({ t: "routines", routines: list }));
void routines.load();
scheduleBackups();
// ארכיון אוטומטי: פעם בשעה, סשנים שלא נגעו בהם X ימים (לא חיים, לא נעוצים, לא כאלה שהוצאו ידנית מהארכיון)
async function autoArchive(): Promise<number> {
  const days = systemPrefs().autoArchiveDays;
  if (!days) return 0;
  const cutoff = Date.now() - days * 86_400_000;
  const meta = (await readThemes()).sessions;
  let n = 0;
  for (const r of await listSessions({ limit: 1000 })) {
    const m = meta[r.sessionId] ?? {};
    if (r.lastModified > cutoff || m.archived || m.pinned || m.kept || hub.liveBySession(r.sessionId)) continue;
    await writeSessionMeta(r.sessionId, { archived: true });
    n++;
  }
  if (n) console.log(`ארכיון אוטומטי: ${n} סשנים שלא נגעו בהם ${days} ימים`);
  return n;
}
setTimeout(() => void autoArchive().catch(() => undefined), 20_000);
// ניקוי סשנים ישנים מהרשימה באפליקציה של Claude (ראו rcRetire.ts): דקה אחרי העלייה, ואז כל חצי שעה
async function retireRemote(): Promise<void> {
  const skip = new Set<string>();
  for (const l of hub.lives.values()) if (l.sessionId) skip.add(l.sessionId);
  for (const id of (await readExternalLives().catch(() => new Map<string, unknown>())).keys()) skip.add(id);
  await retireStaleRemote(skip);
}
setTimeout(() => void retireRemote().catch(() => undefined), 60_000);
setInterval(() => void retireRemote().catch(() => undefined), 10 * 60_000);
setInterval(() => void autoArchive().catch(() => undefined), 3_600_000);
// סשנים של ספקים אחרים שהתחילו מחוץ למפקדה: חצי דקה אחרי עלייה ואז כל 5 דקות, רק לספקים שבשימוש
setTimeout(() => void syncAllAgentSessions().catch(() => undefined), 30_000);
setInterval(() => void syncAllAgentSessions().catch(() => undefined), 5 * 60_000);
setInterval(() => {
  const closed = hub.reapIdle(systemPrefs().liveIdleMinutes);
  if (closed.length) console.log("נסגרו סשנים פעילים שלא היו בשימוש:", closed.join(", "));
}, 5 * 60_000);
// סשנים חדשים מקבלים פרויקט לבד: פעם בשעה, רק מה שעוד לא נבדק (קריאה אחת ל-Sonnet, ורק כשיש חדשים)
async function autoProjectNew(): Promise<void> {
  if (!systemPrefs().aiHelpers) return;
  const r = await autoproject({ onlyNew: true });
  if (r.assigned) console.log(`שיוך אוטומטי: ${r.assigned} סשנים חדשים שויכו לפרויקט`);
}
setTimeout(() => void autoProjectNew().catch(() => undefined), 90_000);
setInterval(() => void autoProjectNew().catch(() => undefined), 3_600_000);
// תקציב חודשי: בדיקה כל שעה, התראה אחת ביום כשעוברים אותו
let budgetWarnedOn = "";
setInterval(async () => {
  const b = systemPrefs().monthlyBudget;
  if (!b) return;
  const today = new Date().toISOString().slice(0, 10);
  if (budgetWarnedOn === today) return;
  const month = new Date().toISOString().slice(0, 7);
  const u = await usageReport(31).catch(() => null);
  const spent = u ? u.days.filter((d) => d.date.startsWith(month)).reduce((x, d) => x + d.cost, 0) : 0;
  if (spent > b) {
    budgetWarnedOn = today;
    hub.broadcast({ t: "notify", kind: "error", title: L("עברת את התקציב החודשי", "You're over your monthly budget"), body: L(`שווי מוערך החודש: $${spent.toFixed(0)} מתוך $${b}`, `Estimated value this month: $${spent.toFixed(0)} of $${b}`), liveId: "", sessionId: null });
  }
}, 3600000);
// חימום של אגרגציית השימוש (קריאה של תמלילי החודש האחרון) כדי שהלוח לא יחכה
setTimeout(() => void usageReport(30).catch(() => undefined), 4000);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  // כיבוי (גם בבנייה בעדכון חם): מחכים שהגשר של כל סשן ייסגר, כדי שלא יישארו סשנים תלויים ברשימה באפליקציה של Claude
  process.on(sig, () => {
    void Promise.race([Promise.all([...hub.lives.values()].map((l) => l.close())), new Promise((r) => setTimeout(r, 3000))]).finally(() => process.exit(0));
  });
}

// כשהמעטפת (Tauri) מריצה אותנו: stdin הוא צינור ממנה. נסגר = המעטפת מתה (גם בקריסה או kill -9), ואז יוצאים
// בצורה מסודרת במקום להישאר יתומים ולתפוס את השקע (מעטפת חדשה הייתה נכשלת: "מישהו כבר עונה בשקע")
if (PARENT_STDIN) {
  process.stdin.on("end", () => process.kill(process.pid, "SIGTERM"));
  process.stdin.on("error", () => process.kill(process.pid, "SIGTERM"));
  process.stdin.resume();
}
