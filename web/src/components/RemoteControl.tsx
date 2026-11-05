import { useEffect, useState } from "react";
import { Smartphone, ExternalLink } from "lucide-react";
import { api, type SystemPrefs } from "../api";
import { send } from "../ws";
import { useStore } from "../store";
import { SETTINGS_COLORS } from "../lib/settingsColors";
import { strings, useT } from "../i18n";
import { Spinner } from "./Spinner";

const S = strings({
  he: {
    onTitle: "זמין באפליקציה של Claude. לחיצה מכבה",
    offTitle: "להפוך את הסשן לזמין באפליקציה של Claude (Remote Control)",
    pillTitle: "זמין גם באפליקציה של Claude: {url}",
    onPhone: "בטלפון",
    title: "Remote Control של Claude",
    desc1: "כל סשן במפקדה זמין גם באפליקציה של Claude בטלפון וב-claude.ai/code, באותו סשן ובמקביל, כמו ב-VS Code. בכל צ'אט יש כפתור",
    desc2: "להדלקה או כיבוי.",
    auto: "להפעיל אוטומטית בכל סשן חדש",
    none: "אין סשנים חיים",
    open: "פתח",
    off: "כבוי",
  },
  en: {
    onTitle: "Available in the Claude app. Click to turn off",
    offTitle: "Make this session available in the Claude app (Remote Control)",
    pillTitle: "Also available in the Claude app: {url}",
    onPhone: "On phone",
    title: "Claude Remote Control",
    desc1: "Every session in Mifkada is also available in the Claude app on your phone and at claude.ai/code, the same session at the same time, like in VS Code. Every chat has a",
    desc2: "button to turn it on or off.",
    auto: "Turn on automatically for every new session",
    none: "No live sessions",
    open: "Open",
    off: "Off",
  },
});

/** כפתור בכותרת של סשן חי: Remote Control בתוך הסשן (כמו ב-VS Code). הסשן נשאר כאן וזמין גם בטלפון */
export function RcLiveButton({ liveId, url }: { liveId: string; url: string | null | undefined }) {
  const [busy, setBusy] = useState(false);
  const on = Boolean(url);
  const t = useT(S);
  return (
    <button
      onClick={() => {
        setBusy(true);
        send({ t: "set_remote", liveId, on: !on });
        setTimeout(() => setBusy(false), 2500);
      }}
      data-active={on}
      className="tool-btn"
      title={on ? t("onTitle") : t("offTitle")}
    >
      {busy && !on ? <Spinner className="size-4" /> : <Smartphone className="size-4" />}
    </button>
  );
}

/** תגית בשורת הסטטוס: הסשן זמין בטלפון, לחיצה פותחת אותו ב-claude.ai */
export function RcLivePill({ url }: { url: string | null | undefined }) {
  const t = useT(S);
  if (!url) return null;
  return (
    <button onClick={() => window.open(url, "_blank")} className="no-drag flex items-center gap-1 text-blue hover:underline normal-case" title={t("pillTitle", { url })}>
      <Smartphone className="size-3" /> {t("onPhone")}
    </button>
  );
}

/** קטע בהגדרות: Remote Control אוטומטי, ורשימת הסשנים החיים עם הקישור של כל אחד */
export function RcSection() {
  const lives = useStore((s) => s.lives);
  const [sys, setSys] = useState<SystemPrefs | null>(null);
  const t = useT(S);
  useEffect(() => {
    api
      .settings()
      .then((s) => setSys((s as unknown as { system: SystemPrefs }).system))
      .catch(() => undefined);
  }, []);
  const save = async (patch: Partial<SystemPrefs>) => setSys(await api.setSystem(patch));
  return (
    <section id="rc" className="card p-5 space-y-4 scroll-mt-6">
      <div className="flex items-center gap-2">
        <span className="ios-icon" style={{ background: SETTINGS_COLORS.rc }}>
          <Smartphone />
        </span>
        <h2 className="font-semibold text-lg">{t("title")}</h2>
      </div>
      <p className="text-sm text-muted leading-relaxed">
        {t("desc1")} <Smartphone className="inline size-3.5" /> {t("desc2")}
      </p>
      {sys && (
        <label className="flex items-center gap-2.5 text-sm">
          <input type="checkbox" checked={sys.rcLive} onChange={(e) => void save({ rcLive: e.target.checked })} className="accent-blue size-4" />
          {t("auto")}
        </label>
      )}
      <div className="group-list fill">
        {lives.length === 0 && <div className="px-4 py-3 text-sm text-muted">{t("none")}</div>}
        {lives.map((l) => (
          <div key={l.liveId} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span className="flex-1 min-w-0 truncate" dir="auto">
              {l.title}
            </span>
            {l.remoteUrl ? (
              <button onClick={() => window.open(l.remoteUrl!, "_blank")} className="text-blue flex items-center gap-1 shrink-0">
                <ExternalLink className="size-3.5" /> {t("open")}
              </button>
            ) : (
              <span className="text-muted shrink-0">{t("off")}</span>
            )}
            <RcLiveButton liveId={l.liveId} url={l.remoteUrl} />
          </div>
        ))}
      </div>
    </section>
  );
}
