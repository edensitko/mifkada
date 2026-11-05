import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Square, Inbox as InboxIcon, Radio, ClipboardList } from "lucide-react";
import { useStore } from "../store";
import { send } from "../ws";
import { relTime } from "../lib/util";
import { projectVisual } from "../lib/groups";
import { MessageView, MarkdownText, ToolRun, groupRuns } from "./Blocks";
import PermissionCard from "./PermissionCard";
import Composer from "./Composer";
import StatusDot, { liveStateLabel } from "./StatusDot";
import Avatar from "./Avatar";
import Toast from "./Toast";
import type { LiveInfo, SessionRow, TranscriptMessage } from "../../../shared/protocol";
import { api } from "../api";
import { holdLive, openSession } from "../ws";
import { refreshSessions } from "../App";
import { strings, useT, isRTL } from "../i18n";

const S = strings({
  he: {
    runningIn: "רץ ב{where}",
    inVscode: "-VS Code",
    inTerminal: "טרמינל",
    appName: "מפקדה",
    oneAwaiting: "אחד ממתין לאישור",
    nAwaiting: "{n} ממתינים לאישור",
    working: "עובדים בשבילך",
    allQuiet: "הכול שקט",
    readyForReview: "מוכן לבדיקה",
    reviewOnDesktop: "את הבדיקה והמיזוג עושים מהמחשב",
    nothingWaiting: "אין כרגע שום דבר שמחכה לך",
    nothingHint: "בקשות אישור וסשנים שסיימו יופיעו כאן",
    workingNow: "עובדים עכשיו",
    recent: "אחרונים",
    runningNow: "רצה עכשיו",
    queued: "בתור",
    noOpenTasks: "אין משימות פתוחות",
    tabWait: "ממתין לך",
    tabSessions: "סשנים",
    tabTasks: "משימות",
    back: "חזרה",
    stop: "עצור",
    runningTool: "מריץ {tool}...",
    queuedMsg: "ההודעה תיכנס לתור",
    writeClaude: "כתוב ל-Claude",
    histRunning: "רץ עכשיו במחשב. הודעה תפתח עותק שלו במפקדה",
    histDone: "היסטוריה. הודעה תמשיך אותה",
    loading: "טוען...",
    continueChat: "המשך את השיחה",
  },
  en: {
    runningIn: "Running in {where}",
    inVscode: "VS Code",
    inTerminal: "the terminal",
    appName: "Mifkada",
    oneAwaiting: "{n} waiting for approval",
    nAwaiting: "{n} waiting for approval",
    working: "Working for you",
    allQuiet: "All quiet",
    readyForReview: "Ready for review",
    reviewOnDesktop: "Review and merge from your computer",
    nothingWaiting: "Nothing is waiting for you right now",
    nothingHint: "Approval requests and finished sessions will show up here",
    workingNow: "Working now",
    recent: "Recent",
    runningNow: "Running now",
    queued: "Queued",
    noOpenTasks: "No open tasks",
    tabWait: "Waiting for you",
    tabSessions: "Sessions",
    tabTasks: "Tasks",
    back: "Back",
    stop: "Stop",
    runningTool: "Running {tool}...",
    queuedMsg: "The message will be queued",
    writeClaude: "Message Claude",
    histRunning: "Running on your computer now. A message will open a copy of it in Mifkada",
    histDone: "History. A message will continue it",
    loading: "Loading...",
    continueChat: "Continue the conversation",
  },
});


/**
 * מסך הטלפון: מה שבאמת עושים מהטלפון.
 * אישורים, מעקב אחרי סשנים חיים, הודעה קצרה ועצירה. בלי טרמינל, קבצים או הגדרות
 * (גם השרת חוסם אותם בגישה מרחוק).
 */
export default function Mobile() {
  const { lives, tasks, sessions, projectThemes } = useStore();
  const t = useT(S);
  const [open, setOpen] = useState<string | null>(null);
  const [hist, setHist] = useState<SessionRow | null>(null);
  const [tab, setTab] = useState<"wait" | "live" | "tasks">("wait");
  const allCwds = useMemo(() => new Set(sessions.map((s) => s.cwd)), [sessions]);
  const approvals = lives.flatMap((l) => l.pending.map((p) => ({ live: l, req: p })));
  const review = tasks.filter((x) => x.status === "review");
  const running = tasks.filter((x) => x.status === "running" || x.status === "todo");

  const current = lives.find((l) => l.liveId === open);
  if (open && current) return <MobileChat live={current} onBack={() => setOpen(null)} />;
  if (hist)
    return (
      <MobileHistory
        row={hist}
        onBack={() => setHist(null)}
        onLive={(id) => {
          setHist(null);
          setOpen(id);
        }}
      />
    );
  const liveIds = new Set(lives.map((l) => l.sessionId));
  const recent = sessions.filter((r) => !liveIds.has(r.sessionId)).slice(0, 30);
  const HistRow = ({ r }: { r: SessionRow }) => {
    const pv = projectVisual(r.cwd, allCwds, projectThemes);
    return (
      <button onClick={() => setHist(r)} className="w-full px-1 py-2.5 flex items-center gap-3 text-start border-b border-border/40 last:border-0">
        <Avatar emoji={pv.emoji} color={pv.color} image={pv.image} size="sm" square />
        <div className="flex-1 min-w-0">
          <div dir="auto" className="truncate text-[15px]">
            {r.title}
          </div>
          <div className="text-xs text-muted">
            {pv.name}
            {r.external ? ` · ${t("runningIn", { where: t(r.external.entrypoint.includes("vscode") ? "inVscode" : "inTerminal") })}` : ""} · {relTime(r.lastModified)}
          </div>
        </div>
        {r.external && <StatusDot external={r.external.status} />}
      </button>
    );
  };

  const LiveRow = ({ l }: { l: LiveInfo }) => {
    const pv = projectVisual(l.cwd, allCwds, projectThemes);
    return (
      <button onClick={() => setOpen(l.liveId)} className="card w-full p-3 flex items-center gap-3 text-start active:scale-[0.99] transition">
        <Avatar emoji={pv.emoji} color={pv.color} image={pv.image} size="md" square />
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{l.title}</div>
          <div className="text-xs text-muted flex items-center gap-1.5">
            <StatusDot state={l.state} /> {liveStateLabel(l.state)} · {pv.name} · {relTime(l.startedAt)}
          </div>
        </div>
        {l.pendingPermissions > 0 && <span className="rounded-full bg-amber text-black text-xs font-semibold px-2 py-0.5">{l.pendingPermissions}</span>}
        <ChevronRight className={`size-4 text-muted ${isRTL() ? "rotate-180" : ""}`} />
      </button>
    );
  };

  return (
    <div className="h-full flex flex-col" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <header className="px-4 pt-4 pb-2">
        <div className="mono-label">{t("appName")}</div>
        <h1 className="large-title !text-[30px]">{approvals.length ? t(approvals.length === 1 ? "oneAwaiting" : "nAwaiting", { n: approvals.length }) : lives.some((l) => l.state === "running") ? t("working") : t("allQuiet")}</h1>
      </header>
      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-3">
        {tab === "wait" && (
          <>
            {approvals.map(({ live, req }) => (
              <div key={req.requestId} className="space-y-1">
                <button onClick={() => setOpen(live.liveId)} className="text-xs text-blue">
                  {live.title}
                </button>
                <PermissionCard req={req} onAnswer={(behavior, always, grant) => send({ t: "permission", liveId: live.liveId, requestId: req.requestId, behavior, always, grant })} />
              </div>
            ))}
            {lives
              .filter((l) => l.state === "idle" && l.pendingPermissions === 0)
              .map((l) => (
                <LiveRow key={l.liveId} l={l} />
              ))}
            {review.map((task) => (
              <div key={task.id} className="card p-3">
                <div className="text-xs text-teal">{t("readyForReview")}</div>
                <div className="font-medium">{task.title}</div>
                <div className="text-xs text-muted">{t("reviewOnDesktop")}</div>
              </div>
            ))}
            {!approvals.length && !review.length && !lives.some((l) => l.state === "idle") && (
              <>
                <div className="empty-state !py-10">
                  <span className="empty-icon">
                    <InboxIcon className="size-8" />
                  </span>
                  <h3>{t("nothingWaiting")}</h3>
                  <p className="text-sm">{t("nothingHint")}</p>
                </div>
                {lives.length > 0 && (
                  <>
                    <div className="mono-label px-1">{t("workingNow")}</div>
                    {lives.map((l) => (
                      <LiveRow key={l.liveId} l={l} />
                    ))}
                  </>
                )}
              </>
            )}
          </>
        )}
        {tab === "live" && (
          <>
            {lives.map((l) => (
              <LiveRow key={l.liveId} l={l} />
            ))}
            {recent.length > 0 && (
              <>
                <div className="mono-label pt-2">{t("recent")}</div>
                <div className="card px-3">
                  {recent.map((r) => (
                    <HistRow key={r.sessionId} r={r} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
        {tab === "tasks" &&
          (running.length ? (
            running.map((task) => (
              <div key={task.id} className="card p-3">
                <div className="text-xs text-muted">{task.status === "running" ? t("runningNow") : t("queued")}</div>
                <div className="font-medium">{task.title}</div>
              </div>
            ))
          ) : (
            <div className="empty-state"><span className="empty-icon"><ClipboardList className="size-8" /></span><h3>{t("noOpenTasks")}</h3></div>
          ))}
      </div>
      <nav className="border-t border-[var(--color-separator)] glass grid grid-cols-3" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {(
          [
            ["wait", t("tabWait"), InboxIcon, approvals.length + review.length],
            ["live", t("tabSessions"), Radio, lives.length],
            ["tasks", t("tabTasks"), ClipboardList, running.length],
          ] as const
        ).map(([id, label, Icon, n]) => (
          <button key={id} onClick={() => setTab(id)} className={`py-2.5 flex flex-col items-center gap-0.5 text-xs ${tab === id ? "text-blue" : "text-muted"}`}>
            <span className="relative">
              <Icon className="size-5" />
              {n > 0 && <span className="absolute -top-1.5 -end-2.5 rounded-full bg-blue text-white text-[10px] px-1 tabular">{n}</span>}
            </span>
            {label}
          </button>
        ))}
      </nav>
      <Toast />
    </div>
  );
}

function MobileChat({ live, onBack }: { live: LiveInfo; onBack: () => void }) {
  const transcript = useStore((s) => s.transcripts[live.liveId]);
  const { sessions, projectThemes } = useStore();
  const allCwds = useMemo(() => new Set(sessions.map((s) => s.cwd)), [sessions]);
  const pv = projectVisual(live.cwd, allCwds, projectThemes);
  useEffect(() => holdLive(live.liveId), [live.liveId]);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript?.messages.length, transcript?.partialText, transcript?.pending.length]);
  const busy = live.state === "running" || live.state === "starting" || live.state === "waiting";
  const t = useT(S);

  return (
    <div className="h-full flex flex-col" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <header className="flex items-center gap-2 px-3 py-2 border-b">
        <button onClick={onBack} className="p-1.5 -ms-1 text-blue" aria-label={t("back")}>
          <ChevronRight className={`size-6 ${isRTL() ? "" : "rotate-180"}`} />
        </button>
        <Avatar emoji={pv.emoji} color={pv.color} image={pv.image} size="sm" square />
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate text-sm">{live.title}</div>
          <div className="text-xs text-muted">{liveStateLabel(live.state)}</div>
        </div>
        {busy && (
          <button onClick={() => send({ t: "interrupt", liveId: live.liveId })} className="rounded-full bg-danger/15 text-danger p-2" aria-label={t("stop")}>
            <Square className="size-4 fill-current" />
          </button>
        )}
      </header>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {groupRuns(transcript?.messages.slice(-80) ?? []).map((item, k, items) =>
          item.run ? <ToolRun key={item.run[0].uuid} msgs={item.run} active={busy && k === items.length - 1} /> : <MessageView key={item.m.uuid} m={item.m} continued={item.continued} />,
        )}
        {transcript?.partialText && (
          <div className="text-[15px]">
            <MarkdownText text={transcript.partialText} />
          </div>
        )}
        {transcript?.toolRunning && <div className="text-xs text-muted">{t("runningTool", { tool: transcript.toolRunning })}</div>}
        {live.pending.map((p) => (
          <PermissionCard key={p.requestId} req={p} onAnswer={(behavior, always, grant) => send({ t: "permission", liveId: live.liveId, requestId: p.requestId, behavior, always, grant })} />
        ))}
      </div>
      <div className="px-2 pt-1" style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}>
        <Composer cwd={live.cwd} disabled={live.state === "closed" || live.state === "error"} placeholder={busy ? t("queuedMsg") : t("writeClaude")} onSend={(text, attachments) => send({ t: "send", liveId: live.liveId, text, attachments })} />
      </div>
    </div>
  );
}

/** שיחה שלא פתוחה במפקדה (היסטוריה, או רצה בטרמינל/VS Code): קריאה, והודעה ממשיכה אותה כאן */
function MobileHistory({ row, onBack, onLive }: { row: SessionRow; onBack: () => void; onLive: (liveId: string) => void }) {
  const [messages, setMessages] = useState<TranscriptMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    api
      .transcript(row.sessionId)
      .then(setMessages)
      .catch((e: Error) => setError(e.message));
  }, [row.sessionId]);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);
  const running = Boolean(row.external);
  const t = useT(S);
  return (
    <div className="h-full flex flex-col" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <header className="flex items-center gap-2 px-3 py-2 border-b">
        <button onClick={onBack} className="p-1.5 -ms-1 text-blue" aria-label={t("back")}>
          <ChevronRight className={`size-6 ${isRTL() ? "" : "rotate-180"}`} />
        </button>
        <div className="flex-1 min-w-0">
          <div dir="auto" className="font-medium truncate text-sm">
            {row.title}
          </div>
          <div className="text-xs text-muted">{running ? t("histRunning") : t("histDone")}</div>
        </div>
      </header>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {!messages && !error && <div className="text-center text-muted py-10">{t("loading")}</div>}
        {error && <div className="text-danger text-sm">{error}</div>}
        {groupRuns(messages?.slice(-80) ?? []).map((item) => (item.run ? <ToolRun key={item.run[0].uuid} msgs={item.run} /> : <MessageView key={item.m.uuid} m={item.m} continued={item.continued} />))}
      </div>
      <div className="px-2 pt-1" style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}>
        <Composer
          cwd={row.cwd}
          placeholder={t("continueChat")}
          onSend={async (text, attachments) => {
            const id = await openSession({ cwd: row.cwd, provider: row.provider, resume: row.sessionId, fork: running && !row.external!.entrypoint.includes("sdk"), agent: row.tag ?? null, permissionMode: "default", text, attachments });
            refreshSessions();
            onLive(id);
          }}
        />
      </div>
    </div>
  );
}
