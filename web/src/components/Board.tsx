import { useMemo, useState, type DragEvent } from "react";
import { Plus, Play, Pencil, Trash2, MessageSquare, Check, RotateCcw, ShieldAlert, GitBranch, GitMerge, Repeat, User } from "lucide-react";
import Routines from "./Routines";
import { useStore } from "../store";
import { api } from "../api";
import { cn, plainPreview, relTime } from "../lib/util";
import { projectVisual, rowAgent } from "../lib/groups";
import Avatar from "./Avatar";
import StatusDot, { liveStateLabel } from "./StatusDot";
import TaskForm from "./TaskForm";
import type { Task, TaskStatus } from "../../../shared/protocol";
import { strings, useT, tr } from "../i18n";
import { ask } from "../lib/dialog";

const S = strings({
  he: {
    todo: "בתור",
    todoHint: "משימות שעוד לא הופעלו",
    running: "בעבודה",
    runningHint: "Claude עובד עליהן עכשיו",
    review: "לבדיקה",
    reviewHint: "הסתיימו, מחכות למבט שלך",
    done: "הושלם",
    doneHint: "משימות שסגרת יגיעו לכאן",
    sessionClosed: "הסשן נסגר",
    awaiting: "ממתין לאישור",
    mineHint: "משימה שלך, לא של סוכן",
    mine: "שלי",
    branch: "ענף נפרד",
    finish: "סיים",
    run: "הפעל",
    open: "פתח",
    merged: "מוזג לענף {base} ({hash})",
    mergeHint: "קומיט למה שנשאר בענף ומיזוג לענף הבסיס",
    merge: "מזג",
    discardConfirm: "לזרוק את כל מה שנעשה בענף של המשימה?",
    discard: "זרוק",
    backToQueue: "חזרה לתור",
    edit: "עריכה",
    deleteConfirm: "למחוק את \"{title}\"?",
    delete: "מחיקה",
    newTask: "משימה חדשה",
    tasks: "משימות",
    task: "משימה",
    boardHint: "לוח משימות · גרור בין העמודות · \"בעבודה\" מפעיל",
    board: "קנבן",
    autoQueue: "תור אוטומטי",
    parallelHint: "כמה משימות במקביל",
    parallel: "{n} במקביל",
    cost: "עלות מוערכת",
  },
  en: {
    todo: "Queued",
    todoHint: "Tasks that haven't started yet",
    running: "Running",
    runningHint: "Claude is working on them now",
    review: "Review",
    reviewHint: "Finished, waiting for you to look",
    done: "Done",
    doneHint: "Tasks you close end up here",
    sessionClosed: "Session closed",
    awaiting: "Awaiting approval",
    mineHint: "Your task, not an agent's",
    mine: "Mine",
    branch: "Separate branch",
    finish: "Mark done",
    run: "Run",
    open: "Open",
    merged: "Merged into {base} ({hash})",
    mergeHint: "Commit what's left on the branch and merge into the base branch",
    merge: "Merge",
    discardConfirm: "Discard everything done on this task's branch?",
    discard: "Discard",
    backToQueue: "Back to the queue",
    edit: "Edit",
    deleteConfirm: "Delete \"{title}\"?",
    delete: "Delete",
    newTask: "New task",
    tasks: "Tasks",
    task: "Task",
    boardHint: "Task board · drag between columns · \"Running\" starts a task",
    board: "Board",
    autoQueue: "Auto queue",
    parallelHint: "How many tasks in parallel",
    parallel: "{n} in parallel",
    cost: "Estimated cost",
  },
});

// label ו-hint כ-getters: מתורגמים בכל קריאה
const COLUMNS: Array<{ status: TaskStatus; readonly label: string; readonly hint: string }> = [
  { status: "todo", get label() { return tr(S, "todo"); }, get hint() { return tr(S, "todoHint"); } },
  { status: "running", get label() { return tr(S, "running"); }, get hint() { return tr(S, "runningHint"); } },
  { status: "review", get label() { return tr(S, "review"); }, get hint() { return tr(S, "reviewHint"); } },
  { status: "done", get label() { return tr(S, "done"); }, get hint() { return tr(S, "doneHint"); } },
];

const pad2 = (n: number) => String(n);

function TaskCard({ task, onEdit }: { task: Task; onEdit: () => void }) {
  const { lives, sessions, agents, projectThemes, select, setToast } = useStore();
  const live = task.liveId ? lives.find((l) => l.liveId === task.liveId) : undefined;
  const allCwds = useMemo(() => new Set(sessions.map((s) => s.cwd)), [sessions]);
  const pv = projectVisual(task.cwd, allCwds, projectThemes);
  const agent = agents.find((a) => a.slug === task.agent) ?? null;
  const pending = live?.pendingPermissions ?? 0;
  const t = useT(S);

  const open = () => {
    if (live) select({ kind: "live", liveId: live.liveId });
    else if (task.sessionId) select({ kind: "history", sessionId: task.sessionId });
    else onEdit();
  };
  const act = (fn: () => Promise<unknown>) => () => fn().catch((e: Error) => setToast(e.message));

  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/task", task.id)}
      className={cn("card hud p-3 space-y-2 cursor-grab active:cursor-grabbing", task.status === "running" && "border-teal/40")}
      style={{ "--agent-color": agent?.color ?? pv.color } as React.CSSProperties}
    >
      <div className="flex items-start gap-2">
        <Avatar emoji={pv.emoji} color={pv.color} image={pv.image} size="sm" square className="mt-0.5" />
        <button onClick={open} className="text-start min-w-0 flex-1">
          <div dir="auto" className="text-sm font-medium leading-snug line-clamp-2">{task.title}</div>
          <div className="mono-label mt-0.5 truncate">{pv.name}</div>
        </button>
      </div>
      {task.status === "todo" && <p dir="auto" className="text-xs text-muted line-clamp-2">{task.prompt}</p>}
      {(task.status === "review" || task.status === "done") && task.summary && <p dir="auto" className="text-xs text-muted line-clamp-3">{plainPreview(task.summary)}</p>}
      {task.lastError && <p className="text-xs text-danger line-clamp-2">{task.lastError}</p>}
      <div className="flex items-center gap-2 text-[11px] flex-wrap">
        {task.status === "running" && (
          <>
            <StatusDot state={live?.state ?? "closed"} />
            <span>{live ? liveStateLabel(live.state) : t("sessionClosed")}</span>
          </>
        )}
        {pending > 0 && (
          <span className="rounded-full bg-amber/20 text-amber px-1.5 py-0.5 flex items-center gap-1">
            <ShieldAlert className="size-3" /> {t("awaiting")}
          </span>
        )}
        {task.owner === "me" && (
          <span className="rounded-full bg-blue/12 text-blue px-1.5 py-0.5 flex items-center gap-1" title={t("mineHint")}>
            <User className="size-3" /> {t("mine")}
          </span>
        )}
        {agent && (
          <span className="rounded-full px-1.5 py-0.5" style={{ background: `${agent.color}26`, color: agent.color }}>
            {agent.emoji} {agent.name}
          </span>
        )}
        {(task.worktree || task.isolate) && (
          <span className="rounded-full bg-blue/12 text-blue px-1.5 py-0.5 flex items-center gap-1" title={task.worktree?.path}>
            <GitBranch className="size-3" /> {task.worktree ? task.worktree.branch.replace("mifkada/", "") : t("branch")}
          </span>
        )}
        {task.allowGit && task.owner !== "me" && (
          <span className="rounded-full bg-amber/15 text-amber px-1.5 py-0.5" title="המשתמש התיר commit, merge ו-push במשימה הזו">
            מותר commit
          </span>
        )}
        {task.routineId && <Repeat className="size-3 text-muted" />}
        {task.costUsd > 0 && <span className="tabular text-muted">${task.costUsd.toFixed(2)}</span>}
        <span className="mono text-muted ms-auto">{relTime(task.updatedAt)}</span>
      </div>
      <div className="flex items-center gap-1 pt-1 border-t border-border/50">
        {task.status === "todo" && task.owner === "me" && (
          <button onClick={act(() => api.updateTask(task.id, { status: "done" }))} className="rounded-md px-2.5 py-1 text-xs flex items-center gap-1 bg-teal/15 text-teal hover:bg-teal/25">
            <Check className="size-3" /> {t("finish")}
          </button>
        )}
        {task.status === "todo" && task.owner !== "me" && (
          <button onClick={act(() => api.runTask(task.id).then((t) => t.liveId && select({ kind: "live", liveId: t.liveId })))} className="btn-primary rounded-md px-2.5 py-1 text-xs flex items-center gap-1">
            <Play className="size-3" /> {t("run")}
          </button>
        )}
        {task.status !== "todo" && (task.liveId || task.sessionId) && (
          <button onClick={open} className="btn-ghost rounded-md px-2.5 py-1 text-xs flex items-center gap-1">
            <MessageSquare className="size-3" /> {t("open")}
          </button>
        )}
        {task.status === "review" && task.worktree && (
          <>
            <button onClick={act(() => api.mergeTask(task.id).then((r) => setToast(t("merged", { base: task.worktree?.base ?? "", hash: r.hash }))))} className="rounded-md px-2.5 py-1 text-xs flex items-center gap-1 bg-teal/15 text-teal hover:bg-teal/25" title={t("mergeHint")}>
              <GitMerge className="size-3" /> {t("merge")}
            </button>
            <button onClick={act(async () => ((await ask(t("discardConfirm"), { danger: true })) ? api.discardBranch(task.id) : undefined))} className="rounded-md px-2 py-1 text-xs text-danger hover:bg-danger/10">
              {t("discard")}
            </button>
          </>
        )}
        {task.status === "review" && !task.worktree && (
          <button onClick={act(() => api.updateTask(task.id, { status: "done" }))} className="rounded-md px-2.5 py-1 text-xs flex items-center gap-1 bg-teal/15 text-teal hover:bg-teal/25">
            <Check className="size-3" /> {t("finish")}
          </button>
        )}
        {task.status === "done" && (
          <button onClick={act(() => api.updateTask(task.id, { status: "todo" }))} className="btn-ghost rounded-md px-2.5 py-1 text-xs flex items-center gap-1" title={t("backToQueue")}>
            <RotateCcw className="size-3" />
          </button>
        )}
        <span className="flex-1" />
        <button onClick={onEdit} className="p-1 rounded hover:bg-surface-2 text-muted" title={t("edit")}>
          <Pencil className="size-3.5" />
        </button>
        <button onClick={act(async () => ((await ask(t("deleteConfirm", { title: task.title }), { danger: true })) ? api.deleteTask(task.id) : undefined))} className="p-1 rounded hover:bg-danger/20 text-muted hover:text-danger" title={t("delete")}>
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

/** לוח קנבן. עם cwd מציג רק את משימות הפרויקט, בגרסה קומפקטית. */
export default function Board({ cwd, compact }: { cwd?: string; compact?: boolean }) {
  const { tasks, setToast, taskSettings } = useStore();
  const t = useT(S);
  const setSettings = (patch: Partial<typeof taskSettings>) => api.taskSettings(patch).catch((e: Error) => setToast(e.message));
  const [form, setForm] = useState<{ open: boolean; task?: Task }>({ open: false });
  const [over, setOver] = useState<TaskStatus | null>(null);
  const visible = useMemo(() => (cwd ? tasks.filter((t) => t.cwd === cwd) : tasks), [tasks, cwd]);
  const totalCost = visible.reduce((s, t) => s + t.costUsd, 0);

  const onDrop = async (status: TaskStatus, e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData("text/task");
    const t = tasks.find((x) => x.id === id);
    if (!t || t.status === status) return;
    try {
      if (status === "running") await api.runTask(id);
      else await api.updateTask(id, { status, order: Date.now() });
    } catch (err) {
      setToast((err as Error).message);
    }
  };

  const columns = (
    <div className={cn("grid grid-cols-4 gap-3", compact ? "min-h-40" : "flex-1 min-h-0")}>
      {COLUMNS.map((col) => {
        const items = visible.filter((t) => t.status === col.status);
        return (
          <section
            key={col.status}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(col.status);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => onDrop(col.status, e)}
            className={cn("kanban-col flex flex-col min-h-0 transition", over === col.status && "bg-blue/10 ring-2 ring-blue/40")}
          >
            <header className="px-3 py-2.5 flex items-center gap-2">
              <span className={cn("size-2 rounded-full", col.status === "todo" ? "bg-muted/60" : col.status === "running" ? "bg-blue" : col.status === "review" ? "bg-amber" : "bg-teal")} />
              <span className="text-sm font-medium">{col.label}</span>
              <span className="mono-label">{pad2(items.length)}</span>
              {col.status === "review" && items.length > 0 && <span className="lamp text-amber ms-auto" />}
              {col.status === "running" && items.length > 0 && <span className="lamp text-teal pulse ms-auto" />}
            </header>
            <div className={cn("p-2 space-y-2 overflow-y-auto", !compact && "flex-1")}>
              {items.map((t) => (
                <TaskCard key={t.id} task={t} onEdit={() => setForm({ open: true, task: t })} />
              ))}
              {items.length === 0 && (
                <div className="empty-col">
                  <span>{col.hint}</span>
                  {col.status === "todo" && (
                    <button onClick={() => setForm({ open: true })} className="text-blue text-xs hover:underline">
                      + {t("newTask")}
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );

  if (compact) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-medium">{t("tasks")}</h2>
          <span className="mono-label">{pad2(visible.length)}</span>
          <button onClick={() => setForm({ open: true })} className="ms-auto btn-ghost rounded-lg px-3 py-1.5 text-sm flex items-center gap-1.5">
            <Plus className="size-4" /> {t("task")}
          </button>
        </div>
        {form.open && <TaskForm initial={form.task} cwd={cwd} onClose={() => setForm({ open: false })} />}
        {columns}
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="app-drag h-10 shrink-0" />
      <div className="px-8 pb-6 flex-1 min-h-0 flex flex-col gap-4">
        <header className="flex items-end justify-between gap-4">
          <div>
            <div className="mono-label">{t("boardHint")}</div>
            <h1 className="large-title mt-1">{t("board")}</h1>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <button
                role="switch"
                aria-checked={taskSettings.autoRun}
                onClick={() => setSettings({ autoRun: !taskSettings.autoRun })}
                className={cn("relative h-7 w-12 rounded-full transition", taskSettings.autoRun ? "bg-teal" : "bg-surface-2")}
              >
                <span className={cn("absolute top-0.5 size-6 rounded-full bg-white shadow transition-all", taskSettings.autoRun ? "start-[calc(100%-1.625rem)]" : "start-0.5")} />
              </button>
              <span>{t("autoQueue")}</span>
              <select value={taskSettings.maxParallel} onChange={(e) => setSettings({ maxParallel: Number(e.target.value) })} className="px-2 py-1 text-sm" title={t("parallelHint")}>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {t("parallel", { n })}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-baseline gap-2">
              <span className="tabular font-semibold text-xl">{pad2(visible.filter((t) => t.status === "running").length)}</span>
              <span className="mono-label">{t("running")}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="tabular font-semibold text-xl">${totalCost.toFixed(2)}</span>
              <span className="mono-label">{t("cost")}</span>
            </div>
            <button onClick={() => setForm({ open: true, task: undefined })} className="btn-primary rounded-xl px-4 py-2.5 flex items-center gap-2">
              <Plus className="size-4" /> {t("newTask")}
            </button>
          </div>
        </header>
        {form.open && <TaskForm initial={form.task} onClose={() => setForm({ open: false })} />}
        {columns}
        <Routines />
      </div>
    </div>
  );
}

export { rowAgent };
