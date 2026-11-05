import { useCallback, useEffect, useState } from "react";
import { GitBranch, RefreshCw, CircleCheck, CircleX, CircleDashed, GitPullRequest, ArrowUp, ArrowDown, CloudOff, ExternalLink, FolderOpen, Code2 } from "lucide-react";
import { useStore } from "../store";
import { cn, relTime } from "../lib/util";
import { strings, useT, tr } from "../i18n";
import { Spinner, Spin } from "./Spinner";

const S = strings({
  he: {
    ciRunning: "רץ",
    ciFailed: "נכשל",
    ciPassed: "עבר",
    kicker: "git ו-GitHub",
    title: "מאגרים",
    refresh: "רענון",
    failing: "CI או PR נכשל",
    dirty: "עם שינויים לא שמורים",
    unpushed: "עם קומיטים שלא נדחפו",
    noRemote: "בלי גיבוי ב-GitHub",
    noFirstCommit: "אין קומיט ראשון",
    noRemoteBadge: "אין remote",
    projectPage: "עמוד הפרויקט",
    openVscode: "פתח ב-VS Code",
    changed: "{n} שונו",
    untracked: "{n} חדשים",
    clean: "נקי",
    toPush: "{n} לדחוף",
    toPull: "{n} למשוך",
    noUpstream: "הענף לא במעקב",
    root: "(שורש)",
  },
  en: {
    ciRunning: "running",
    ciFailed: "failed",
    ciPassed: "passed",
    kicker: "git and GitHub",
    title: "Repositories",
    refresh: "Refresh",
    failing: "CI or PR failing",
    dirty: "With uncommitted changes",
    unpushed: "With unpushed commits",
    noRemote: "Not backed up on GitHub",
    noFirstCommit: "No first commit",
    noRemoteBadge: "No remote",
    projectPage: "Project page",
    openVscode: "Open in VS Code",
    changed: "{n} changed",
    untracked: "{n} new",
    clean: "Clean",
    toPush: "{n} to push",
    toPull: "{n} to pull",
    noUpstream: "Branch not tracked",
    root: "(root)",
  },
});


interface RepoStatus {
  root: string;
  name: string;
  branch: string | null;
  remote: string | null;
  github: string | null;
  changed: number;
  untracked: number;
  ahead: number;
  behind: number;
  noUpstream: boolean;
  lastCommit: { subject: string; time: number } | null;
  byFolder: Array<{ folder: string; changed: number }>;
  prs: Array<{ number: number; title: string; url: string; checks: "pass" | "fail" | "pending" | "none" }> | null;
  lastRun: { name: string; status: string; conclusion: string | null; url: string; time: number } | null;
  error?: string;
}

const open = (url: string) => window.open(url, "_blank");

function RunBadge({ run }: { run: NonNullable<RepoStatus["lastRun"]> }) {
  const ok = run.conclusion === "success";
  const fail = run.conclusion === "failure" || run.conclusion === "cancelled" || run.conclusion === "timed_out";
  const pending = run.status !== "completed";
  return (
    <button onClick={() => open(run.url)} className={cn("flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]", fail ? "bg-danger/12 text-danger" : ok ? "bg-teal/12 text-teal" : "bg-surface-2 text-muted")} title={`${run.name} · ${relTime(run.time)}`}>
      {pending ? <Spin on><CircleDashed className="size-3" /></Spin> : fail ? <CircleX className="size-3" /> : <CircleCheck className="size-3" />}
      CI {pending ? tr(S, "ciRunning") : fail ? tr(S, "ciFailed") : ok ? tr(S, "ciPassed") : run.conclusion}
    </button>
  );
}

/** מאגרים: מצב git ו-GitHub של כל הפרויקטים, מה שדורש תשומת לב קודם. */
export default function Repos() {
  const { select, setToast } = useStore();
  const t = useT(S);
  const [repos, setRepos] = useState<RepoStatus[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (force = false) => {
      setBusy(true);
      try {
        const local = (await (await fetch(`/api/repos${force ? "?force=1" : ""}`)).json()) as RepoStatus[];
        setRepos((cur) => cur ?? local);
        setRepos((await (await fetch(`/api/repos?github=1${force ? "&force=1" : ""}`)).json()) as RepoStatus[]);
      } catch (e) {
        setToast((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [setToast],
  );

  useEffect(() => {
    void load();
    const id = setInterval(() => !document.hidden && void load(), 60000);
    return () => clearInterval(id);
  }, [load]);

  const openIn = (cwd: string, app: "vscode" | "finder" | "terminal") => fetch("/api/projects/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd, app }) });

  const dirty = repos?.filter((r) => r.changed + r.untracked > 0).length ?? 0;
  const unpushed = repos?.filter((r) => r.ahead > 0).length ?? 0;
  const failing = repos?.filter((r) => r.lastRun?.conclusion === "failure" || r.prs?.some((p) => p.checks === "fail")).length ?? 0;
  const noRemote = repos?.filter((r) => !r.remote).length ?? 0;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="app-drag h-10" />
      <div className="max-w-6xl mx-auto px-8 pb-14 space-y-6">
        <header className="flex items-end gap-4">
          <div>
            <div className="mono-label">{t("kicker")}</div>
            <h1 className="large-title mt-1">{t("title")}</h1>
          </div>
          <button onClick={() => load(true)} disabled={busy} className="ms-auto btn-ghost px-3 py-2 text-sm flex items-center gap-1.5 disabled:opacity-60">
            {busy ? <Spinner className="size-4" /> : <RefreshCw className="size-4" />} {t("refresh")}
          </button>
        </header>

        <section className="grid grid-cols-4 gap-3">
          {[
            { n: failing, label: t("failing"), tone: "text-danger" },
            { n: dirty, label: t("dirty"), tone: "text-amber" },
            { n: unpushed, label: t("unpushed"), tone: "text-blue" },
            { n: noRemote, label: t("noRemote"), tone: "text-muted" },
          ].map((x) => (
            <div key={x.label} className="card px-4 py-3.5">
              {repos ? <div className={cn("tabular text-[28px] font-semibold leading-none", x.n > 0 && x.tone)}>{x.n}</div> : <div className="skeleton h-7 w-10" />}
              <div className="text-[13px] text-muted mt-1.5">{x.label}</div>
            </div>
          ))}
        </section>

        {!repos && (
          <div className="grid grid-cols-2 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="card p-4 space-y-3">
                <div className="skeleton h-5 w-1/2" />
                <div className="skeleton h-4 w-3/4" />
                <div className="skeleton h-16 w-full" />
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          {repos?.map((r) => {
            const total = r.changed + r.untracked;
            const max = Math.max(1, ...r.byFolder.map((f) => f.changed));
            return (
              <div key={r.root} className="card p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[15px] truncate">{r.name}</span>
                      {r.lastRun && <RunBadge run={r.lastRun} />}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted mt-0.5">
                      <GitBranch className="size-3" />
                      <span className="ltr truncate">{r.branch === "HEAD" && !r.lastCommit ? t("noFirstCommit") : r.branch}</span>
                      {r.github ? (
                        <button onClick={() => open(`https://github.com/${r.github}`)} className="ltr hover:text-blue flex items-center gap-0.5 truncate">
                          · {r.github} <ExternalLink className="size-3" />
                        </button>
                      ) : r.remote ? (
                        <span className="ltr truncate">· {r.remote}</span>
                      ) : (
                        <span className="flex items-center gap-1 text-amber">
                          · <CloudOff className="size-3" /> {t("noRemoteBadge")}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => select({ kind: "project", cwd: r.root })} className="tool-btn" title={t("projectPage")}>
                      <FolderOpen className="size-4" />
                    </button>
                    <button onClick={() => openIn(r.root, "vscode")} className="tool-btn" title={t("openVscode")}>
                      <Code2 className="size-4" />
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {total > 0 ? (
                    <span className="rounded-full bg-amber/12 text-amber px-2 py-0.5">
                      {r.changed > 0 && t("changed", { n: r.changed })}
                      {r.changed > 0 && r.untracked > 0 && " · "}
                      {r.untracked > 0 && t("untracked", { n: r.untracked })}
                    </span>
                  ) : (
                    <span className="rounded-full bg-teal/12 text-teal px-2 py-0.5">{t("clean")}</span>
                  )}
                  {r.ahead > 0 && (
                    <span className="rounded-full bg-blue/12 text-blue px-2 py-0.5 flex items-center gap-0.5">
                      <ArrowUp className="size-3" /> {t("toPush", { n: r.ahead })}
                    </span>
                  )}
                  {r.behind > 0 && (
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 flex items-center gap-0.5">
                      <ArrowDown className="size-3" /> {t("toPull", { n: r.behind })}
                    </span>
                  )}
                  {r.remote && r.noUpstream && <span className="rounded-full bg-surface-2 text-muted px-2 py-0.5">{t("noUpstream")}</span>}
                  {r.prs && r.prs.length > 0 && (
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 flex items-center gap-1">
                      <GitPullRequest className="size-3" /> {r.prs.length} PR
                    </span>
                  )}
                  {r.lastCommit && <span className="text-muted ms-auto truncate max-w-[50%]" title={r.lastCommit.subject}>{relTime(r.lastCommit.time)} · {r.lastCommit.subject}</span>}
                </div>

                {r.byFolder.length > 1 && total > 0 && (
                  <div className="space-y-1">
                    {r.byFolder.slice(0, 5).map((f) => (
                      <div key={f.folder} className="flex items-center gap-2 text-xs">
                        <span className="w-28 truncate ltr text-left">{f.folder === "." ? t("root") : f.folder}</span>
                        <div className="flex-1 h-1.5 rounded-full bg-surface-2 overflow-hidden">
                          <div className="h-full rounded-full bg-amber/70" style={{ width: `${(f.changed / max) * 100}%` }} />
                        </div>
                        <span className="tabular text-muted w-8 text-end">{f.changed}</span>
                      </div>
                    ))}
                  </div>
                )}

                {r.prs && r.prs.length > 0 && (
                  <div className="space-y-1">
                    {r.prs.slice(0, 4).map((p) => (
                      <button key={p.number} onClick={() => open(p.url)} className="w-full flex items-center gap-2 text-xs rounded-lg px-2 py-1 hover:bg-surface-2 text-start">
                        {p.checks === "fail" ? <CircleX className="size-3.5 text-danger" /> : p.checks === "pass" ? <CircleCheck className="size-3.5 text-teal" /> : <CircleDashed className="size-3.5 text-muted" />}
                        <span className="tabular text-muted">#{p.number}</span>
                        <span className="truncate">{p.title}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
