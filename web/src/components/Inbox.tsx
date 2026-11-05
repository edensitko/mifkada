import { useMemo } from "react";
import { ShieldAlert, CheckCheck, MessageSquare, AlertTriangle, Check, Inbox as InboxIcon } from "lucide-react";
import { useStore } from "../store";
import { api } from "../api";
import { send } from "../ws";
import { relTime, summarizeToolInput } from "../lib/util";
import { projectVisual } from "../lib/groups";
import Avatar from "./Avatar";
import PermissionCard from "./PermissionCard";
import type { PermissionRequest, LiveInfo } from "../../../shared/protocol";
import { strings, useT } from "../i18n";

const S = strings({
  he: {
    approvalFor: "אישור ל-",
    allow: "אשר",
    allowAlways: "אשר תמיד",
    deny: "דחה",
    kicker: "מה מחכה להחלטה שלך",
    title: "ממתין לך",
    allQuiet: "הכול שקט. האייג'נטים עובדים או ממתינים למשימה.",
    oneItem: "פריט אחד",
    nItems: "{n} פריטים",
    approvals: "אישורים",
    tasksReview: "משימות לבדיקה",
    finish: "סיים",
    open: "פתח",
    idle: "סיימו וממתינים לתשובה",
    errors: "שגיאות",
    emptyTitle: "אין כלום בתיבה",
    emptyHint: "כאן יופיעו בקשות אישור, משימות שמחכות לבדיקה, וסשנים שסיימו ומחכים לתשובה ממך.",
  },
  en: {
    approvalFor: "Approval for ",
    allow: "Allow",
    allowAlways: "Always allow",
    deny: "Deny",
    kicker: "What needs your decision",
    title: "Waiting for you",
    allQuiet: "All quiet. The agents are working or waiting for a task.",
    oneItem: "{n} item",
    nItems: "{n} items",
    approvals: "Approvals",
    tasksReview: "Tasks to review",
    finish: "Done",
    open: "Open",
    idle: "Finished and waiting for a reply",
    errors: "Errors",
    emptyTitle: "Nothing here",
    emptyHint: "Approval requests, tasks waiting for review and sessions that finished and need your reply will show up here.",
  },
});


/** "ממתין לך": כל מה שדורש מבט או החלטה שלך, במקום אחד. */
export default function Inbox() {
  const { lives, tasks, sessions, projectThemes, select, setToast } = useStore();
  const t = useT(S);
  const allCwds = useMemo(() => new Set(sessions.map((s) => s.cwd)), [sessions]);
  const approvals = lives.flatMap((l) => l.pending.map((p) => ({ live: l, req: p })));
  const review = tasks.filter((x) => x.status === "review");
  const idle = lives.filter((l) => l.state === "idle" && l.pendingPermissions === 0);
  const errors = lives.filter((l) => l.state === "error");
  const total = approvals.length + review.length + idle.length + errors.length;
  const act = (fn: () => Promise<unknown>) => () => fn().catch((e: Error) => setToast(e.message));

  const Approval = ({ live, req }: { live: LiveInfo; req: PermissionRequest }) => {
    const pv = projectVisual(live.cwd, allCwds, projectThemes);
    const answer = (behavior: "allow" | "deny", always = false, grant = false) => send({ t: "permission", liveId: live.liveId, requestId: req.requestId, behavior, always, grant });
    // פקודה שמשנה פרוד: אותו כרטיס כמו בצ'אט (פרטי הקומיט, "אשר פריסה לסשן הזה")
    if (req.prod)
      return (
        <div className="space-y-1">
          <button onClick={() => select({ kind: "live", liveId: live.liveId })} className="flex items-center gap-1 text-blue text-sm hover:underline">
            <Avatar emoji={pv.emoji} color={pv.color} image={pv.image} size="sm" square /> {live.title}
          </button>
          <PermissionCard req={req} onAnswer={answer} />
        </div>
      );
    return (
      <div className="card p-4 space-y-2 border-amber/40">
        <div className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-amber" />
          <span className="font-medium">
            {t("approvalFor")}<span className="mono">{req.toolName}</span>
          </span>
          <button onClick={() => select({ kind: "live", liveId: live.liveId })} className="ms-auto flex items-center gap-1 text-blue text-sm hover:underline">
            <Avatar emoji={pv.emoji} color={pv.color} image={pv.image} size="sm" square /> {live.title}
          </button>
        </div>
        {summarizeToolInput(req.toolName, req.input) && <pre className="ltr text-xs mono whitespace-pre-wrap bg-background rounded-lg p-2 max-h-32 overflow-auto">{summarizeToolInput(req.toolName, req.input)}</pre>}
        {req.reason && <div className="text-xs text-muted">{req.reason}</div>}
        <div className="flex gap-2">
          <button onClick={() => answer("allow")} className="btn-primary px-3 py-1.5 text-sm">
            {t("allow")}
          </button>
          {req.canAlways && (
            <button onClick={() => answer("allow", true)} className="btn-ghost px-3 py-1.5 text-sm">
              {t("allowAlways")}
            </button>
          )}
          <button onClick={() => answer("deny")} className="rounded-xl bg-danger/15 text-danger px-3 py-1.5 text-sm">
            {t("deny")}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="app-drag h-10" />
      <div className="max-w-4xl mx-auto px-8 pb-14 space-y-8">
        <header>
          <div className="mono-label">{t("kicker")}</div>
          <h1 className="large-title mt-1">{t("title")}</h1>
          <p className="text-sm text-muted mt-2">{total === 0 ? t("allQuiet") : t(total === 1 ? "oneItem" : "nItems", { n: total })}</p>
        </header>

        {approvals.length > 0 && (
          <section className="space-y-3">
            <h2 className="font-medium flex items-center gap-2">
              {t("approvals")} <span className="mono-label">{approvals.length}</span>
            </h2>
            {approvals.map(({ live, req }) => (
              <Approval key={req.requestId} live={live} req={req} />
            ))}
          </section>
        )}

        {review.length > 0 && (
          <section className="space-y-3">
            <h2 className="font-medium flex items-center gap-2">
              {t("tasksReview")} <span className="mono-label">{review.length}</span>
            </h2>
            {review.map((task) => {
              const pv = projectVisual(task.cwd, allCwds, projectThemes);
              return (
                <div key={task.id} className="card p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Avatar emoji={pv.emoji} color={pv.color} image={pv.image} size="sm" square />
                    <span dir="auto" className="font-medium truncate">{task.title}</span>
                    <span className="ms-auto tabular text-xs text-muted">{relTime(task.updatedAt)}</span>
                  </div>
                  {task.summary && <p dir="auto" className="text-sm text-muted line-clamp-3">{task.summary}</p>}
                  <div className="flex gap-2 items-center">
                    <button onClick={act(() => api.updateTask(task.id, { status: "done" }))} className="rounded-xl bg-teal/15 text-teal px-3 py-1.5 text-sm flex items-center gap-1">
                      <Check className="size-4" /> {t("finish")}
                    </button>
                    <button onClick={() => (task.liveId ? select({ kind: "live", liveId: task.liveId }) : task.sessionId && select({ kind: "history", sessionId: task.sessionId }))} className="btn-ghost px-3 py-1.5 text-sm flex items-center gap-1">
                      <MessageSquare className="size-4" /> {t("open")}
                    </button>
                    {task.costUsd > 0 && <span className="ms-auto tabular text-xs text-muted">${task.costUsd.toFixed(2)}</span>}
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {idle.length > 0 && (
          <section className="space-y-3">
            <h2 className="font-medium flex items-center gap-2">
              {t("idle")} <span className="mono-label">{idle.length}</span>
            </h2>
            <div className="card divide-y divide-border/60">
              {idle.map((l) => {
                const pv = projectVisual(l.cwd, allCwds, projectThemes);
                return (
                  <button key={l.liveId} onClick={() => select({ kind: "live", liveId: l.liveId })} className="w-full text-start px-4 py-2.5 flex items-center gap-3 hover:bg-surface-2/60 first:rounded-t-[18px] last:rounded-b-[18px]">
                    <Avatar emoji={pv.emoji} color={pv.color} image={pv.image} size="sm" square />
                    <span dir="auto" className="truncate flex-1 text-sm">{l.title}</span>
                    <CheckCheck className="size-4 text-teal" />
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {errors.length > 0 && (
          <section className="space-y-3">
            <h2 className="font-medium flex items-center gap-2">
              {t("errors")} <span className="mono-label">{errors.length}</span>
            </h2>
            <div className="card divide-y divide-border/60">
              {errors.map((l) => (
                <button key={l.liveId} onClick={() => select({ kind: "live", liveId: l.liveId })} className="w-full text-start px-4 py-2.5 flex items-center gap-3 hover:bg-surface-2/60">
                  <AlertTriangle className="size-4 text-danger" />
                  <span dir="auto" className="truncate flex-1 text-sm">{l.title}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {total === 0 && (
          <div className="card empty-state">
            <span className="empty-icon">
              <InboxIcon className="size-8" />
            </span>
            <h3>{t("emptyTitle")}</h3>
            <p className="text-sm max-w-sm">{t("emptyHint")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
