import { useState, type FormEvent } from "react";
import { Plus, Pencil, Trash2, Palette, Bot, Tags } from "lucide-react";
import { useStore } from "../store";
import { api } from "../api";
import { MODEL_OPTIONS } from "../lib/util";
import { rowAgent } from "../lib/groups";
import Avatar from "./Avatar";
import Capabilities from "./Capabilities";
import { ThemeEditor } from "./AgentPicker";
import type { AgentInfo } from "../../../shared/protocol";
import { strings, useT, pick } from "../i18n";
import { Spinner } from "./Spinner";
import { ask } from "../lib/dialog";

const S = strings({
  he: {
    editAgent: "עריכת אייג'נט",
    newAgent: "אייג'נט חדש",
    fileHint: "הקובץ נכתב ל-~/.claude/agents ונטען בסשנים חדשים, גם בטרמינל.",
    slug: "שם (אנגלית, מקפים)",
    model: "מודל",
    default: "ברירת מחדל",
    description: "תיאור (מתי להשתמש בו, Claude קורא את זה)",
    descPlaceholder: "כותב טקסטים שיווקיים בעברית בקול המותג של העסק",
    prompt: "הפרומפט (ההנחיות הקבועות)",
    promptPlaceholder: "אתה... תמיד... לעולם לא...",
    tools: "כלים מותרים (ריק = הכול)",
    cancel: "ביטול",
    save: "שמור",
    create: "צור אייג'נט",
    noMatch: "Claude לא מצא סשן שמתאים בבירור לאייג'נט",
    tagged: "{n} סשנים תויגו",
    deleteConfirm: "למחוק את האייג'נט \"{name}\"? הקובץ יימחק מ-~/.claude/agents.",
    whoWorks: "מי עובד בשבילך",
    agents: "אייג'נטים",
    tagHint: "Claude מציע אייג'נט לכל סשן לא מתויג לפי התוכן",
    tagN: "תייג {n} סשנים",
    proposals: "הצעות תיוג",
    nSessions: "{n} סשנים",
    apply: "החל",
    remove: "הסר",
    colorEmoji: "צבע ואימוג'י",
    edit: "עריכה",
    delete: "מחיקה",
    styleOf: "עיצוב {name}",
    allTools: "כל הכלים",
    sessions: "סשנים",
    active: "פעילים",
    openTasks: "משימות פתוחות",
    newSession: "סשן חדש",
    empty: "אין עדיין אייג'נטים. צור את הראשון: שם, תיאור ופרומפט.",
  },
  en: {
    editAgent: "Edit agent",
    newAgent: "New agent",
    fileHint: "The file is written to ~/.claude/agents and loads in new sessions, in the terminal too.",
    slug: "Name (lowercase, dashes)",
    model: "Model",
    default: "Default",
    description: "Description (when to use it, Claude reads this)",
    descPlaceholder: "Writes marketing copy in the brand voice",
    prompt: "Prompt (the standing instructions)",
    promptPlaceholder: "You are... Always... Never...",
    tools: "Allowed tools (empty = all)",
    cancel: "Cancel",
    save: "Save",
    create: "Create agent",
    noMatch: "Claude didn't find a session that clearly fits an agent",
    tagged: "{n} sessions tagged",
    deleteConfirm: "Delete the agent \"{name}\"? The file will be removed from ~/.claude/agents.",
    whoWorks: "Who works for you",
    agents: "Agents",
    tagHint: "Claude suggests an agent for each untagged session based on its content",
    tagN: "Tag {n} sessions",
    proposals: "Suggested tags",
    nSessions: "{n} sessions",
    apply: "Apply",
    remove: "Remove",
    colorEmoji: "Color and emoji",
    edit: "Edit",
    delete: "Delete",
    styleOf: "Style {name}",
    allTools: "All tools",
    sessions: "sessions",
    active: "active",
    openTasks: "open tasks",
    newSession: "New session",
    empty: "No agents yet. Create the first one: name, description and prompt.",
  },
});

const TOOL_PRESETS = ["Read", "Grep", "Glob", "Bash", "Edit", "Write", "WebFetch", "WebSearch"];

function AgentForm({ initial, onClose }: { initial?: AgentInfo; onClose: () => void }) {
  const setAgents = useStore((s) => s.setAgents);
  const setToast = useStore((s) => s.setToast);
  const t = useT(S);
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [tools, setTools] = useState<string[]>(initial?.tools ? initial.tools.split(",").map((t) => t.trim()).filter(Boolean) : []);
  const [model, setModel] = useState(initial?.model ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      setAgents(await api.saveAgent({ slug: slug.trim(), description, prompt, tools: tools.join(", ") || undefined, model: model || undefined }));
      onClose();
    } catch (err) {
      setToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card p-5 space-y-4">
      <div>
        <div className="mono-label">{initial ? t("editAgent") : t("newAgent")}</div>
        <p className="text-sm text-muted mt-1">{t("fileHint")}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-xs text-muted">{t("slug")}</span>
          <input value={slug} disabled={Boolean(initial)} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder="content-writer" className="w-full ltr rounded-lg bg-background border px-3 py-1.5 mono text-sm outline-none focus:border-blue/60 disabled:opacity-60" />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-muted">{t("model")}</span>
          <select value={model} onChange={(e) => setModel(e.target.value)} className="px-2 py-1.5 text-sm w-full">
            <option value="">{t("default")}</option>
            {MODEL_OPTIONS.filter((o) => o.value).map((o) => (
              <option key={o.label} value={o.value ?? ""}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-xs text-muted">{t("description")}</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} className="w-full rounded-lg bg-background border px-3 py-1.5 text-sm outline-none focus:border-blue/60" placeholder={t("descPlaceholder")} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-muted">{t("prompt")}</span>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={8} className="w-full rounded-lg bg-background border px-3 py-2 text-[14px] outline-none focus:border-blue/60" placeholder={t("promptPlaceholder")} />
      </label>
      <div className="space-y-1">
        <span className="text-xs text-muted">{t("tools")}</span>
        <div className="flex flex-wrap gap-1.5">
          {TOOL_PRESETS.map((t) => {
            const on = tools.includes(t);
            return (
              <button type="button" key={t} onClick={() => setTools(on ? tools.filter((x) => x !== t) : [...tools, t])} className={"rounded-full px-2.5 py-1 text-xs transition " + (on ? "bg-blue text-white" : "bg-surface-2 text-foreground hover:bg-border")}>
                {t}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onClose} className="btn-ghost px-3 py-1.5 text-sm">
          {t("cancel")}
        </button>
        <button type="submit" disabled={busy || !slug.trim() || !description.trim() || !prompt.trim()} className="btn-primary px-4 py-1.5 text-sm disabled:opacity-40">
          {initial ? t("save") : t("create")}
        </button>
      </div>
    </form>
  );
}

/** עמוד האייג'נטים: מי קיים, מה הוא עושה, יצירה ועריכה. */
export default function Agents() {
  const { agents, sessions, tasks, setAgents, setToast, select } = useStore();
  const [form, setForm] = useState<{ open: boolean; agent?: AgentInfo }>({ open: false });
  const t = useT(S);
  const [themeFor, setThemeFor] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Array<{ sessionId: string; title: string; agent: string | null }> | null>(null);
  const [tagBusy, setTagBusy] = useState(false);
  const untagged = sessions.filter((s) => !rowAgent(s)).length;
  const propose = async () => {
    setTagBusy(true);
    try {
      const r = await api.autotag(true);
      setProposals(r.proposals.filter((p) => p.agent));
      if (!r.proposals.some((p) => p.agent)) setToast(t("noMatch"));
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setTagBusy(false);
    }
  };
  const applyProposals = async () => {
    if (!proposals) return;
    let n = 0;
    for (const p of proposals) {
      if (!p.agent) continue;
      try {
        await api.tag(p.sessionId, p.agent);
        n++;
      } catch {
        /* נמחק */
      }
    }
    setToast(t("tagged", { n }));
    setProposals(null);
    useStore.getState().setSessions(await api.sessions());
  };

  const remove = async (a: AgentInfo) => {
    if (!(await ask(t("deleteConfirm", { name: a.name }), { danger: true }))) return;
    try {
      setAgents(await api.deleteAgent(a.slug));
    } catch (e) {
      setToast((e as Error).message);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="app-drag h-10" />
      <div className="max-w-5xl mx-auto px-8 pb-14 space-y-6">
        <header className="flex items-end justify-between gap-4">
          <div>
            <div className="mono-label">{t("whoWorks")}</div>
            <h1 className="large-title mt-1">{t("agents")}</h1>
          </div>
          <div className="flex items-center gap-2">
            {agents.length > 0 && untagged > 0 && (
              <button onClick={propose} disabled={tagBusy} className="btn-ghost px-3 py-2.5 flex items-center gap-2 disabled:opacity-50" title={t("tagHint")}>
                {tagBusy ? <Spinner className="size-4" /> : <Tags className="size-4" />} {t("tagN", { n: untagged })}
              </button>
            )}
            <button onClick={() => setForm({ open: true })} className="btn-primary px-4 py-2.5 flex items-center gap-2">
              <Plus className="size-4" /> {t("newAgent")}
            </button>
          </div>
        </header>

        {proposals && proposals.length > 0 && (
          <div className="card p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-medium">{t("proposals")}</span>
              <span className="text-[11px] text-muted">{t("nSessions", { n: proposals.length })}</span>
              <button onClick={applyProposals} className="ms-auto btn-primary px-3 py-1.5 text-sm">
                {t("apply")}
              </button>
              <button onClick={() => setProposals(null)} className="btn-ghost px-3 py-1.5 text-sm">
                {t("cancel")}
              </button>
            </div>
            <div className="divide-y divide-border/60 text-sm">
              {proposals.map((p) => {
                const a = agents.find((x) => x.slug === p.agent);
                return (
                  <div key={p.sessionId} className="flex items-center gap-2 py-1.5">
                    <span dir="auto" className="truncate flex-1">{p.title}</span>
                    {a && (
                      <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: `${a.color}26`, color: a.color }}>
                        {a.emoji} {a.name}
                      </span>
                    )}
                    <button onClick={() => setProposals((ps) => ps?.filter((x) => x.sessionId !== p.sessionId) ?? null)} className="text-muted hover:text-danger text-xs">
                      {t("remove")}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {form.open && <AgentForm key={form.agent?.slug ?? "new"} initial={form.agent} onClose={() => setForm({ open: false })} />}

        <div className="grid grid-cols-2 gap-3">
          {agents.map((a) => {
            const n = sessions.filter((s) => rowAgent(s) === a.slug).length;
            const live = sessions.filter((s) => rowAgent(s) === a.slug && (s.live || s.external)).length;
            const open = tasks.filter((t) => t.agent === a.slug && t.status !== "done").length;
            return (
              <div key={a.slug} className="card p-4 space-y-3 relative">
                <div className="flex items-start gap-3">
                  <Avatar emoji={a.emoji} color={a.color} image={a.image} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold truncate">{a.name}</div>
                    <div className={`mono text-[11px] text-muted ltr ${pick("text-right", "text-left")}`}>{a.slug}</div>
                  </div>
                  <div className="flex items-center gap-1 relative">
                    <button onClick={() => setThemeFor(themeFor === a.slug ? null : a.slug)} className="size-8 rounded-lg grid place-items-center hover:bg-surface-2 text-muted" title={t("colorEmoji")}>
                      <Palette className="size-4" />
                    </button>
                    <button onClick={() => setForm({ open: true, agent: a })} className="size-8 rounded-lg grid place-items-center hover:bg-surface-2 text-muted" title={t("edit")}>
                      <Pencil className="size-4" />
                    </button>
                    <button onClick={() => remove(a)} className="size-8 rounded-lg grid place-items-center hover:bg-danger/15 text-muted hover:text-danger" title={t("delete")}>
                      <Trash2 className="size-4" />
                    </button>
                    {themeFor === a.slug && (
                      <ThemeEditor
                        title={t("styleOf", { name: a.name })}
                        initial={{ color: a.color, emoji: a.emoji, name: a.name, image: a.image }}
                        onSave={async (t) => {
                          await api.setTheme("agents", a.slug, t);
                          setAgents(await api.agents());
                        }}
                        onClose={() => setThemeFor(null)}
                      />
                    )}
                  </div>
                </div>
                <p dir="auto" className="text-sm text-muted line-clamp-2">{a.description}</p>
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  {a.model && <span className="rounded-full bg-surface-2 px-2 py-0.5">{a.model}</span>}
                  {a.tools && <span className="rounded-full bg-surface-2 px-2 py-0.5 ltr">{a.tools}</span>}
                  {!a.tools && <span className="rounded-full bg-surface-2 px-2 py-0.5">{t("allTools")}</span>}
                </div>
                <div className="flex items-center gap-4 text-xs text-muted pt-1 border-t border-border/60">
                  <span>
                    <span className="tabular font-semibold text-foreground">{n}</span> {t("sessions")}
                  </span>
                  <span>
                    <span className="tabular font-semibold text-foreground">{live}</span> {t("active")}
                  </span>
                  <span>
                    <span className="tabular font-semibold text-foreground">{open}</span> {t("openTasks")}
                  </span>
                  <button onClick={() => select({ kind: "new", agent: a.slug })} className="ms-auto text-blue hover:underline">
                    {t("newSession")}
                  </button>
                </div>
              </div>
            );
          })}
          {agents.length === 0 && (
            <div className="col-span-2 card border-dashed p-8 text-center text-muted">
              <Bot className="size-8 mx-auto mb-2" />
              {t("empty")}
            </div>
          )}
        </div>
        <Capabilities />
      </div>
    </div>
  );
}
