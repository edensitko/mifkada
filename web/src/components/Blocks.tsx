import { lineDiff } from "../lib/diff";
import { memo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown, ChevronLeft, ChevronRight, Wrench, AlertTriangle, Brain, Terminal, FileText, FilePlus2, Pencil, FolderSearch, Search, Globe, Bot, Sparkles, History, type LucideIcon } from "lucide-react";
import { FileText as FileIcon, Copy, Check } from "lucide-react";
import { cn, summarizeToolInput } from "../lib/util";
import type { Visual } from "../lib/groups";
import Avatar from "./Avatar";
import SpeakButton from "./SpeakButton";
import type { Block, TranscriptMessage } from "../../../shared/protocol";
import { groupRuns, isToolOnly } from "../lib/transcript";
import { isRTL, strings, tr, useT } from "../i18n";

const S = strings({
  he: {
    yesterday: "אתמול {hm}",
    more: "עוד",
    error: "שגיאה",
    result: "תוצאה",
    lines: "{n} שורות",
    thinking: "חשיבה",
    fromPhone: "📱 מהטלפון",
    rewindHint: "להחזיר את הקבצים למצב שלפני ההודעה הזו",
    rewind: "חזור לכאן",
    image: "[תמונה]",
    oneAction: "פעולה אחת",
    actions: "{n} פעולות",
    filesChanged: "{n} קבצים שונו",
    errors: "{n} שגיאות",
    copy: "העתק",
  },
  en: {
    yesterday: "Yesterday {hm}",
    more: "More",
    error: "Error",
    result: "Result",
    lines: "{n} lines",
    thinking: "Thinking",
    fromPhone: "📱 From phone",
    rewindHint: "Restore the files to how they were before this message",
    rewind: "Rewind to here",
    image: "[Image]",
    oneAction: "1 action",
    actions: "{n} actions",
    filesChanged: "{n} files changed",
    errors: "{n} errors",
    copy: "Copy",
  },
});

/*
 * מה שמוסתר מהודעת המשתמש בתצוגה, בשתי השפות (הודעה שנשלחה בשפה אחת יכולה להיות מוצגת בשנייה):
 * ההנחיה של השיחה הקולית (VOICE_TAG ב-useVoiceConversation) ורשימת הקבצים המצורפים שהשרת מוסיף.
 */
const VOICE_TAG_RE = /^\((?:מצב שיחה קולית|Voice chat mode):[^)]*\)\n/;
const ATTACHED_RE = /\n\n(?:קבצים מצורפים \(שמורים במחשב|Attached files \()[\s\S]*$/;
const cleanUserText = (t: string) => t.replace(VOICE_TAG_RE, "").replace(ATTACHED_RE, "");

export { groupRuns, isToolOnly };

const TOOL_ICONS: Record<string, LucideIcon> = {
  Bash: Terminal,
  Read: FileText,
  Write: FilePlus2,
  Edit: Pencil,
  NotebookEdit: Pencil,
  Glob: FolderSearch,
  Grep: Search,
  WebFetch: Globe,
  WebSearch: Globe,
  Agent: Bot,
  Skill: Sparkles,
};

/** חץ של פריט מקופל: מצביע לכיוון הקריאה (שמאלה ב-RTL, ימינה ב-LTR) */
function Closed(props: { className?: string }) {
  return isRTL() ? <ChevronLeft {...props} /> : <ChevronRight {...props} />;
}

const DEFAULT_WHO: Visual = { color: "#5fd3c4", emoji: "✦", name: "Claude", square: false };

function timeOf(ts?: string): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const today = new Date();
  const days = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  if (days === 0) return hm;
  if (days === 1) return tr(S, "yesterday", { hm });
  return `${d.getDate()}/${d.getMonth() + 1} ${hm}`;
}

/** כל בלוק טקסט מקבל כיוון לפי התוכן שלו: פסקה בעברית מימין לשמאל, באנגלית משמאל לימין. */
const AUTO_DIR = Object.fromEntries(
  (["p", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "table", "td", "th"] as const).map((tag) => [
    tag,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ({ node, ...props }: { node?: unknown } & Record<string, unknown>) => {
      const Tag = tag as unknown as React.ElementType;
      return <Tag dir="auto" {...props} />;
    },
  ]),
);

/** בלוק קוד עם כפתור העתקה בפינה */
function CodeBlock({ node, children, ...props }: React.HTMLAttributes<HTMLPreElement> & { node?: unknown }) {
  void node;
  const text = (function extract(n: React.ReactNode): string {
    if (typeof n === "string" || typeof n === "number") return String(n);
    if (Array.isArray(n)) return n.map(extract).join("");
    if (n && typeof n === "object" && "props" in n) return extract((n as { props: { children?: React.ReactNode } }).props.children);
    return "";
  })(children);
  return (
    <div className="relative group/code">
      <pre {...props}>{children}</pre>
      <span className="absolute top-1.5 end-1.5 opacity-0 group-hover/code:opacity-100 transition">
        <CopyButton text={text.replace(/\n$/, "")} />
      </span>
    </div>
  );
}

export function MarkdownText({ text }: { text: string }) {
  return (
    <div className="markdown text-[15px] leading-relaxed break-words">
      <Markdown remarkPlugins={[remarkGfm]} components={{ ...AUTO_DIR, pre: CodeBlock }}>
        {text}
      </Markdown>
    </div>
  );
}

/** diff קטן בתוך הצ'אט לעריכות של Claude: Edit (old→new), MultiEdit, ו-Write כקובץ חדש. */
function InlineDiff({ name, input }: { name: string; input: unknown }) {
  const i = (input ?? {}) as Record<string, unknown>;
  const pairs: Array<{ old: string; new: string }> = [];
  if (name === "Edit" && typeof i.old_string === "string" && typeof i.new_string === "string") pairs.push({ old: i.old_string, new: i.new_string });
  else if (name === "MultiEdit" && Array.isArray(i.edits)) {
    for (const e of i.edits as Array<Record<string, unknown>>) {
      if (typeof e.old_string === "string" && typeof e.new_string === "string") pairs.push({ old: e.old_string, new: e.new_string });
    }
  } else if (name === "Write" && typeof i.content === "string") pairs.push({ old: "", new: i.content });
  if (pairs.length === 0) return null;
  const MAX = 40;
  let shown = 0;
  return (
    <div dir="ltr" className="diff-inline mono text-[11.5px] leading-[1.55] max-h-72 overflow-auto">
      {pairs.map((p, k) => {
        // diff אמיתי: רק השורות שהשתנו והקשר קצר (Codex שולח את כל הקובץ לפני ואחרי)
        const rows = lineDiff(p.old, p.new);
        return (
          <div key={k} className={k > 0 ? "border-t border-border/50 mt-1 pt-1" : ""}>
            {rows.map((r, j) => {
              if (shown++ >= MAX) return j === rows.length - 1 ? <div key={j} className="px-3 text-muted">…</div> : null;
              if (r.sign === "…") return <div key={j} className="px-3 text-muted select-none">⋯</div>;
              return (
                <div key={j} className={r.sign === "-" ? "diff-del" : r.sign === "+" ? "diff-add" : "opacity-60"}>
                  <span className="select-none opacity-60 w-4 inline-block text-center">{r.sign}</span>
                  {r.text || " "}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function ToolUse({ b }: { b: Extract<Block, { type: "tool_use" }> }) {
  const [open, setOpen] = useState(false);
  const t = useT(S);
  const Icon = TOOL_ICONS[b.name] ?? Wrench;
  const summary = summarizeToolInput(b.name, b.input);
  const command = b.name === "Bash" && b.input && typeof (b.input as { command?: unknown }).command === "string" ? (b.input as { command: string }).command : null;
  return (
    <div className="tool-card max-w-[88%]">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-2.5 py-1.5 text-start">
        <span className="size-5 rounded-md grid place-items-center bg-accent/15 text-accent shrink-0">
          <Icon className="size-3.5" />
        </span>
        <span className="text-[12.5px] font-medium shrink-0">{b.name}</span>
        {summary && <span className="text-muted truncate ltr text-[12px] mono flex-1">{summary}</span>}
        {open ? <ChevronDown className="size-4 text-muted ms-auto shrink-0" /> : <Closed className="size-4 text-muted ms-auto shrink-0" />}
      </button>
      {command && !open && (
        <div className="relative">
          <pre className="ltr px-3 pb-2 text-[11.5px] mono text-muted whitespace-pre-wrap max-h-[3.2rem] overflow-hidden">{command}</pre>
          {(command.split("\n").length > 3 || command.length > 260) && (
            <div className="absolute inset-x-0 bottom-0 h-7 tool-fade flex items-end justify-center">
              <button onClick={() => setOpen(true)} className="mono-label hover:text-foreground">{t("more")}</button>
            </div>
          )}
        </div>
      )}
      {!open && (b.name === "Edit" || b.name === "MultiEdit" || b.name === "Write") && <InlineDiff name={b.name} input={b.input} />}
      {open && <pre className="ltr px-3 pb-2.5 text-xs mono whitespace-pre-wrap max-h-80 overflow-auto">{JSON.stringify(b.input, null, 2)}</pre>}
    </div>
  );
}

function ToolResult({ b }: { b: Extract<Block, { type: "tool_result" }> }) {
  const [open, setOpen] = useState(false);
  const t = useT(S);
  const lines = b.content.split("\n");
  const first = lines[0]?.slice(0, 120) ?? "";
  return (
    <div className={cn("tool-result max-w-[88%]", b.isError && "is-error")}>
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-3 py-1.5 text-start">
        {b.isError ? <AlertTriangle className="size-3.5 text-danger shrink-0" /> : <span className="mono text-muted text-xs shrink-0">←</span>}
        <span className="mono-label">{b.isError ? t("error") : t("result")}</span>
        <span className="ltr text-xs mono truncate flex-1 text-muted">{first}</span>
        {lines.length > 1 && <span className="tabular text-[11px] text-muted shrink-0">{t("lines", { n: lines.length })}</span>}
        {open ? <ChevronDown className="size-4 text-muted shrink-0" /> : <Closed className="size-4 text-muted shrink-0" />}
      </button>
      {open && <pre className="ltr px-3 pb-2 text-xs mono whitespace-pre-wrap max-h-96 overflow-auto">{b.content}</pre>}
    </div>
  );
}

function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-sm text-muted">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 italic">
        <Brain className="size-3.5" /> {tr(S, "thinking")} {open ? <ChevronDown className="size-3.5" /> : <Closed className="size-3.5" />}
      </button>
      {open && <div dir="auto" className="bidi mt-1 border-s-2 border-border ps-3 whitespace-pre-wrap">{text}</div>}
    </div>
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** continued: הודעה של Claude שבאה ישר אחרי הודעה שלו, בלי לחזור על האווטאר והשם. */
export function MessageView({ m, who, onRewind, continued }: { m: TranscriptMessage; who?: Visual; onRewind?: (uuid: string) => void; continued?: boolean }) {
  const v = who ?? DEFAULT_WHO;
  const time = timeOf(m.timestamp);
  if (m.role === "user") {
    const texts = m.blocks.filter((b) => b.type === "text");
    const results = m.blocks.filter((b) => b.type === "tool_result");
    const attached = m.blocks.filter((b): b is Extract<Block, { type: "file" }> => b.type === "file");
    return (
      <div className="space-y-2">
        {texts.length > 0 && (
          <div className="group/u flex flex-col items-end gap-0.5">
            <div className="bubble-user px-4 py-2 max-w-[78%] whitespace-pre-wrap text-[15px] leading-relaxed">{m.phone && <div className="text-[11px] opacity-75 mb-0.5">{tr(S, "fromPhone")}</div>}{texts.map((b, i) => {
              if (b.type !== "text") return null;
              return <div key={i} dir="auto" className="bidi">{cleanUserText(b.text)}</div>;
            })}</div>
            {attached.length > 0 && (
              <div className="flex flex-wrap justify-end gap-1.5 max-w-[78%]">
                {attached.map((f) =>
                  f.mime.startsWith("image/") ? (
                    <img key={f.path} src={`/api/uploads/file?path=${encodeURIComponent(f.path)}`} alt={f.name} className="max-h-48 max-w-64 rounded-2xl object-cover border border-border" />
                  ) : (
                    <span key={f.path} className="flex items-center gap-1.5 rounded-xl bg-surface border border-border px-2.5 py-1.5 text-xs" title={f.path}>
                      <FileIcon className="size-4 text-muted" /> {f.name}
                    </span>
                  ),
                )}
              </div>
            )}
            <div className="flex items-center gap-2 px-1 text-[11px] text-muted">
              {time && <span>{time}</span>}
              {onRewind && UUID.test(m.uuid) && (
                <button onClick={() => onRewind(m.uuid)} className="opacity-0 group-hover/u:opacity-100 flex items-center gap-1 text-blue hover:underline transition" title={tr(S, "rewindHint")}>
                  <History className="size-3" /> {tr(S, "rewind")}
                </button>
              )}
            </div>
          </div>
        )}
        {results.length > 0 && <div className="ps-9 space-y-1.5">{results.map((b, i) => (b.type === "tool_result" ? <ToolResult key={i} b={b} /> : null))}</div>}
      </div>
    );
  }
  const hasText = m.blocks.some((b) => b.type === "text");
  const lastText = m.blocks.map((b) => b.type).lastIndexOf("text");
  return (
    <div className={cn("flex gap-3", continued && "-mt-3")}>
      {continued ? <span className="size-6 shrink-0" /> : <Avatar emoji={v.emoji} color={v.color} image={v.image} size="sm" square={v.square} className="mt-1" />}
      <div className="min-w-0 flex-1 space-y-1.5">
        {hasText && !continued && (
          <div className="text-[11px] text-muted flex items-center gap-2 px-1">
            <span>{v.name}</span>
          </div>
        )}
        {m.blocks.map((b, i) => {
          switch (b.type) {
            case "text":
              return (
                <div key={i} className="group/a flex items-end gap-1.5">
                  <div className="max-w-[88%] w-fit flex flex-col">
                    <div className="bubble-assistant px-4 py-2">
                      <MarkdownText text={b.text} />
                    </div>
                    {i === lastText && time && <span className="text-[11px] text-muted px-2 mt-0.5 tabular">{time}</span>}
                  </div>
                  <span className="flex flex-col gap-0.5 opacity-0 group-hover/a:opacity-100 transition mb-1">
                    <CopyButton text={b.text} />
                    <SpeakButton text={b.text} />
                  </span>
                </div>
              );
            case "thinking":
              return <Thinking key={i} text={b.text} />;
            case "tool_use":
              return <ToolUse key={i} b={b} />;
            case "tool_result":
              return <ToolResult key={i} b={b} />;
            case "image":
              return (
                <div key={i} className="mono-label">
                  {tr(S, "image")}
                </div>
              );
          }
        })}
      </div>
    </div>
  );
}

const descOf = (b: Extract<Block, { type: "tool_use" }>): string => {
  const i = (b.input ?? {}) as Record<string, unknown>;
  if (typeof i.description === "string" && i.description) return i.description;
  return summarizeToolInput(b.name, b.input) || b.name;
};

/**
 * רצף של קריאות לכלים, מקופל לשורה אחת כמו באפליקציה של Claude:
 * "6 פעולות · Bash ×4, Edit ×2" ומתחת הפעולה האחרונה. לחיצה פותחת את כל הפירוט.
 */
export function ToolRun({ msgs, who, active }: { msgs: TranscriptMessage[]; who?: Visual; active?: boolean }) {
  const [open, setOpen] = useState(false);
  const t = useT(S);
  const uses = msgs.flatMap((m) => m.blocks.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use"));
  const errors = msgs.flatMap((m) => m.blocks.filter((b) => b.type === "tool_result" && b.isError)).length;
  const counts = new Map<string, number>();
  for (const u of uses) counts.set(u.name, (counts.get(u.name) ?? 0) + 1);
  const files = new Set(uses.filter((u) => ["Edit", "MultiEdit", "Write"].includes(u.name)).map((u) => String((u.input as Record<string, unknown>)?.file_path ?? "")));
  const last = uses[uses.length - 1];
  const icons = [...counts.keys()].slice(0, 4);
  const v = who ?? DEFAULT_WHO;
  if (!uses.length) return <>{msgs.map((m) => <MessageView key={m.uuid} m={m} who={who} continued />)}</>;
  return (
    <div className="flex gap-3 -mt-2">
      <span className="size-6 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="tool-group max-w-[88%]">
          <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2.5 px-3 py-2 text-start">
            <span className={cn("flex -space-x-1.5 shrink-0", isRTL() && "space-x-reverse")}>
              {icons.map((n) => {
                const Icon = TOOL_ICONS[n] ?? Wrench;
                return (
                  <span key={n} className="size-5 rounded-md grid place-items-center bg-surface ring-2 ring-[var(--color-background)]" style={{ color: v.color }}>
                    <Icon className="size-3" />
                  </span>
                );
              })}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[12.5px] font-medium">
                {active && <span className="lamp text-teal pulse" />}
                {uses.length === 1 ? t("oneAction") : t("actions", { n: uses.length })}
                <span className="text-muted font-normal truncate">
                  · {[...counts].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(", ")}
                  {files.size > 0 && ` · ${t("filesChanged", { n: files.size })}`}
                </span>
                {errors > 0 && <span className="text-danger font-normal">· {t("errors", { n: errors })}</span>}
              </span>
              {!open && last && (
                <span dir="auto" className="block truncate text-[12px] text-muted mt-0.5">
                  {descOf(last)}
                </span>
              )}
            </span>
            {open ? <ChevronDown className="size-4 text-muted shrink-0" /> : <Closed className="size-4 text-muted shrink-0" />}
          </button>
        </div>
        {open && (
          <div className="space-y-3 mt-3">
            {msgs.map((m) => (
              <MessageView key={m.uuid} m={m} who={who} continued />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** העתקת הודעה ללוח, עם סימון קצר שהועתק */
export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className="size-6 rounded-md grid place-items-center text-muted hover:text-foreground hover:bg-[var(--color-fill)]"
      title={tr(S, "copy")}
    >
      {done ? <Check className="size-3.5 text-teal" /> : <Copy className="size-3.5" />}
    </button>
  );
}



/*
 * גרסאות ממוזכרות לרשימת הצ'אט: בכל טוקן שמגיע בזרימה הרשימה כולה מתרנדרת מחדש,
 * ובשיחה של מאות הודעות (markdown לכל אחת) זה מה שגרם לקרטוע. הודעה שלא השתנתה לא מצוירת שוב.
 */
const sameWho = (a?: Visual, b?: Visual) => a === b || (a?.color === b?.color && a?.emoji === b?.emoji && a?.name === b?.name);
export const MessageViewMemo = memo(MessageView, (a, b) => a.m === b.m && a.continued === b.continued && Boolean(a.onRewind) === Boolean(b.onRewind) && sameWho(a.who, b.who));
export const ToolRunMemo = memo(
  ToolRun,
  (a, b) => a.active === b.active && a.msgs.length === b.msgs.length && a.msgs[0] === b.msgs[0] && a.msgs[a.msgs.length - 1] === b.msgs[b.msgs.length - 1] && sameWho(a.who, b.who),
);
