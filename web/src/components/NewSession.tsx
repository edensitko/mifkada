import SlashMenu from "./SlashMenu";
import { FolderOpen } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { useStore } from "../store";
import { getPrefs } from "../lib/prefs";
import { api } from "../api";
import { openSession } from "../ws";
import { refreshSessions } from "../App";
import { MODEL_OPTIONS, MODE_OPTIONS, basename, cn, confirmMode } from "../lib/util";
import { projectVisual } from "../lib/groups";
import Avatar from "./Avatar";
import { AgentSelect } from "./AgentPicker";
import { ProviderSelect, useHasProviders } from "./ProviderPicker";
import { ACP_MODES, isClaude, providerLabel, useProviders } from "../lib/providers";
import type { PermissionMode } from "../../../shared/protocol";
import { strings, useT } from "../i18n";

const FolderBrowser = lazy(() => import("./FolderBrowser"));

const S = strings({
  he: {
    mifkada: "מפקדה",
    terminal: "טרמינל",
    cancel: "ביטול",
    title: "סשן חדש",
    opening: "פותח...",
    start: "התחל",
    project: "פרויקט",
    otherFolder: "תיקייה אחרת...",
    browse: "בחר תיקייה",
    settings: "הגדרות",
    agent: "אייג'נט",
    provider: "סוכן",
    providerHint: "אצל {label} האייג'נט עובר כהנחיות בהודעה הראשונה, והמודל נבחר בתוך הסשן.",
    model: "מודל",
    permissions: "הרשאות",
    firstMessage: "ההודעה הראשונה",
    placeholder: "מה לעשות? (/ לפקודות ו-skills)",
    othersWorking: "כבר עובדים בריפו הזה: {list}",
    andMore: " ועוד {n}",
    othersHint: "שני סשנים באותו ריפו יכולים לדרוס זה את זה (קבצים, commit, reset). בענף נפרד העבודה מתבצעת בעותק משלה, ואחר כך ממזגים מהקנבן.",
    startIsolated: "התחל בענף נפרד",
    footer: "⌘Enter להתחלה · Esc לביטול",
  },
  en: {
    mifkada: "Mifkada",
    terminal: "Terminal",
    cancel: "Cancel",
    title: "New session",
    opening: "Opening...",
    start: "Start",
    project: "Project",
    otherFolder: "Other folder...",
    browse: "Browse for a folder",
    settings: "Settings",
    agent: "Agent",
    provider: "Runs on",
    providerHint: "With {label}, the agent is passed as instructions in the first message, and the model is picked inside the session.",
    model: "Model",
    permissions: "Permissions",
    firstMessage: "First message",
    placeholder: "What should it do? (/ for commands and skills)",
    othersWorking: "Already working in this repo: {list}",
    andMore: " and {n} more",
    othersHint: "Two sessions in the same repo can overwrite each other (files, commit, reset). On a separate branch the work happens in its own copy, and you merge it from the Board afterwards.",
    startIsolated: "Start on a separate branch",
    footer: "⌘Enter to start · Esc to cancel",
  },
});

/** האייג'נט שנבחר לבד בסשן חדש (הגדרות ← סשנים). ריק = בלי */
const defaultAgent = () => getPrefs().defaultAgent;

export default function NewSession() {
  const select = useStore((s) => s.select);
  const t = useT(S);
  // undefined = לא נבחר אייג'נט (כפתור "חדש"): הסוכן הראשי. null = נבחר במפורש "ללא" (למשל /clear בסשן בלי אייג'נט)
  const preset = useStore((s) => (s.selection?.kind === "new" ? s.selection.agent : null));
  const presetCwd = useStore((s) => (s.selection?.kind === "new" ? (s.selection.cwd ?? "") : ""));
  const setToast = useStore((s) => s.setToast);
  const agents = useStore((s) => s.agents);
  const projectThemes = useStore((s) => s.projectThemes);
  const [projects, setProjects] = useState<Array<{ cwd: string; sessions: number }>>([]);
  const [cwd, setCwd] = useState(presetCwd);
  const [agent, setAgent] = useState<string | null>(() => (preset !== undefined ? preset : agents.some((a) => a.slug === defaultAgent()) ? defaultAgent() : null));
  // רשימת האייג'נטים עוד לא נטענה כשהמסך נפתח: הסוכן הראשי נבחר כשהיא מגיעה, אם עדיין לא נבחר כלום
  const touched = useRef(false);
  useEffect(() => {
    if (preset === undefined && !touched.current && agent === null && agents.some((a) => a.slug === defaultAgent())) setAgent(defaultAgent());
  }, [agents, preset, agent]);
  const [model, setModel] = useState<string | null>(getPrefs().defaultModel);
  // ספק: claude (ברירת מחדל) או ספק ACP. ל-ACP אין רשימת מודלים מראש, ורק שלושה מצבי הרשאה
  const [provider, setProvider] = useState("claude");
  const hasProviders = useHasProviders();
  const providers = useProviders();
  const claude = isClaude(provider);
  const modeOptions = claude ? MODE_OPTIONS : MODE_OPTIONS.filter((o) => ACP_MODES.includes(o.value));
  const [mode, setMode] = useState<PermissionMode>(getPrefs().defaultMode);
  const [text, setText] = useState("");
  const slashKey = useRef<((e: React.KeyboardEvent) => boolean) | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const slashQuery = /^\/(\S*)$/.exec(text)?.[1];
  // פקודות / הן של Claude Code
  const slashOpen = slashQuery !== undefined && Boolean(cwd.trim()) && dismissed !== text && provider === "claude";
  const [busy, setBusy] = useState(false);

  // פרופיל הפרויקט: כשבוחרים תיקייה, המודל, האייג'נט וההרשאות שלה נבחרים לבד
  useEffect(() => {
    if (!cwd.trim()) return;
    let cancelled = false;
    api
      .profiles()
      .then((all) => {
        const pr = all[cwd.trim()];
        if (cancelled || !pr) return;
        if (pr.model !== undefined && pr.model !== null) setModel(pr.model);
        if (pr.agent) setAgent(pr.agent);
        if (pr.permissionMode) setMode(pr.permissionMode as PermissionMode);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  useEffect(() => {
    api
      .projects()
      .then((p) => {
        setProjects(p);
        if (!cwd && p[0]) setCwd(p[0].cwd);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!cwd.trim() || !text.trim() || busy) return;
    setBusy(true);
    try {
      const liveId = await openSession({ cwd: cwd.trim(), provider: claude ? undefined : provider, agent, model: claude ? model : null, permissionMode: mode, text: text.trim() });
      select({ kind: "live", liveId });
      refreshSessions();
    } catch (err) {
      setToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // מי עוד עובד בריפו הזה עכשיו: אזהרה, ואפשרות לעבוד בענף נפרד (משימה עם worktree, שאפשר למזג או לזרוק בקנבן)
  const [others, setOthers] = useState<Array<{ sessionId: string; cwd: string; entrypoint: string }>>([]);
  useEffect(() => {
    const dir = cwd.trim();
    if (!dir) return setOthers([]);
    const id = setTimeout(() => {
      api
        .activity(dir)
        .then((r) => setOthers(r.sessions))
        .catch(() => setOthers([]));
    }, 300);
    return () => clearTimeout(id);
  }, [cwd]);
  const sessionsById = useStore((s) => s.sessions);
  const otherLabel = (o: { sessionId: string; cwd: string; entrypoint: string }) => {
    const row = sessionsById.find((r) => r.sessionId === o.sessionId);
    const where = o.entrypoint.startsWith("mifkada-") ? `${providerLabel(o.entrypoint.slice(8), providers)} · ${t("mifkada")}` : o.entrypoint.includes("vscode") ? "VS Code" : o.entrypoint.startsWith("sdk") ? t("mifkada") : t("terminal");
    return `${row?.title ?? o.cwd.split("/").pop()} (${where})`;
  };
  const startIsolated = async () => {
    if (!cwd.trim() || !text.trim() || busy) return;
    setBusy(true);
    try {
      const title = text.trim().split("\n")[0].slice(0, 80);
      const task = await api.createTask({ title, prompt: text.trim(), cwd: cwd.trim(), provider: claude ? undefined : provider, agent, model: claude ? model : null, permissionMode: mode, isolate: true }, true);
      if (task.liveId) select({ kind: "live", liveId: task.liveId });
      else select({ kind: "board" });
      refreshSessions();
    } catch (err) {
      setToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const chosen = agents.find((a) => a.slug === agent);

  const recent = projects.slice(0, 8);
  const allCwds = projects.map((p) => p.cwd);
  const inRecent = recent.some((p) => p.cwd === cwd.trim());
  const [custom, setCustom] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const showPath = custom || (Boolean(cwd.trim()) && !inRecent && projects.length > 0);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="app-drag h-10" />
      <form
        onSubmit={submit}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(e as unknown as FormEvent);
          if (e.key === "Escape" && !slashOpen) select(null);
        }}
        className="max-w-2xl mx-auto mt-2 pb-10"
      >
        {/* סרגל ניווט של גיליון iOS: ביטול, כותרת, התחל */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center px-1 mb-5">
          <button type="button" onClick={() => select(null)} className="justify-self-start text-blue text-[15px] px-1">
            {t("cancel")}
          </button>
          <h1 className="text-[17px] font-semibold">{t("title")}</h1>
          <button type="submit" disabled={busy || !cwd.trim() || !text.trim()} className="justify-self-end btn-primary rounded-full px-4 py-1.5 text-[15px] disabled:opacity-35">
            {busy ? t("opening") : t("start")}
          </button>
        </div>

        <div className="group-header">{t("project")}</div>
        <div className="flex flex-wrap gap-2 mb-2 px-1">
          {recent.map((p) => {
            const v = projectVisual(p.cwd, allCwds, projectThemes);
            const on = p.cwd === cwd.trim() && !custom;
            return (
              <button
                key={p.cwd}
                type="button"
                onClick={() => {
                  setCustom(false);
                  setCwd(p.cwd);
                }}
                className={cn("flex items-center gap-2 rounded-full ps-1 pe-3 py-1 text-[13.5px] transition", on ? "bg-blue text-white" : "bg-surface hover:bg-[var(--color-fill)]")}
                title={p.cwd}
              >
                <Avatar emoji={v.emoji} color={v.color} image={v.image} size="sm" square />
                {v.name}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              setCustom(true);
              setBrowsing(true);
            }}
            className={cn("rounded-full px-3 py-1 text-[13.5px]", showPath ? "bg-blue text-white" : "bg-surface text-blue hover:bg-[var(--color-fill)]")}
          >
            {t("otherFolder")}
          </button>
        </div>
        {(showPath || projects.length === 0) && (
          <div className="group-list mb-2 flex items-center">
            {/* השדה נשאר למי שמעדיף להדביק נתיב; הכפתור פותח את הבורר */}
            <input list="projects" value={cwd} onChange={(e) => setCwd(e.target.value)} className="flex-1 min-w-0 ltr bg-transparent px-4 py-3 mono text-sm outline-none" placeholder="~/projects/..." />
            <button type="button" onClick={() => setBrowsing(true)} title={t("browse")} aria-label={t("browse")} className="me-2 rounded-md p-2 text-blue hover:bg-[var(--color-fill)]">
              <FolderOpen className="size-4" />
            </button>
            <datalist id="projects">
              {projects.map((p) => (
                <option key={p.cwd} value={p.cwd}>
                  {basename(p.cwd)} ({p.sessions})
                </option>
              ))}
            </datalist>
          </div>
        )}

        {browsing && (
          <Suspense fallback={null}>
            <FolderBrowser
              initial={cwd.trim()}
              onClose={() => setBrowsing(false)}
              onPick={(p) => {
                setBrowsing(false);
                setCwd(p);
                setCustom(!recent.some((r) => r.cwd === p));
              }}
            />
          </Suspense>
        )}

        <div className="group-header mt-6">{t("settings")}</div>
        <div className="group-list">
          {hasProviders && (
            <div className="flex items-center gap-3 px-4 py-2.5">
              <span className="flex-1 text-[15px]">{t("provider")}</span>
              <ProviderSelect
                value={provider}
                onChange={(v) => {
                  setProvider(v);
                  if (!isClaude(v) && !ACP_MODES.includes(mode)) setMode("default");
                }}
              />
            </div>
          )}
          <div className="flex items-center gap-3 px-4 py-2.5">
            <span className="flex-1 text-[15px]">{t("agent")}</span>
            <AgentSelect
              value={agent}
              onChange={(v) => {
                touched.current = true;
                setAgent(v);
              }}
            />
          </div>
          {claude && (
            <div className="flex items-center gap-3 px-4 py-2.5">
              <span className="flex-1 text-[15px]">{t("model")}</span>
              <select value={model ?? ""} onChange={(e) => setModel(e.target.value || null)} className="px-2 py-1 text-sm">
                {MODEL_OPTIONS.map((o) => (
                  <option key={o.label} value={o.value ?? ""}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-center gap-3 px-4 py-2.5">
            <span className="flex-1 text-[15px]">{t("permissions")}</span>
            <select value={mode} onChange={(e) => {
              const v = e.target.value as PermissionMode;
              void confirmMode(v).then((ok) => ok && setMode(v));
            }} className="px-2 py-1 text-sm">
              {modeOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-[12.5px] text-muted px-4 mt-1.5">
          {chosen ? `${chosen.description.slice(0, 160)} · ` : ""}
          {MODE_OPTIONS.find((o) => o.value === mode)?.hint}
          {!claude && agent ? ` · ${t("providerHint", { label: providerLabel(provider, providers) })}` : ""}
        </p>

        <div className="group-header mt-6">{t("firstMessage")}</div>
        <div className="relative">
          <SlashMenu
            cwd={cwd.trim() || undefined}
            withLocal={false}
            query={slashQuery ?? ""}
            active={slashOpen}
            onPick={(c, run) => setText(run ? `/${c.name}` : `/${c.name} `)}
            onClose={() => setDismissed(text)}
            keyRef={slashKey}
          />
          <textarea
            autoFocus={!custom}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (slashOpen && slashKey.current?.(e)) return;
            }}
            rows={6}
            className="w-full group-list px-4 py-3 text-[15px] leading-relaxed outline-none focus:ring-2 focus:ring-blue/30 resize-none"
            placeholder={t("placeholder")}
          />
        </div>
        {others.length > 0 && (
          <div className="mt-4 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-[13px] space-y-2">
            <div className="font-medium">
              {t("othersWorking", { list: others.slice(0, 3).map(otherLabel).join(", ") })}
              {others.length > 3 ? t("andMore", { n: others.length - 3 }) : ""}
            </div>
            <div className="text-muted">{t("othersHint")}</div>
            <button type="button" onClick={() => void startIsolated()} disabled={!text.trim() || busy} className="btn-primary rounded-lg px-3 py-1.5 text-[13px] disabled:opacity-50">
              {t("startIsolated")}
            </button>
          </div>
        )}
        <p className="text-[12px] text-muted px-4 mt-1.5">{t("footer")}</p>
      </form>
    </div>
  );
}
