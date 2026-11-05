import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import GeneralSettings from "./GeneralSettings";
import AnthropicKeyField from "./AnthropicKeyField";
import { strings, useT } from "../i18n";
import { Spinner } from "./Spinner";

const S = strings({
  he: {
    welcome: "ברוך הבא למפקדה",
    intro: "מרכז שליטה לכל סשני Claude Code שלך: שיחות, אייג'נטים, משימות ופרויקטים במקום אחד. שתי דקות של הגדרה.",
    disclaimer: "מפקדה היא פרויקט עצמאי ואינה קשורה ל-Anthropic, ואינה מאושרת או נתמכת על ידה. השימוש ב-Claude הוא דרך החשבון שלך, באחריותך ולפי התנאים של Anthropic.",
    env: "הסביבה",
    claudeBundled: "Claude Code ({v}, מגיע עם מפקדה)",
    claudeInstalled: "Claude Code ({v}, מותקן במחשב)",
    claudeMissing: "לא נמצא Claude Code בגרסה {min} ומעלה. להתקנה: npm install -g @anthropic-ai/claude-code, ואז לפתוח את מפקדה מחדש",
    signedIn: "Claude מחובר: {label}",
    signedOut: "לא מחובר ל-Claude",
    signedOutHint: "מפקדה מריצה את Claude על ההתחברות של Claude Code במחשב הזה. ההתחברות נפתחת בדפדפן.",
    needKey: "חסר מפתח API של Anthropic",
    signingIn: "מתחבר... נפתח דפדפן. אחרי ההתחברות זה יתעדכן לבד.",
    openLink: "הדפדפן לא נפתח? לפתוח את הקישור",
    connect: "התחבר ל-Claude",
    gitHint: "נדרש למאגרים, לשינויים ולענפים נפרדים",
    gh: "GitHub CLI (לא חובה)",
    ghHint: "ל-PRs ול-CI בעמוד המאגרים",
    install: "התקנה: {cmd}",
    apiKeyEnv: "מוגדר ANTHROPIC_API_KEY בסביבה, אבל ההגדרות קובעות שהסשנים רצים על ההתחברות של Claude Code (authMode = claudeCode), ולכן המפתח לא בשימוש.",
    found: "נמצאו {n} סשנים קיימים של Claude Code. הם יופיעו בסרגל הצד.",
    aboutYou: "עליך",
    later: "אפשר לשנות הכול אחר כך בהגדרות ← כללי.",
    finish: "סיום",
  },
  en: {
    welcome: "Welcome to Mifkada",
    intro: "A control center for all your Claude Code sessions: conversations, agents, tasks and projects in one place. Two minutes of setup.",
    disclaimer: "Mifkada is an independent project. It is not affiliated with, endorsed by or supported by Anthropic. Claude is used through your own account, at your own responsibility and under Anthropic's terms.",
    env: "Environment",
    claudeBundled: "Claude Code ({v}, bundled with Mifkada)",
    claudeInstalled: "Claude Code ({v}, installed on this computer)",
    claudeMissing: "Claude Code {min} or newer wasn't found. Install it: npm install -g @anthropic-ai/claude-code, then reopen Mifkada",
    signedIn: "Claude connected: {label}",
    signedOut: "Not signed in to Claude",
    signedOutHint: "Mifkada runs Claude on this computer's Claude Code sign-in. Sign-in opens in your browser.",
    needKey: "No Anthropic API key yet",
    signingIn: "Signing in... a browser is opening. This updates on its own once you're done.",
    openLink: "Browser didn't open? Open the link",
    connect: "Sign in to Claude",
    gitHint: "Needed for Repositories, changes and separate branches",
    gh: "GitHub CLI (optional)",
    ghHint: "For PRs and CI on the Repositories page",
    install: "Install: {cmd}",
    apiKeyEnv: "ANTHROPIC_API_KEY is set in your environment, but your settings run sessions on the Claude Code sign-in (authMode = claudeCode), so the key is not used.",
    found: "Found {n} existing Claude Code sessions. They will appear in the sidebar.",
    aboutYou: "About you",
    later: "You can change all of this later in Settings → General.",
    finish: "Done",
  },
});

const DONE_KEY = "mifkada.onboarded";

type Doctor = Awaited<ReturnType<typeof api.doctor>>;

/** פקודת התקנה לפי מערכת ההפעלה */
const INSTALL: Record<string, Record<string, string>> = {
  git: { darwin: "xcode-select --install", linux: "sudo apt install git", win32: "winget install Git.Git" },
  gh: { darwin: "brew install gh", linux: "sudo apt install gh", win32: "winget install GitHub.cli" },
};

/**
 * ההפעלה הראשונה: בודק שהסביבה מוכנה (Claude Code, git) ושואל את מה שמפקדה לא יכולה לנחש: איך לפנות אליך
 * ואיפה הפרויקטים. מוצג פעם אחת, כל עוד לא הוגדרו תיקיות פרויקטים ולא נלחץ "סיום".
 */
export default function Onboarding() {
  const system = useStore((s) => s.system);
  const [done, setDone] = useState(() => localStorage.getItem(DONE_KEY) === "1");
  const [doc, setDoc] = useState<Doctor | null>(null);
  const t = useT(S);
  // ההחלטה אם להציג נעשית פעם אחת, כשההגדרות נטענות. אחרת המסך נסגר באמצע, ברגע שמוסיפים את התיקייה הראשונה
  const [needed, setNeeded] = useState<boolean | null>(null);
  useEffect(() => {
    if (system && needed === null) setNeeded(system.projectRoots.length === 0);
  }, [system, needed]);
  const show = Boolean(needed) && !done;

  useEffect(() => {
    if (show) api.doctor().then(setDoc).catch(() => undefined);
  }, [show]);
  // התחברות מתוך המסך: אחרי הלחיצה בודקים כל 2.5 שניות עד שהיא מסתיימת
  const auth = doc?.claudeAuth;
  const signingIn = auth?.status === "signingIn";
  useEffect(() => {
    if (!signingIn) return;
    const id = setInterval(() => {
      void api.providerAuth().then((l) => {
        const a = l.find((x) => x.provider === "claude");
        if (a) setDoc((d) => (d ? { ...d, claudeAuth: a } : d));
      });
    }, 2500);
    return () => clearInterval(id);
  }, [signingIn]);
  if (!show) return null;
  const login = () => void api.providerLogin("claude").then((a) => setDoc((d) => (d ? { ...d, claudeAuth: a } : d)));
  const apiMode = doc?.authMode !== "claudeCode";
  const reloadDoc = () => void api.doctor().then(setDoc).catch(() => undefined);
  const hint = (tool: string, why: string) => `${why}. ${t("install", { cmd: INSTALL[tool]?.[doc?.platform ?? "darwin"] ?? "" })}`;

  const finish = () => {
    localStorage.setItem(DONE_KEY, "1");
    setDone(true);
  };
  const Check = ({ ok, label, hint }: { ok: boolean | null; label: string; hint?: string }) => (
    <div className="flex items-start gap-2.5 py-1.5">
      {ok === null ? <Spinner className="size-4 text-muted mt-0.5" /> : ok ? <CheckCircle2 className="size-4 text-teal mt-0.5" /> : <AlertTriangle className="size-4 text-amber mt-0.5" />}
      <span className="min-w-0">
        <span className="block text-[13.5px]">{label}</span>
        {hint && !ok && <span className="block text-[12px] text-muted">{hint}</span>}
      </span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 backdrop-blur-sm p-6">
      <div className="card w-full max-w-xl max-h-full overflow-y-auto p-7 shadow-2xl space-y-6">
        <div className="space-y-1">
          <h1 className="text-[22px] font-semibold">{t("welcome")}</h1>
          <p className="text-[14px] text-muted">{t("intro")}</p>
          <p dir="auto" className="text-[12px] text-muted">{t("disclaimer")}</p>
        </div>

        <section className="space-y-1">
          <div className="text-[13px] font-semibold text-muted">{t("env")}</div>
          <Check ok={doc ? Boolean(doc.claude) : null} label={doc?.claude ? t(doc.claudeSource === "bundled" ? "claudeBundled" : "claudeInstalled", { v: doc.claude.replace(/\s*\(Claude Code\)/, "") }) : "Claude Code"} hint={t("claudeMissing", { min: doc?.claudeMin ?? "" })} />
          {/* ההתחברות: הדבר היחיד שחובה, עם כפתור כאן במקום הוראות לטרמינל */}
          <div className="flex items-start gap-2.5 py-1.5">
            {!auth || signingIn ? <Spinner className="size-4 text-muted mt-0.5" /> : auth.status === "signedIn" ? <CheckCircle2 className="size-4 text-teal mt-0.5" /> : <AlertTriangle className="size-4 text-amber mt-0.5" />}
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px]">{!auth ? "Claude" : auth.status === "signedIn" ? t("signedIn", { label: [auth.label, auth.email].filter(Boolean).join(" · ") }) : signingIn ? t("signingIn") : apiMode ? t("needKey") : t("signedOut")}</span>
              {auth && auth.status !== "signedIn" && !signingIn && !apiMode && <span className="block text-[12px] text-muted">{t("signedOutHint")}</span>}
              {auth && auth.status !== "signedIn" && apiMode && (
                <span className="block pt-1">
                  <AnthropicKeyField hasKey={false} onSaved={reloadDoc} />
                </span>
              )}
              {signingIn && auth?.url && (
                <a href={auth.url} target="_blank" rel="noreferrer" className="block text-[12px] text-blue">
                  {t("openLink")}
                </a>
              )}
              {auth?.error && auth.status !== "signedIn" && <span className="block text-[12px] text-danger">{auth.error}</span>}
            </span>
            {auth && auth.status !== "signedIn" && !signingIn && !apiMode && (
              <button onClick={login} className="btn-primary px-3 py-1 text-[12.5px] shrink-0">
                {t("connect")}
              </button>
            )}
          </div>
          <Check ok={doc ? Boolean(doc.git) : null} label="git" hint={hint("git", t("gitHint"))} />
          <Check ok={doc ? Boolean(doc.gh) : null} label={t("gh")} hint={hint("gh", t("ghHint"))} />
          {doc?.apiKeyEnv && !apiMode && (
            <div className="rounded-lg bg-warn/10 border border-warn/40 px-3 py-2 text-[12.5px]">
              {t("apiKeyEnv")}
            </div>
          )}
          {doc && <div className="text-[12px] text-muted pt-1">{t("found", { n: doc.sessions })}</div>}
        </section>

        <section className="space-y-2">
          <div className="text-[13px] font-semibold text-muted">{t("aboutYou")}</div>
          <GeneralSettings compact />
        </section>

        <div className="flex items-center gap-3 pt-1">
          <span className="text-[12px] text-muted me-auto">{t("later")}</span>
          <button onClick={finish} className="btn-primary rounded-xl px-5 py-2">
            {t("finish")}
          </button>
        </div>
      </div>
    </div>
  );
}
