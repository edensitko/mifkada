import { Rocket, ShieldAlert } from "lucide-react";
import { explainPermissionReason, summarizeToolInput } from "../lib/util";
import type { PermissionRequest } from "../../../shared/protocol";
import { strings, useT } from "../i18n";

const S = strings({
  he: { allow: "אשר", always: "אשר תמיד", deny: "דחה", asks: "Claude מבקש אישור ל-" },
  en: { allow: "Allow", always: "Always allow", deny: "Deny", asks: "Claude is asking permission to use " },
});

type Answer = (behavior: "allow" | "deny", always: boolean, grant?: boolean) => void;

export default function PermissionCard({ req, onAnswer }: { req: PermissionRequest; onAnswer: Answer }) {
  const t = useT(S);
  if (req.prod) return <ProdCard req={req} onAnswer={onAnswer} />;
  const summary = summarizeToolInput(req.toolName, req.input);
  const explain = explainPermissionReason(req.reason, req.canAlways);
  const buttons = (
    <>
      <button onClick={() => onAnswer("allow", false)} autoFocus={!req.defaultToNo} className="btn-primary rounded-lg px-3 py-1.5 text-sm">
        {t("allow")}
      </button>
      {req.canAlways && (
        <button onClick={() => onAnswer("allow", true)} className="btn-ghost rounded-lg px-3 py-1.5 text-sm">
          {t("always")}
        </button>
      )}
    </>
  );
  const deny = (
    <button onClick={() => onAnswer("deny", false)} autoFocus={req.defaultToNo} className="rounded-lg bg-danger/20 hover:bg-danger/30 px-3 py-1.5 text-sm">
      {t("deny")}
    </button>
  );
  return (
    <div className="card hud border-amber/50 p-3 space-y-2" style={{ "--agent-color": "#f5b74a" } as React.CSSProperties}>
      <div className="flex items-center gap-2 text-sm">
        <ShieldAlert className="size-4 text-warn" />
        <span className="font-medium">{t("asks")}<span className="mono">{req.toolName}</span></span>
      </div>
      {summary && <pre className="ltr text-xs mono whitespace-pre-wrap bg-background/60 rounded-lg p-2 max-h-40 overflow-auto">{summary}</pre>}
      {explain && <div className="text-xs rounded-lg bg-warn/10 px-2 py-1.5">{explain}</div>}
      {req.reason && <div className="ltr text-xs text-muted">{req.reason}</div>}
      <div className="flex gap-2">{req.defaultToNo ? <>{deny}{buttons}</> : <>{buttons}{deny}</>}</div>
    </div>
  );
}

/** "אשר פריסה לסשן הזה" פעיל: עד מתי, ולחיצה מבטלת */
export function DeployGrantPill({ until, onRevoke }: { until: number | null | undefined; onRevoke: () => void }) {
  if (!until || until < Date.now()) return null;
  const hhmm = new Date(until).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  return (
    <button onClick={onRevoke} className="no-drag flex items-center gap-1 text-danger hover:underline normal-case" title="פקודות פרוד בסשן הזה עוברות בלי כרטיס. לחיצה מבטלת">
      <Rocket className="size-3" /> פריסה מאושרת עד {hhmm}
    </button>
  );
}

/**
 * פקודה שמשנה את הפרוד (שומר הפרוד ב-server/src/live.ts). האישור עובר רק מהחלון של האפליקציה, וזה האישור היחיד
 * שנחשב: סוכן לא יכול להעביר "המשתמש אישר" בטקסט. "לסשן הזה" פותח את כל צעדי הפריסה לזמן קצוב, לאותו קומיט ותיקייה.
 */
function ProdCard({ req, onAnswer }: { req: PermissionRequest; onAnswer: Answer }) {
  const p = req.prod!;
  const home = (s: string) => s.replace(/^\/Users\/[^/]+/, "~");
  return (
    <div className="card hud border-danger/60 p-3 space-y-2" style={{ "--agent-color": "#ff3b30" } as React.CSSProperties}>
      <div className="flex items-center gap-2 text-sm">
        <Rocket className="size-4 text-danger" />
        <span className="font-medium">בקשה לשנות את הפרוד{p.agent ? <> · <span className="mono">{p.agent}</span></> : null}</span>
      </div>
      <pre className="ltr text-xs mono whitespace-pre-wrap bg-background/60 rounded-lg p-2 max-h-48 overflow-auto">{p.command}</pre>
      <div className="text-xs grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <span className="text-muted">למה</span>
        <span dir="auto">{p.reasons.join(", ")}</span>
        <span className="text-muted">תיקייה</span>
        <span className="ltr mono truncate">{home(p.cwd)}</span>
        <span className="text-muted">קומיט</span>
        <span className="ltr mono">{p.branch ?? "-"} @ {p.commit?.slice(0, 7) ?? "אין git"}</span>
      </div>
      {p.untrustedOnly ? (
        <div className="text-xs rounded-lg bg-danger/10 px-2 py-1.5">אישור פריסה אפשרי רק מהאפליקציה של מפקדה, לא מדפדפן או ממצב פיתוח. אפשר רק לדחות מכאן.</div>
      ) : (
        <div className="text-xs rounded-lg bg-warn/10 px-2 py-1.5">
          "אשר פריסה" מאשר את כל פקודות הפרוד בסשן הזה ל-{p.grantMinutes} דקות, כל עוד הקומיט לא משתנה. אפשר לבטל בכל רגע.
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => onAnswer("deny", false)} autoFocus className="rounded-lg bg-danger/20 hover:bg-danger/30 px-3 py-1.5 text-sm">
          דחה
        </button>
        {!p.untrustedOnly && (
          <>
            <button onClick={() => onAnswer("allow", false)} className="btn-ghost rounded-lg px-3 py-1.5 text-sm">
              רק הפקודה הזו
            </button>
            <button onClick={() => onAnswer("allow", false, true)} className="btn-primary rounded-lg px-3 py-1.5 text-sm">
              אשר פריסה לסשן הזה
            </button>
          </>
        )}
      </div>
    </div>
  );
}
