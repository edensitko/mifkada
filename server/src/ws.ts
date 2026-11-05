import { WebSocketServer, WebSocket } from "ws";
import { createRuntime } from "./providers/registry.js";
import type { AgentRuntime, OpenParams } from "./providers/types.js";
import { isQuiet, notifyPrefs } from "./settings.js";
import type { IncomingMessage } from "node:http";
import type { ClientMsg, LiveEvent, LiveInfo, ServerMsg } from "../../shared/protocol.js";
import { L } from "./i18n.js";
import { assertOpenableCwd } from "./access.js";
import { cachedProvider } from "./providers/presets.js";
import { isTrustedUi } from "./uiTrust.js";

/** trusted: החיבור הגיע מהחלון של מפקדה דרך ה-main של Electron (uiTrust.ts). רק הוא מאשר פקודות פרוד */
type Client = WebSocket & { attached: Set<string>; trusted: boolean };

/** מחזיק את כל הסשנים החיים ומשדר את האירועים שלהם ללקוחות שנרשמו. */
export class Hub {
  readonly lives = new Map<string, AgentRuntime>();
  /** נקרא בכל פתיחה של סשן חי (שרת Remote Control אוטומטי לפרויקט) */
  onOpen?: (live: AgentRuntime) => void;
  private readonly clients = new Set<Client>();

  constructor(readonly wss: WebSocketServer) {
    wss.on("connection", (ws, req?: IncomingMessage) => this.onConnection(ws as Client, Boolean(req && isTrustedUi(req.headers))));
  }

  liveBySession(sessionId: string): AgentRuntime | undefined {
    for (const l of this.lives.values()) if (l.sessionId === sessionId) return l;
    return undefined;
  }

  /**
   * סשנים פעילים שנפתחו (גם רק בלחיצה ברשימה) ואף אחד לא מסתכל עליהם או משתמש בהם X דקות נסגרים,
   * כדי שלא יצטברו תהליכי Claude. לא נוגע בסשן שעובד, ממתין לאישור, או פתוח על מסך כלשהו (מחשב או טלפון)
   */
  reapIdle(minutes: number): string[] {
    if (!minutes) return [];
    const watched = new Set<string>();
    for (const c of this.clients) for (const id of c.attached) watched.add(id);
    const cutoff = Date.now() - minutes * 60_000;
    const closed: string[] = [];
    for (const l of [...this.lives.values()]) {
      const st = l.info().state;
      if (watched.has(l.liveId) || l.lastActivity > cutoff || !["idle", "ready"].includes(st)) continue;
      closed.push(l.title);
      this.closeLive(l.liveId);
    }
    return closed;
  }

  infos(): LiveInfo[] {
    return [...this.lives.values()].map((l) => l.info());
  }

  open(params: OpenParams): AgentRuntime {
    const live = createRuntime(params);
    this.lives.set(live.liveId, live);
    live.on("event", (event) => {
      const msg: ServerMsg = { t: "event", liveId: live.liveId, event };
      for (const c of this.clients) if (c.attached.has(live.liveId)) this.send(c, msg);
    });
    live.on("info", () => this.broadcastLives());
    // התראות מערכת: ה-Electron מאזין להודעות notify ומציג אותן כשהחלון לא בפוקוס
    live.on("event", (event: LiveEvent) => {
      const n = this.toNotification(live, event);
      // שעות שקטות: רק בקשות אישור עוברות
      if (n && n.t === "notify" && notifyPrefs()[n.kind] && (n.kind === "permission" || !isQuiet())) this.broadcast(n);
    });
    this.broadcastLives();
    this.onOpen?.(live);
    return live;
  }

  private onConnection(ws: Client, trusted: boolean): void {
    ws.attached = new Set();
    ws.trusted = trusted;
    this.clients.add(ws);
    this.send(ws, { t: "lives", lives: this.infos() });
    ws.on("message", (data) => {
      let m: ClientMsg;
      try {
        m = JSON.parse(String(data)) as ClientMsg;
      } catch {
        return;
      }
      this.handle(ws, m).catch((e: unknown) => this.send(ws, { t: "error", message: e instanceof Error ? e.message : String(e), ref: m.t === "open" ? m.ref : undefined }));
    });
    ws.on("close", () => this.clients.delete(ws));
  }

  private async handle(ws: Client, m: ClientMsg): Promise<void> {
    switch (m.t) {
      case "open": {
        const existing = m.resume && !m.fork ? this.liveBySession(m.resume) : undefined;
        // התיקייה מגיעה מהלקוח, והסשן החי נכנס לתיקיות המותרות (setExtraRoots): בלי הבדיקה כל נתיב היה עובר
        // (הנתיב נשאר כמו שנשלח: resume מחפש את הסשן לפי הצורה המקורית של ה-cwd)
        if (!existing) await assertOpenableCwd(m.cwd);
        const live =
          existing ??
          this.open({
            cwd: m.cwd,
            provider: m.provider,
            title: m.title,
            resume: m.resume,
            fork: m.fork,
            agent: m.agent ?? null,
            model: m.model ?? null,
            permissionMode: m.permissionMode ?? "default",
          });
        this.send(ws, { t: "opened", liveId: live.liveId, ref: m.ref });
        this.attach(ws, live);
        if (m.text || m.attachments?.length) live.send(m.text ?? "", m.attachments ?? []);
        return;
      }
      case "attach":
        this.attach(ws, this.must(m.liveId));
        return;
      case "detach":
        ws.attached.delete(m.liveId);
        return;
      case "send":
        this.must(m.liveId).send(m.text, m.attachments ?? []);
        return;
      case "permission":
        this.must(m.liveId).resolvePermission(m.requestId, m.behavior, Boolean(m.always), { trusted: ws.trusted, grant: Boolean(m.grant) });
        return;
      case "revoke_grant":
        this.must(m.liveId).revokeGrant?.();
        return;
      case "interrupt":
        await this.must(m.liveId).interrupt();
        return;
      case "set_model":
        await this.must(m.liveId).setModel(m.model);
        return;
      case "set_remote": {
        const url = await this.must(m.liveId).setRemote(m.on);
        this.send(ws, { t: "toast", message: m.on ? L(`זמין באפליקציה של Claude${url ? "" : ""}`, "Available in the Claude app") : L("Remote Control כבוי", "Remote Control is off") });
        return;
      }
      case "set_mode":
        await this.must(m.liveId).setPermissionMode(m.mode);
        return;
      case "rewind": {
        const msg = await this.must(m.liveId).rewind(m.uuid);
        this.send(ws, { t: "toast", message: msg });
        return;
      }
      case "close": {
        const live = this.must(m.liveId);
        live.close();
        this.lives.delete(live.liveId);
        this.broadcastLives();
        return;
      }
    }
  }

  private toNotification(live: AgentRuntime, e: LiveEvent): ServerMsg | null {
    const base = { t: "notify" as const, liveId: live.liveId, sessionId: live.sessionId };
    switch (e.kind) {
      case "permission_request":
      {
        const who = live.provider === "claude" ? "Claude" : (cachedProvider(live.provider)?.label ?? live.provider);
        return { ...base, kind: "permission", title: e.request.prod ? L("בקשת פריסה לפרוד", "Production deploy request") : L(`${who} מבקש אישור ל-${e.request.toolName}`, `${who} is asking permission for ${e.request.toolName}`), body: live.title };
      }
      case "result": {
        const first = e.result.text.split("\n").find((l) => l.trim())?.trim().slice(0, 120) ?? "";
        return e.result.isError
          ? { ...base, kind: "error", title: L(`שגיאה: ${live.title}`, `Error: ${live.title}`), body: first }
          : { ...base, kind: "done", title: L(`סיים: ${live.title}`, `Done: ${live.title}`), body: first || L(`${e.result.numTurns} צעדים`, `${e.result.numTurns} steps`) };
      }
      case "error":
        return { ...base, kind: "error", title: L(`שגיאה: ${live.title}`, `Error: ${live.title}`), body: e.message.slice(0, 120) };
      default:
        return null;
    }
  }

  /** סגירה מבחוץ (העברה ל-Remote Control) */
  closeLive(liveId: string): void {
    const live = this.lives.get(liveId);
    if (!live) return;
    live.close();
    this.lives.delete(liveId);
    this.broadcastLives();
  }

  private attach(ws: Client, live: AgentRuntime): void {
    ws.attached.add(live.liveId);
    this.send(ws, { t: "snapshot", liveId: live.liveId, info: live.info(), events: live.events, partialText: live.partialText });
  }

  private must(liveId: string): AgentRuntime {
    const l = this.lives.get(liveId);
    if (!l) throw new Error(L(`אין סשן חי בשם ${liveId}`, `No live session ${liveId}`));
    return l;
  }

  private send(ws: WebSocket, msg: ServerMsg): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  broadcast(msg: ServerMsg): void {
    for (const c of this.clients) this.send(c, msg);
  }

  private broadcastLives(): void {
    const msg: ServerMsg = { t: "lives", lives: this.infos() };
    for (const c of this.clients) this.send(c, msg);
  }
}
