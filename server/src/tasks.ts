import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { DATA_DIR } from "./paths.js";
import type { Hub } from "./ws.js";
import type { LiveEvent, Task, TaskInput, TaskSettings, TaskStatus } from "../../shared/protocol.js";
import { createWorktree, mergeWorktree, removeWorktree, worktreeStatus } from "./worktree.js";
import { activeInRepo } from "./activity.js";
import { L } from "./i18n.js";

function slugify(s: string): string {
  const ascii = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
  return ascii || "task";
}

const FILE = path.join(DATA_DIR, "tasks.json");
const STATUSES: TaskStatus[] = ["todo", "running", "review", "done"];

/** לוח המשימות: קובץ JSON, והקשר בין משימה לסשן חי שהיא פתחה. */
export class TaskStore extends EventEmitter {
  private tasks: Task[] = [];
  private loaded = false;
  settings: TaskSettings = { autoRun: false, maxParallel: 2 };
  private ticking = false;

  constructor(private readonly hub: Hub) {
    super();
  }

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(FILE, "utf8")) as { tasks?: Task[]; settings?: Partial<TaskSettings> };
      this.tasks = Array.isArray(raw.tasks) ? raw.tasks : [];
      this.settings = { autoRun: Boolean(raw.settings?.autoRun), maxParallel: Math.min(6, Math.max(1, Number(raw.settings?.maxParallel) || 2)) };
    } catch {
      this.tasks = [];
    }
    // סשנים שהיו חיים לפני שהשרת עלה מחדש כבר לא קיימים
    for (const t of this.tasks) {
      if (t.liveId && !this.hub.lives.has(t.liveId)) {
        t.liveId = null;
        if (t.status === "running") t.status = "review";
      }
    }
    this.loaded = true;
    this.emit("change", this.list());
  }

  async updateSettings(patch: Partial<TaskSettings>): Promise<TaskSettings> {
    if (typeof patch.autoRun === "boolean") this.settings.autoRun = patch.autoRun;
    if (typeof patch.maxParallel === "number") this.settings.maxParallel = Math.min(6, Math.max(1, Math.round(patch.maxParallel)));
    await this.save();
    return this.settings;
  }

  /** תור אוטומטי: כל עוד יש מקום, המשימה הוותיקה ביותר בתור מופעלת. */
  private async tick(): Promise<void> {
    if (!this.settings.autoRun || this.ticking) return;
    this.ticking = true;
    try {
      for (;;) {
        const running = this.tasks.filter((t) => t.status === "running" && t.liveId && this.hub.lives.has(t.liveId)).length;
        if (running >= this.settings.maxParallel) break;
        const next = this.list().find((t) => t.status === "todo" && t.owner !== "me");
        if (!next) break;
        await this.run(next.id);
      }
    } finally {
      this.ticking = false;
    }
  }

  list(): Task[] {
    return [...this.tasks].sort((a, b) => a.order - b.order);
  }

  get(id: string): Task | undefined {
    return this.tasks.find((t) => t.id === id);
  }

  async create(input: TaskInput): Promise<Task> {
    const now = Date.now();
    const task: Task = {
      id: randomUUID(),
      title: input.title.trim() || input.prompt.trim().slice(0, 60),
      prompt: input.prompt,
      cwd: input.cwd,
      ...(input.provider && input.provider !== "claude" ? { provider: input.provider } : {}),
      agent: input.agent ?? null,
      model: input.model ?? null,
      permissionMode: input.permissionMode ?? "default",
      status: input.status && STATUSES.includes(input.status) ? input.status : "todo",
      owner: input.owner === "me" ? "me" : "agent",
      order: now,
      createdAt: now,
      updatedAt: now,
      liveId: null,
      sessionId: null,
      summary: null,
      costUsd: 0,
      lastError: null,
      isolate: Boolean(input.isolate),
      allowGit: input.allowGit === true,
      worktree: null,
      routineId: input.routineId ?? null,
    };
    this.tasks.push(task);
    await this.save();
    return task;
  }

  async update(id: string, patch: Partial<Task>): Promise<Task> {
    const t = this.must(id);
    const allowed: Array<keyof Task> = ["title", "prompt", "cwd", "provider", "agent", "model", "permissionMode", "status", "owner", "order", "summary", "isolate", "allowGit"];
    for (const k of allowed) if (k in patch) (t as unknown as Record<string, unknown>)[k] = (patch as Record<string, unknown>)[k];
    if (patch.status && !STATUSES.includes(patch.status)) t.status = "todo";
    t.updatedAt = Date.now();
    // סשן שכבר רץ מקבל את ההיתר (או את החסימה) מיד
    const live = t.liveId ? this.hub.lives.get(t.liveId) : undefined;
    if (live) live.gitLock = !t.allowGit;
    await this.save();
    return t;
  }

  async remove(id: string): Promise<void> {
    const t = this.must(id);
    if (t.worktree) await removeWorktree(t.worktree).catch(() => undefined);
    if (t.liveId) {
      const live = this.hub.lives.get(t.liveId);
      live?.close();
      if (live) this.hub.lives.delete(live.liveId);
    }
    this.tasks = this.tasks.filter((x) => x.id !== id);
    await this.save();
  }

  /** פותח סשן חי עם הפרומפט של המשימה ועוקב אחריו עד התוצאה. */
  async run(id: string): Promise<Task> {
    const t = this.must(id);
    if (t.owner === "me") throw new Error(L("זו משימה שלך ולא של סוכן, אפשר לסגור אותה אבל לא להפעיל.", "This is your task, not an agent's. You can close it but not run it."));
    if (t.liveId && this.hub.lives.has(t.liveId)) return t;
    // סשן אחר כבר עובד בריפו הזה (במפקדה, בטרמינל או ב-VS Code): המשימה רצה בענף נפרד כדי לא לדרוס אותו
    if (!t.isolate && !t.worktree && !t.sessionId) {
      const busy = await activeInRepo(t.cwd).catch(() => ({ root: null, sessions: [] }));
      if (busy.sessions.length) t.isolate = true;
    }
    if (t.isolate && !t.worktree) {
      t.worktree = await createWorktree(t.cwd, t.id, slugify(t.title));
      await this.save();
    }
    const runCwd = t.worktree ? path.join(t.worktree.path, t.worktree.prefix) : t.cwd;
    const live = this.hub.open({
      cwd: runCwd,
      provider: t.provider,
      title: t.title,
      resume: t.sessionId ?? undefined,
      agent: t.agent,
      model: t.model,
      permissionMode: t.permissionMode,
      // הוראה בפרומפט ("אסור commit") לא עצרה סוכן (31/10), לכן החסימה בקוד, ורק המשתמש מתיר
      gitLock: !t.allowGit,
    });
    t.liveId = live.liveId;
    t.status = "running";
    t.lastError = null;
    t.updatedAt = Date.now();
    live.on("event", (e: LiveEvent) => void this.onLiveEvent(t.id, e));
    live.on("info", () => {
      const cur = this.get(t.id);
      if (!cur || cur.liveId !== live.liveId) return;
      if (live.state === "closed" || live.state === "error") {
        cur.liveId = null;
        if (cur.status === "running") cur.status = "review";
        cur.updatedAt = Date.now();
        void this.save();
      }
    });
    live.send(t.prompt);
    await this.save();
    return t;
  }

  /** ממזג את הענף של המשימה לענף הבסיס ומסמן אותה כהושלמה. */
  async merge(id: string): Promise<{ task: Task; hash: string }> {
    const t = this.must(id);
    if (!t.worktree) throw new Error(L("למשימה אין ענף נפרד", "This task has no separate branch"));
    const live = t.liveId ? this.hub.lives.get(t.liveId) : undefined;
    if (live && (live.state === "running" || live.state === "starting" || live.state === "waiting")) throw new Error(L("Claude עדיין עובד על המשימה. אפשר למזג כשהוא מסיים.", "Claude is still working on this task. You can merge when it's done."));
    if (live) {
      live.close();
      this.hub.lives.delete(live.liveId);
      t.liveId = null;
    }
    const hash = await mergeWorktree(t.worktree, t.title);
    t.worktree = null;
    t.status = "done";
    t.updatedAt = Date.now();
    await this.save();
    return { task: t, hash };
  }

  /** זורק את הענף של המשימה בלי למזג. */
  async discardBranch(id: string): Promise<Task> {
    const t = this.must(id);
    if (!t.worktree) throw new Error(L("למשימה אין ענף נפרד", "This task has no separate branch"));
    const live = t.liveId ? this.hub.lives.get(t.liveId) : undefined;
    if (live) {
      live.close();
      this.hub.lives.delete(live.liveId);
      t.liveId = null;
    }
    await removeWorktree(t.worktree);
    t.worktree = null;
    t.updatedAt = Date.now();
    await this.save();
    return t;
  }

  async branchStatus(id: string): Promise<{ changed: number; commits: number } | null> {
    const t = this.must(id);
    return t.worktree ? worktreeStatus(t.worktree) : null;
  }

  private async onLiveEvent(id: string, e: LiveEvent): Promise<void> {
    const t = this.get(id);
    if (!t) return;
    switch (e.kind) {
      case "init":
        t.sessionId = e.sessionId;
        break;
      case "result":
        t.costUsd = e.result.costUsd;
        t.summary = e.result.text.trim().slice(0, 400) || t.summary;
        if (e.result.isError) t.lastError = e.result.text.slice(0, 300);
        if (t.status === "running") t.status = "review";
        break;
      case "error":
        t.lastError = e.message;
        break;
      default:
        return;
    }
    t.updatedAt = Date.now();
    await this.save();
  }

  private must(id: string): Task {
    const t = this.get(id);
    if (!t) throw new Error(L(`אין משימה ${id}`, `No task ${id}`));
    return t;
  }

  private async save(): Promise<void> {
    if (!this.loaded) return;
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(FILE, JSON.stringify({ tasks: this.tasks, settings: this.settings }, null, 2));
    this.emit("change", this.list());
    void this.tick();
  }
}
