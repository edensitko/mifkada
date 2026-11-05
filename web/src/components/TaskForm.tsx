import { useEffect, useMemo, useState, type FormEvent } from "react";
import { BookmarkPlus, Trash2 } from "lucide-react";
import { useStore } from "../store";
import { api, type Template } from "../api";
import { MODEL_OPTIONS, MODE_OPTIONS, basename, cn } from "../lib/util";
import { AgentSelect } from "./AgentPicker";
import { ProviderSelect, useHasProviders } from "./ProviderPicker";
import { ACP_MODES, isClaude } from "../lib/providers";
import type { PermissionMode, Task } from "../../../shared/protocol";
import { strings, useT } from "../i18n";
import { ask, askText } from "../lib/dialog";

const S = strings({
  he: {
    tplName: "שם לתבנית",
    tplSaved: "התבנית נשמרה. אפשר להשתמש ב-{שם} כמקום למילוי.",
    editTask: "עריכת משימה",
    newTask: "משימה חדשה",
    template: "תבנית",
    fromTemplate: "מתבנית...",
    deleteTplConfirm: "למחוק את התבנית \"{name}\"?",
    deleteTpl: "מחק תבנית",
    saveAsTplHint: "שמור את המשימה הזו כתבנית",
    saveAsTpl: "שמור כתבנית",
    title: "כותרת",
    titlePlaceholder: "למשל: להוסיף דף תודה אחרי טופס",
    project: "פרויקט",
    prompt: "מה לעשות (הפרומפט ל-Claude)",
    promptPlaceholder: "תאר את המשימה כמו שהיית כותב ל-Claude",
    agent: "אייג'נט",
    provider: "סוכן",
    model: "מודל",
    permissions: "הרשאות",
    mine: "משימה שלי",
    mineHint: "לא של סוכן: לא תופעל אוטומטית ולא ייפתח לה סשן. היא רק מחכה לך בלוח, ואפשר לסמן אותה כבוצעה.",
    isolate: "ענף נפרד",
    isolateHint: "Claude עובד בעותק של הריפו (git worktree), בלי לגעת בתיקייה שלך. בסוף ממזגים או זורקים. מומלץ כשכמה משימות רצות במקביל באותו פרויקט.",
    cancel: "ביטול",
    update: "עדכן",
    saveQueue: "שמור לתור",
    updateRun: "עדכן והפעל",
    saveRun: "שמור והפעל",
  },
  en: {
    tplName: "Template name",
    tplSaved: "Template saved. Use {name} as a placeholder to fill in.",
    editTask: "Edit task",
    newTask: "New task",
    template: "Template",
    fromTemplate: "From template...",
    deleteTplConfirm: "Delete the template \"{name}\"?",
    deleteTpl: "Delete template",
    saveAsTplHint: "Save this task as a template",
    saveAsTpl: "Save as template",
    title: "Title",
    titlePlaceholder: "For example: add a thank-you page after the form",
    project: "Project",
    prompt: "What to do (the prompt for Claude)",
    promptPlaceholder: "Describe the task the way you'd write it to Claude",
    agent: "Agent",
    provider: "Runs on",
    model: "Model",
    permissions: "Permissions",
    mine: "My task",
    mineHint: "Not an agent's: it won't run automatically and no session opens for it. It just waits for you on the Board, and you can mark it done.",
    isolate: "Separate branch",
    isolateHint: "Claude works in a copy of the repo (git worktree) without touching your folder. When it's done you merge or discard. Recommended when several tasks run in parallel on the same project.",
    cancel: "Cancel",
    update: "Update",
    saveQueue: "Save to queue",
    updateRun: "Update and run",
    saveRun: "Save and run",
  },
});

/** יצירה או עריכה של משימה בלוח. "שמור והפעל" פותח לה סשן מיד. */
export default function TaskForm({ initial, cwd: presetCwd, onClose }: { initial?: Task; cwd?: string; onClose: () => void }) {
  const sessions = useStore((s) => s.sessions);
  const setToast = useStore((s) => s.setToast);
  const select = useStore((s) => s.select);
  const projects = useMemo(() => [...new Set(sessions.map((s) => s.cwd).filter(Boolean))], [sessions]);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [cwd, setCwd] = useState(initial?.cwd ?? presetCwd ?? projects[0] ?? "");
  const [agent, setAgent] = useState<string | null>(initial?.agent ?? null);
  const [model, setModel] = useState<string | null>(initial?.model ?? null);
  const [provider, setProvider] = useState(initial?.provider ?? "claude");
  const hasProviders = useHasProviders() || !isClaude(initial?.provider);
  const claude = isClaude(provider);
  const [mode, setMode] = useState<PermissionMode>(initial?.permissionMode ?? "default");
  const [isolate, setIsolate] = useState(initial?.isolate ?? false);
  const [allowGit, setAllowGit] = useState(initial?.allowGit ?? false);
  const [mine, setMine] = useState(initial?.owner === "me");
  const [busy, setBusy] = useState(false);
  const tx = useT(S);

  // פרופיל הפרויקט: כשבוחרים תיקייה, המודל, האייג'נט וההרשאות שלה נבחרים לבד
  useEffect(() => {
    if (!cwd.trim() || initial) return;
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
  const [templates, setTemplates] = useState<Template[]>([]);
  const [tpl, setTpl] = useState<Template | null>(null);
  const [fills, setFills] = useState<Record<string, string>>({});
  useEffect(() => {
    api.templates().then(setTemplates).catch(() => undefined);
  }, []);
  // מקומות למילוי בתבנית: {שם}
  const slots = useMemo(() => (tpl ? [...new Set([...`${tpl.title}\n${tpl.prompt}`.matchAll(/\{([^{}\n]{1,30})\}/g)].map((m) => m[1]))] : []), [tpl]);
  const fill = (text: string, f: Record<string, string>) => text.replace(/\{([^{}\n]{1,30})\}/g, (all, k: string) => f[k]?.trim() || all);
  const applyTemplate = (t: Template | null) => {
    setTpl(t);
    setFills({});
    if (!t) return;
    setTitle(t.title);
    setPrompt(t.prompt);
    setAgent(t.agent);
    setMode(t.permissionMode as PermissionMode);
    setIsolate(t.isolate);
  };
  useEffect(() => {
    if (!tpl) return;
    setTitle(fill(tpl.title, fills));
    setPrompt(fill(tpl.prompt, fills));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fills]);
  const saveAsTemplate = async () => {
    const name = await askText(tx("tplName"), title || prompt.slice(0, 40));
    if (!name?.trim()) return;
    try {
      setTemplates(await api.saveTemplate({ name, title, prompt, agent, permissionMode: mode, isolate }));
      setToast(tx("tplSaved"));
    } catch (e) {
      setToast((e as Error).message);
    }
  };

  const submit = async (run: boolean, e?: FormEvent) => {
    e?.preventDefault();
    if (!prompt.trim() || !cwd.trim() || busy) return;
    setBusy(true);
    try {
      if (initial) {
        await api.updateTask(initial.id, { title, prompt, cwd, provider, agent, model: claude ? model : null, permissionMode: mode, isolate: mine ? false : isolate, allowGit: mine ? false : allowGit, owner: mine ? "me" : "agent" });
        if (run && !mine) {
          const t = await api.runTask(initial.id);
          if (t.liveId) select({ kind: "live", liveId: t.liveId });
        }
      } else {
        const t = await api.createTask({ title, prompt, cwd: cwd.trim(), provider: claude ? undefined : provider, agent, model: claude ? model : null, permissionMode: mode, isolate: mine ? false : isolate, allowGit: mine ? false : allowGit, owner: mine ? "me" : "agent" }, run && !mine);
        if (run && !mine && t.liveId) select({ kind: "live", liveId: t.liveId });
      }
      onClose();
    } catch (err) {
      setToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => submit(false, e)} className="card hud p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="mono-label">{initial ? tx("editTask") : tx("newTask")}</div>
        {!initial && templates.length > 0 && (
          <select value={tpl?.id ?? ""} onChange={(e) => applyTemplate(templates.find((t) => t.id === e.target.value) ?? null)} className="pill-select bg-surface-2 ms-2" title={tx("template")}>
            <option value="">{tx("fromTemplate")}</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        {tpl && (
          <button
            type="button"
            onClick={async () => {
              if (!(await ask(tx("deleteTplConfirm", { name: tpl.name }), { danger: true }))) return;
              setTemplates(await api.deleteTemplate(tpl.id));
              setTpl(null);
            }}
            className="p-1 rounded text-muted hover:text-danger"
            title={tx("deleteTpl")}
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
        <button type="button" onClick={saveAsTemplate} disabled={!prompt.trim()} className="ms-auto text-xs text-blue flex items-center gap-1 disabled:opacity-40" title={tx("saveAsTplHint")}>
          <BookmarkPlus className="size-3.5" /> {tx("saveAsTpl")}
        </button>
      </div>
      {slots.length > 0 && (
        <div className="flex flex-wrap gap-2 rounded-xl bg-blue/8 p-2.5">
          {slots.map((k) => (
            <label key={k} className="flex items-center gap-1.5 text-sm">
              <span className="text-muted">{k}</span>
              <input autoFocus={k === slots[0]} value={fills[k] ?? ""} onChange={(e) => setFills((f) => ({ ...f, [k]: e.target.value }))} className="rounded-lg bg-surface border px-2 py-1 text-sm outline-none focus:border-blue/60 min-w-48" />
            </label>
          ))}
        </div>
      )}
      <div className="grid grid-cols-[1fr_1fr] gap-3">
        <label className="block space-y-1">
          <span className="text-xs text-muted">{tx("title")}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tx("titlePlaceholder")} className="w-full rounded-lg bg-background/70 border px-3 py-1.5 text-sm focus:border-accent/60 outline-none" />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-muted">{tx("project")}</span>
          <input list="task-projects" value={cwd} onChange={(e) => setCwd(e.target.value)} className="w-full ltr rounded-lg bg-background/70 border px-3 py-1.5 mono text-xs focus:border-accent/60 outline-none" />
          <datalist id="task-projects">
            {projects.map((p) => (
              <option key={p} value={p}>
                {basename(p)}
              </option>
            ))}
          </datalist>
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-xs text-muted">{tx("prompt")}</span>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} className="w-full rounded-lg bg-background/70 border px-3 py-2 text-[15px] focus:border-accent/60 outline-none" placeholder={tx("promptPlaceholder")} />
      </label>
      <div className={cn("grid gap-3", hasProviders ? "grid-cols-4" : "grid-cols-3")}>
        {hasProviders && (
          <label className="block space-y-1">
            <span className="text-xs text-muted">{tx("provider")}</span>
            <ProviderSelect
              value={provider}
              onChange={(v) => {
                setProvider(v);
                if (!isClaude(v) && !ACP_MODES.includes(mode)) setMode("default");
              }}
              className="rounded-lg bg-surface-2/80 border px-2 py-1 text-sm w-full"
            />
          </label>
        )}
        <label className="block space-y-1">
          <span className="text-xs text-muted">{tx("agent")}</span>
          <div>
            <AgentSelect value={agent} onChange={setAgent} />
          </div>
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-muted">{tx("model")}</span>
          <select value={claude ? (model ?? "") : ""} disabled={!claude} onChange={(e) => setModel(e.target.value || null)} className="rounded-lg bg-surface-2/80 border px-2 py-1 text-sm w-full disabled:opacity-50">
            {MODEL_OPTIONS.map((o) => (
              <option key={o.label} value={o.value ?? ""}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-muted">{tx("permissions")}</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as PermissionMode)} className="rounded-lg bg-surface-2/80 border px-2 py-1 text-sm w-full">
            {MODE_OPTIONS.filter((o) => claude || ACP_MODES.includes(o.value)).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="mt-1 accent-blue" />
        <span>
          {tx("mine")}
          <span className="block text-xs text-muted">{tx("mineHint")}</span>
        </span>
      </label>
      <label className={cn("flex items-start gap-2 text-sm", mine && "opacity-40")}>
        <input type="checkbox" checked={isolate} disabled={Boolean(initial?.worktree) || mine} onChange={(e) => setIsolate(e.target.checked)} className="mt-1 accent-blue" />
        <span>
          {tx("isolate")}
          <span className="block text-xs text-muted">{tx("isolateHint")}</span>
        </span>
      </label>
      <label className={cn("flex items-start gap-2 text-sm", mine && "opacity-40")}>
        <input type="checkbox" checked={allowGit} disabled={mine} onChange={(e) => setAllowGit(e.target.checked)} className="mt-1 accent-blue" />
        <span>
          מותר commit
          <span className="block text-xs text-muted">בלי הסימון, commit, merge, rebase, push, reset --hard, branch -D, tag ו-worktree remove חסומים בסשן של המשימה. השינויים נשארים בתיקייה, ואתה ממזג מהקנבן.</span>
        </span>
      </label>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onClose} className="btn-ghost rounded-lg px-3 py-1.5 text-sm">
          {tx("cancel")}
        </button>
        <button type="submit" disabled={busy || !prompt.trim() || !cwd.trim()} className="btn-ghost rounded-lg px-3 py-1.5 text-sm disabled:opacity-40">
          {initial ? tx("update") : tx("saveQueue")}
        </button>
        {!mine && <button type="button" onClick={() => submit(true)} disabled={busy || !prompt.trim() || !cwd.trim()} className="btn-primary rounded-lg px-4 py-1.5 text-sm disabled:opacity-40 disabled:shadow-none">
          {initial ? tx("updateRun") : tx("saveRun")}
        </button>}
      </div>
    </form>
  );
}
