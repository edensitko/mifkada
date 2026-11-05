import { useEffect, useMemo, useState } from "react";
import { api, type Digest, type UsageReport } from "../api";
import { RefreshCw, Sun, Activity, ShieldAlert, ClipboardCheck, KanbanSquare, Bot, Search, GitBranch } from "lucide-react";
import SpeakButton from "./SpeakButton";
import { Plus, ArrowUpLeft } from "lucide-react";
import { useStore } from "../store";
import { relTime, dateLocale } from "../lib/util";
import { strings, useT, tr, isRTL } from "../i18n";
import { groupByProject, projectVisual, type Group } from "../lib/groups";
import Avatar from "./Avatar";
import StatusDot from "./StatusDot";
import { Spinner } from "./Spinner";

const S = strings({
  he: {
    night: "לילה טוב",
    morning: "בוקר טוב",
    afternoon: "צהריים טובים",
    evening: "ערב טוב",
    limitSession: "חלון של 5 שעות",
    limitWeekAll: "השבוע, כל המודלים",
    limitWeek: "השבוע, {model}",
    oneSession: "סשן אחד",
    nSessions: "{n} סשנים",
    nActive: "{n} פעילים",
    newInProject: "סשן חדש בפרויקט",
    waitingApproval: "מחכה לאישור שלך ({n})",
    finishedAway: "סיים בזמן שלא היית כאן",
    yourTask: "משימה שלך",
    taskReview: "משימה שסיימה, מחכה לבדיקה",
    nothingWaiting: "אין שום דבר שמחכה לך.",
    oneWaiting: "דבר אחד מחכה לך",
    nWaiting: "{n} דברים מחכים לך",
    newSession: "סשן חדש",
    waitingForYou: "מחכה לך",
    sinceYesterday: "מאז אתמול",
    readAloud: "הקרא",
    rewrite: "כתוב מחדש",
    writeNow: "כתוב תקציר עכשיו",
    noDigest: "אין תקציר עדיין",
    continueTitle: "להמשיך מאיפה שעצרת",
    qNew: "סשן חדש",
    qNewHint: "שיחה עם Claude בפרויקט",
    qTask: "משימה חדשה",
    qTaskHint: "לתור, בענף נפרד",
    qAgents: "אייג'נטים",
    qAgentsHint: "מי עובד בשבילך",
    qSearch: "חיפוש בכול",
    qSearchHint: "סשנים, פרויקטים, פעולות",
    digestOffShort: "אין תקציר יומי (עוזרי רקע כבויים).",
    projects: "הפרויקטים",
    less: "פחות",
    showAll: "הצג הכול",
    plan: "המנוי: {line}",
    claudeMemory: "זיכרון של Claude {gb}GB",
    cost: "שווי מוערך לפי מחירון ה-API (לא חיוב): היום ${today}, 30 ימים ${month}",
  },
  en: {
    night: "Good night",
    morning: "Good morning",
    afternoon: "Good afternoon",
    evening: "Good evening",
    limitSession: "5-hour window",
    limitWeekAll: "This week, all models",
    limitWeek: "This week, {model}",
    oneSession: "{n} session",
    nSessions: "{n} sessions",
    nActive: "{n} active",
    newInProject: "New session in this project",
    waitingApproval: "Waiting for your approval ({n})",
    finishedAway: "Finished while you were away",
    yourTask: "Your task",
    taskReview: "Task finished, waiting for review",
    nothingWaiting: "Nothing is waiting for you.",
    oneWaiting: "{n} thing is waiting for you",
    nWaiting: "{n} things are waiting for you",
    newSession: "New session",
    waitingForYou: "Waiting for you",
    sinceYesterday: "Since yesterday",
    readAloud: "Read aloud",
    rewrite: "Rewrite",
    writeNow: "Write a digest now",
    noDigest: "No digest yet",
    continueTitle: "Continue where you left off",
    qNew: "New session",
    qNewHint: "Talk to Claude in a project",
    qTask: "New task",
    qTaskHint: "Queue it, on its own branch",
    qAgents: "Agents",
    qAgentsHint: "Who works for you",
    qSearch: "Search everything",
    qSearchHint: "Sessions, projects, actions",
    digestOffShort: "No daily digest (background helpers are off).",
    projects: "Projects",
    less: "Less",
    showAll: "Show all",
    plan: "Subscription: {line}",
    claudeMemory: "Claude memory {gb}GB",
    cost: "Estimated value at API prices (not billed): today ${today}, 30 days ${month}",
  },
});

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return tr(S, "night");
  if (h < 12) return tr(S, "morning");
  if (h < 17) return tr(S, "afternoon");
  if (h < 21) return tr(S, "evening");
  return tr(S, "night");
}

const limitLabel = (l: string) => {
  if (l === "Current session") return tr(S, "limitSession");
  if (l === "Current week (all models)") return tr(S, "limitWeekAll");
  const m = /^Current week \((.+)\)$/.exec(l);
  return m ? tr(S, "limitWeek", { model: m[1] }) : l;
};

function SectionTitle({ title, count, children }: { title: string; count?: number; children?: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 px-1 w-full">
      <h2 className="text-[20px] font-bold tracking-tight">{title}</h2>
      {count !== undefined && <span className="text-muted text-[15px] tabular">{count}</span>}
      {children}
    </div>
  );
}


function ProjectCard({ g }: { g: Group }) {
  const { select } = useStore.getState();
  const t = useT(S);
  const last = g.rows[0];
  // שורה אחת: אווטאר, שם, כמה סשנים ומתי. לחיצה פותחת את הפרויקט, + פותח בו סשן חדש
  return (
    <div className="group/p flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-[var(--color-fill)] transition">
      <button onClick={() => select({ kind: "project", cwd: g.cwd ?? "" })} className="flex items-center gap-3 flex-1 min-w-0 text-start">
        <Avatar emoji={g.visual.emoji} color={g.visual.color} image={g.visual.image} size="md" square />
        <span className="min-w-0 flex-1">
          <span className="block font-medium truncate">{g.visual.name}</span>
          <span className="block text-[12px] text-muted truncate">
            {t(g.rows.length === 1 ? "oneSession" : "nSessions", { n: g.rows.length })}{g.active ? ` · ${t("nActive", { n: g.active })}` : ""}{last ? ` · ${relTime(last.lastModified)}` : ""}
          </span>
        </span>
      </button>
      <button onClick={() => select({ kind: "new", cwd: g.cwd })} className="size-7 rounded-lg grid place-items-center text-muted opacity-0 group-hover/p:opacity-100 hover:bg-surface hover:text-foreground transition" title={t("newInProject")}>
        <Plus className="size-4" />
      </button>
    </div>
  );
}

export default function Dashboard() {
  const { sessions, agents, projectThemes, select, tasks } = useStore();
  const t = useT(S);
  const [digestData, setDigest] = useState<Digest | null>(null);
  const [digestBusy, setDigestBusy] = useState(false);
  const [usage, setUsage] = useState<UsageReport | null>(null);
  const [allProjects, setAllProjects] = useState(false);
  const [res, setRes] = useState<{ mifkada: { count: number; mb: number }; other: { count: number; mb: number }; daemonMB: number; totalGB: number } | null>(null);
  const [plan, setPlan] = useState<Array<{ label: string; percent: number; resets: string | null }> | null>(null);
  const loadDigest = (force = false, attempt = 0) => {
    setDigestBusy(true);
    api
      .digest(force)
      .then((d) => {
        setDigest(d);
        // השרת החזיר תקציר ישן ומחדש ברקע: בודקים שוב עד 3 פעמים
        if (d.stale && attempt < 3) setTimeout(() => loadDigest(false, attempt + 1), 15000);
      })
      .catch(() => undefined)
      .finally(() => setDigestBusy(false));
  };
  useEffect(() => {
    loadDigest();
    api.usage(30).then(setUsage).catch(() => undefined);
    api.planUsage().then(setPlan).catch(() => setPlan([]));
    const loadRes = () => api.resources().then(setRes).catch(() => undefined);
    void loadRes();
    const rid = setInterval(() => !document.hidden && void loadRes(), 15000);
    return () => clearInterval(rid);
  }, []);
  const projects = useMemo(() => groupByProject(sessions, projectThemes, agents, false).filter((g) => g.cwd && g.cwd !== "?" && !g.hidden), [sessions, projectThemes, agents]);
  const allCwds = useMemo(() => projects.map((p) => p.cwd ?? ""), [projects]);
  // להמשיך מאיפה שעצרת: קודם מה שחי עכשיו, אחר כך האחרונים
  const recent = useMemo(
    () => [...sessions].sort((a, b) => (b.live || b.external ? 1 : 0) - (a.live || a.external ? 1 : 0) || b.lastModified - a.lastModified).slice(0, 6),
    [sessions],
  );
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const date = new Date().toLocaleDateString(dateLocale(), { weekday: "long", day: "numeric", month: "long" });

  // מה מחכה לך: אישורים, משימות לבדיקה, וסשנים שסיימו כשלא היית מולם. זה מה שהלוח שואל קודם כול
  const lives = useStore((s) => s.lives);
  const unread = useStore((s) => s.unread);
  const inbox = useMemo(() => {
    const out: Array<{ key: string; icon: typeof Sun; color: string; title: string; sub: string; open: () => void }> = [];
    for (const l of lives) {
      if (l.pendingPermissions > 0)
        out.push({ key: `p:${l.liveId}`, icon: ShieldAlert, color: "#ff9f0a", title: l.title, sub: tr(S, "waitingApproval", { n: l.pendingPermissions }), open: () => select({ kind: "live", liveId: l.liveId }) });
      else if (unread[l.liveId]) out.push({ key: `u:${l.liveId}`, icon: Activity, color: "#0a84ff", title: l.title, sub: tr(S, "finishedAway"), open: () => select({ kind: "live", liveId: l.liveId }) });
    }
    for (const task of tasks.filter((x) => x.status === "review"))
      out.push({ key: `t:${task.id}`, icon: ClipboardCheck, color: "#bf5af2", title: task.title, sub: tr(S, task.owner === "me" ? "yourTask" : "taskReview"), open: () => select({ kind: "board" }) });
    return out;
  }, [lives, unread, tasks, select]);
  const name = useStore((s) => s.system?.displayName ?? "");
  const aiHelpers = useStore((s) => Boolean(s.system?.aiHelpers));
  const planLine = (plan ?? []).map((l) => `${limitLabel(l.label)} ${l.percent}%`).join(" · ");

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="app-drag h-10" />
      <div className="max-w-4xl mx-auto px-8 pb-14 space-y-10">
        <header className="flex items-end justify-between gap-6">
          <div className="space-y-1">
            <div className="text-[13px] text-muted">{date}</div>
            <h1 className="large-title">{greeting()}{name ? `, ${name}` : ""}</h1>
            <p className="text-muted text-sm">{inbox.length === 0 ? t("nothingWaiting") : t(inbox.length === 1 ? "oneWaiting" : "nWaiting", { n: inbox.length })}</p>
          </div>
        </header>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {(
            [
              [Plus, t("qNew"), t("qNewHint"), "⌘N", () => select({ kind: "new" }), true],
              [KanbanSquare, t("qTask"), t("qTaskHint"), "⌘2", () => select({ kind: "board" }), false],
              [Bot, t("qAgents"), t("qAgentsHint"), "⌘3", () => select({ kind: "agents" }), false],
              [Search, t("qSearch"), t("qSearchHint"), "⌘K", () => useStore.getState().setPalette(true), false],
            ] as const
          ).map(([Icon, label, hint, key, run, primary]) => (
            <button key={label} onClick={run} className="card text-start p-3.5 flex flex-col gap-2 hover:-translate-y-px hover:shadow-md transition group/q">
              <span className="flex items-center justify-between">
                <span className={`size-8 rounded-[9px] grid place-items-center ${primary ? "bg-blue text-white" : "bg-[var(--color-fill)] text-foreground"}`}>
                  <Icon className="size-4" />
                </span>
                <kbd className="ltr text-[11px] text-muted font-sans">{key}</kbd>
              </span>
              <span>
                <span className="block text-[14px] font-semibold">{label}</span>
                <span className="block text-[12px] text-muted">{hint}</span>
              </span>
            </button>
          ))}
        </div>

        {inbox.length > 0 && (
          <section className="space-y-2">
            <SectionTitle title={t("waitingForYou")} count={inbox.length} />
            <div className="divide-y divide-[var(--color-separator)]">
              {inbox.map((it) => (
                <button key={it.key} onClick={it.open} className="w-full text-start flex items-center gap-3 py-2.5 px-1 rounded-lg hover:bg-[var(--color-fill)] transition">
                  <it.icon className="size-4 shrink-0" style={{ color: it.color }} />
                  <span className="flex-1 min-w-0">
                    <span dir="auto" className="block truncate text-[14px]">{it.title}</span>
                    <span className="block text-[12px] text-muted">{it.sub}</span>
                  </span>
                  <ArrowUpLeft className={`size-4 text-muted shrink-0 ${isRTL() ? "" : "-scale-x-100"}`} />
                </button>
              ))}
            </div>
          </section>
        )}

        {(aiHelpers ? !digestData?.disabled : Boolean(digestData && !digestData.disabled)) && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <SectionTitle title={t("sinceYesterday")} />
            {digestData && <span className="text-[11px] text-muted whitespace-nowrap">{relTime(digestData.createdAt)}</span>}
            <span className="flex-1" />
            {digestData && <SpeakButton text={() => `${greeting()}${name ? `, ${name}` : ""}. ${t("sinceYesterday")}: ${digestData.bullets.join(". ")}`} label={t("readAloud")} />}
            <button onClick={() => loadDigest(true)} disabled={digestBusy} className="size-7 rounded-lg grid place-items-center hover:bg-[var(--color-fill)] text-muted disabled:opacity-50" title={t("rewrite")}>
              {digestBusy ? <Spinner className="size-4" /> : <RefreshCw className="size-4" />}
            </button>
          </div>
          {digestData ? (
            <ul className="text-[14px] leading-relaxed space-y-1.5 list-disc ps-5 marker:text-muted">
              {digestData.bullets.map((b, i) => (
                <li key={i} dir="auto">
                  {b}
                </li>
              ))}
            </ul>
          ) : digestBusy ? (
            <div className="space-y-2">
              <div className="skeleton h-4 w-11/12" />
              <div className="skeleton h-4 w-9/12" />
            </div>
          ) : (
            <div className="text-sm text-muted">{t("noDigest")}</div>
          )}
        </section>
        )}

        {recent.length > 0 && (
          <section className="space-y-2">
            <SectionTitle title={t("continueTitle")} />
            <div className="card divide-y divide-[var(--color-separator)] overflow-hidden">
              {recent.map((r) => {
                const pv = projectVisual(r.projectCwd || r.cwd, allCwds, projectThemes);
                const ag = r.tag ? agents.find((a) => a.slug === r.tag) : undefined;
                return (
                  <button key={r.live?.liveId ?? r.sessionId} onClick={() => select(r.live ? { kind: "live", liveId: r.live.liveId } : { kind: "history", sessionId: r.sessionId })} className="w-full text-start flex items-center gap-3 py-2.5 px-3.5 hover:bg-[var(--color-fill)] transition min-w-0">
                    <Avatar emoji={pv.emoji} color={pv.color} image={pv.image} size="sm" square />
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-2 min-w-0">
                        {(r.live || r.external) && <StatusDot state={r.live?.state} external={r.external?.status} />}
                        <span dir="auto" className="truncate text-[14px] font-medium">{r.title}</span>
                      </span>
                      <span className="flex items-center gap-2 text-[12px] text-muted min-w-0">
                        <span className="truncate">{pv.name}</span>
                        {ag && <span className="truncate" style={{ color: ag.color }}>{ag.emoji} {ag.name}</span>}
                        {r.gitBranch && (
                          <span className="ltr flex items-center gap-0.5 truncate">
                            <GitBranch className="size-3" />
                            {r.gitBranch}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="text-[12px] text-muted shrink-0">{relTime(r.lastModified)}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <section className="space-y-3">
          <SectionTitle title={t("projects")} count={projects.length}>
            {projects.length > 6 && (
              <button onClick={() => setAllProjects((v) => !v)} className="ms-auto text-blue text-[14px]">
                {allProjects ? t("less") : t("showAll")}
              </button>
            )}
          </SectionTitle>
          <div className="grid grid-cols-3 gap-x-4 gap-y-1">
            {(allProjects ? projects : projects.slice(0, 6)).map((g) => (
              <ProjectCard key={g.key} g={g} />
            ))}
          </div>
        </section>

        {!aiHelpers && digestData?.disabled && (
          <p className="text-[12px] text-muted px-1">
            {t("digestOffShort")}{" "}
            <button onClick={() => loadDigest(true)} className="text-blue hover:underline">
              {t("writeNow")}
            </button>
          </p>
        )}
        {(planLine || res || usage) && (
          <p className="text-[12px] text-muted px-1 leading-relaxed">
            {planLine && t("plan", { line: planLine })}
            {res && `${planLine ? " · " : ""}${t("claudeMemory", { gb: ((res.mifkada.mb + res.other.mb + res.daemonMB) / 1024).toFixed(1) })}`}
            {usage && ` · ${t("cost", { today: usage.today.toFixed(1), month: usage.month.toFixed(0) })}`}
          </p>
        )}
      </div>
    </div>
  );
}
