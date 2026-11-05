import { useEffect, useState } from "react";
import { Bot, ChevronDown, ExternalLink, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { api, type AuthState, type ProviderInfo, type RegistryAgent } from "../api";
import { refreshProviders } from "../lib/providers";
import { useStore } from "../store";
import { cn, hashString } from "../lib/util";
import { strings, useT } from "../i18n";
import { Card, Switch } from "./SettingsExtra";
import { Spin } from "./Spinner";
import { ask } from "../lib/dialog";
import AnthropicKeyField from "./AnthropicKeyField";

const PS = strings({
  he: {
    title: "ספקים",
    hint: "הסוכנים שמפקדה מריצה. Claude מובנה ורץ על מפתח API של Anthropic, והשאר מתחברים דרך ACP, כל אחד עם ההתחברות שלו.",
    yours: "הסוכנים שלך",
    notInstalled: "עוד לא מותקנים",
    builtIn: "מובנה",
    signedIn: "מחובר",
    signedOut: "לא מחובר",
    authUnknown: "לא ידוע",
    signingIn: "מתחבר...",
    checking: "בודק...",
    off: "כבוי",
    connect: "התחבר",
    reconnect: "התחבר מחדש",
    refreshAuth: "בדוק את כל ההתחברויות",
    signingInHint: "נפתח דפדפן. אחרי ההתחברות זה יתעדכן לבד.",
    openLink: "הדפדפן לא נפתח? לפתוח את הקישור",
    pasteCode: "הקוד מהדפדפן",
    sendCode: "שלח",
    claudeHint: "רץ דרך Claude Agent SDK על מפתח API של Anthropic (או Bedrock / Vertex מהסביבה).",
    claudeHintCC: "רץ על ההתחברות של Claude Code במחשב הזה (authMode = claudeCode בהגדרות).",
    sessions: "סשנים מבחוץ",
    sync: "סנכרן עכשיו",
    syncing: "מסנכרן...",
    synced: "נמצאו {n} סשנים",
    syncStatus: "{n} סשנים, עודכן ב-{time}",
    neverSynced: "עוד לא סונכרן",
    syncHint: "סשנים שהתחילו בטרמינל או ב-VS Code נכנסים לרשימה ונפתחים כאן עם ההיסטוריה. מתעדכן לבד כל 5 דקות.",
    command: "פקודה",
    reset: "ברירת מחדל",
    env: "משתני סביבה",
    envHint: "למשל מפתח API. נשמרים רק במחשב ולא מוצגים שוב.",
    addEnv: "הוסף",
    remove: "הסר",
    installHint: "לא נמצא במחשב. אחרי ההתקנה הוא יופיע למעלה. הפקודה:",
    signInCmd: "התחברות מהטרמינל",
    saved: "נשמר",
    addAgent: "הוסף סוכן",
    hideCatalog: "סגור",
    catalogHint: "קטלוג ציבורי של סוכנים שמדברים ACP (ACP Registry). הוספה שומרת את הפקודה בלבד; הסוכן יורד ורץ כשפותחים איתו סשן.",
    filter: "חיפוש",
    add: "הוסף",
    added: "כבר כאן",
    manual: "התקנה ידנית",
    manualHint: "מתקינים מהאתר, ואז מגדירים את הפקודה {cmd}",
    confirmAdd: "להוסיף את {name}?\n\nהפקודה שתרוץ כשתפתח איתו סשן:\n{cmd}\n\nזה קוד חיצוני שירוץ במחשב שלך עם גישה לתיקיית הפרויקט.",
    loading: "טוען...",
    empty: "אין תוצאות",
  },
  en: {
    title: "Providers",
    hint: "The agents Mifkada runs. Claude is built in and runs on an Anthropic API key; the rest connect through ACP, each with its own sign-in.",
    yours: "Your agents",
    notInstalled: "Not installed yet",
    builtIn: "Built in",
    signedIn: "Signed in",
    signedOut: "Not signed in",
    authUnknown: "Unknown",
    signingIn: "Signing in...",
    checking: "Checking...",
    off: "Off",
    connect: "Sign in",
    reconnect: "Sign in again",
    refreshAuth: "Check all sign-ins",
    signingInHint: "A browser is opening. This updates on its own once you're done.",
    openLink: "Browser didn't open? Open the link",
    pasteCode: "Code from the browser",
    sendCode: "Send",
    claudeHint: "Runs through the Claude Agent SDK on an Anthropic API key (or Bedrock / Vertex from the environment).",
    claudeHintCC: "Runs on this computer's Claude Code sign-in (authMode = claudeCode in settings).",
    sessions: "Outside sessions",
    sync: "Sync now",
    syncing: "Syncing...",
    synced: "Found {n} sessions",
    syncStatus: "{n} sessions, updated at {time}",
    neverSynced: "Not synced yet",
    syncHint: "Sessions started in a terminal or VS Code join the list and open here with their history. Updates on its own every 5 minutes.",
    command: "Command",
    reset: "Default",
    env: "Environment variables",
    envHint: "For example an API key. Stored only on this computer and never shown again.",
    addEnv: "Add",
    remove: "Remove",
    installHint: "Not found on this computer. Once installed it shows up above. Command:",
    signInCmd: "Sign in from a terminal",
    saved: "Saved",
    addAgent: "Add an agent",
    hideCatalog: "Close",
    catalogHint: "A public catalog of agents that speak ACP (ACP Registry). Adding only saves the command; the agent is downloaded and run when you open a session with it.",
    filter: "Search",
    add: "Add",
    added: "Already here",
    manual: "Manual install",
    manualHint: "Install it from the website, then set the command {cmd}",
    confirmAdd: "Add {name}?\n\nThe command that runs when you open a session with it:\n{cmd}\n\nThis is outside code that will run on your computer with access to the project folder.",
    loading: "Loading...",
    empty: "No results",
  },
});

/** צבע וסימן לכל ספק מוכר, ולשאר צבע יציב לפי המזהה */
const BRAND: Record<string, { color: string; mark: string }> = {
  claude: { color: "#d97757", mark: "C" },
  codex: { color: "#10a37f", mark: "C" },
  copilot: { color: "#6e40c9", mark: "G" },
  opencode: { color: "#e8590c", mark: "o" },
  cursor: { color: "#1f1f1f", mark: "C" },
  gemini: { color: "#4285f4", mark: "G" },
  goose: { color: "#c79500", mark: "g" },
};
const PALETTE = ["#0a84ff", "#5e5ce6", "#bf5af2", "#ff375f", "#ff9f0a", "#30d158", "#64d2ff", "#ac8e68"];
function brand(id: string, label: string) {
  return BRAND[id] ?? { color: PALETTE[hashString(id) % PALETTE.length], mark: (label.trim()[0] ?? "?").toUpperCase() };
}

function ProviderIcon({ id, label, dim }: { id: string; label: string; dim?: boolean }) {
  const b = brand(id, label);
  return (
    <span className={cn("size-8 rounded-[9px] grid place-items-center text-white text-[15px] font-semibold shrink-0", dim && "opacity-45 grayscale")} style={{ background: b.color }}>
      {b.mark}
    </span>
  );
}

/** הגדרות ← ספקים: Claude והסוכנים המותקנים כרשימה, פרטים בלחיצה, ומה שעוד לא מותקן בנפרד */
export function ProvidersSection() {
  const t = useT(PS);
  const setToast = useStore((s) => s.setToast);
  const [list, setList] = useState<ProviderInfo[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [cmd, setCmd] = useState<Record<string, string>>({});
  const [envDraft, setEnvDraft] = useState<Record<string, { k: string; v: string }>>({});

  const load = () =>
    refreshProviders().then((l) => {
      setList(l);
      setCmd(Object.fromEntries(l.map((p) => [p.id, [p.command, ...p.args].join(" ")])));
    });
  useEffect(() => {
    void load();
  }, []);
  const save = async (id: string, patch: Parameters<typeof api.setProvider>[1]) => {
    try {
      await api.setProvider(id, patch);
      await load();
      setToast(t("saved"));
    } catch (e) {
      setToast((e as Error).message);
    }
  };

  // מצב ההתחברות: נטען בפתיחה, ובזמן התחברות נבדק כל 2.5 שניות עד שהיא מסתיימת
  const [auth, setAuth] = useState<Record<string, AuthState>>({});
  const [authBusy, setAuthBusy] = useState(false);
  const [code, setCode] = useState("");
  const setAuthList = (l: AuthState[]) => setAuth(Object.fromEntries(l.map((a) => [a.provider, a])));
  const loadAuth = (refresh = false) => {
    setAuthBusy(true);
    return api
      .providerAuth(refresh)
      .then(setAuthList)
      .catch(() => undefined)
      .finally(() => setAuthBusy(false));
  };
  // Claude: מפתח API (ברירת המחדל) או ההתחברות של Claude Code (authMode = claudeCode)
  const claudeApi = useStore((s) => s.system?.authMode) !== "claudeCode";
  const [hasAnthropicKey, setHasAnthropicKey] = useState(false);
  const loadKey = () => void api.settings().then((s) => setHasAnthropicKey(s.hasAnthropicKey)).catch(() => undefined);
  useEffect(() => {
    void loadAuth();
    loadKey();
  }, []);
  const signingIn = Object.values(auth).some((a) => a.status === "signingIn");
  useEffect(() => {
    if (!signingIn) return;
    const id = setInterval(() => void api.providerAuth().then(setAuthList).catch(() => undefined), 2500);
    return () => clearInterval(id);
  }, [signingIn]);
  const login = async (id: string) => {
    try {
      const s = await api.providerLogin(id);
      setAuth((cur) => ({ ...cur, [id]: s }));
    } catch (e) {
      setToast((e as Error).message);
    }
  };

  const [syncing, setSyncing] = useState<string | null>(null);
  const sync = async (id: string) => {
    setSyncing(id);
    try {
      const r = await api.syncProvider(id);
      setToast(t("synced", { n: r.count }));
      await load();
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setSyncing(null);
    }
  };

  const [catalog, setCatalog] = useState<RegistryAgent[] | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);
  const [filter, setFilter] = useState("");
  const toggleCatalog = () => {
    setShowCatalog(!showCatalog);
    if (!catalog) api.providerRegistry().then(setCatalog, (e: Error) => setToast(e.message));
  };
  const addFromRegistry = async (a: RegistryAgent) => {
    if (!a.run) return;
    if (!(await ask(t("confirmAdd", { name: a.name, cmd: [a.run.command, ...a.run.args].join(" ") })))) return;
    await save(a.id, { label: a.name, command: a.run.command, args: a.run.args, env: a.run.env, enabled: true });
    setCatalog(await api.providerRegistry().catch(() => catalog));
  };
  const shown = (catalog ?? []).filter((a) => !filter.trim() || `${a.name} ${a.description} ${a.id}`.toLowerCase().includes(filter.trim().toLowerCase()));

  const claude = list.find((p) => p.id === "claude");
  const installed = list.filter((p) => p.id !== "claude" && p.available);
  const missing = list.filter((p) => p.id !== "claude" && !p.available);

  /** תג המצב: מחובר / לא מחובר / מתחבר / כבוי */
  const statusPill = (p: ProviderInfo) => {
    const a = auth[p.id];
    if (!p.enabled) return <span className="pill">{t("off")}</span>;
    const [cls, text] = !a
      ? ["", t("checking")]
      : a.status === "signedIn"
        ? ["pill-ok", t("signedIn")]
        : a.status === "signedOut"
          ? ["pill-warn", t("signedOut")]
          : a.status === "signingIn"
            ? ["pill-blue", t("signingIn")]
            : ["", t("authUnknown")];
    return <span className={cn("pill", cls)}>{text}</span>;
  };

  /** הפעולה הראשית בשורה: התחבר (כשלא מחובר) */
  const primary = (p: ProviderInfo) => {
    const a = auth[p.id];
    if (!p.enabled || !a || a.status === "signedIn" || a.status === "signingIn") return null;
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          void login(p.id);
        }}
        className="btn-primary px-3 py-1 text-xs shrink-0"
      >
        {t("connect")}
      </button>
    );
  };

  /** הפרטים שנפתחים בלחיצה על שורה */
  const details = (p: ProviderInfo) => {
    const a = auth[p.id];
    const draft = envDraft[p.id] ?? { k: "", v: "" };
    const parts = (cmd[p.id] ?? "").trim().split(/\s+/).filter(Boolean);
    const isClaude = p.id === "claude";
    return (
      <div className="px-4 pb-4 pt-1 space-y-4 text-[13px]">
        {isClaude && <p className="text-muted text-xs">{t(claudeApi ? "claudeHint" : "claudeHintCC")}</p>}

        {/* חשבון */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            {a?.label && <span className="font-medium">{a.label}</span>}
            {a?.email && <span className="ltr text-muted">{a.email}</span>}
            <span className="flex-1" />
            {a?.status !== "signingIn" && !(isClaude && claudeApi) && (
              <button onClick={() => void login(p.id)} className={cn("px-3 py-1 text-xs", a?.status === "signedIn" ? "btn-ghost" : "btn-primary")}>
                {a?.status === "signedIn" ? t("reconnect") : t("connect")}
              </button>
            )}
          </div>
          {a?.status === "signingIn" && (
            <div className="text-xs text-muted space-y-1.5">
              <div>{t("signingInHint")}</div>
              {a.url && (
                <a href={a.url} target="_blank" rel="noreferrer" className="text-blue inline-flex items-center gap-1">
                  <ExternalLink className="size-3" />
                  {t("openLink")}
                </a>
              )}
              {isClaude && a.needsCode && (
                <div className="flex items-center gap-2">
                  <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t("pasteCode")} className="ltr mono flex-1 px-2 py-1 text-xs rounded-lg bg-surface border" />
                  <button disabled={!code.trim()} onClick={() => void api.claudeLoginCode(code).then(() => setCode(""), (e: Error) => setToast(e.message))} className="btn-primary px-2.5 py-1 text-xs disabled:opacity-40">
                    {t("sendCode")}
                  </button>
                </div>
              )}
            </div>
          )}
          {a?.error && a.status !== "signedIn" && !(isClaude && claudeApi) && <div className="text-xs text-danger">{a.error}</div>}
          {isClaude && claudeApi && <AnthropicKeyField hasKey={hasAnthropicKey} onSaved={() => { loadKey(); void loadAuth(true); }} />}
        </div>

        {!isClaude && (
          <>
            {/* סשנים מבחוץ */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted w-24 shrink-0">{t("sessions")}</span>
              <span className="text-muted flex-1" title={t("syncHint")}>
                {p.sessions ? (p.sessions.error ? p.sessions.error.slice(0, 120) : t("syncStatus", { n: p.sessions.count, time: new Date(p.sessions.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) })) : t("neverSynced")}
              </span>
              <button onClick={() => void sync(p.id)} disabled={syncing === p.id} className="text-blue inline-flex items-center gap-1 disabled:opacity-50">
                <Spin on={syncing === p.id}><RefreshCw className="size-3" /></Spin>
                {syncing === p.id ? t("syncing") : t("sync")}
              </button>
            </div>

            {/* פקודה */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted w-24 shrink-0">{t("command")}</span>
              <input
                value={cmd[p.id] ?? ""}
                onChange={(e) => setCmd({ ...cmd, [p.id]: e.target.value })}
                onBlur={() => parts.length && parts.join(" ") !== [p.command, ...p.args].join(" ") && void save(p.id, { command: parts[0], args: parts.slice(1) })}
                className="ltr mono flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-surface border"
              />
              {p.builtin && (
                <button onClick={() => void save(p.id, null)} className="text-blue shrink-0">
                  {t("reset")}
                </button>
              )}
            </div>

            {/* משתני סביבה */}
            <div className="flex items-start gap-2 text-xs">
              <span className="text-muted w-24 shrink-0 pt-1.5">{t("env")}</span>
              <div className="flex-1 space-y-1.5">
                {p.envKeys.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {p.envKeys.map((k) => (
                      <span key={k} className="ltr mono rounded-md bg-[var(--color-fill)] px-2 py-0.5 inline-flex items-center gap-1">
                        {k}
                        <button onClick={() => void save(p.id, { env: { [k]: null } })} className="text-muted hover:text-danger" title={t("remove")}>
                          <Trash2 className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <input value={draft.k} onChange={(e) => setEnvDraft({ ...envDraft, [p.id]: { ...draft, k: e.target.value.toUpperCase() } })} placeholder="NAME" className="ltr mono w-36 px-2 py-1 rounded-lg bg-surface border" />
                  <input type="password" value={draft.v} onChange={(e) => setEnvDraft({ ...envDraft, [p.id]: { ...draft, v: e.target.value } })} placeholder="value" className="ltr mono flex-1 min-w-0 px-2 py-1 rounded-lg bg-surface border" />
                  <button
                    disabled={!draft.k || !draft.v}
                    onClick={() => void save(p.id, { env: { [draft.k]: draft.v } }).then(() => setEnvDraft({ ...envDraft, [p.id]: { k: "", v: "" } }))}
                    className="text-blue disabled:opacity-40 shrink-0"
                  >
                    {t("addEnv")}
                  </button>
                </div>
                <div className="text-muted">{t("envHint")}</div>
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  /** שורה ברשימה: אייקון, שם, מצב, חשבון, פעולה ראשית, מתג וחץ */
  const row = (p: ProviderInfo) => {
    const a = auth[p.id];
    const isOpen = open === p.id;
    return (
      <div key={p.id} className="provider-row">
        <div role="button" tabIndex={0} onClick={() => setOpen(isOpen ? null : p.id)} onKeyDown={(e) => e.key === "Enter" && setOpen(isOpen ? null : p.id)} className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[var(--color-fill)]/50 transition">
          <ProviderIcon id={p.id} label={p.label} dim={!p.enabled} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-[14px]">{p.label}</span>
              {p.id === "claude" && <span className="pill">{t("builtIn")}</span>}
              {statusPill(p)}
            </div>
            {p.enabled && (a?.label || a?.email) && (
              <div className="text-xs text-muted truncate">
                {a?.label}
                {a?.label && a?.email ? " · " : ""}
                {a?.email && <span className="ltr">{a.email}</span>}
              </div>
            )}
          </div>
          {primary(p)}
          {p.id !== "claude" && (
            <span onClick={(e) => e.stopPropagation()}>
              <Switch on={p.enabled} onChange={(v) => void save(p.id, { enabled: v })} />
            </span>
          )}
          <ChevronDown className={cn("size-4 text-muted shrink-0 transition-transform", isOpen && "rotate-180")} />
        </div>
        {isOpen && details(p)}
      </div>
    );
  };

  return (
    <Card id="providers" title={t("title")} icon={Bot} hint={t("hint")}>
      {/* הסוכנים שלך */}
      <div>
        <div className="flex items-center mb-1.5 px-1">
          <span className="text-xs font-medium text-muted flex-1">{t("yours")}</span>
          <button onClick={() => void loadAuth(true)} disabled={authBusy} className="text-xs text-blue inline-flex items-center gap-1 disabled:opacity-50">
            <Spin on={authBusy}><RefreshCw className="size-3" /></Spin>
            {authBusy ? t("checking") : t("refreshAuth")}
          </button>
        </div>
        <div className="provider-list">
          {claude && row(claude)}
          {installed.map(row)}
        </div>
      </div>

      {/* הוספת סוכן מהקטלוג */}
      <div>
        <button onClick={toggleCatalog} className="btn-ghost px-3 py-1.5 text-sm inline-flex items-center gap-1.5">
          <Plus className="size-3.5" />
          {showCatalog ? t("hideCatalog") : t("addAgent")}
        </button>
        {showCatalog && (
          <div className="provider-list mt-2">
            <div className="px-4 pt-3 pb-2 space-y-2">
              <p className="text-xs text-muted">{t("catalogHint")}</p>
              <label className="flex items-center gap-2 rounded-lg bg-surface border px-2 py-1.5">
                <Search className="size-3.5 text-muted" />
                <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("filter")} className="flex-1 bg-transparent outline-none text-sm" />
              </label>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {!catalog && <div className="px-4 py-3 text-xs text-muted">{t("loading")}</div>}
              {catalog && shown.length === 0 && <div className="px-4 py-3 text-xs text-muted">{t("empty")}</div>}
              {shown.map((a) => (
                <div key={a.id} className="provider-row flex items-center gap-3 px-4 py-2.5">
                  <ProviderIcon id={a.id} label={a.name} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[13.5px]">{a.name}</span>
                      <span className="ltr text-[11px] text-muted">
                        {a.kind}
                        {a.version ? ` · ${a.version}` : ""}
                        {a.license ? ` · ${a.license}` : ""}
                      </span>
                    </div>
                    <div dir="auto" className="text-xs text-muted line-clamp-2">
                      {a.description}
                    </div>
                    {a.kind === "binary" && a.binaryHint && <div className="text-[11px] text-muted mt-0.5">{t("manualHint", { cmd: [a.binaryHint.cmd, ...a.binaryHint.args].join(" ") })}</div>}
                  </div>
                  {a.added ? (
                    <span className="pill pill-ok shrink-0">{t("added")}</span>
                  ) : a.run ? (
                    <button onClick={() => void addFromRegistry(a)} className="btn-primary px-3 py-1 text-xs shrink-0">
                      {t("add")}
                    </button>
                  ) : a.website ? (
                    <a href={a.website} target="_blank" rel="noreferrer" className="text-xs text-blue shrink-0 inline-flex items-center gap-1">
                      <ExternalLink className="size-3" />
                      {t("manual")}
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* עוד לא מותקנים: מקופל */}
      {missing.length > 0 && (
        <div>
          <button onClick={() => setShowMissing(!showMissing)} className="flex items-center gap-1.5 text-xs font-medium text-muted px-1">
            <ChevronDown className={cn("size-3.5 transition-transform", !showMissing && "-rotate-90 rtl:rotate-90")} />
            {t("notInstalled")} ({missing.length})
          </button>
          {showMissing && (
            <div className="provider-list mt-1.5">
              {missing.map((p) => (
                <div key={p.id} className="provider-row flex items-center gap-3 px-4 py-2.5">
                  <ProviderIcon id={p.id} label={p.label} dim />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-[13.5px]">{p.label}</div>
                    <div className="text-xs text-muted">
                      {t("installHint")} <code className="ltr">{[p.command, ...p.args].join(" ")}</code>
                    </div>
                    {p.login && (
                      <div className="text-xs text-muted">
                        {t("signInCmd")}: <code className="ltr">{p.login}</code>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
