import { CLAUDE_HOME, DATA_DIR } from "./paths.js";
import path from "node:path";
import { EventEmitter } from "node:events";
import { rememberCommands } from "./commands.js";
import { systemPrefs } from "./settings.js";
import { L } from "./i18n.js";
import { readTranscript } from "./history.js";
import { getSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import type { TranscriptMessage } from "../../shared/protocol.js";
import { randomUUID } from "node:crypto";
import { query, tagSession } from "@anthropic-ai/claude-agent-sdk";
import type { HookCallback, HookInput, HookJSONOutput, Options, PermissionMode, PermissionResult, PermissionUpdate, Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { classifyCommand, gitHead, grantProblem, GRANT_MINUTES, type DeployGrant } from "./prodGuard.js";
import { hasUiSecret } from "./uiTrust.js";
import { normalizeMessage } from "./history.js";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { analyzeShell, gitBlockMessage } from "./gitPolicy.js";
import type { Attachment, LiveEvent, LiveInfo, LiveState, PermissionRequest } from "../../shared/protocol.js";
import { CLAUDE_CAPS, type AgentRuntime, type OpenParams } from "./providers/types.js";
import { sdkExe } from "./claudeExe.js";
import { applyClaudeAuth } from "./claudeAuth.js";

export type { OpenParams } from "./providers/types.js";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/**
 * תוכן ההודעה ל-Claude: הטקסט, תמונות כבלוקי תמונה (עד 5MB, Claude רואה אותן ישירות), ולכל הקבצים
 * גם הנתיב במחשב, כדי שיוכל לקרוא אותם בעצמו (PDF, קוד, CSV וכו').
 */
function buildContent(text: string, attachments: Attachment[]): SDKUserMessage["message"]["content"] {
  if (attachments.length === 0) return text;
  const list = attachments.map((a) => `- ${a.name}: ${a.path}`).join("\n");
  const blocks: Array<Record<string, unknown>> = [{ type: "text", text: `${text}\n\n${L("קבצים מצורפים (שמורים במחשב, אפשר לקרוא עם Read):", "Attached files (saved on this computer, readable with Read):")}\n${list}` }];
  for (const a of attachments) {
    if (!IMAGE_TYPES.has(a.mime) || a.size > 5 * 1024 * 1024) continue;
    try {
      blocks.push({ type: "image", source: { type: "base64", media_type: a.mime, data: readFileSync(a.path).toString("base64") } });
    } catch {
      /* הקובץ נעלם; הנתיב עדיין בטקסט */
    }
  }
  return blocks as unknown as SDKUserMessage["message"]["content"];
}

/** תור אסינכרוני: ה-SDK קורא ממנו הודעות משתמש, אנחנו דוחפים כשהן מגיעות מה-UI. */
class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiters: Array<(r: IteratorResult<T>) => void> = [];
  private done = false;

  push(item: T): void {
    if (this.done) return;
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false });
    else this.items.push(item);
  }

  end(): void {
    this.done = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined as unknown as T, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift()!, done: false });
        if (this.done) return Promise.resolve({ value: undefined as unknown as T, done: true });
        return new Promise((res) => this.waiters.push(res));
      },
    };
  }
}

/** alias של git (גלובלי ושל הריפו), כדי ש-"git ci" לא יעקוף את החסימה */
function gitAliases(cwd: string): Record<string, string> {
  try {
    const out = execFileSync("git", ["-C", cwd, "config", "--get-regexp", "^alias\\."], { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] });
    const map: Record<string, string> = {};
    for (const line of out.split("\n")) {
      const m = /^alias\.(\S+)\s+(.*)$/.exec(line);
      if (m) map[m[1].toLowerCase()] = m[2];
    }
    return map;
  } catch {
    return {};
  }
}

type CanUseToolOpts = Parameters<NonNullable<Options["canUseTool"]>>[2];
type Pending = { request: PermissionRequest; suggestions: PermissionUpdate[]; resolve: (r: PermissionResult) => void };

// פונקציה ולא קבוע: השפה יכולה להשתנות בזמן ריצה
function errorText(code: string): string | undefined {
  const t: Record<string, string> = {
    authentication_failed: L("האימות נכשל - צריך להתחבר מחדש ב-claude", "Authentication failed. Sign in to claude again"),
    rate_limit: L("הגעת למגבלת השימוש של התוכנית", "You've reached your plan's usage limit"),
    overloaded: L("השרת של Anthropic עמוס, נסה שוב בעוד רגע", "Anthropic's servers are overloaded. Try again in a moment"),
    billing_error: L("בעיית חיוב בחשבון", "Billing issue with your account"),
    model_not_found: L("המודל שנבחר לא זמין לחשבון הזה", "The selected model isn't available for this account"),
    max_output_tokens: L("התשובה נקטעה באורך המקסימלי", "The response was cut off at the maximum length"),
  };
  return t[code];
}

/* כותרות זמניות עד שיש כותרת אמיתית, בשתי השפות (השפה יכולה להשתנות באמצע) */
const NEW_TITLES = new Set(["סשן חדש", "New session"]);
const RESUME_TITLES = new Set(["המשך סשן", "עותק של סשן", "Continue session", "Session copy"]);

const BUFFER_LIMIT = 3000;
/** כמה זמן כרטיס פריסה מחכה להמשתמש לפני שהפקודה נדחית */
const PROD_WAIT_MS = 30 * 60_000;

/**
 * סשן חי שמפקדה מחזיקה דרך ה-SDK. התהליך של Claude Code נפתח בהודעה הראשונה
 * ונשאר פתוח (מצב streaming input) עד close().
 */
/**
 * מצב bypassPermissions (הכול רץ בלי שום אישור) חסום בכל הדרכים: ממשק, WebSocket, משימות ורוטינות.
 * אפשר להתיר רק בעריכה ידנית של settings.json (system.allowBypass), לא מהממשק.
 */
export function safeMode(mode: PermissionMode): PermissionMode {
  if (mode === "bypassPermissions" && !systemPrefs().allowBypass) {
    console.error("[safety] בקשה למצב bypassPermissions נחסמה, הסשן במצב default");
    return "default";
  }
  return mode;
}

/**
 * מצב ההתחלה של סשן חדש. כש-system.allowBypass דלוק וברירת המחדל ב-~/.claude/settings.json היא bypassPermissions,
 * סשן שנפתח במצב "שואל" (ברירת המחדל של הממשק, המשימות והטלפון) מתחיל ב"מאשר הכול". מעבר ידני ל"שואל" באמצע סשן נשמר.
 */
function initialMode(requested: PermissionMode | undefined): PermissionMode {
  if ((requested ?? "default") === "default" && systemPrefs().allowBypass) {
    try {
      const s = JSON.parse(readFileSync(path.join(CLAUDE_HOME, "settings.json"), "utf8")) as { permissions?: { defaultMode?: string } };
      if (s.permissions?.defaultMode === "bypassPermissions") return "bypassPermissions";
    } catch {
      /* אין קובץ או JSON שבור: נשארים במצב שביקשו */
    }
  }
  return safeMode(requested ?? "default");
}

export class LiveSession extends EventEmitter implements AgentRuntime {
  readonly liveId = randomUUID();
  readonly provider = "claude";
  readonly caps = CLAUDE_CAPS;
  readonly cwd: string;
  readonly agent: string | null;
  readonly startedAt = Date.now();
  /** פעילות אחרונה (הודעה, אירוע): לסגירה אוטומטית של סשן פעיל שאף אחד לא משתמש בו */
  lastActivity = Date.now();
  readonly events: LiveEvent[] = [];
  sessionId: string | null;
  model: string | null;
  permissionMode: PermissionMode;
  state: LiveState = "ready";
  title: string;
  costUsd = 0;
  partialText = "";

  private readonly resumeId?: string;
  private readonly fork: boolean;
  private readonly input = new AsyncQueue<SDKUserMessage>();
  private readonly pending = new Map<string, Pending>();
  private q: Query | null = null;
  private tagged = false;
  /** הודעות שנשלחו ממפקדה. הודעת משתמש אחרת שמגיעה מה-CLI נשלחה מהטלפון (Remote Control) */
  private readonly sentUuids = new Set<string>();
  remoteUrl: string | null = null;
  /** "אשר פריסה לסשן הזה": פקודות פרוד עוברות בלי כרטיס עד שפג, הקומיט משתנה או הסשן נסגר (prodGuard.ts) */
  private deployGrant: DeployGrant | null = null;
  /** חסימת git (משימה). אפשר לשנות באמצע: סימון "מותר commit" במשימה פותח גם סשן שכבר רץ */
  gitLock: boolean;

  constructor(p: OpenParams) {
    super();
    this.cwd = p.cwd;
    this.gitLock = Boolean(p.gitLock);
    this.agent = p.agent ?? null;
    this.model = p.model ?? null;
    this.permissionMode = initialMode(p.permissionMode);
    this.resumeId = p.resume;
    this.fork = Boolean(p.fork);
    this.sessionId = p.resume && !p.fork ? p.resume : null;
    this.title = p.title ?? (p.resume ? (p.fork ? L("עותק של סשן", "Session copy") : L("המשך סשן", "Continue session")) : L("סשן חדש", "New session"));
    // סשן שממשיכים: הכותרת האמיתית שלו במקום "המשך סשן"
    if (p.resume && !p.title) {
      const fork = Boolean(p.fork);
      void getSessionInfo(p.resume)
        .then((info) => {
          const t = info?.customTitle || info?.summary;
          if (t && RESUME_TITLES.has(this.title)) {
            this.title = (fork ? L(`עותק: ${t}`, `Copy: ${t}`) : t).slice(0, 80);
            this.emit("info");
          }
        })
        .catch(() => undefined);
    }
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
      remoteUrl: this.remoteUrl,
      deployGrantUntil: this.deployGrant && this.deployGrant.expires > Date.now() ? this.deployGrant.expires : null,
    };
  }

  send(text: string, attachments: Attachment[] = []): void {
    const trimmed = text.trim() || (attachments.length ? L("מצורף קובץ", "File attached") : "");
    if (!trimmed) return;
    if (this.state === "closed" || this.state === "error") throw new Error(L("הסשן סגור", "The session is closed"));
    if (!this.q) this.start();
    if (NEW_TITLES.has(this.title)) {
      this.title = trimmed.slice(0, 60);
      this.emit("info");
    }
    const uuid = randomUUID();
    this.sentUuids.add(uuid);
    this.emitEvent({
      kind: "message",
      message: {
        uuid,
        role: "user",
        blocks: [{ type: "text", text: trimmed }, ...attachments.map((a) => ({ type: "file" as const, name: a.name, path: a.path, mime: a.mime }))],
        timestamp: new Date().toISOString(),
      },
    });
    // אותו uuid עובר ל-SDK, כדי ש-rewindFiles(uuid) יוכל להחזיר את הקבצים למצב שלפני ההודעה
    this.input.push({ type: "user", uuid, message: { role: "user", content: buildContent(trimmed, attachments) }, parent_tool_use_id: null });
    this.partialText = "";
    this.setState("running");
  }

  /**
   * trusted: ההודעה הגיעה מהחלון של מפקדה (uiTrust.ts). פקודת פרוד מאושרת רק ככה; דחייה מותרת מכל מקום.
   * grant: "אשר פריסה לסשן הזה" על כרטיס פרוד.
   */
  resolvePermission(requestId: string, behavior: "allow" | "deny", always: boolean, opts: { trusted?: boolean; grant?: boolean } = {}): void {
    const p = this.pending.get(requestId);
    if (!p) return;
    const prod = p.request.prod;
    if (prod && behavior === "allow" && !opts.trusted) {
      console.error(`[prod ${this.liveId.slice(0, 8)}] אישור פריסה מלקוח לא מוגן נדחה`);
      throw new Error("אישור פריסה אפשרי רק מהחלון של אפליקציית מפקדה");
    }
    this.pending.delete(requestId);
    if (prod && behavior === "allow" && opts.grant) {
      this.deployGrant = { cwd: prod.cwd, commit: prod.commit, expires: Date.now() + GRANT_MINUTES * 60_000 };
      this.emitEvent({ kind: "info", text: `אישור פריסה לסשן הזה ל-${GRANT_MINUTES} דקות (${prod.branch ?? "?"} @ ${prod.commit?.slice(0, 7) ?? "?"})` });
    }
    const result: PermissionResult =
      behavior === "allow"
        ? { behavior: "allow", ...(always && p.suggestions.length ? { updatedPermissions: p.suggestions } : {}) }
        : { behavior: "deny", message: L("המשתמש דחה את הפעולה במפקדה", "The user denied this action in Mifkada") };
    this.emitEvent({ kind: "permission_resolved", requestId, behavior });
    if (this.pending.size === 0) this.setState("running");
    this.emit("info");
    p.resolve(result);
  }

  /** ביטול "אשר פריסה לסשן הזה". מותר מכל לקוח: הוא רק מצמצם */
  revokeGrant(): void {
    if (!this.deployGrant) return;
    this.deployGrant = null;
    this.emitEvent({ kind: "info", text: "אישור הפריסה בוטל" });
    this.emit("info");
  }

  async interrupt(): Promise<void> {
    await this.q?.interrupt();
  }

  /** מחזיר את הקבצים למצב שלפני הודעת המשתמש הזו (checkpoint של ה-SDK). */
  async rewind(uuid: string): Promise<string> {
    if (!this.q) throw new Error(L("הסשן לא פעיל", "The session isn't active"));
    const r = await this.q.rewindFiles(uuid);
    const files = (r as { filesChanged?: string[] }).filesChanged ?? [];
    this.emitEvent({ kind: "info", text: L(`הקבצים הוחזרו למצב שלפני ההודעה (${files.length} קבצים)`, `Files restored to before this message (${files.length} files)`) });
    return files.length ? L(`${files.length} קבצים הוחזרו`, `${files.length} files restored`) : L("אין קבצים להחזיר", "No files to restore");
  }

  /** הודעות משתמש שכבר היו בתמליל כשהגשר הופעל (לא להציג שוב) */
  private seenUser: Set<string> | null = null;

  /**
   * הודעות שנכתבו מהטלפון: ה-SDK לא משדר אותן, לכן משווים לתמליל ומציגים כל הודעת משתמש חדשה שלא נשלחה ממפקדה.
   * נקרא כשתור מתחיל בלי ששלחנו, ובסוף כל תור (הודעה מהטלפון שנכנסה לתור באמצע עבודה).
   */
  private async pullExternalUser(): Promise<void> {
    if (!this.sessionId || !this.remoteUrl) return;
    await new Promise((r) => setTimeout(r, 150));
    try {
      const all = await readTranscript(this.sessionId);
      if (!this.seenUser) {
        this.seenUser = new Set(all.filter((m) => m.role === "user").map((m) => m.uuid));
        return;
      }
      for (const m of all) {
        if (m.role !== "user" || this.sentUuids.has(m.uuid) || this.seenUser.has(m.uuid)) continue;
        this.seenUser.add(m.uuid);
        const text = m.blocks.find((b) => b.type === "text");
        if (!text || !("text" in text) || !text.text.trim() || text.text.startsWith("<")) continue;
        this.emitEvent({ kind: "message", message: { ...m, phone: true } as TranscriptMessage });
        console.error(`[rc ${this.liveId.slice(0, 8)}] הודעה מבחוץ (טלפון)`);
      }
    } catch {
      /* התמליל לא זמין */
    }
  }

  /**
   * Remote Control בתוך הסשן, כמו ב-VS Code: הסשן נשאר כאן ובמקביל זמין באפליקציה של Claude ו-claude.ai/code.
   * enableRemoteControl קיים ב-Query של ה-SDK (תוסף ה-VS Code משתמש בו) אבל לא בהגדרות הטיפוסים, לכן הגישה דרך cast.
   */
  async setRemote(on: boolean): Promise<string | null> {
    if (this.state === "closed" || this.state === "error") throw new Error(L("הסשן סגור", "The session is closed"));
    if (!this.q) this.start();
    await this.q!.initializationResult();
    const q = this.q as unknown as { enableRemoteControl?: (on: boolean, name?: string, opts?: { keepSessionOnExit?: boolean }) => Promise<{ session_url?: string } | undefined> };
    if (!q.enableRemoteControl) throw new Error(L("גרסת ה-SDK לא תומכת ב-Remote Control", "This SDK version doesn't support Remote Control"));
    // שם ברור ברשימה של האפליקציה: "מפקדה · <פרויקט> · <כותרת>"
    const r = await q.enableRemoteControl(on, on ? `${L("מפקדה", "Mifkada")} · ${path.basename(this.cwd)} · ${this.title}`.slice(0, 80) : undefined, on ? { keepSessionOnExit: true } : undefined);
    // keepSessionOnExit: בלי זה כל הפעלה מחדש של מפקדה מעבירה את הסשן לארכיון באפליקציה, והוא נעלם מהרשימה
    this.remoteUrl = on ? (r?.session_url ?? null) : null;
    if (on && !this.seenUser) {
      this.seenUser = null;
      await this.pullExternalUser();
    }
    if (on && !this.remoteUrl) throw new Error(L("Remote Control לא החזיר קישור", "Remote Control didn't return a link"));
    this.emitEvent({ kind: "info", text: on ? L("Remote Control פעיל: הסשן זמין גם באפליקציה של Claude", "Remote Control is on: this session is also available in the Claude app") : L("Remote Control כבוי", "Remote Control is off") });
    this.emit("info");
    return this.remoteUrl;
  }

  async setModel(model: string | null): Promise<void> {
    this.model = model;
    if (this.q) await this.q.setModel(model ?? undefined);
    this.emit("info");
  }

  async setPermissionMode(requested: PermissionMode): Promise<void> {
    const mode = safeMode(requested);
    this.permissionMode = mode;
    if (this.q) await this.q.setPermissionMode(mode);
    this.emit("info");
  }

  close(): Promise<void> {
    // סגירה מכוונת: הסשן יוצא גם מהאפליקציה של Claude (בהפעלה מחדש של מפקדה הוא נשאר)
    // קודם מכבים את הגשר ומחכים לו (עד 4 שניות), ורק אז סוגרים את התהליך. סגירה מיידית השאירה את הסשן
    // תלוי ברשימה של האפליקציה בטלפון, כי בקשת הכיבוי לא הספיקה לצאת
    const q = this.q;
    const bridgeOff =
      this.remoteUrl && q
        ? Promise.race([(q as unknown as { enableRemoteControl?: (on: boolean) => Promise<unknown> }).enableRemoteControl?.(false)?.catch(() => undefined), new Promise((r) => setTimeout(r, 4000))])
        : Promise.resolve();
    this.remoteUrl = null;
    this.deployGrant = null;
    this.denyAllPending(L("הסשן נסגר", "The session was closed"));
    this.setState("closed");
    return bridgeOff.then(() => {
      this.input.end();
      q?.close();
    });
  }

  private start(): void {
    // ההתחברות לפי system.authMode: מפתח API (ברירת המחדל) או ההתחברות של Claude Code במחשב (claudeAuth.ts)
    const env: Record<string, string | undefined> = { ...process.env };
    applyClaudeAuth(env);
    // deployer בודק את זה לפני שהוא סומך על השומר (prodHook). בטרמינל או ב-daemon ישן אין שומר ואין משתנה
    env.MIFKADA_PROD_GUARD = "1";
    const options: Options = {
      ...sdkExe(),
      cwd: this.cwd,
      resume: this.resumeId,
      forkSession: this.fork || undefined,
      agent: this.agent ?? undefined,
      model: this.model ?? undefined,
      permissionMode: this.permissionMode,
      // "מאשר הכול" (bypassPermissions) עובד רק אם התהליך הופעל עם ההיתר הזה, גם כשעוברים אליו באמצע הסשן
      allowDangerouslySkipPermissions: systemPrefs().allowBypass,
      includePartialMessages: true,
      enableFileCheckpointing: true,
      env,
      systemPrompt: { type: "preset", preset: "claude_code" },
      tools: { type: "preset", preset: "claude_code" },
      canUseTool: (toolName, input, opts) => this.canUseTool(toolName, input, opts),
      // שומר הפרוד: callback בתוך ה-daemon, לא סקריפט שסוכן יכול לערוך. רץ גם לתת-סוכנים (כלי Agent), בכל מצב הרשאות.
      // חסימת git: בלי matcher, כל כלי עם command (Bash, Monitor), גם אצל תת-אייג'נטים
      // ה-hook עצמו מחכה להחלטה של המשתמש, ולכן זה לא תלוי ב-allow: Bash שב-settings.json. timeout של hook חוסם את הפקודה
      hooks: { PreToolUse: [{ matcher: "Bash", timeout: 24 * 3600, hooks: [(input, _id, { signal }) => this.prodHook(input, signal)] }, { hooks: [this.gitHook()] }] },
      // יומן דיבוג מלא של Claude לאבחון Remote Control (גדל מהר, לכן רק עם MIFKADA_RC_DEBUG=1)
      ...(process.env.MIFKADA_RC_DEBUG === "1" ? { extraArgs: { "debug-file": path.join(DATA_DIR, "rc-debug", `${this.liveId}.log`) } } : {}),
      stderr: (d) => {
        const line = d.trim();
        if (line) console.error(`[claude ${this.liveId.slice(0, 8)}] ${line}`);
      },
    };
    this.setState("starting");
    this.q = query({ prompt: this.input, options });
    void this.pump();
  }

  private async pump(): Promise<void> {
    try {
      for await (const m of this.q!) this.handle(m);
      if (this.state !== "closed") this.setState("closed");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.emitEvent({ kind: "error", message });
      this.setState("error");
    } finally {
      this.denyAllPending(L("הסשן הסתיים", "The session ended"));
    }
  }

  private handle(m: SDKMessage): void {
    switch (m.type) {
      case "system":
        if (m.subtype === "init") {
          this.sessionId = m.session_id;
          this.model = m.model;
          this.permissionMode = m.permissionMode;
          this.emitEvent({
            kind: "init",
            sessionId: m.session_id,
            model: m.model,
            permissionMode: m.permissionMode,
            cwd: m.cwd,
            tools: m.tools,
            version: m.claude_code_version,
          });
          this.emit("info");
          // רשימת פקודות ה-/ העדכנית של התיקייה, לתפריט בתיבת הכתיבה
          void this.q?.supportedCommands().then((l) => rememberCommands(this.cwd, l)).catch(() => undefined);
        }
        if (m.subtype === "commands_changed") rememberCommands(this.cwd, m.commands);
        // מצב הגשר של Remote Control. כשל = כבר לא זמין בטלפון
        if ((m.subtype as string) === "bridge_state") {
          const st = (m as unknown as { state: string }).state;
          console.error(`[rc ${this.liveId.slice(0, 8)}] bridge ${st}`);
          if ((st === "failed" || st === "policy_disabled") && this.remoteUrl) {
            this.remoteUrl = null;
            this.emitEvent({ kind: "info", text: L("Remote Control התנתק", "Remote Control disconnected") });
            this.emit("info");
          }
        }
        return;

      case "stream_event": {
        if (m.parent_tool_use_id) return;
        // תור שהתחיל מהטלפון: אצלנו הסשן עדיין "ממתין". ה-SDK לא משדר את הודעת הטלפון, לכן קוראים אותה מהתמליל
        if (this.state === "idle" || this.state === "ready") {
          this.setState("running");
          void this.pullExternalUser();
        }
        const ev = m.event;
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          this.partialText += ev.delta.text;
          this.emitEvent({ kind: "text_delta", text: ev.delta.text }, false);
        } else if (ev.type === "content_block_start" && ev.content_block.type === "tool_use") {
          this.emitEvent({ kind: "tool_start", name: ev.content_block.name }, false);
        }
        return;
      }

      case "assistant": {
        if (m.parent_tool_use_id) return;
        this.partialText = "";
        const msg = normalizeMessage("assistant", m.uuid, m.message, m.timestamp ?? new Date().toISOString());
        if (msg) this.emitEvent({ kind: "message", message: msg });
        if (m.error) this.emitEvent({ kind: "error", message: errorText(m.error) ?? m.error });
        return;
      }

      case "user": {
        if (m.parent_tool_use_id) return;
        const content = m.message.content;
        const hasToolResult = Array.isArray(content) && content.some((b) => b.type === "tool_result");
        if (!hasToolResult) {
          // את הטקסט ששלחנו כבר שידרנו ב-send(). הודעה שלא שלחנו הגיעה מהטלפון דרך Remote Control
          if (m.uuid && this.sentUuids.has(m.uuid)) return;
          if ((m as { isReplay?: boolean }).isReplay && !this.remoteUrl) return;
          const msg = normalizeMessage("user", m.uuid ?? randomUUID(), m.message, new Date().toISOString());
          if (msg && msg.blocks.some((b) => b.type === "text" && b.text.trim())) {
            if (m.uuid) this.sentUuids.add(m.uuid);
            console.error(`[rc ${this.liveId.slice(0, 8)}] הודעה מבחוץ (טלפון)`);
            this.emitEvent({ kind: "message", message: msg });
            if (this.state === "idle" || this.state === "ready") this.setState("running");
          }
          return;
        }
        const msg = normalizeMessage("user", m.uuid ?? randomUUID(), m.message, new Date().toISOString());
        if (msg) this.emitEvent({ kind: "message", message: msg });
        return;
      }

      case "result": {
        this.costUsd = m.total_cost_usd ?? this.costUsd;
        const text = m.subtype === "success" ? m.result : "errors" in m && Array.isArray(m.errors) ? m.errors.join("\n") : m.subtype;
        this.emitEvent({
          kind: "result",
          result: { subtype: m.subtype, isError: m.is_error, costUsd: this.costUsd, durationMs: m.duration_ms, numTurns: m.num_turns, text },
        });
        this.setState("idle");
        this.emit("info");
        void this.ensureTag();
        void this.pullExternalUser();
        return;
      }

      default:
        return;
    }
  }

  /** פקודת Bash שמשנה פרוד: עוברת רק עם אישור של המשתמש מהחלון (כרטיס), או לפי "אשר פריסה לסשן הזה" */
  private async prodHook(input: HookInput, signal: AbortSignal): Promise<HookJSONOutput> {
    if (input.hook_event_name !== "PreToolUse" || input.tool_name !== "Bash") return {};
    const command = String((input.tool_input as { command?: unknown } | null)?.command ?? "");
    const cwd = input.cwd || this.cwd;
    const check = classifyCommand(command, cwd);
    if (!check.prod) return {};
    const decide = (d: "allow" | "deny", reason: string): HookJSONOutput => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: d, permissionDecisionReason: reason } });
    const problem = grantProblem(this.deployGrant, cwd);
    if (!problem) {
      console.error(`[prod ${this.liveId.slice(0, 8)}] לפי אישור הפריסה: ${command.slice(0, 120)}`);
      return decide("allow", "פקודת פרוד לפי אישור הפריסה שהמשתמש נתן לסשן הזה במפקדה");
    }
    if (this.deployGrant) {
      this.emitEvent({ kind: "info", text: `${problem}, צריך לאשר שוב` });
      this.deployGrant = null;
      this.emit("info");
    }
    const head = gitHead(cwd);
    const agent = (input as { agent_type?: string }).agent_type ?? this.agent;
    const request: PermissionRequest = {
      requestId: randomUUID(),
      toolName: "Bash",
      input: input.tool_input,
      reason: `שינוי בפרוד: ${check.reasons.join(", ")}`,
      defaultToNo: true,
      canAlways: false,
      prod: { command, reasons: check.reasons, cwd, branch: head.branch, commit: head.commit, agent: agent ?? null, grantMinutes: GRANT_MINUTES, untrustedOnly: !hasUiSecret() || undefined },
    };
    console.error(`[prod ${this.liveId.slice(0, 8)}] מחכה לאישור: ${command.slice(0, 120)}`);
    const r = await new Promise<PermissionResult>((resolve) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(request.requestId)) return;
        this.emitEvent({ kind: "permission_resolved", requestId: request.requestId, behavior: "deny" });
        if (this.pending.size === 0 && this.state === "waiting") this.setState("running");
        this.emit("info");
        resolve({ behavior: "deny", message: "לא אושר תוך 30 דקות" });
      }, PROD_WAIT_MS);
      this.pending.set(request.requestId, {
        request,
        suggestions: [],
        resolve: (x) => {
          clearTimeout(timer);
          resolve(x);
        },
      });
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          if (!this.pending.delete(request.requestId)) return;
          this.emitEvent({ kind: "permission_resolved", requestId: request.requestId, behavior: "deny" });
          this.emit("info");
          resolve({ behavior: "deny", message: "הבקשה בוטלה" });
        },
        { once: true },
      );
      this.emitEvent({ kind: "permission_request", request });
      this.setState("waiting");
      this.emit("info");
    });
    if (r.behavior === "allow") return decide("allow", "המשתמש אישר את הפקודה במפקדה");
    return decide("deny", `${r.message}. פקודה שמשנה פרוד לא אושרה על ידי המשתמש. לא לנסות לעקוף (סקריפט, host אחר, פקודה אחרת): לעצור ולדווח.`);
  }

  private gitHook(): HookCallback {
    let aliases: Record<string, string> | null = null;
    return async (input) => {
      if (!this.gitLock || input.hook_event_name !== "PreToolUse") return {};
      const command = (input.tool_input as { command?: unknown } | null)?.command;
      if (typeof command !== "string") return {};
      aliases ??= gitAliases(this.cwd);
      let op: string | null;
      try {
        op = analyzeShell(command, aliases)?.op ?? null;
      } catch {
        // ניתוח שנכשל על פקודה שמזכירה git: חוסמים (משימה, לא המשתמש)
        op = /\b(git|gh)\b/.test(command) ? "פקודת git שלא ניתן לנתח" : null;
      }
      if (!op) return {};
      this.emitEvent({ kind: "info", text: `נחסם: ${op} (משימה בלי "מותר commit"): ${command.slice(0, 160)}` });
      return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: gitBlockMessage(op) } };
    };
  }

  private canUseTool(toolName: string, input: Record<string, unknown>, opts: CanUseToolOpts): Promise<PermissionResult> {
    const requestId = opts.requestId ?? randomUUID();
    const suggestions = opts.suggestions ?? [];
    const request: PermissionRequest = {
      requestId,
      toolName,
      input,
      reason: opts.decisionReason,
      defaultToNo: opts.defaultToNo,
      canAlways: suggestions.length > 0 && !opts.suppressAlwaysAllowRule,
    };
    return new Promise((resolve) => {
      this.pending.set(requestId, { request, suggestions, resolve });
      opts.signal.addEventListener(
        "abort",
        () => {
          if (!this.pending.delete(requestId)) return;
          this.emitEvent({ kind: "permission_resolved", requestId, behavior: "deny" });
          this.emit("info");
          resolve({ behavior: "deny", message: L("הבקשה בוטלה", "The request was cancelled") });
        },
        { once: true },
      );
      this.emitEvent({ kind: "permission_request", request });
      this.setState("waiting");
      this.emit("info");
    });
  }

  private denyAllPending(reason: string): void {
    for (const [id, p] of this.pending) {
      this.pending.delete(id);
      this.emitEvent({ kind: "permission_resolved", requestId: id, behavior: "deny" });
      p.resolve({ behavior: "deny", message: reason });
    }
  }

  private async ensureTag(): Promise<void> {
    if (this.tagged || !this.agent || !this.sessionId) return;
    this.tagged = true;
    try {
      await tagSession(this.sessionId, this.agent);
    } catch (e) {
      console.error("tagSession failed", e);
    }
  }

  private emitEvent(e: LiveEvent, buffer = true): void {
    this.lastActivity = Date.now();
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
