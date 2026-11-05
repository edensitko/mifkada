import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Sparkles, Terminal, Zap } from "lucide-react";
import { api, type CommandInfo } from "../api";
import { cn } from "../lib/util";
import { commandOptions } from "../lib/slashOptions";
import { isRTL, strings, tr, useT } from "../i18n";
import { Spinner } from "./Spinner";

const S = strings({
  he: {
    clear: "שיחה חדשה באותו פרויקט ועם אותו אייג'נט",
    model: "החלפת מודל לסשן הזה",
    mode: "מצב ההרשאות לסשן הזה: שואל, מאשר עריכות, תכנון...",
    resume: "חיפוש ופתיחה של שיחה אחרת (⌘K)",
    agents: "האייג'נטים והיכולות",
    config: "ההגדרות של מפקדה",
    permissions: "מגבלות ובטיחות: מה מותר בלי לשאול",
    groupMifkada: "מפקדה",
    groupYours: "שלך",
    loading: "טוען את הפקודות של הפרויקט",
    noMatch: "אין פקודה כזו. Enter ישלח את הטקסט כמו שהוא.",
    navSelect: "↑↓ בחירה",
    navSwitch: "Enter החלפה",
    navRun: "Enter הרצה",
    navComplete: "Tab השלמה",
    navClose: "Esc סגירה",
  },
  en: {
    clear: "New conversation in the same project with the same agent",
    model: "Switch the model for this session",
    mode: "Permission mode for this session: ask, accept edits, plan...",
    resume: "Find and open another conversation (⌘K)",
    agents: "Agents and capabilities",
    config: "Mifkada settings",
    permissions: "Limits and safety: what is allowed without asking",
    groupMifkada: "Mifkada",
    groupYours: "Yours",
    loading: "Loading the project's commands",
    noMatch: "No such command. Enter sends the text as is.",
    navSelect: "↑↓ select",
    navSwitch: "Enter switch",
    navRun: "Enter run",
    navComplete: "Tab complete",
    navClose: "Esc close",
  },
});

/** פקודות שמפקדה מטפלת בהן בעצמה (במקום ה-CLI), כי יש להן מקבילה טובה יותר בממשק */
export const LOCAL_COMMANDS: CommandInfo[] = [
  { name: "clear", get description() { return tr(S, "clear"); }, argumentHint: "", builtin: true },
  { name: "model", get description() { return tr(S, "model"); }, argumentHint: "fable | opus | sonnet | haiku", builtin: true },
  { name: "mode", get description() { return tr(S, "mode"); }, argumentHint: "default | acceptEdits | plan | auto | dontAsk", builtin: true },
  { name: "resume", get description() { return tr(S, "resume"); }, argumentHint: "", builtin: true },
  { name: "agents", get description() { return tr(S, "agents"); }, argumentHint: "", builtin: true },
  { name: "config", get description() { return tr(S, "config"); }, argumentHint: "", builtin: true },
  { name: "permissions", get description() { return tr(S, "permissions"); }, argumentHint: "", builtin: true },
];
const LOCAL = new Set(LOCAL_COMMANDS.map((c) => c.name));

/** תיאורים מתורגמים לפקודות המובנות הנפוצות. השאר מוצגות בתיאור המקורי. */
const DESC = strings({
  he: {
    compact: "לסכם את השיחה עד כאן ולפנות מקום בהקשר",
    context: "כמה מההקשר תפוס, ובמה",
    usage: "שימוש ומגבלות המנוי: סשן, שבוע, עלות",
    init: "ליצור CLAUDE.md עם תיעוד של הפרויקט",
    "code-review": "סקירת קוד לשינויים הנוכחיים או ל-PR",
    "security-review": "סקירת אבטחה לשינויים בענף",
    simplify: "לפשט את הקוד שהשתנה",
    verify: "לוודא ששינוי באמת עובד, בהרצה",
    effort: "רמת מאמץ וחשיבה של המודל",
    fast: "מצב מהיר",
    mcp: "ניהול שרתי MCP",
    "output-style": "סגנון התשובות",
    autocompact: "מתי לסכם את ההקשר אוטומטית",
    loop: "להריץ פקודה או בקשה שוב ושוב לפי מרווח",
    schedule: "סוכנים מתוזמנים בענן",
    goal: "להגדיר מטרה ולעבוד עד שהיא מושגת",
    recap: "סיכום של שורה אחת לסשן",
    insights: "דוח על כל סשני Claude Code שלך",
    debug: "לוגים מפורטים ואבחון בעיה",
    batch: "שינוי גדול: מחקר, תכנון וביצוע במקביל",
    advisor: "להתייעץ עם מודל חזק יותר ברגעי מפתח",
    "reload-skills": "לטעון מחדש skills שנוספו לדיסק",
    "reload-plugins": "להפעיל שינויים בתוספים",
    "skill-doctor": "אילו skills לא בשימוש ותופסים הקשר",
    ultrareview: "סוכן בענן שמוצא ומאמת באגים בענף",
    "fewer-permission-prompts": "פחות בקשות אישור לפקודות קריאה נפוצות",
    config: "ההגדרות של מפקדה",
  },
  en: {
    compact: "Summarize the conversation so far and free up context",
    context: "How much of the context is used, and by what",
    usage: "Subscription usage and limits: session, week, cost",
    init: "Create a CLAUDE.md that documents the project",
    "code-review": "Review the current changes or a PR",
    "security-review": "Security review of the changes on the branch",
    simplify: "Simplify the code that changed",
    verify: "Check that a change really works by running it",
    effort: "How much effort and thinking the model puts in",
    fast: "Fast mode",
    mcp: "Manage MCP servers",
    "output-style": "Response style",
    autocompact: "When to summarize the context automatically",
    loop: "Run a command or prompt repeatedly on an interval",
    schedule: "Scheduled agents in the cloud",
    goal: "Set a goal and keep working until it is reached",
    recap: "A one-line recap of the session",
    insights: "A report on all your Claude Code sessions",
    debug: "Detailed logs and problem diagnosis",
    batch: "A large change: research, plan and execute in parallel",
    advisor: "Consult a stronger model at key moments",
    "reload-skills": "Reload skills added to disk",
    "reload-plugins": "Apply plugin changes",
    "skill-doctor": "Which skills go unused and take up context",
    ultrareview: "A cloud agent that finds and verifies bugs on the branch",
    "fewer-permission-prompts": "Fewer approval prompts for common read commands",
    config: "Mifkada settings",
  },
});
const descFor = (name: string): string | undefined => (Object.hasOwn(DESC.he, name) ? tr(DESC, name as keyof typeof DESC.he) : undefined);

const cache = new Map<string, CommandInfo[]>();

type Group = "mifkada" | "cc" | "yours";
type Row = CommandInfo & { group: Group; he?: string };

/** תפריט ה-/ מעל תיבת הכתיבה, כמו ב-VS Code: כל הפקודות, ה-skills והפקודות שלך. */
export default function SlashMenu({
  cwd,
  query,
  arg,
  current,
  active,
  onPick,
  onPickArg,
  onClose,
  keyRef,
  withLocal = true,
}: {
  withLocal?: boolean;
  cwd?: string;
  query: string;
  /** "/model op": בוחרים ערך לפקודה, לא פקודה */
  arg?: { name: string; q: string } | null;
  /** הערך הנוכחי לכל פקודה (model, mode), לסימון ✓ */
  current?: Record<string, string | null | undefined>;
  active: boolean;
  onPick: (c: CommandInfo, run: boolean) => void;
  onPickArg?: (name: string, value: string) => void;
  onClose: () => void;
  keyRef: React.MutableRefObject<((e: React.KeyboardEvent) => boolean) | null>;
}) {
  const [list, setList] = useState<CommandInfo[]>(() => (cwd ? (cache.get(cwd) ?? []) : []));
  const [loading, setLoading] = useState(false);
  const [idx, setIdx] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const t = useT(S);
  const groupLabel = (g: Group) => (g === "mifkada" ? t("groupMifkada") : g === "cc" ? "Claude Code" : t("groupYours"));

  // טוענים ברגע שהתפריט נפתח בפעם הראשונה בתיקייה, ומרעננים ברקע בכל פתיחה
  useEffect(() => {
    if (!active || !cwd) return;
    setLoading(!cache.has(cwd));
    api
      .commands(cwd)
      .then((l) => {
        cache.set(cwd, l);
        setList(l);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [active, cwd]);

  const rows = useMemo<Row[]>(() => {
    const q = query.toLowerCase();
    const all: Row[] = [
      ...(withLocal ? LOCAL_COMMANDS.map((c) => ({ ...c, group: "mifkada" as const })) : []),
      ...list.filter((c) => !LOCAL.has(c.name)).map((c) => ({ ...c, group: c.builtin ? ("cc" as const) : ("yours" as const), he: descFor(c.name) })),
    ];
    if (!q) return all;
    const score = (c: Row) => {
      const n = c.name.toLowerCase();
      if (n === q) return 0;
      if (n.startsWith(q)) return 1;
      if (c.aliases?.some((a) => a.startsWith(q))) return 2;
      if (n.includes(q)) return 3;
      if (`${c.he ?? ""} ${c.description}`.toLowerCase().includes(q)) return 4;
      return 9;
    };
    const order: Record<Group, number> = { mifkada: 0, cc: 1, yours: 2 };
    const hits = all.map((c) => [score(c), c] as const).filter(([sc]) => sc < 9);
    // כל קבוצה פעם אחת; בתוכה התאמה בתחילת השם קודם
    return hits
      .sort((a, b) => order[a[1].group] - order[b[1].group] || a[0] - b[0] || a[1].name.localeCompare(b[1].name))
      .map(([, c]) => c);
  }, [list, query, withLocal]);

  // תפריט שני: האפשרויות של הפקודה שנבחרה
  const argCmd = arg ? [...(withLocal ? LOCAL_COMMANDS : []), ...list].find((c) => c.name === arg.name) : undefined;
  const argOptions = useMemo(() => {
    if (!arg || !argCmd) return null;
    const all = commandOptions(argCmd.name, argCmd.argumentHint);
    if (!all) return null;
    const q = arg.q.toLowerCase();
    return q ? all.filter((o) => o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q)) : all;
  }, [arg, argCmd]);

  useEffect(() => setIdx(0), [query, arg?.name, arg?.q]);
  useEffect(() => {
    boxRef.current?.querySelector(`[data-i="${idx}"]`)?.scrollIntoView({ block: "nearest" });
  }, [idx]);

  // הניווט במקלדת מגיע מהשדה עצמו
  keyRef.current = (e) => {
    if (!active) return false;
    if (arg) {
      if (!argOptions?.length) return false;
      if (e.key === "ArrowDown") setIdx((i) => Math.min(argOptions.length - 1, i + 1));
      else if (e.key === "ArrowUp") setIdx((i) => Math.max(0, i - 1));
      else if (e.key === "Escape") onClose();
      else if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") onPickArg?.(arg.name, argOptions[idx]?.value ?? arg.q);
      else return false;
      e.preventDefault();
      return true;
    }
    if (e.key === "ArrowDown") setIdx((i) => Math.min(rows.length - 1, i + 1));
    else if (e.key === "ArrowUp") setIdx((i) => Math.max(0, i - 1));
    else if (e.key === "Escape") onClose();
    else if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
      const c = rows[idx];
      if (!c) return false;
      onPick(c, e.key === "Enter" && !c.argumentHint);
    } else return false;
    e.preventDefault();
    return true;
  };

  if (!active) return null;
  if (arg) {
    if (!argOptions?.length) return null;
    const cur = current?.[arg.name];
    return (
      <div ref={boxRef} className="absolute bottom-full mb-2 start-5 z-30 w-[min(420px,calc(100%-2.5rem))] card shadow-2xl overflow-hidden flex flex-col max-h-[min(420px,55vh)]">
        <div className="mono-label px-3 pt-2.5 pb-1" dir="ltr" style={{ textAlign: isRTL() ? "right" : "left" }}>
          /{arg.name}
        </div>
        <div className="overflow-y-auto p-1.5 pt-0 flex-1 min-h-0">
          {argOptions.map((o, i) => {
            const sel = i === idx;
            return (
              <button
                key={o.value}
                data-i={i}
                onMouseMove={() => setIdx(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPickArg?.(arg.name, o.value);
                }}
                className={cn("w-full text-start rounded-[10px] px-2.5 py-1.5 flex items-center gap-2.5", sel && "bg-blue text-white")}
              >
                <span className="size-4 shrink-0 grid place-items-center">{(cur === o.value || (arg.name === "model" && cur?.includes(o.value))) && <Check className="size-4" />}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13.5px] font-medium">{o.label}</span>
                  {o.hint && <span className={cn("block truncate text-[12px]", sel ? "text-white/80" : "text-muted")}>{o.hint}</span>}
                </span>
                {o.label.toLowerCase() !== o.value.toLowerCase() && <span className={cn("mono text-[11px] shrink-0", sel ? "text-white/65" : "text-muted/60")}>{o.value}</span>}
              </button>
            );
          })}
        </div>
        <div className="text-[11px] text-muted px-3 py-1.5 border-t border-border/50 flex gap-3 shrink-0 max-sm:hidden">
          <span>{t("navSelect")}</span>
          <span>{t("navSwitch")}</span>
          <span>{t("navClose")}</span>
        </div>
      </div>
    );
  }
  let last = "";
  return (
    <div
      ref={boxRef}
      className="absolute bottom-full mb-2 start-5 z-30 w-[min(560px,calc(100%-2.5rem))] card shadow-2xl overflow-hidden flex flex-col max-h-[min(420px,55vh)]"
    >
      <div className="overflow-y-auto p-1.5 flex-1 min-h-0">
        {loading && !rows.length && (
          <div className="flex items-center gap-2 text-muted text-sm px-3 py-3">
            <Spinner className="size-4" /> {t("loading")}
          </div>
        )}
        {!loading && !rows.length && <div className="text-muted text-sm px-3 py-3">{t("noMatch")}</div>}
        {rows.map((c, i) => {
          const head = c.group !== last ? groupLabel(c.group) : null;
          last = c.group;
          const Icon = c.group === "mifkada" ? Zap : c.group === "cc" ? Terminal : Sparkles;
          const sel = i === idx;
          return (
            <div key={`${c.group}:${c.name}`}>
              {head && <div className="mono-label px-2.5 pt-2.5 pb-1">{head}</div>}
              <button
                data-i={i}
                onMouseMove={() => setIdx(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(c, !c.argumentHint);
                }}
                className={cn("w-full text-start rounded-[10px] px-2.5 py-1.5 flex items-start gap-2.5", sel && "bg-blue text-white")}
              >
                <span className={cn("size-6 shrink-0 rounded-md grid place-items-center mt-0.5", sel ? "bg-white/20" : "bg-surface-2")}>
                  <Icon className={cn("size-3.5", sel ? "text-white" : "text-muted")} />
                </span>
                <span className="flex-1 min-w-0">
                  <span dir="ltr" className={cn("flex items-baseline gap-2 min-w-0", isRTL() && "justify-end")}>
                    <span className="mono text-[13px] font-medium shrink-0">/{c.name}</span>
                    {c.argumentHint && <span className={cn("mono text-[11px] truncate max-w-[55%]", sel ? "text-white/65" : "text-muted/60")}>{c.argumentHint}</span>}
                  </span>
                  <span dir="auto" className={cn("block truncate text-[12px] leading-snug", sel ? "text-white/85" : "text-muted")}>
                    {c.he ?? firstSentence(c.description)}
                  </span>
                </span>
              </button>
            </div>
          );
        })}
      </div>
      <div className="text-[11px] text-muted px-3 py-1.5 border-t border-border/50 flex gap-3 shrink-0 max-sm:hidden">
        <span>{t("navSelect")}</span>
        <span>{t("navRun")}</span>
        <span>{t("navComplete")}</span>
        <span>{t("navClose")}</span>
        <span className="ms-auto tabular">{rows.length}</span>
      </div>
    </div>
  );
}

/** תיאורים של skills ארוכים מאוד: משפט ראשון בלבד */
function firstSentence(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  const m = /^(.{20,140}?[.!?:](?=\s|$))/.exec(t);
  return (m ? m[1] : t.slice(0, 140)).replace(/[.:]$/, "");
}
