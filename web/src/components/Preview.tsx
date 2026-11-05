import { useEffect, useMemo, useState } from "react";
import { RotateCw, ExternalLink, Monitor, Smartphone, Tablet, Globe } from "lucide-react";
import { api, type DevPort } from "../api";
import { cn } from "../lib/util";
import { strings, useT, pick } from "../i18n";

const S = strings({
  he: {
    reload: "רענון",
    urlPlaceholder: "localhost:3000 או מספר פורט",
    desktop: "מחשב",
    tablet: "טאבלט",
    phone: "טלפון",
    openInBrowser: "פתח בדפדפן",
    preview: "תצוגה מקדימה",
    noServer: "לא נמצא שרת פיתוח של הפרויקט הזה. אפשר להריץ אותו בטרמינל (למשל npm run dev) או לבחור שרת שכבר רץ:",
    thisProject: "של הפרויקט",
    otherServers: "שרתים אחרים שרצים",
  },
  en: {
    reload: "Reload",
    urlPlaceholder: "localhost:3000 or a port number",
    desktop: "Desktop",
    tablet: "Tablet",
    phone: "Phone",
    openInBrowser: "Open in browser",
    preview: "Preview",
    noServer: "No dev server found for this project. Run one in the terminal (for example npm run dev) or pick a server that's already running:",
    thisProject: "This project",
    otherServers: "Other running servers",
  },
});

const KEY = "mifkada.preview.";
const WIDTHS = { desktop: null, tablet: 820, phone: 390 } as const;
type Device = keyof typeof WIDTHS;

const read = (k: string) => {
  try {
    return localStorage.getItem(KEY + k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(KEY + k, v);
  } catch {
    /* אין אחסון */
  }
};

/** דפדפן מובנה: תצוגה מקדימה של שרת הפיתוח של הפרויקט, ליד הצ'אט. */
export default function Preview({ cwd }: { cwd: string }) {
  const [ports, setPorts] = useState<DevPort[]>([]);
  const [url, setUrl] = useState(() => read(`url:${cwd}`) ?? "");
  const [draft, setDraft] = useState(url);
  const [device, setDevice] = useState<Device>(() => (read("device") as Device) || "desktop");
  const [reloadKey, setReloadKey] = useState(0);
  const t = useT(S);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .ports()
        .then((p) => alive && setPorts(p))
        .catch(() => undefined);
    void load();
    const id = setInterval(() => !document.hidden && void load(), 8000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // שרת שרץ מתוך תיקיית הפרויקט הזה, או שהפרויקט בתוך התיקייה שלו
  const mine = useMemo(() => ports.filter((p) => p.cwd && (p.cwd === cwd || p.cwd.startsWith(cwd + "/") || cwd.startsWith(p.cwd + "/"))), [ports, cwd]);
  useEffect(() => {
    if (!url && mine[0]) go(`http://localhost:${mine[0].port}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine.length]);

  function go(u: string) {
    let v = u.trim();
    if (!v) return;
    if (/^\d+$/.test(v)) v = `http://localhost:${v}`;
    else if (!/^https?:\/\//.test(v)) v = `http://${v}`;
    setUrl(v);
    setDraft(v);
    write(`url:${cwd}`, v);
    setReloadKey((k) => k + 1);
  }
  const pickDevice = (d: Device) => {
    setDevice(d);
    write("device", d);
  };
  const others = ports.filter((p) => !mine.includes(p));
  const width = WIDTHS[device];

  return (
    <div className="h-full flex flex-col" dir={pick("rtl", "ltr")}>
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border/70 bg-background/60">
        <button onClick={() => setReloadKey((k) => k + 1)} disabled={!url} className="size-7 rounded-md grid place-items-center text-muted hover:bg-surface-2 disabled:opacity-40" title={t("reload")}>
          <RotateCw className="size-4" />
        </button>
        <form
          className="flex-1 min-w-0"
          onSubmit={(e) => {
            e.preventDefault();
            go(draft);
          }}
        >
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("urlPlaceholder")} dir="ltr" className="w-full rounded-lg bg-background border px-2.5 py-1 text-[12.5px] mono outline-none focus:border-blue/60" />
        </form>
        <div className="segmented grid grid-cols-3 text-xs">
          {(
            [
              ["desktop", Monitor, t("desktop")],
              ["tablet", Tablet, t("tablet")],
              ["phone", Smartphone, t("phone")],
            ] as const
          ).map(([d, Icon, label]) => (
            <button key={d} data-active={device === d} onClick={() => pickDevice(d)} className="px-1.5 py-1" title={label}>
              <Icon className="size-3.5 mx-auto" />
            </button>
          ))}
        </div>
        <button onClick={() => url && window.open(url, "_blank")} disabled={!url} className="size-7 rounded-md grid place-items-center text-muted hover:bg-surface-2 disabled:opacity-40" title={t("openInBrowser")}>
          <ExternalLink className="size-4" />
        </button>
      </div>

      {url ? (
        <div className="flex-1 min-h-0 bg-surface-2/50 grid place-items-start justify-center overflow-auto">
          <iframe
            key={`${url}#${reloadKey}`}
            src={url}
            title={t("preview")}
            className="bg-white h-full border-0 shadow-sm"
            style={{ width: width ? `${width}px` : "100%", minWidth: width ? `${width}px` : undefined, height: "100%" }}
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 text-sm">
          <div className="text-muted">{t("noServer")}</div>
          <PortList ports={mine} onPick={(p) => go(String(p))} title={t("thisProject")} />
          <PortList ports={others} onPick={(p) => go(String(p))} title={t("otherServers")} />
        </div>
      )}
      {url && others.length + mine.length > 1 && (
        <div className="flex items-center gap-1 px-2 py-1 border-t border-border/70 overflow-x-auto text-[11.5px]" dir="ltr">
          {[...mine, ...others].map((p) => (
            <button key={p.port} onClick={() => go(String(p.port))} className={cn("rounded-md px-2 py-0.5 whitespace-nowrap", url.includes(`:${p.port}`) ? "bg-blue/15 text-blue" : "text-muted hover:bg-surface-2")} title={p.cwd ?? p.command}>
              :{p.port} {p.cwd ? p.cwd.split("/").pop() : p.command}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PortList({ ports, onPick, title }: { ports: DevPort[]; onPick: (port: number) => void; title: string }) {
  if (!ports.length) return null;
  return (
    <div>
      <div className="mono-label mb-1.5">{title}</div>
      <div className="space-y-1">
        {ports.map((p) => (
          <button key={p.port} onClick={() => onPick(p.port)} className="w-full card px-3 py-2 flex items-center gap-2 text-start hover:border-blue/40">
            <Globe className="size-4 text-muted" />
            <span className="mono ltr">:{p.port}</span>
            <span className="truncate text-muted flex-1 min-w-0" dir="ltr">
              {p.cwd?.replace(/^\/Users\/[^/]+/, "~") ?? p.command}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
