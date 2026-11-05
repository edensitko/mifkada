import { useMemo } from "react";
import { GitBranch, FolderGit2, Bot, Cpu, ShieldCheck, Radio, BellDot, Sparkles, Gauge } from "lucide-react";
import { providerLabel, useProviders } from "../lib/providers";
import { useStore } from "../store";
import { cn, modelLabel, MODE_OPTIONS } from "../lib/util";
import { strings, useT } from "../i18n";
import { projectVisual } from "../lib/groups";

const S = strings({
  he: { live: "{n} חיים", running: "{n} עובדים", waiting: "{n} ממתינים לך", project: "פרויקט", branch: "ענף", agent: "אייג'נט", model: "מודל", mode: "הרשאות", noAgent: "בלי אייג'נט", provider: "סוכן", context: "הקשר {p}%", contextHint: "{used} מתוך {size} טוקנים בחלון ההקשר" },
  en: { live: "{n} live", running: "{n} working", waiting: "{n} waiting for you", project: "Project", branch: "Branch", agent: "Agent", model: "Model", mode: "Permissions", noAgent: "No agent", provider: "Runs on", context: "Context {p}%", contextHint: "{used} of {size} tokens in the context window" },
});

/**
 * שורת המצב בתחתית, כמו ב-IDE: של הסשן הפתוח (פרויקט, ענף, אייג'נט, מודל, הרשאות) ושל כל המפקדה (כמה סשנים חיים,
 * כמה עובדים עכשיו, וכמה ממתינים לך). לחיצה על "ממתינים" פותחת את תיבת ההמתנה.
 */
export default function StatusBar() {
  const t = useT(S);
  const { selection, sessions, lives, projectThemes, tasks, select } = useStore();
  const allCwds = useMemo(() => new Set(sessions.map((s) => s.cwd)), [sessions]);
  const providers = useProviders();

  const live = selection?.kind === "live" ? lives.find((l) => l.liveId === selection.liveId) : undefined;
  const row =
    selection?.kind === "history" ? sessions.find((r) => r.sessionId === selection.sessionId) : live?.sessionId ? sessions.find((r) => r.sessionId === live.sessionId) : undefined;
  const cwd = live?.cwd ?? row?.projectCwd ?? row?.cwd;
  const agent = live?.agent ?? row?.tag ?? null;
  const running = lives.filter((l) => l.state === "running" || l.state === "starting").length;
  const waiting = lives.reduce((n, l) => n + l.pendingPermissions, 0) + tasks.filter((x) => x.status === "review").length;

  const item = (Icon: typeof Bot, text: string, title: string, extra?: string) => (
    <span className={cn("status-item flex items-center gap-1 min-w-0", extra)} title={title}>
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{text}</span>
    </span>
  );

  return (
    <footer className="status-bar shrink-0 h-[26px] px-2 flex items-center gap-2 text-[11.5px] text-muted border-t border-[var(--color-separator)]">
      {cwd && item(FolderGit2, projectVisual(cwd, allCwds, projectThemes).name, t("project"), "max-w-48")}
      {row?.gitBranch && item(GitBranch, row.gitBranch, t("branch"), "ltr max-w-48")}
      {(live || row) && item(Sparkles, providerLabel(live?.provider ?? row?.provider, providers), t("provider"))}
      {(live || row) && item(Bot, agent ?? t("noAgent"), t("agent"))}
      {live && item(Cpu, live.provider && live.provider !== "claude" ? live.model || "-" : modelLabel(live.model), t("model"))}
      {live && item(ShieldCheck, MODE_OPTIONS.find((m) => m.value === live.permissionMode)?.label ?? live.permissionMode, t("mode"))}
      {live?.context &&
        item(
          Gauge,
          t("context", { p: Math.round((100 * live.context.used) / live.context.size) }),
          t("contextHint", { used: live.context.used.toLocaleString(), size: live.context.size.toLocaleString() }),
          live.context.used / live.context.size > 0.85 ? "text-warn" : undefined,
        )}
      <span className="flex-1" />
      {lives.length > 0 && item(Radio, running ? t("running", { n: running }) : t("live", { n: lives.length }), t("live", { n: lives.length }), running ? "text-ok" : undefined)}
      {waiting > 0 && (
        <button onClick={() => select({ kind: "inbox" })} className="status-item flex items-center gap-1 text-warn hover:underline">
          <BellDot className="size-3" />
          {t("waiting", { n: waiting })}
        </button>
      )}
    </footer>
  );
}
