import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import { client, methods, ndJsonStream, PROTOCOL_VERSION, type ClientConnection } from "@agentclientprotocol/sdk";
import type * as acp from "@agentclientprotocol/sdk";
import { L } from "../i18n.js";
import { listAgents } from "../agents.js";
import { appendTranscript, getProviderSession, readProviderTranscript, upsertProviderSession } from "../providerSessions.js";
import { registerLiveSession, unregisterLiveSession } from "../activity.js";
import { gitConflictWarning } from "../gitGuard.js";
import type { Attachment, Block, LiveEvent, LiveInfo, LiveState, PermissionMode, PermissionRequest, ProviderCaps, TranscriptMessage } from "../../../shared/protocol.js";
import type { AgentRuntime, OpenParams } from "./types.js";
import type { ProviderConfig } from "./presets.js";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const BUFFER_LIMIT = 3000;
/** מצבים של סוכן שמריצים הכול בלי לשאול. מפקדה לא בוחרת בהם אף פעם, כמו bypassPermissions אצל Claude */
const DANGEROUS_MODE = /yolo|bypass|full.?access|danger|never/i;
/** המצבים של מפקדה שספק ACP יכול לקבל. bypass/dontAsk לא: אין להם מקבילה בטוחה */
const ACP_MODES: PermissionMode[] = ["default", "acceptEdits", "plan", "auto"];

/**
 * המצב של הסוכן שמתאים למצב של מפקדה, לפי המצבים שהוא מפרסם. נבדק מול המצבים האמיתיים:
 * Codex (codex-acp 2.5): read-only "Requires approval to edit files", workspace-write "Workspace access",
 * agent "Auto review" (ברירת המחדל שלו, כמעט לא שואל), agent-full-access "Full access" (לא נבחר אף פעם).
 * Gemini: default / autoEdit / plan / yolo. opencode: build / plan.
 * emulatePlan: לסוכן אין מצב תכנון, ולכן "תכנון" = המצב הכי סגור שלו ומפקדה דוחה לבד כל בקשת עריכה.
 */
export function pickMode(available: acp.SessionMode[], mode: PermissionMode): { id: string | null; emulatePlan: boolean } {
  const list = available.filter((m) => !DANGEROUS_MODE.test(`${m.id} ${m.name}`));
  const find = (...res: RegExp[]) => {
    for (const re of res) {
      const hit = list.find((m) => re.test(`${m.id} ${m.name}`));
      if (hit) return hit.id;
    }
    return null;
  };
  switch (mode) {
    case "plan": {
      const plan = find(/plan/i);
      return plan ? { id: plan, emulatePlan: false } : { id: find(/read.?only/i), emulatePlan: Boolean(find(/read.?only/i)) };
    }
    case "acceptEdits":
      return { id: find(/accept|auto.?edit/i, /workspace/i), emulatePlan: false };
    case "auto":
      return { id: find(/auto.?review|^agent\b/i, /\bauto\b(?!.?edit)/i), emulatePlan: false };
    default:
      // "שואל": המצב שבאמת שואל. אצל Codex זה read-only (כל עריכה דורשת אישור), לא ה-agent של ברירת המחדל
      return { id: find(/^default$/i, /\bask\b/i, /read.?only/i, /^default\b/i), emulatePlan: false };
  }
}
const NEW_TITLES = new Set(["סשן חדש", "New session"]);

type Pending = { request: PermissionRequest; options: acp.PermissionOption[]; resolve: (r: acp.RequestPermissionResponse) => void };
type ToolInfo = { name: string; input: Record<string, unknown> };

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

/**
 * הפקודה עצמה, בלי עטיפת ה-shell: Codex שולח `/bin/zsh -lc "git commit ..."` (codex-acp מסיר רק גרשיים בודדים),
 * ובלי הסרה שומר ה-git לא מזהה את git שאחרי המרכאות, והכרטיס מציג מרכאות מיותרות. גם מערך [shell, -lc, cmd].
 */
export function unwrapShell(cmd: unknown): string | undefined {
  let c = Array.isArray(cmd)
    ? cmd.length === 3 && /^(?:\/bin\/)?(?:ba|z)?sh$/.test(String(cmd[0])) && /^-[lc]+$/.test(String(cmd[1]))
      ? String(cmd[2])
      : cmd.map(String).join(" ")
    : str(cmd);
  if (!c) return undefined;
  c = c.trim().replace(/^(?:\/bin\/)?(?:ba|z)?sh\s+-[lc]+\s+/, "");
  if (c.length >= 2 && c.startsWith('"') && c.endsWith('"')) c = c.slice(1, -1).replace(/\\(["\\$`])/g, "$1");
  else if (c.length >= 2 && c.startsWith("'") && c.endsWith("'") && !c.slice(1, -1).includes("'")) c = c.slice(1, -1);
  return c;
}

/**
 * כלי של ACP בשמות של Claude Code (Bash, Edit, Read...) כדי שהרינדור, כרטיס האישור וה-diff בצ'אט יעבדו כמו שהם.
 * כלי בלי kind מוכר נשאר עם הכותרת שלו.
 */
export function toolInfo(tc: Pick<acp.ToolCallUpdate, "title" | "kind" | "rawInput" | "content" | "locations">): ToolInfo {
  const raw = (tc.rawInput && typeof tc.rawInput === "object" && !Array.isArray(tc.rawInput) ? tc.rawInput : {}) as Record<string, unknown>;
  const title = tc.title ?? "";
  const loc = tc.locations?.[0]?.path ?? str(raw.path) ?? str(raw.file_path);
  switch (tc.kind) {
    case "execute": {
      // codex-acp שם את הפקודה ב-rawInput.command, ובבקשת אישור לפעמים ב-input.command (שדה של ההרחבה שלו)
      const input = raw.input && typeof raw.input === "object" ? (raw.input as Record<string, unknown>) : {};
      const command = unwrapShell(raw.command ?? raw.cmd ?? input.command) ?? title;
      return { name: "Bash", input: { command, description: title !== command ? title : undefined } };
    }
    case "edit":
    case "delete":
    case "move": {
      const diff = tc.content?.find((c): c is acp.Diff & { type: "diff" } => c.type === "diff");
      if (diff) {
        return diff.oldText == null
          ? { name: "Write", input: { file_path: diff.path, content: diff.newText } }
          : { name: "Edit", input: { file_path: diff.path, old_string: diff.oldText, new_string: diff.newText } };
      }
      return { name: "Edit", input: { file_path: loc ?? title, description: title } };
    }
    case "read":
      return { name: "Read", input: { file_path: loc ?? title } };
    case "search":
      return { name: "Grep", input: { pattern: str(raw.pattern) ?? str(raw.query) ?? title } };
    case "fetch":
      return { name: "WebFetch", input: { url: str(raw.url) ?? title } };
    default:
      return { name: title || tc.kind || "tool", input: { ...raw, description: title || undefined } };
  }
}

/** הטקסט של תוצאת כלי: תוכן טקסט, ואם אין אז rawOutput */
export function toolOutput(tc: Pick<acp.ToolCallUpdate, "content" | "rawOutput">): string {
  const parts: string[] = [];
  for (const c of tc.content ?? []) {
    if (c.type === "content" && c.content.type === "text") parts.push(c.content.text);
    else if (c.type === "diff") parts.push(c.path);
  }
  if (!parts.length && tc.rawOutput != null) {
    const o = tc.rawOutput as Record<string, unknown>;
    parts.push(typeof tc.rawOutput === "string" ? tc.rawOutput : (str(o.formatted_output) ?? str(o.output) ?? str(o.stdout) ?? JSON.stringify(tc.rawOutput)));
  }
  return parts.join("\n").slice(0, 20000);
}

/** התוכנית של הסוכן (ACP plan) כרשימה בהודעה: ✓ הושלם, ← בעבודה, ○ ממתין */
export function planText(entries: acp.PlanEntry[]): string {
  const mark = { completed: "✓", in_progress: "←", pending: "○" } as const;
  return `**${L("תוכנית", "Plan")}**\n\n${entries.map((e) => `- ${mark[e.status] ?? "○"} ${e.content}`).join("\n")}`;
}

/** הסביבה של תהליך הסוכן: הוא רץ על ההתחברות של ה-CLI שלו (המנוי), לא על מפתחות שבסביבה של מפקדה */
export function agentEnv(cfg: ProviderConfig): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...cfg.env };
  for (const k of ["ANTHROPIC_API_KEY", "ELECTRON_RUN_AS_NODE", "MIFKADA_SOCKET", ...cfg.dropEnv]) if (!(k in cfg.env)) delete env[k];
  return env;
}

function isAuthError(e: unknown): boolean {
  const x = e as { code?: number; message?: string };
  return x?.code === -32000 || /auth/i.test(String(x?.message ?? ""));
}

/**
 * שיטת התחברות שהסוכן מבצע בעצמו (דפדפן), לא מפתח API ולא טרמינל: Codex מפרסם "chat-gpt", שפותח את דף ההתחברות
 * של ChatGPT ומחכה עד שמסיימים. ההתחברות נשמרת אצל הסוכן (~/.codex) ומשותפת עם ה-CLI שלו
 */
export function loginMethod(methods: acp.AuthMethod[] | undefined): acp.AuthMethod | null {
  const ok = (methods ?? []).filter((m) => !("type" in m && m.type === "terminal") && !/api.?key|gateway|device/i.test(m.id));
  return ok.find((m) => /chat|browser|oauth|login|google|github/i.test(`${m.id} ${m.name}`)) ?? ok[0] ?? null;
}

function flatOptions(o: acp.SessionConfigSelectOptions): acp.SessionConfigSelectOption[] {
  return (o as Array<acp.SessionConfigSelectOption | acp.SessionConfigSelectGroup>).flatMap((x) => ("options" in x ? x.options : [x]));
}

/**
 * סשן חי מול סוכן שמדבר ACP (Codex דרך codex-acp, Copilot, opencode, Cursor...).
 * התהליך נפתח בהודעה הראשונה (או מיד, כשממשיכים סשן) ומחזיק סשן ACP אחד עד close().
 */
export class AcpRuntime extends EventEmitter implements AgentRuntime {
  readonly liveId = randomUUID();
  readonly provider: string;
  readonly cwd: string;
  readonly agent: string | null;
  readonly startedAt = Date.now();
  readonly events: LiveEvent[] = [];
  lastActivity = Date.now();
  sessionId: string | null = null;
  model: string | null;
  permissionMode: PermissionMode;
  state: LiveState = "ready";
  title: string;
  costUsd = 0;
  partialText = "";
  remoteUrl: string | null = null;

  private readonly cfg: ProviderConfig;
  private readonly resumeId?: string;
  private child: ChildProcess | null = null;
  private conn: ClientConnection | null = null;
  private ready: Promise<void> | null = null;
  private turn: Promise<void> = Promise.resolve();
  private readonly pending = new Map<string, Pending>();
  private init: acp.InitializeResponse | null = null;
  private modes: acp.SessionModeState | null = null;
  private modelOption: { id: string; options: acp.SessionConfigSelectOption[] } | null = null;
  private stderrTail: string[] = [];
  /** טקסט/מחשבה שהצטברו בתור הנוכחי, נשלחים כהודעה כשמגיע כלי או כשהתור נגמר */
  private text = "";
  private thought = "";
  private lastText = "";
  private readonly tools = new Map<string, ToolInfo>();
  private agentPrompt: string | null = null;
  /** התוכנית האחרונה שהסוכן שלח, ומה שכבר הוצג ממנה: מוצגת פעם בתחילת התור ושוב בסופו אם השתנתה */
  private plan: string | null = null;
  private planShown: string | null = null;
  private planThisTurn = false;
  private replaying = false;

  constructor(cfg: ProviderConfig, p: OpenParams) {
    super();
    this.cfg = cfg;
    this.provider = cfg.id;
    this.cwd = p.cwd;
    this.agent = p.agent ?? null;
    this.model = p.model ?? null;
    this.permissionMode = p.permissionMode && ACP_MODES.includes(p.permissionMode) ? p.permissionMode : "default";
    this.resumeId = p.resume;
    this.title = p.title ?? L("סשן חדש", "New session");
    if (p.resume) {
      this.sessionId = p.resume;
      void getProviderSession(p.resume).then((s) => {
        if (s?.title && !p.title) {
          this.title = s.title;
          this.emit("info");
        }
      });
      // ממשיכים סשן: מתחברים מיד כדי שבקשות אישור ושגיאות התחברות יופיעו עוד לפני ההודעה הבאה
      this.ready = this.connect();
    }
  }

  get caps(): ProviderCaps {
    const ac = this.init?.agentCapabilities;
    const available = this.modes?.availableModes ?? [];
    const modes: PermissionMode[] = ["default", ...(["acceptEdits", "plan", "auto"] as const).filter((m) => pickMode(available, m).id)];
    return {
      resume: Boolean(ac?.loadSession || ac?.sessionCapabilities?.resume),
      fork: false,
      rewind: false,
      remote: false,
      slashCommands: false,
      agents: false,
      cost: false,
      modes,
      models: this.modelOption ? this.modelOption.options.map((o) => ({ id: o.value, label: o.name })) : [],
    };
  }

  info(): LiveInfo {
    return {
      liveId: this.liveId,
      sessionId: this.sessionId,
      cwd: this.cwd,
      provider: this.provider,
      caps: this.caps,
      agent: this.agent,
      state: this.state,
      title: this.title,
      model: this.model,
      permissionMode: this.permissionMode,
      pendingPermissions: this.pending.size,
      pending: [...this.pending.values()].map((p) => p.request),
      startedAt: this.startedAt,
      costUsd: this.costUsd,
      context: this.context,
      remoteUrl: null,
    };
  }

  send(text: string, attachments: Attachment[] = []): void {
    const trimmed = text.trim() || (attachments.length ? L("מצורף קובץ", "File attached") : "");
    if (!trimmed) return;
    if (this.state === "closed" || this.state === "error") throw new Error(L("הסשן סגור", "The session is closed"));
    if (!this.ready) this.ready = this.connect();
    if (NEW_TITLES.has(this.title)) {
      this.title = trimmed.slice(0, 60);
      this.emit("info");
    }
    const message: TranscriptMessage = {
      uuid: randomUUID(),
      role: "user",
      blocks: [{ type: "text", text: trimmed }, ...attachments.map((a) => ({ type: "file" as const, name: a.name, path: a.path, mime: a.mime }))],
      timestamp: new Date().toISOString(),
    };
    this.emitMessage(message);
    this.setState("running");
    // תור: ב-ACP אין שתי הודעות במקביל באותו סשן, לכן הודעה שנשלחה באמצע עבודה מחכה לסוף התור הקודם
    this.turn = this.turn.then(() => this.prompt(trimmed, attachments)).catch(() => undefined);
  }

  resolvePermission(requestId: string, behavior: "allow" | "deny", always: boolean): void {
    const p = this.pending.get(requestId);
    if (!p) return;
    this.pending.delete(requestId);
    const kinds: acp.PermissionOptionKind[] = behavior === "allow" ? (always ? ["allow_always", "allow_once"] : ["allow_once", "allow_always"]) : ["reject_once", "reject_always"];
    const opt = kinds.map((k) => p.options.find((o) => o.kind === k)).find(Boolean);
    this.emitEvent({ kind: "permission_resolved", requestId, behavior });
    if (this.pending.size === 0 && this.state === "waiting") this.setState("running");
    this.emit("info");
    p.resolve(opt ? { outcome: { outcome: "selected", optionId: opt.optionId } } : { outcome: { outcome: "cancelled" } });
  }

  async interrupt(): Promise<void> {
    if (!this.conn || !this.sessionId) return;
    // לפי הפרוטוקול, בקשות אישור פתוחות נענות ב-cancelled לפני session/cancel
    this.cancelAllPending();
    await this.conn.agent.notify(methods.agent.session.cancel, { sessionId: this.sessionId });
  }

  async setModel(model: string | null): Promise<void> {
    this.model = model;
    if (model && this.conn && this.sessionId && this.modelOption) {
      const r = await this.conn.agent.request(methods.agent.session.setConfigOption, { sessionId: this.sessionId, configId: this.modelOption.id, value: model });
      this.applyConfig(r.configOptions);
    }
    this.emit("info");
  }

  async setPermissionMode(requested: PermissionMode): Promise<void> {
    const mode: PermissionMode = ACP_MODES.includes(requested) ? requested : "default";
    this.permissionMode = mode;
    await this.applyMode();
    this.emit("info");
  }

  async rewind(): Promise<string> {
    throw new Error(L(`${this.cfg.label} לא תומך בחזרה לנקודה קודמת`, `${this.cfg.label} doesn't support rewinding`));
  }

  async setRemote(): Promise<string | null> {
    throw new Error(L("Remote Control זמין רק בסשנים של Claude", "Remote Control is only available in Claude sessions"));
  }

  async close(): Promise<void> {
    this.cancelAllPending();
    this.setState("closed");
    const conn = this.conn;
    const sid = this.sessionId;
    if (conn && sid && this.init?.agentCapabilities?.sessionCapabilities?.close) {
      await Promise.race([conn.agent.request(methods.agent.session.close, { sessionId: sid }).catch(() => undefined), new Promise((r) => setTimeout(r, 2000))]);
    }
    conn?.close();
    if (this.child?.pid) this.unregister(this.child.pid);
    this.child?.kill();
  }

  /** רישום ב-<נתונים>/sessions כדי שהבדיקה "מי עוד עובד בריפו" ושומר ה-git של Claude יראו את הסשן הזה */
  private register(): void {
    const pid = this.child?.pid;
    if (!pid || !this.sessionId || this.ended()) return;
    const entry = { pid, sessionId: this.sessionId, cwd: this.cwd, provider: this.provider, name: this.title, status: this.state };
    // בתור אחד עם המחיקה: כתיבה שמסתיימת אחרי המחיקה השאירה קובץ של תהליך מת
    this.registry = this.registry.then(() => (this.ended() ? undefined : registerLiveSession(entry))).catch(() => undefined);
  }

  private unregister(pid: number): void {
    this.registry = this.registry.then(() => unregisterLiveSession(pid)).catch(() => undefined);
  }

  private registry: Promise<void> = Promise.resolve();

  /* ---------- חיבור ---------- */

  /** start() עם טיפול בכישלון: השגיאה כבר שודרה כאירוע, ודחייה שאף אחד לא מחכה לה הייתה מפילה את ה-daemon */
  private connect(): Promise<void> {
    const p = this.start();
    p.catch(() => undefined);
    return p;
  }

  private async start(): Promise<void> {
    this.setState("starting");
    try {
      const child = spawn(this.cfg.command, this.cfg.args, { cwd: this.cwd, env: agentEnv(this.cfg), stdio: ["pipe", "pipe", "pipe"] });
      this.child = child;
      const spawned = new Promise<void>((res, rej) => {
        child.once("spawn", res);
        child.once("error", (e: NodeJS.ErrnoException) =>
          rej(new Error(e.code === "ENOENT" ? L(`הפקודה ${this.cfg.command} לא נמצאה. צריך להתקין את ${this.cfg.label} או לתקן את הפקודה בהגדרות ← ספקים`, `Command ${this.cfg.command} not found. Install ${this.cfg.label} or fix the command in Settings → Providers`) : e.message)),
        );
      });
      child.stderr!.setEncoding("utf8").on("data", (d: string) => {
        for (const line of d.split("\n")) {
          if (!line.trim()) continue;
          this.stderrTail.push(line.slice(0, 400));
          if (this.stderrTail.length > 20) this.stderrTail.shift();
          console.error(`[${this.provider} ${this.liveId.slice(0, 8)}] ${line}`);
        }
      });
      child.on("exit", (code, signal) => {
        if (child.pid) this.unregister(child.pid);
        // closed: סגירה מכוונת. error: השגיאה כבר שודרה, והתהליך נהרג בגללה
        if (this.ended()) return;
        const tail = this.stderrTail.slice(-3).join("\n");
        this.emitEvent({ kind: "error", message: L(`${this.cfg.label} יצא (${code ?? signal})`, `${this.cfg.label} exited (${code ?? signal})`) + (tail ? `\n${tail}` : "") });
        this.cancelAllPending();
        this.setState("error");
      });
      await spawned;

      const app = client({ name: "mifkada" })
        .onNotification(methods.client.session.update, ({ params }) => this.onUpdate(params.update))
        .onRequest(methods.client.session.requestPermission, ({ params, signal }) => this.onPermission(params, signal));
      const stream = ndJsonStream(Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>, Readable.toWeb(child.stdout!) as unknown as ReadableStream<Uint8Array>);
      this.conn = app.connect(stream);
      const agent = this.conn.agent;

      // בלי fs ובלי terminal: הסוכן קורא, כותב ומריץ בעצמו, ומבקש אישור דרך request_permission
      this.init = await agent.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: "mifkada", version: "0.1.0" } });
      const ac = this.init.agentCapabilities;

      const open = async (): Promise<{ modes?: acp.SessionModeState | null; configOptions?: acp.SessionConfigOption[] | null }> => {
        if (!this.resumeId) {
          const r = await agent.request(methods.agent.session.new, { cwd: this.cwd, mcpServers: [] });
          this.sessionId = r.sessionId;
          return r;
        }
        let r: { modes?: acp.SessionModeState | null; configOptions?: acp.SessionConfigOption[] | null };
        // סשן שהתחיל מחוץ למפקדה (Codex מהטרמינל): אין לנו תמליל, אז load וההיסטוריה שהסוכן משדר נשמרת ומוצגת
        const ownHistory = (await readProviderTranscript(this.resumeId)).length > 0;
        if (!ownHistory && ac?.loadSession) {
          this.sessionId = this.resumeId;
          this.capturing = true;
          try {
            r = (await agent.request(methods.agent.session.load, { sessionId: this.resumeId, cwd: this.cwd, mcpServers: [] })) ?? {};
          } finally {
            this.flushUser();
            this.flush();
            this.tools.clear();
            this.capturing = false;
          }
        } else if (ac?.sessionCapabilities?.resume) {
          r = await agent.request(methods.agent.session.resume, { sessionId: this.resumeId, cwd: this.cwd, mcpServers: [] });
        } else if (ac?.loadSession) {
          // load משדר מחדש את כל ההיסטוריה. יש לנו תמליל משלנו, אז ההשמעה החוזרת לא מוצגת
          this.replaying = true;
          try {
            r = (await agent.request(methods.agent.session.load, { sessionId: this.resumeId, cwd: this.cwd, mcpServers: [] })) ?? {};
          } finally {
            this.replaying = false;
          }
        } else {
          throw new Error(L(`${this.cfg.label} לא תומך בהמשך סשן. אפשר לפתוח סשן חדש`, `${this.cfg.label} can't resume sessions. Start a new one`));
        }
        this.sessionId = this.resumeId;
        return r;
      };
      let opened: Awaited<ReturnType<typeof open>>;
      try {
        opened = await open();
      } catch (e) {
        // לא מחובר: אם הסוכן יודע להתחבר לבד (Codex: ChatGPT בדפדפן), מתחברים ומנסים שוב פעם אחת
        const method = isAuthError(e) ? loginMethod(this.init.authMethods) : null;
        if (!method) throw e;
        this.emitEvent({ kind: "info", text: L(`${this.cfg.label} לא מחובר: נפתח דפדפן להתחברות (${method.name}). אחרי ההתחברות הסשן ממשיך לבד.`, `${this.cfg.label} isn't signed in: a browser is opening to sign in (${method.name}). The session continues once you're signed in.`) });
        await agent.request(methods.agent.authenticate, { methodId: method.id });
        this.emitEvent({ kind: "info", text: L(`מחובר ל-${this.cfg.label}`, `Signed in to ${this.cfg.label}`) });
        opened = await open();
      }
      const sid = this.sessionId!;
      this.modes = opened.modes ?? null;
      this.applyConfig(opened.configOptions);
      if (this.model && this.modelOption && this.modelOption.options.some((o) => o.value === this.model)) {
        await agent.request(methods.agent.session.setConfigOption, { sessionId: sid, configId: this.modelOption.id, value: this.model }).then((r) => this.applyConfig(r.configOptions)).catch(() => undefined);
      }
      await this.applyMode();

      if (this.agent && !this.resumeId) {
        const a = (await listAgents().catch(() => [])).find((x) => x.slug === this.agent);
        this.agentPrompt = a?.prompt?.trim() || null;
      }
      void upsertProviderSession({ sessionId: sid, provider: this.provider, cwd: this.cwd, title: this.title, agent: this.agent });
      this.register();
      this.emitEvent({ kind: "init", sessionId: sid, model: this.model ?? "", permissionMode: this.permissionMode, cwd: this.cwd, tools: [], version: `${this.init.agentInfo?.name ?? this.cfg.label} ${this.init.agentInfo?.version ?? ""}`.trim() });
      if (this.state === "starting") this.setState(this.resumeId ? "idle" : "running");
      this.emit("info");
    } catch (e) {
      const raw = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
      // ACP מחזיר auth_required (-32000) כשה-CLI לא מחובר: אומרים איך להתחבר
      const auth = isAuthError(e);
      const message = auth ? L(`${this.cfg.label} לא מחובר.`, `${this.cfg.label} isn't signed in.`) + (this.cfg.login ? L(` להתחבר בטרמינל: ${this.cfg.login}`, ` Sign in from a terminal: ${this.cfg.login}`) : "") + ` (${raw})` : raw;
      this.emitEvent({ kind: "error", message });
      this.setState("error");
      this.child?.kill();
      throw e;
    }
  }

  private async prompt(text: string, attachments: Attachment[]): Promise<void> {
    try {
      await this.ready;
    } catch {
      return;
    }
    if (!this.conn || !this.sessionId || this.state === "closed" || this.state === "error") return;
    this.setState("running");
    const started = Date.now();
    let body = text;
    if (attachments.length) body += `\n\n${L("קבצים מצורפים (שמורים במחשב):", "Attached files (saved on this computer):")}\n${attachments.map((a) => `- ${a.name}: ${a.path}`).join("\n")}`;
    // אייג'נט של מפקדה אצל ספק אחר: ההנחיות שלו עוברות כהקדמה להודעה הראשונה
    if (this.agentPrompt) {
      body = `<instructions>\n${this.agentPrompt}\n</instructions>\n\n${body}`;
      this.agentPrompt = null;
    }
    const prompt: acp.ContentBlock[] = [{ type: "text", text: body }];
    if (this.init?.agentCapabilities?.promptCapabilities?.image) {
      for (const a of attachments) {
        if (!IMAGE_TYPES.has(a.mime) || a.size > 5 * 1024 * 1024) continue;
        try {
          prompt.push({ type: "image", mimeType: a.mime, data: readFileSync(a.path).toString("base64") });
        } catch {
          /* הקובץ נעלם; הנתיב בטקסט */
        }
      }
    }
    this.lastText = "";
    this.planThisTurn = false;
    try {
      const r = await this.conn.agent.request(methods.agent.session.prompt, { sessionId: this.sessionId, prompt });
      this.flush();
      this.showPlan();
      const isError = r.stopReason === "refusal" || r.stopReason === "max_tokens";
      this.emitEvent({
        kind: "result",
        result: { subtype: r.stopReason === "end_turn" ? "success" : r.stopReason, isError, costUsd: this.costUsd, durationMs: Date.now() - started, numTurns: 1, text: this.lastText || r.stopReason },
      });
    } catch (e) {
      this.flush();
      if (this.ended()) return;
      const message = (e as { message?: string })?.message ?? String(e);
      this.emitEvent({ kind: "error", message });
      this.emitEvent({ kind: "result", result: { subtype: "error", isError: true, costUsd: this.costUsd, durationMs: Date.now() - started, numTurns: 1, text: message } });
    }
    if (!this.ended()) this.setState("idle");
    if (this.sessionId) void upsertProviderSession({ sessionId: this.sessionId, provider: this.provider, cwd: this.cwd, title: this.title });
    this.register();
    this.emit("info");
  }

  /* ---------- אירועים מהסוכן ---------- */

  private onUpdate(u: acp.SessionUpdate): void {
    if (this.replaying) return;
    this.lastActivity = Date.now();
    // השמעה חוזרת של היסטוריה: הודעות המשתמש מגיעות מהסוכן (בזמן רגיל מפקדה כבר הציגה אותן ב-send)
    if (this.capturing) {
      if (u.sessionUpdate === "user_message_chunk") {
        if (u.content.type === "text") {
          this.flush();
          this.userText += u.content.text;
        }
        return;
      }
      if (u.sessionUpdate === "agent_message_chunk" || u.sessionUpdate === "agent_thought_chunk" || u.sessionUpdate === "tool_call") this.flushUser();
    }
    switch (u.sessionUpdate) {
      case "agent_message_chunk":
        if (u.content.type === "text") {
          if (this.thought) this.flushThought();
          this.text += u.content.text;
          // בהשמעה חוזרת אין טעם להקליד מחדש את כל ההיסטוריה על המסך: ההודעות השלמות מספיקות
          if (!this.capturing) {
            this.partialText += u.content.text;
            this.emitEvent({ kind: "text_delta", text: u.content.text }, false);
          }
        }
        return;
      case "agent_thought_chunk":
        if (u.content.type === "text") this.thought += u.content.text;
        return;
      case "tool_call": {
        this.flush();
        const info = toolInfo(u);
        this.tools.set(u.toolCallId, info);
        if (!this.capturing) this.emitEvent({ kind: "tool_start", name: info.name }, false);
        this.emitMessage({ uuid: randomUUID(), role: "assistant", blocks: [{ type: "tool_use", id: u.toolCallId, name: info.name, input: info.input }], timestamp: new Date().toISOString() });
        if (u.status === "completed" || u.status === "failed") this.toolDone(u.toolCallId, u);
        return;
      }
      case "tool_call_update":
        if (u.status === "completed" || u.status === "failed") this.toolDone(u.toolCallId, u);
        return;
      case "plan":
        this.plan = u.entries.length ? planText(u.entries) : null;
        // הפעם הראשונה בתור: מיד, כדי שיהיה ברור מה הסוכן מתכנן. השאר מתעדכן בסוף התור
        if (!this.planThisTurn) {
          this.flush();
          this.showPlan();
          this.planThisTurn = true;
        }
        return;
      case "current_mode_update":
        if (this.modes) this.modes = { ...this.modes, currentModeId: u.currentModeId };
        this.emit("info");
        return;
      case "config_option_update":
        this.applyConfig(u.configOptions);
        this.emit("info");
        return;
      case "session_info_update":
        if (u.title) {
          this.title = u.title.slice(0, 80);
          this.emit("info");
        }
        return;
      case "usage_update":
        if (u.cost && u.cost.currency === "USD") this.costUsd = u.cost.amount;
        if (u.size > 0) {
          this.context = { used: u.used, size: u.size };
          this.emit("info");
        }
        return;
      default:
        return;
    }
  }

  private toolDone(id: string, u: Pick<acp.ToolCallUpdate, "status" | "content" | "rawOutput">): void {
    if (!this.tools.has(id)) return;
    this.tools.delete(id);
    const block: Block = { type: "tool_result", toolUseId: id, content: toolOutput(u), isError: u.status === "failed" };
    this.emitMessage({ uuid: randomUUID(), role: "user", blocks: [block], timestamp: new Date().toISOString() });
  }

  private async onPermission(params: acp.RequestPermissionRequest, signal: AbortSignal): Promise<acp.RequestPermissionResponse> {
    const requestId = randomUUID();
    const info = toolInfo(params.toolCall);
    // תכנון (מדומה): עריכות נדחות לבד. פקודות עדיין שואלות, והמצב הסגור של הסוכן ממילא לא נותן להן לכתוב
    if (this.permissionMode === "plan" && this.emulatePlan && (info.name === "Edit" || info.name === "Write" || ["edit", "delete", "move"].includes(params.toolCall.kind ?? ""))) {
      const reject = params.options.find((o) => o.kind === "reject_once") ?? params.options.find((o) => o.kind === "reject_always");
      this.emitEvent({ kind: "info", text: L(`מצב תכנון: עריכה נדחתה (${params.toolCall.title ?? info.name})`, `Plan mode: edit declined (${params.toolCall.title ?? info.name})`) });
      return reject ? { outcome: { outcome: "selected", optionId: reject.optionId } } : { outcome: { outcome: "cancelled" } };
    }
    // שומר git: פקודה שמשנה ריפו שסשן אחר עובד בו מקבלת אזהרה, ברירת מחדל "לא", ובלי "אשר תמיד"
    const command = info.name === "Bash" && typeof info.input.command === "string" ? info.input.command : "";
    const warning = command ? await gitConflictWarning(command, this.cwd, this.sessionId ? [this.sessionId] : []) : null;
    const request: PermissionRequest = {
      requestId,
      toolName: info.name,
      input: info.input,
      reason: warning ?? params.toolCall.title ?? undefined,
      defaultToNo: warning ? true : undefined,
      canAlways: !warning && params.options.some((o) => o.kind === "allow_always"),
    };
    if (signal.aborted) return { outcome: { outcome: "cancelled" } };
    return new Promise((resolve) => {
      this.pending.set(requestId, { request, options: params.options, resolve });
      signal.addEventListener(
        "abort",
        () => {
          if (!this.pending.delete(requestId)) return;
          this.emitEvent({ kind: "permission_resolved", requestId, behavior: "deny" });
          this.emit("info");
          resolve({ outcome: { outcome: "cancelled" } });
        },
        { once: true },
      );
      // קודם המצב ואז הבקשה: תשובה מיידית (ממשק אחר, בדיקה) לא תשאיר את הסשן תקוע ב"ממתין"
      this.setState("waiting");
      this.emitEvent({ kind: "permission_request", request });
      this.emit("info");
    });
  }

  /* ---------- עזרים ---------- */

  /** "תכנון" אצל סוכן בלי מצב תכנון: בקשות עריכה נדחות בלי כרטיס */
  private emulatePlan = false;

  private async applyMode(): Promise<void> {
    if (!this.conn || !this.sessionId || !this.modes) return;
    const cur = this.modes.currentModeId;
    const picked = pickMode(this.modes.availableModes, this.permissionMode);
    this.emulatePlan = picked.emulatePlan;
    let want = picked.id;
    // ברירת המחדל של הסוכן נשארת, אלא אם היא מסוכנת
    if (this.permissionMode === "default" && !DANGEROUS_MODE.test(cur)) want = want ?? cur;
    if (!want || want === cur) return;
    await this.conn.agent.request(methods.agent.session.setMode, { sessionId: this.sessionId, modeId: want });
    this.modes = { ...this.modes, currentModeId: want };
  }

  private applyConfig(config: acp.SessionConfigOption[] | null | undefined): void {
    const m = config?.find((o) => o.type === "select" && (o.category === "model" || o.id === "model"));
    if (!m || m.type !== "select") return;
    this.modelOption = { id: m.id, options: flatOptions(m.options) };
    this.model = m.currentValue;
  }

  /** הודעת משתמש מההיסטוריה שהסוכן שידר (load) */
  private flushUser(): void {
    if (this.userText.trim()) this.emitMessage({ uuid: randomUUID(), role: "user", blocks: [{ type: "text", text: this.userText }], timestamp: new Date().toISOString() });
    this.userText = "";
  }

  private capturing = false;
  private context: { used: number; size: number } | null = null;
  private userText = "";

  private showPlan(): void {
    if (!this.plan || this.plan === this.planShown) return;
    this.planShown = this.plan;
    this.emitMessage({ uuid: randomUUID(), role: "assistant", blocks: [{ type: "text", text: this.plan }], timestamp: new Date().toISOString() });
  }

  private flushThought(): void {
    if (!this.thought.trim()) return void (this.thought = "");
    this.emitMessage({ uuid: randomUUID(), role: "assistant", blocks: [{ type: "thinking", text: this.thought }], timestamp: new Date().toISOString() });
    this.thought = "";
  }

  /** שולח את הטקסט שהצטבר כהודעת assistant */
  private flush(): void {
    this.flushThought();
    if (this.text.trim()) {
      this.lastText = this.text;
      this.emitMessage({ uuid: randomUUID(), role: "assistant", blocks: [{ type: "text", text: this.text }], timestamp: new Date().toISOString() });
    }
    this.text = "";
    this.partialText = "";
  }

  private emitMessage(message: TranscriptMessage): void {
    this.emitEvent({ kind: "message", message });
    // ההודעה הראשונה נשלחת לפני שיש sessionId: נשמרת אחרי שהסשן נוצר
    if (this.sessionId) void appendTranscript(this.sessionId, message);
    else this.early.push(message);
  }

  private early: TranscriptMessage[] = [];

  /** בפונקציה ולא בהשוואה ישירה: המצב משתנה בזמן ההמתנה, ו-TypeScript מצמצם אותו כאילו לא */
  private ended(): boolean {
    return this.state === "closed" || this.state === "error";
  }

  private cancelAllPending(): void {
    for (const [id, p] of this.pending) {
      this.pending.delete(id);
      this.emitEvent({ kind: "permission_resolved", requestId: id, behavior: "deny" });
      p.resolve({ outcome: { outcome: "cancelled" } });
    }
  }

  private emitEvent(e: LiveEvent, buffer = true): void {
    this.lastActivity = Date.now();
    if (e.kind === "init") for (const m of this.early.splice(0)) void appendTranscript(e.sessionId, m);
    if (buffer) {
      this.events.push(e);
      if (this.events.length > BUFFER_LIMIT) this.events.splice(0, this.events.length - BUFFER_LIMIT);
    }
    this.emit("event", e);
  }

  private setState(s: LiveState): void {
    if (this.state === s) return;
    this.state = s;
    this.emitEvent({ kind: "state", state: s });
    this.emit("info");
  }
}
