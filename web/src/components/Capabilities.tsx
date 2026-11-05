import { useEffect, useMemo, useState } from "react";
import { Sparkles, Puzzle, Cloud, FolderGit2, User, ChevronDown, ChevronLeft } from "lucide-react";
import { api, type Capability } from "../api";
import { basename } from "../lib/util";
import { pick, strings, useT } from "../i18n";

const S = strings({
  he: {
    title: "סקילים ופלאגינים",
    count: "{n} סקילים",
    loading: "טוען",
    intro: 'סקיל הוא "איך עושים משהו" (מתכון שנטען כשצריך). אייג\'נט הוא "מי עושה" (תפקיד עם כלים והרשאות משלו). פלאגין אורז כמה מהם יחד כדי להתקין במקום אחר.',
    plugin: "פלאגין",
    skill: "סקיל",
  },
  en: {
    title: "Skills and plugins",
    count: "{n} skills",
    loading: "Loading",
    intro: 'A skill is "how to do something" (a recipe loaded when needed). An agent is "who does it" (a role with its own tools and permissions). A plugin bundles several of them so they can be installed elsewhere.',
    plugin: "Plugin",
    skill: "Skill",
  },
});

// getters: התוויות מחושבות בכל קריאה, לפי השפה הנוכחית
const GROUPS: Array<{ scope: Capability["scope"]; label: string; hint: string; icon: typeof User }> = [
  { scope: "user", get label() { return pick("שלך, בכל הפרויקטים", "Yours, in all projects"); }, hint: "~/.claude/skills", icon: User },
  { scope: "plugin", get label() { return pick("מפלאגינים", "From plugins"); }, get hint() { return pick("מותקנים דרך claude plugin", "Installed via claude plugin"); }, icon: Puzzle },
  { scope: "project", get label() { return pick("של פרויקט מסוים", "Project specific"); }, get hint() { return pick("<פרויקט>/.claude/skills", "<project>/.claude/skills"); }, icon: FolderGit2 },
  { scope: "synced", get label() { return pick("מסונכרנים מ-claude.ai", "Synced from claude.ai"); }, get hint() { return pick("מנוהלים ב-claude.ai, לא לערוך כאן", "Managed on claude.ai, don't edit here"); }, icon: Cloud },
];

/** כל הסקילים והפלאגינים ש-Claude Code רואה במחשב, מקובצים לפי מאיפה הם באים. */
export default function Capabilities() {
  const [items, setItems] = useState<Capability[] | null>(null);
  const t = useT(S);
  const [open, setOpen] = useState<Record<string, boolean>>({ user: true, plugin: true, project: true, synced: false });
  useEffect(() => {
    api.capabilities().then(setItems).catch(() => setItems([]));
  }, []);
  const byScope = useMemo(() => {
    const m = new Map<string, Capability[]>();
    for (const c of items ?? []) m.set(c.scope, [...(m.get(c.scope) ?? []), c]);
    return m;
  }, [items]);
  const skills = (items ?? []).filter((c) => c.kind === "skill").length;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Sparkles className="size-4 text-blue" /> {t("title")}
        </h2>
        <span className="text-sm text-muted">{items ? t("count", { n: skills }) : t("loading")}</span>
      </div>
      <p className="text-sm text-muted">
        {t("intro")}
      </p>
      {GROUPS.map((g) => {
        const list = byScope.get(g.scope) ?? [];
        if (list.length === 0) return null;
        const Icon = g.icon;
        const isOpen = open[g.scope];
        return (
          <div key={g.scope} className="card">
            <button onClick={() => setOpen((o) => ({ ...o, [g.scope]: !isOpen }))} className="w-full flex items-center gap-2 px-4 py-3 text-start">
              {isOpen ? <ChevronDown className="size-4 text-muted" /> : <ChevronLeft className="size-4 text-muted ltr:rotate-180" />}
              <Icon className="size-4 text-muted" />
              <span className="font-medium">{g.label}</span>
              <span className="text-xs text-muted tabular">{list.length}</span>
              <span className="ms-auto text-[11px] text-muted ltr">{g.hint}</span>
            </button>
            {isOpen && (
              <div className="divide-y divide-border/60 border-t border-border/60">
                {list.map((c) => (
                  <div key={c.path} className="px-4 py-2.5 flex items-start gap-3 text-sm">
                    <span className={"mt-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium shrink-0 " + (c.kind === "plugin" ? "bg-amber/15 text-amber" : "bg-blue/12 text-blue")}>{c.kind === "plugin" ? t("plugin") : t("skill")}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium ltr">{c.kind === "plugin" ? c.name : `/${c.name}`}</span>
                        {c.project && c.scope === "project" && <span className="text-[11px] text-muted">{basename(c.project)}</span>}
                        {c.project && c.scope === "plugin" && <span className="text-[11px] text-muted ltr">{c.project}</span>}
                      </div>
                      <div className="text-xs text-muted line-clamp-2" dir="auto">
                        {c.description}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
