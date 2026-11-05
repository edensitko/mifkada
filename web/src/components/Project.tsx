import { useEffect, useMemo, useState } from "react";
import { Plus, Code2, Folder, TerminalSquare, GitBranch, GitCommitHorizontal, Palette, RefreshCw, ListFilter } from "lucide-react";
import { useStore } from "../store";
import { api } from "../api";
import { refreshThemes } from "../App";
import { cn, relTime } from "../lib/util";
import { projectVisual, rowAgent } from "../lib/groups";
import Avatar from "./Avatar";
import StatusDot, { liveStateLabel } from "./StatusDot";
import Board from "./Board";
import { ThemeEditor } from "./AgentPicker";
import type { GitInfo } from "../../../shared/protocol";
import { strings, useT, isRTL } from "../i18n";

const S = strings({
  he: {
    project: "פרויקט",
    terminal: "טרמינל",
    theme: "עיצוב הפרויקט",
    themeOf: "עיצוב הפרויקט {name}",
    newSession: "סשן חדש",
    changedFiles: "קבצים שהשתנו",
    refresh: "רענון",
    checkingGit: "בודק git",
    notRepo: "התיקייה אינה ריפו של git",
    sessions: "סשנים",
    active: "פעילים",
    openTasks: "משימות פתוחות",
    showInSidebar: "הצג בסיידבר",
    less: "פחות",
    more: "עוד {n}",
    noSessions: "אין עדיין סשנים בפרויקט הזה",
  },
  en: {
    project: "Project",
    terminal: "Terminal",
    theme: "Project appearance",
    themeOf: "Appearance of {name}",
    newSession: "New session",
    changedFiles: "changed files",
    refresh: "Refresh",
    checkingGit: "Checking git",
    notRepo: "This folder is not a git repository",
    sessions: "Sessions",
    active: "Active",
    openTasks: "Open tasks",
    showInSidebar: "Show in sidebar",
    less: "Less",
    more: "{n} more",
    noSessions: "No sessions in this project yet",
  },
});


const pad2 = (n: number) => String(n);

/** עמוד פרויקט: פעולות, מצב git, המשימות והסשנים שלו. */
export default function Project({ cwd }: { cwd: string }) {
  const { sessions, agents, projectThemes, select, setToast, setFocusProject } = useStore();
  const t = useT(S);
  const allCwds = useMemo(() => new Set(sessions.map((s) => s.cwd)), [sessions]);
  const vis = projectVisual(cwd, allCwds, projectThemes);
  const rows = useMemo(() => sessions.filter((s) => (s.projectCwd || s.cwd) === cwd).sort((a, b) => (b.live ? 1 : 0) - (a.live ? 1 : 0) || (b.external ? 1 : 0) - (a.external ? 1 : 0) || b.lastModified - a.lastModified), [sessions, cwd]);
  const active = rows.filter((r) => r.live || r.external).length;
  const [git, setGit] = useState<GitInfo | null>(null);
  const [themeOpen, setThemeOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const loadGit = () => api.git(cwd).then(setGit).catch(() => setGit(null));
  useEffect(() => {
    loadGit();
    const id = setInterval(() => !document.hidden && loadGit(), 15000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);

  const openIn = (app: "vscode" | "finder" | "terminal") => api.openIn(cwd, app).catch((e: Error) => setToast(e.message));
  const list = showAll ? rows : rows.slice(0, 8);

  return (
    <div className="flex-1 overflow-y-auto" style={{ "--agent-color": vis.color } as React.CSSProperties}>
      <div className="app-drag h-10" />
      <div className="max-w-6xl mx-auto px-8 pb-14 space-y-8">
        <header className="flex items-center gap-5">
          <Avatar emoji={vis.emoji} color={vis.color} image={vis.image} size="xl" square />
          <div className="min-w-0 flex-1">
            <div className="mono-label">{t("project")}</div>
            <h1 className="large-title mt-1 truncate">{vis.name}</h1>
            <div className={cn("mono text-xs text-muted mt-2 ltr truncate", isRTL() ? "text-right" : "text-left")} title={cwd}>
              {cwd.replace(/^\/Users\/[^/]+/, "~")}
            </div>
          </div>
          <div className="flex items-center gap-2 relative">
            <button onClick={() => openIn("vscode")} className="btn-ghost rounded-lg px-3 py-2 text-sm flex items-center gap-1.5">
              <Code2 className="size-4" /> VS Code
            </button>
            <button onClick={() => openIn("finder")} className="btn-ghost rounded-lg px-3 py-2 text-sm flex items-center gap-1.5">
              <Folder className="size-4" /> Finder
            </button>
            <button onClick={() => openIn("terminal")} className="btn-ghost rounded-lg px-3 py-2 text-sm flex items-center gap-1.5">
              <TerminalSquare className="size-4" /> {t("terminal")}
            </button>
            <button onClick={() => setThemeOpen((o) => !o)} className="btn-ghost size-9 rounded-lg grid place-items-center" title={t("theme")}>
              <Palette className="size-4" style={{ color: vis.color }} />
            </button>
            {themeOpen && (
              <ThemeEditor
                title={t("themeOf", { name: vis.name })}
                initial={{ color: vis.color, emoji: vis.emoji, name: vis.name, image: vis.image }}
                onSave={async (theme) => {
                  await api.setTheme("projects", cwd, theme);
                  refreshThemes();
                }}
                onClose={() => setThemeOpen(false)}
              />
            )}
            <button onClick={() => select({ kind: "new", cwd })} className="btn-primary rounded-xl px-4 py-2 flex items-center gap-2">
              <Plus className="size-4" /> {t("newSession")}
            </button>
          </div>
        </header>

        <section className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3">
          <div className="card hud p-4 flex items-center gap-6 min-w-0 overflow-hidden">
            {git?.isRepo ? (
              <>
                <div className="flex items-center gap-2">
                  <GitBranch className="size-4 text-muted" />
                  <span className="mono text-sm">{git.branch}</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className={cn("tabular font-semibold text-2xl leading-none", git.changed ? "text-amber" : "")}>{pad2(git.changed)}</span>
                  <span className="text-xs text-muted">{t("changedFiles")}</span>
                </div>
                {(git.ahead > 0 || git.behind > 0) && (
                  <div className="tabular text-xs text-muted">
                    ↑{git.ahead} ↓{git.behind}
                  </div>
                )}
                {git.lastCommit && (
                  <div className="min-w-0 flex-1 flex items-center gap-2 text-xs text-muted">
                    <GitCommitHorizontal className="size-4 shrink-0" />
                    <span dir="auto" className="truncate">{git.lastCommit.subject}</span>
                    <span className="mono shrink-0">{relTime(git.lastCommit.time)}</span>
                  </div>
                )}
                <button onClick={loadGit} className="p-1.5 rounded-lg hover:bg-surface-2 text-muted ms-auto" title={t("refresh")}>
                  <RefreshCw className="size-3.5" />
                </button>
              </>
            ) : (
              <span className="text-sm text-muted">{git === null ? t("checkingGit") : t("notRepo")}</span>
            )}
          </div>
          <div className={cn("card hud grid grid-cols-3 divide-x divide-border/70", isRTL() && "divide-x-reverse")}>
            <div className="px-4 py-3">
              <div className="tabular font-semibold text-2xl leading-none">{pad2(rows.length)}</div>
              <div className="mono-label mt-1">{t("sessions")}</div>
            </div>
            <div className="px-4 py-3">
              <div className={cn("tabular font-semibold text-2xl leading-none", active > 0 && "text-teal")}>{pad2(active)}</div>
              <div className="mono-label mt-1">{t("active")}</div>
            </div>
            <div className="px-4 py-3">
              <div className="tabular font-semibold text-2xl leading-none">{pad2(useStore.getState().tasks.filter((x) => x.cwd === cwd && x.status !== "done").length)}</div>
              <div className="mono-label mt-1">{t("openTasks")}</div>
            </div>
          </div>
        </section>

        <Board cwd={cwd} compact />

        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-medium">{t("sessions")}</h2>
            <span className="mono-label">{pad2(rows.length)}</span>
            <button onClick={() => setFocusProject(cwd)} className="ms-auto btn-ghost rounded-lg px-3 py-1.5 text-sm flex items-center gap-1.5">
              <ListFilter className="size-4" /> {t("showInSidebar")}
            </button>
          </div>
          <div className="card divide-y divide-border/50">
            {list.map((r) => {
              const a = agents.find((x) => x.slug === rowAgent(r));
              return (
                <button key={r.live?.liveId ?? r.sessionId} onClick={() => select(r.live ? { kind: "live", liveId: r.live.liveId } : { kind: "history", sessionId: r.sessionId })} className="w-full text-start px-4 py-2.5 flex items-center gap-3 hover:bg-surface-2/60 transition first:rounded-t-2xl last:rounded-b-2xl">
                  <StatusDot state={r.live?.state} external={r.external?.status} />
                  <span dir="auto" className="truncate text-sm flex-1">{r.title}</span>
                  {a && (
                    <span className="rounded-full px-1.5 text-[11px]" style={{ background: `${a.color}26`, color: a.color }}>
                      {a.emoji} {a.name}
                    </span>
                  )}
                  <span className="mono-label">{r.live ? liveStateLabel(r.live.state) : r.external ? (r.external.entrypoint.includes("vscode") ? "VS Code" : t("terminal")) : ""}</span>
                  <span className="tabular text-xs text-muted">{relTime(r.lastModified)}</span>
                </button>
              );
            })}
            {rows.length > 8 && (
              <button onClick={() => setShowAll((v) => !v)} className="w-full py-2 mono-label hover:text-foreground">
                {showAll ? t("less") : t("more", { n: rows.length - 8 })}
              </button>
            )}
            {rows.length === 0 && <div className="px-4 py-6 text-sm text-muted">{t("noSessions")}</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
