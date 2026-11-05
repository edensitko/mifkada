import { useMemo, useState, type FormEvent } from "react";
import { Repeat, Plus, Play, Trash2, Pencil, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useStore } from "../store";
import { api } from "../api";
import { basename, cn, dateLocale, MODE_OPTIONS } from "../lib/util";
import { strings, useT, tr, pick } from "../i18n";
import { AgentSelect } from "./AgentPicker";
import type { PermissionMode, Routine, RoutineSchedule } from "../../../shared/protocol";
import { ask } from "../lib/dialog";

const S = strings({
  he: {
    everyHours: "כל {n} שעות",
    everyMinutes: "כל {n} דקות",
    everyDay: "כל יום",
    weekdays: "א-ה",
    atTime: "{days} ב-{time}",
    today: "היום {time}",
    titlePlaceholder: "שם, למשל: בדיקת שרת בוקר",
    promptPlaceholder: "מה Claude יעשה בכל הרצה",
    daily: "יומי",
    interval: "כל X זמן",
    modeHint: "רוטינה רצה בלי שאתה מול המסך, לכן ברירת המחדל היא תכנון (קריאה בלבד)",
    cancel: "ביטול",
    save: "שמור",
    routines: "רוטינות",
    hint: "כל הרצה יוצרת משימה בקנבן. רצות כשמפקדה פתוחה (גם ברקע).",
    routine: "רוטינה",
    next: "הבא: {when}",
    off: "כבוי",
    last: "אחרון: {when}",
    runNow: "הרץ עכשיו",
    edit: "עריכה",
    deleteConfirm: 'למחוק את "{title}"?',
    delete: "מחיקה",
  },
  en: {
    everyHours: "Every {n} hours",
    everyMinutes: "Every {n} minutes",
    everyDay: "Every day",
    weekdays: "Sun-Thu",
    atTime: "{days} at {time}",
    today: "Today {time}",
    titlePlaceholder: "Name, for example: Morning server check",
    promptPlaceholder: "What Claude does on each run",
    daily: "Daily",
    interval: "Every X time",
    modeHint: "A routine runs while you're away from the screen, so the default is plan mode (read only)",
    cancel: "Cancel",
    save: "Save",
    routines: "Routines",
    hint: "Each run creates a task on the Board. Routines run while Mifkada is open (also in the background).",
    routine: "Routine",
    next: "Next: {when}",
    off: "Off",
    last: "Last: {when}",
    runNow: "Run now",
    edit: "Edit",
    deleteConfirm: 'Delete "{title}"?',
    delete: "Delete",
  },
});

const dayLetters = () => pick(["א", "ב", "ג", "ד", "ה", "ו", "ש"], ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]);

const every = (m: number) => (m % 60 === 0 ? tr(S, "everyHours", { n: m / 60 }) : tr(S, "everyMinutes", { n: m }));

function describe(s: RoutineSchedule): string {
  if (s.kind === "interval") return every(s.minutes);
  const DAYS = dayLetters();
  const ds = s.days.length === 7 ? tr(S, "everyDay") : s.days.length === 5 && [0, 1, 2, 3, 4].every((d) => s.days.includes(d)) ? tr(S, "weekdays") : s.days.map((d) => DAYS[d]).join(",");
  return tr(S, "atTime", { days: ds, time: s.time });
}

function when(ms: number): string {
  if (!ms || ms >= Number.MAX_SAFE_INTEGER) return "-";
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  const t = d.toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit" });
  return sameDay ? tr(S, "today", { time: t }) : `${d.toLocaleDateString(dateLocale(), { weekday: "short" })} ${t}`;
}

function Form({ initial, onClose }: { initial?: Routine; onClose: () => void }) {
  const sessions = useStore((s) => s.sessions);
  const setToast = useStore((s) => s.setToast);
  const t = useT(S);
  const DAYS = dayLetters();
  const projects = useMemo(() => [...new Set(sessions.map((s) => s.cwd).filter(Boolean))], [sessions]);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [cwd, setCwd] = useState(initial?.cwd ?? projects[0] ?? "");
  const [agent, setAgent] = useState<string | null>(initial?.agent ?? null);
  const [mode, setMode] = useState<PermissionMode>(initial?.permissionMode ?? "plan");
  const [kind, setKind] = useState<"daily" | "interval">(initial?.schedule.kind ?? "daily");
  const [time, setTime] = useState(initial?.schedule.kind === "daily" ? initial.schedule.time : "09:00");
  const [days, setDays] = useState<number[]>(initial?.schedule.kind === "daily" ? initial.schedule.days : [0, 1, 2, 3, 4]);
  const [minutes, setMinutes] = useState(initial?.schedule.kind === "interval" ? initial.schedule.minutes : 60);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.saveRoutine({ id: initial?.id, title, prompt, cwd, agent, permissionMode: mode, enabled: initial?.enabled ?? true, schedule: kind === "daily" ? { kind, time, days } : { kind, minutes } });
      onClose();
    } catch (err) {
      setToast((err as Error).message);
    }
  };

  return (
    <form onSubmit={submit} className="card p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("titlePlaceholder")} className="rounded-lg bg-background border px-3 py-1.5 text-sm outline-none focus:border-blue/60" />
        <input list="routine-projects" value={cwd} onChange={(e) => setCwd(e.target.value)} className="ltr rounded-lg bg-background border px-3 py-1.5 mono text-xs outline-none focus:border-blue/60" />
        <datalist id="routine-projects">
          {projects.map((p) => (
            <option key={p} value={p}>
              {basename(p)}
            </option>
          ))}
        </datalist>
      </div>
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} placeholder={t("promptPlaceholder")} className="w-full rounded-lg bg-background border px-3 py-2 text-sm outline-none focus:border-blue/60" />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="segmented grid grid-cols-2 text-xs w-36">
          <button type="button" data-active={kind === "daily"} onClick={() => setKind("daily")} className="py-1">
            {t("daily")}
          </button>
          <button type="button" data-active={kind === "interval"} onClick={() => setKind("interval")} className="py-1">
            {t("interval")}
          </button>
        </div>
        {kind === "daily" ? (
          <>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="rounded-lg bg-background border px-2 py-1 text-sm" />
            <div className="flex gap-1">
              {DAYS.map((d, i) => (
                <button type="button" key={i} onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort())} className={cn("size-7 rounded-full text-xs", days.includes(i) ? "bg-blue text-white" : "bg-surface-2 text-muted")}>
                  {d}
                </button>
              ))}
            </div>
          </>
        ) : (
          <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="px-2 py-1 text-sm">
            {[15, 30, 60, 120, 240, 480].map((m) => (
              <option key={m} value={m}>
                {every(m)}
              </option>
            ))}
          </select>
        )}
        <AgentSelect value={agent} onChange={setAgent} />
        <select value={mode} onChange={(e) => setMode(e.target.value as PermissionMode)} className="px-2 py-1 text-sm" title={t("modeHint")}>
          {MODE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onClose} className="btn-ghost px-3 py-1.5 text-sm">
          {t("cancel")}
        </button>
        <button type="submit" disabled={!prompt.trim() || !cwd.trim()} className="btn-primary px-4 py-1.5 text-sm disabled:opacity-40">
          {t("save")}
        </button>
      </div>
    </form>
  );
}

/** רוטינות: משימות שנוצרות ורצות לבד לפי לוח זמנים. */
export default function Routines() {
  const { routines, setToast } = useStore();
  const [open, setOpen] = useState(true);
  const [form, setForm] = useState<{ open: boolean; r?: Routine }>({ open: false });
  const t = useT(S);
  const act = (fn: () => Promise<unknown>) => () => fn().catch((e: Error) => setToast(e.message));

  return (
    <section className="shrink-0 space-y-2">
      <div className="flex items-center gap-2">
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 font-medium">
          {open ? <ChevronDown className="size-4 text-muted" /> : pick(<ChevronLeft className="size-4 text-muted" />, <ChevronRight className="size-4 text-muted" />)}
          <Repeat className="size-4 text-blue" /> {t("routines")}
          <span className="text-[11px] text-muted tabular">{routines.length}</span>
        </button>
        <span className="text-[11px] text-muted">{t("hint")}</span>
        <button onClick={() => setForm({ open: true })} className="ms-auto btn-ghost px-3 py-1 text-sm flex items-center gap-1">
          <Plus className="size-4" /> {t("routine")}
        </button>
      </div>
      {open && (
        <>
          {form.open && <Form key={form.r?.id ?? "new"} initial={form.r} onClose={() => setForm({ open: false })} />}
          {routines.length > 0 && (
            <div className="card divide-y divide-border/60">
              {routines.map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <button
                    role="switch"
                    aria-checked={r.enabled}
                    onClick={act(() => api.saveRoutine({ ...r, enabled: !r.enabled }))}
                    className={cn("relative h-5 w-9 rounded-full transition shrink-0", r.enabled ? "bg-teal" : "bg-surface-2")}
                  >
                    <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", r.enabled ? "start-[calc(100%-1.125rem)]" : "start-0.5")} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div dir="auto" className="truncate font-medium">{r.title}</div>
                    <div className="text-[11px] text-muted truncate">
                      {basename(r.cwd)} · {describe(r.schedule)}
                    </div>
                  </div>
                  <div className="text-[11px] text-muted text-end shrink-0">
                    <div>{t("next", { when: r.enabled ? when(r.next) : t("off") })}</div>
                    <div>{t("last", { when: r.lastRun ? when(r.lastRun) : "-" })}</div>
                  </div>
                  <button onClick={act(() => api.runRoutine(r.id))} className="p-1.5 rounded-lg hover:bg-surface-2 text-blue" title={t("runNow")}>
                    <Play className="size-4" />
                  </button>
                  <button onClick={() => setForm({ open: true, r })} className="p-1.5 rounded-lg hover:bg-surface-2 text-muted" title={t("edit")}>
                    <Pencil className="size-4" />
                  </button>
                  <button onClick={act(async () => ((await ask(t("deleteConfirm", { title: r.title }), { danger: true })) ? api.deleteRoutine(r.id) : undefined))} className="p-1.5 rounded-lg hover:bg-danger/15 text-muted hover:text-danger" title={t("delete")}>
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
