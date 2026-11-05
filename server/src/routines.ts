import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { DATA_DIR } from "./paths.js";
import { isQuiet } from "./settings.js";
import type { TaskStore } from "./tasks.js";
import type { PermissionMode, Routine, RoutineSchedule } from "../../shared/protocol.js";
import { L } from "./i18n.js";

const FILE = path.join(DATA_DIR, "routines.json");

/** מתי הרוטינה צריכה לרוץ בפעם הבאה, אחרי lastRun. */
export function nextRun(r: Routine, from = Date.now()): number {
  const s = r.schedule;
  if (s.kind === "interval") return (r.lastRun ?? r.createdAt) + Math.max(5, s.minutes) * 60000;
  const [hh, mm] = s.time.split(":").map((n) => Number(n) || 0);
  const days = s.days.length ? s.days : [0, 1, 2, 3, 4, 5, 6];
  const base = new Date(Math.max(from, r.lastRun ?? 0));
  for (let i = 0; i < 8; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    d.setHours(hh, mm, 0, 0);
    if (days.includes(d.getDay()) && d.getTime() > (r.lastRun ?? 0) && (i > 0 || d.getTime() >= base.getTime() - 60000)) return d.getTime();
  }
  return Number.MAX_SAFE_INTEGER;
}

/** רוטינות: משימה שנוצרת ומופעלת לבד לפי לוח זמנים (יומי בשעה, או כל X דקות). */
export class RoutineStore extends EventEmitter {
  private items: Routine[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly tasks: TaskStore) {
    super();
  }

  async load(): Promise<void> {
    try {
      this.items = (JSON.parse(await fs.readFile(FILE, "utf8")) as { routines?: Routine[] }).routines ?? [];
    } catch {
      this.items = [];
    }
    this.timer = setInterval(() => void this.tick(), 30000);
    void this.tick();
  }

  list(): Array<Routine & { next: number }> {
    return this.items.map((r) => ({ ...r, next: r.enabled ? nextRun(r) : 0 }));
  }

  async upsert(input: Partial<Routine> & { title: string; prompt: string; cwd: string; schedule: RoutineSchedule }): Promise<Routine> {
    const existing = input.id ? this.items.find((r) => r.id === input.id) : undefined;
    const r: Routine = {
      id: existing?.id ?? randomUUID(),
      title: input.title.trim().slice(0, 120),
      prompt: input.prompt.slice(0, 20000),
      cwd: input.cwd,
      ...(input.provider && input.provider !== "claude" ? { provider: input.provider } : {}),
      agent: input.agent ?? null,
      model: input.model ?? null,
      permissionMode: (input.permissionMode as PermissionMode) ?? "default",
      schedule: input.schedule,
      enabled: input.enabled ?? true,
      lastRun: existing?.lastRun ?? null,
      createdAt: existing?.createdAt ?? Date.now(),
    };
    this.items = existing ? this.items.map((x) => (x.id === r.id ? r : x)) : [...this.items, r];
    await this.save();
    return r;
  }

  async remove(id: string): Promise<void> {
    this.items = this.items.filter((r) => r.id !== id);
    await this.save();
  }

  /** הפעלה עכשיו, בלי קשר ללוח הזמנים. */
  async runNow(id: string): Promise<void> {
    const r = this.items.find((x) => x.id === id);
    if (!r) throw new Error(L("אין רוטינה כזו", "No such routine"));
    await this.fire(r);
  }

  private async fire(r: Routine): Promise<void> {
    r.lastRun = Date.now();
    await this.save();
    const stamp = new Date().toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
    const t = await this.tasks.create({ title: `${r.title} · ${stamp}`, prompt: r.prompt, cwd: r.cwd, provider: r.provider, agent: r.agent, model: r.model, permissionMode: r.permissionMode, routineId: r.id });
    await this.tasks.run(t.id);
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    // שעות שקטות: הרוטינות מחכות, ורצות כשהשקט נגמר
    if (isQuiet()) return;
    for (const r of this.items) {
      if (!r.enabled) continue;
      // רוטינה יומית שפוספסה בזמן שהמחשב ישן: רצה פעם אחת כשמתעוררים, לא מצטברת
      if (nextRun(r, r.lastRun ?? r.createdAt) <= now) {
        try {
          await this.fire(r);
        } catch (e) {
          console.error("routine failed", r.title, e);
        }
      }
    }
  }

  private async save(): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(FILE, JSON.stringify({ routines: this.items }, null, 2));
    this.emit("change", this.list());
  }
}
