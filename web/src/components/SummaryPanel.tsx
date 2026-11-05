import { cn } from "../lib/util";
import { useEffect, useState } from "react";
import { X, RefreshCw, ListChecks, CheckCircle2, Plus, KanbanSquare, Archive, LogOut } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { relTime } from "../lib/util";
import SpeakButton from "./SpeakButton";
import type { SessionSummary } from "../../../shared/protocol";
import { strings, useT } from "../i18n";
import { Spinner, Spin } from "./Spinner";

const S = strings({
  he: {
    tasksAdded: "{n} משימות נוספו לתור",
    closeTitle: "סגירת הסשן",
    summaryTitle: "סיכום הסשן",
    messages: "{n} הודעות",
    readAloud: "הקרא",
    speechOpen: "נשארו {n} דברים פתוחים: {list}.",
    speechNoneOpen: "אין דברים פתוחים.",
    closeNowHint: "בלי לחכות לסיכום ובלי משימות",
    closeNow: "סגור עכשיו",
    resummarize: "סכם מחדש",
    close: "סגור",
    summarizing: "Claude קורא את השיחה ומסכם",
    done: "נעשה",
    open: "נשאר פתוח",
    createN: "צור {n} משימות",
    toBoard: "לקנבן",
    noneOpen: "אין פריטים פתוחים. הכול סגור.",
    queued: "בתור",
    task: "משימה",
    archive: "להעביר לארכיון",
    closeNoTasks: "סגור בלי משימות",
    finishNoTasks: "סיים בלי משימות",
    createAndClose: "צור {n} משימות וסגור",
    createAndFinish: "צור {n} משימות וסיים",
    finish: "סיים",
  },
  en: {
    tasksAdded: "{n} tasks added to the queue",
    closeTitle: "Close session",
    summaryTitle: "Session summary",
    messages: "{n} messages",
    readAloud: "Read aloud",
    speechOpen: "{n} things are still open: {list}.",
    speechNoneOpen: "Nothing is left open.",
    closeNowHint: "Without waiting for the summary and without tasks",
    closeNow: "Close now",
    resummarize: "Summarize again",
    close: "Close",
    summarizing: "Claude is reading the conversation and summarizing",
    done: "Done",
    open: "Still open",
    createN: "Create {n} tasks",
    toBoard: "Open Board",
    noneOpen: "Nothing open. All done.",
    queued: "Queued",
    task: "Task",
    archive: "Move to archive",
    closeNoTasks: "Close without tasks",
    finishNoTasks: "Finish without tasks",
    createAndClose: "Create {n} tasks and close",
    createAndFinish: "Create {n} tasks and finish",
    finish: "Finish",
  },
});

/** סיכום סשן: מה נעשה, מה נשאר, ויצירת משימות למה שנשאר. */
export default function SummaryPanel({
  sessionId,
  cwd,
  agent,
  onClose,
  closing,
  isLive,
  onFinish,
}: {
  sessionId: string;
  cwd: string;
  agent: string | null;
  onClose: () => void;
  /** מצב סגירת סשן: סיכום, משימות למה שנשאר, ואז סגירה וארכיון */
  closing?: boolean;
  isLive?: boolean;
  onFinish?: (opts: { archive: boolean }) => Promise<void>;
}) {
  const [archive, setArchive] = useState(true);
  const [finishing, setFinishing] = useState(false);
  const setToast = useStore((s) => s.setToast);
  const t = useT(S);
  const select = useStore((s) => s.select);
  const [data, setData] = useState<SessionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [created, setCreated] = useState<Set<number>>(new Set());

  const generate = async () => {
    setRunning(true);
    try {
      const s = await api.summarize(sessionId);
      setData(s);
      setPicked(new Set(s.open.map((_, i) => i)));
      setCreated(new Set());
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    api
      .summary(sessionId)
      .then((s) => {
        setData(s);
        if (s) setPicked(new Set(s.open.map((_, i) => i)));
        setLoading(false);
        if (!s) void generate();
      })
      .catch(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const createTasks = async (indexes: number[]): Promise<number> => {
    if (!data) return 0;
    let n = 0;
    for (const i of indexes) {
      const o = data.open[i];
      if (!o || created.has(i)) continue;
      try {
        await api.createTask({ title: o.title, prompt: o.prompt, cwd, agent }, false);
        setCreated((c) => new Set(c).add(i));
        n++;
      } catch (e) {
        setToast((e as Error).message);
      }
    }
    if (n) setToast(t("tasksAdded", { n }));
    return n;
  };

  const finish = async (withTasks: boolean) => {
    if (!onFinish) return;
    setFinishing(true);
    try {
      if (withTasks) await createTasks([...picked]);
      await onFinish({ archive });
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setFinishing(false);
    }
  };

  return (
    <div className="card m-3 mb-0 p-4 space-y-3 max-h-[60%] overflow-y-auto">
      <div className="flex items-center gap-2">
        {closing ? <LogOut className="size-4 text-blue" /> : <ListChecks className="size-4 text-blue" />}
        <span className="font-semibold">{closing ? t("closeTitle") : t("summaryTitle")}</span>
        {data && <span className="text-[11px] text-muted">{relTime(data.createdAt)} · {t("messages", { n: data.messages })}</span>}
        {data && <SpeakButton className="ms-auto" label={t("readAloud")} text={() => `${data.summary.join(". ")}. ${data.open.length ? t("speechOpen", { n: data.open.length, list: data.open.map((o) => o.title).join(", ") }) : t("speechNoneOpen")}`} />}
        {closing && onFinish && (
          <button
            onClick={async () => {
              setFinishing(true);
              await onFinish({ archive: false });
            }}
            disabled={finishing}
            className={cn("rounded-full bg-danger/12 text-danger hover:bg-danger/20 px-3 py-1 text-[13px] font-medium disabled:opacity-50", !data && "ms-auto")}
            title={t("closeNowHint")}
          >
            {t("closeNow")}
          </button>
        )}
        <button onClick={generate} disabled={running} className="size-7 rounded-lg grid place-items-center hover:bg-surface-2 text-muted disabled:opacity-50" title={t("resummarize")}>
          <Spin on={running}><RefreshCw className="size-4" /></Spin>
        </button>
        <button onClick={onClose} className="size-7 rounded-lg grid place-items-center hover:bg-surface-2 text-muted" title={t("close")} aria-label={t("close")}>
          <X className="size-4" />
        </button>
      </div>

      {(loading || (running && !data)) && (
        <div className="flex items-center gap-2 text-sm text-muted py-4">
          <Spinner className="size-4" /> {t("summarizing")}
        </div>
      )}

      {data && (
        <>
          <ul className="space-y-1 text-[14px] leading-relaxed list-disc ps-5">
            {data.summary.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>

          {data.done.length > 0 && (
            <div className="space-y-1">
              <div className="mono-label">{t("done")}</div>
              <ul className="space-y-0.5 text-sm">
                {data.done.map((d, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <CheckCircle2 className="size-4 text-teal shrink-0 mt-0.5" />
                    <span dir="auto">{d}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="mono-label">{t("open")}</div>
              {data.open.length > 0 && (
                <>
                  <button onClick={() => createTasks([...picked])} disabled={picked.size === 0} className="ms-auto btn-primary px-3 py-1 text-xs flex items-center gap-1 disabled:opacity-40">
                    <Plus className="size-3.5" /> {t("createN", { n: picked.size })}
                  </button>
                  <button onClick={() => select({ kind: "board" })} className="btn-ghost px-2.5 py-1 text-xs flex items-center gap-1">
                    <KanbanSquare className="size-3.5" /> {t("toBoard")}
                  </button>
                </>
              )}
            </div>
            {data.open.length === 0 && <div className="text-sm text-muted">{t("noneOpen")}</div>}
            {data.open.map((o, i) => {
              const done = created.has(i);
              void done;
              return (
                <label key={i} className={"flex items-start gap-2 rounded-xl px-3 py-2 text-sm " + (done ? "bg-teal/10" : "bg-background")}>
                  <input type="checkbox" checked={picked.has(i)} disabled={done} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(i); else n.delete(i); return n; })} className="mt-1 accent-blue" />
                  <div className="min-w-0 flex-1">
                    <div dir="auto" className="font-medium">{o.title}</div>
                    <div dir="auto" className="text-xs text-muted line-clamp-2">{o.prompt}</div>
                  </div>
                  {done ? (
                    <span className="text-[11px] text-teal shrink-0">{t("queued")}</span>
                  ) : (
                    <button onClick={() => createTasks([i])} className="text-blue text-xs shrink-0 hover:underline">
                      {t("task")}
                    </button>
                  )}
                </label>
              );
            })}
          </div>

          {closing && (
            <div className="flex items-center gap-2 pt-2 border-t border-border/60">
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={archive} onChange={(e) => setArchive(e.target.checked)} className="accent-blue" />
                <Archive className="size-3.5 text-muted" /> {t("archive")}
              </label>
              <span className="flex-1" />
              <button onClick={() => finish(false)} disabled={finishing} className="btn-ghost px-3 py-1.5 text-sm disabled:opacity-50">
                {isLive ? t("closeNoTasks") : t("finishNoTasks")}
              </button>
              <button onClick={() => finish(true)} disabled={finishing} className="btn-primary px-3 py-1.5 text-sm flex items-center gap-1 disabled:opacity-50">
                {finishing ? <Spinner className="size-4" /> : <Plus className="size-4" />}
                {picked.size > 0 ? t(isLive ? "createAndClose" : "createAndFinish", { n: picked.size }) : isLive ? t("close") : t("finish")}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
