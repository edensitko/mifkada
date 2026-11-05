import { SETTINGS_COLORS } from "../lib/settingsColors";
import { useEffect, useState, type ReactNode } from "react";
import { Monitor, Sun, Moon, Palette, MessageSquare, Bell, Database, Keyboard, Info, Check, FolderOpen, HardDriveDownload, ShieldCheck, FolderCog, Mic, Cog, Smartphone, UserRound, Bot } from "lucide-react";
import GeneralSettings from "./GeneralSettings";
import { AgentSelect } from "./AgentPicker";
import { api } from "../api";
import { useStore } from "../store";
import { cn, MODEL_OPTIONS, MODE_OPTIONS } from "../lib/util";
import { ACCENTS, getPrefs, setPrefs, type Prefs } from "../lib/prefs";
import { VoiceSection } from "./Settings";
import { RcSection } from "./RemoteControl";
import { ExportImport, ProfilesSection, SafetySection, SystemSection, VoiceChatSection } from "./SettingsExtra";
import { ProvidersSection } from "./ProvidersSettings";
import { pick, strings, useT } from "../i18n";

const S = strings({
  he: {
    backupSaved: "גיבוי נשמר",
    nothingToBackup: "אין עדיין נתונים לגבות",
    prefs: "העדפות",
    settings: "הגדרות",
    generalHint: "השם שלך, איפה הפרויקטים, והאם מותר לקרוא למודל ברקע.",
    skin: "סגנון",
    skinHint: "IDE: צפוף, כרטיסיות לשיחות פתוחות ושורת מצב, כמו VS Code. iOS: כרטיסים ובועות.",
    theme: "ערכת צבעים",
    themeSystem: "לפי המערכת",
    themeLight: "בהיר",
    themeDark: "כהה",
    accent: "צבע הדגשה",
    accentHint: "כפתורים, בחירה וקישורים",
    otherColor: "צבע אחר",
    textSize: "גודל טקסט",
    reset: "איפוס",
    density: "צפיפות",
    comfortable: "מרווח",
    compact: "קומפקטי",
    reduceMotion: "הפחתת תנועה",
    reduceMotionHint: "בלי אנימציות ומעברים",
    sessionsHint: "ברירות המחדל לכל סשן ומשימה חדשים. אפשר לשנות בכל סשן בנפרד.",
    agent: "אייג'נט",
    agentHint: "נבחר לבד בסשן חדש, אם לא בחרת אחר ואין לפרויקט פרופיל",
    model: "מודל",
    mode: "הרשאות",
    send: "שליחת הודעה",
    cmdEnter: "⌘Enter (Enter = שורה)",
    notifyHint: "התראות של macOS כשהחלון לא מול העיניים. בקשות אישור מגיעות גם כשהחלון פתוח.",
    notifyPermission: "Claude מבקש אישור",
    notifyDone: "Claude סיים",
    notifyError: "שגיאה בסשן",
    loading: "טוען",
    dataHint: "הקנבן, הרוטינות, הסיכומים, התבניות וההגדרות נשמרים רק במחשב. גיבוי אוטומטי כל 6 שעות, 14 ימים אחרונים.",
    dataDir: "תיקיית הנתונים",
    openFinder: "פתח ב-Finder",
    backups: "גיבויים",
    lastBackup: "אחרון: {name}",
    noneYet: "עוד אין",
    savedCount: "{n} שמורים",
    backupNow: "גבה עכשיו",
    about1: "מפקדה: מרכז שליטה מקומי לסשני Claude Code, על ה-Agent SDK הרשמי.",
    about2: "רץ על המנוי שלך (claude.ai), לא על חיוב לפי טוקנים. הכול נשאר במחשב.",
  },
  en: {
    backupSaved: "Backup saved",
    nothingToBackup: "No data to back up yet",
    prefs: "Preferences",
    settings: "Settings",
    generalHint: "Your name, where your projects live, and whether the model may run in the background.",
    skin: "Style",
    skinHint: "IDE: dense, tabs for open chats and a status bar, like VS Code. iOS: cards and bubbles.",
    theme: "Appearance",
    themeSystem: "System",
    themeLight: "Light",
    themeDark: "Dark",
    accent: "Accent color",
    accentHint: "Buttons, selection and links",
    otherColor: "Custom color",
    textSize: "Text size",
    reset: "Reset",
    density: "Density",
    comfortable: "Comfortable",
    compact: "Compact",
    reduceMotion: "Reduce motion",
    reduceMotionHint: "No animations or transitions",
    sessionsHint: "Defaults for every new session and task. You can change them in each session.",
    agent: "Agent",
    agentHint: "Picked automatically in a new session, unless you chose another or the project has a profile",
    model: "Model",
    mode: "Permission mode",
    send: "Send message",
    cmdEnter: "⌘Enter (Enter = new line)",
    notifyHint: "macOS notifications when the window isn't in front of you. Approval requests arrive even when the window is open.",
    notifyPermission: "Claude needs approval",
    notifyDone: "Claude finished",
    notifyError: "Session error",
    loading: "Loading",
    dataHint: "The Board, routines, summaries, templates and settings are stored only on this Mac. Automatic backup every 6 hours, last 14 days kept.",
    dataDir: "Data folder",
    openFinder: "Show in Finder",
    backups: "Backups",
    lastBackup: "Latest: {name}",
    noneYet: "None yet",
    savedCount: "{n} saved",
    backupNow: "Back up now",
    about1: "Mifkada: a local control center for Claude Code sessions, built on the official Agent SDK.",
    about2: "Runs on your subscription (claude.ai), not per-token billing. Everything stays on your computer.",
  },
});

// getters: התוויות מחושבות בכל קריאה, כדי שילכו אחרי השפה הנוכחית
const SECTIONS = [
  { id: "general", get label() { return pick("כללי", "General"); }, icon: UserRound },
  { id: "display", get label() { return pick("תצוגה", "Display"); }, icon: Palette },
  { id: "voice", get label() { return pick("קול והקראה", "Voice and read aloud"); }, icon: MessageSquare },
  { id: "voicechat", get label() { return pick("שיחה קולית", "Voice chat"); }, icon: Mic },
  { id: "sessions", get label() { return pick("סשנים", "Sessions"); }, icon: Monitor },
  { id: "providers", get label() { return pick("ספקים", "Providers"); }, icon: Bot },
  { id: "safety", get label() { return pick("מגבלות ובטיחות", "Limits and safety"); }, icon: ShieldCheck },
  { id: "profiles", get label() { return pick("פרופילי פרויקטים", "Project profiles"); }, icon: FolderCog },
  { id: "notify", get label() { return pick("התראות", "Notifications"); }, icon: Bell },
  { id: "system", get label() { return pick("מערכת", "System"); }, icon: Cog },
  { id: "rc", label: "Remote Control", icon: Smartphone },
  { id: "data", get label() { return pick("נתונים וגיבוי", "Data and backup"); }, icon: Database },
  { id: "keys", get label() { return pick("קיצורי מקלדת", "Keyboard shortcuts"); }, icon: Keyboard },
  { id: "about", get label() { return pick("אודות", "About"); }, icon: Info },
];
const sectionLabel = (id: string) => SECTIONS.find((x) => x.id === id)?.label ?? id;

function Section({ id, title, icon: Icon, children, hint }: { id: string; title: string; icon: typeof Info; children: ReactNode; hint?: string }) {
  return (
    <section id={id} className="card p-5 space-y-4 scroll-mt-6">
      <div className="flex items-center gap-2">
        <span className="ios-icon" style={{ background: SETTINGS_COLORS[id] ?? "#8e8e93" }}>
          <Icon />
        </span>
        <h2 className="font-semibold text-lg">{title}</h2>
      </div>
      {hint && <p className="text-sm text-muted -mt-2">{hint}</p>}
      {children}
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 text-sm min-h-9">
      <div className="w-40 shrink-0">
        <div>{label}</div>
        {hint && <div className="text-xs text-muted">{hint}</div>}
      </div>
      <div className="flex-1 flex items-center gap-2 flex-wrap">{children}</div>
    </div>
  );
}

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} className={cn("relative h-[26px] w-[46px] rounded-full transition-colors duration-200 shrink-0", on ? "bg-teal" : "bg-[var(--color-fill)]")}>
      <span className={cn("absolute top-[2px] size-[22px] rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,.18)] transition-all duration-200", on ? "start-[22px]" : "start-[2px]")} />
    </button>
  );
}

/** עמוד ההגדרות של מפקדה: תצוגה, קול, ברירות מחדל לסשנים, התראות, נתונים, קיצורים ואודות. */
export default function SettingsPage() {
  const setToast = useStore((s) => s.setToast);
  const [p, setP] = useState<Prefs>(getPrefs());
  const [server, setServer] = useState<{ notify: { permission: boolean; done: boolean; error: boolean }; dataDir: string } | null>(null);
  const [backups, setBackups] = useState<string[]>([]);
  const t = useT(S);
  const update = (patch: Partial<Prefs>) => setP(setPrefs(patch));

  useEffect(() => {
    api.settings().then((s) => setServer(s as never)).catch(() => undefined);
    fetch("/api/backups")
      .then((r) => r.json())
      .then(setBackups)
      .catch(() => undefined);
  }, []);

  const setNotify = async (k: "permission" | "done" | "error", v: boolean) => {
    const r = (await (await fetch("/api/settings/notify", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ [k]: v }) })).json()) as { permission: boolean; done: boolean; error: boolean };
    setServer((s) => (s ? { ...s, notify: r } : s));
  };
  const backupNow = async () => {
    const r = (await (await fetch("/api/backups", { method: "POST" })).json()) as { dir: string | null };
    setToast(r.dir ? t("backupSaved") : t("nothingToBackup"));
    fetch("/api/backups")
      .then((x) => x.json())
      .then(setBackups)
      .catch(() => undefined);
  };
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="app-drag h-10" />
      <div className="max-w-5xl mx-auto px-8 pb-16 flex gap-8">
        <nav className="w-52 shrink-0 sticky top-4 self-start space-y-0.5 pt-14">
          {SECTIONS.map((x) => (
            <button key={x.id} onClick={() => go(x.id)} className="w-full flex items-center gap-2.5 rounded-[9px] px-2 py-1.5 text-[13.5px] hover:bg-[var(--color-fill)] transition text-start">
              <span className="ios-icon !size-6 !rounded-[6px] [&_svg]:!size-3.5" style={{ background: SETTINGS_COLORS[x.id] ?? "#8e8e93" }}>
                <x.icon />
              </span>
              <span className="truncate">{x.label}</span>
            </button>
          ))}
        </nav>

        <div className="flex-1 min-w-0 space-y-5">
          <header>
            <div className="mono-label">{t("prefs")}</div>
            <h1 className="large-title mt-1">{t("settings")}</h1>
          </header>

          <Section id="general" title={sectionLabel("general")} icon={UserRound} hint={t("generalHint")}>
            <div className="px-4 py-3">
              <GeneralSettings />
            </div>
          </Section>

          <Section id="display" title={sectionLabel("display")} icon={Palette}>
            <Row label={t("skin")} hint={t("skinHint")}>
              <div className="segmented grid grid-cols-2 text-sm w-56">
                {(["ide", "ios"] as const).map((v) => (
                  <button key={v} data-active={p.skin === v} onClick={() => update({ skin: v })} className="py-1.5">
                    {v === "ide" ? "IDE" : "iOS"}
                  </button>
                ))}
              </div>
            </Row>
            <Row label={t("theme")}>
              <div className="segmented grid grid-cols-3 text-sm w-80">
                {(
                  [
                    ["system", t("themeSystem"), Monitor],
                    ["light", t("themeLight"), Sun],
                    ["dark", t("themeDark"), Moon],
                  ] as const
                ).map(([v, label, Icon]) => (
                  <button key={v} data-active={p.theme === v} onClick={() => update({ theme: v })} className="py-1.5 flex items-center justify-center gap-1.5">
                    <Icon className="size-3.5" /> {label}
                  </button>
                ))}
              </div>
            </Row>
            <Row label={t("accent")} hint={t("accentHint")}>
              {ACCENTS.map((c) => (
                <button key={c} onClick={() => update({ accent: c })} className="size-7 rounded-full grid place-items-center ring-offset-2 ring-offset-surface transition" style={{ background: c, boxShadow: p.accent === c ? `0 0 0 2px var(--color-surface), 0 0 0 4px ${c}` : undefined }} title={c}>
                  {p.accent === c && <Check className="size-4 text-white" />}
                </button>
              ))}
              <input type="color" value={p.accent} onChange={(e) => update({ accent: e.target.value })} className="size-7 rounded-full bg-transparent cursor-pointer" title={t("otherColor")} />
            </Row>
            <Row label={t("textSize")}>
              <input type="range" min={0.85} max={1.2} step={0.05} value={p.textScale} onChange={(e) => update({ textScale: Number(e.target.value) })} className="w-64 accent-blue" />
              <span className="tabular text-muted w-12">{Math.round(p.textScale * 100)}%</span>
              {p.textScale !== 1 && (
                <button onClick={() => update({ textScale: 1 })} className="text-xs text-blue hover:underline">
                  {t("reset")}
                </button>
              )}
            </Row>
            <Row label={t("density")}>
              <div className="segmented grid grid-cols-2 text-sm w-56">
                <button data-active={p.density === "comfortable"} onClick={() => update({ density: "comfortable" })} className="py-1.5">
                  {t("comfortable")}
                </button>
                <button data-active={p.density === "compact"} onClick={() => update({ density: "compact" })} className="py-1.5">
                  {t("compact")}
                </button>
              </div>
            </Row>
            <Row label={t("reduceMotion")} hint={t("reduceMotionHint")}>
              <Switch on={p.reduceMotion} onChange={(v) => update({ reduceMotion: v })} />
            </Row>
          </Section>

          <VoiceSection />
          <VoiceChatSection />

          <Section id="sessions" title={sectionLabel("sessions")} icon={Monitor} hint={t("sessionsHint")}>
            <Row label={t("agent")} hint={t("agentHint")}>
              <AgentSelect value={p.defaultAgent || null} onChange={(v) => update({ defaultAgent: v ?? "" })} className="px-2 py-1.5 text-sm w-56" />
            </Row>
            <Row label={t("model")}>
              <select value={p.defaultModel ?? ""} onChange={(e) => update({ defaultModel: e.target.value || null })} className="px-2 py-1.5 text-sm w-56">
                {MODEL_OPTIONS.map((o) => (
                  <option key={o.label} value={o.value ?? ""}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Row>
            <Row label={t("mode")} hint={MODE_OPTIONS.find((o) => o.value === p.defaultMode)?.hint}>
              <select value={p.defaultMode} onChange={(e) => update({ defaultMode: e.target.value as Prefs["defaultMode"] })} className="px-2 py-1.5 text-sm w-56">
                {MODE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Row>
            <Row label={t("send")}>
              <div className="segmented grid grid-cols-2 text-sm w-72">
                <button data-active={p.enterToSend} onClick={() => update({ enterToSend: true })} className="py-1.5">
                  Enter
                </button>
                <button data-active={!p.enterToSend} onClick={() => update({ enterToSend: false })} className="py-1.5">
                  {t("cmdEnter")}
                </button>
              </div>
            </Row>
          </Section>

          <ProvidersSection />
          <SafetySection />
          <ProfilesSection />

          <Section id="notify" title={sectionLabel("notify")} icon={Bell} hint={t("notifyHint")}>
            {server ? (
              <>
                <Row label={t("notifyPermission")}>
                  <Switch on={server.notify.permission} onChange={(v) => void setNotify("permission", v)} />
                </Row>
                <Row label={t("notifyDone")}>
                  <Switch on={server.notify.done} onChange={(v) => void setNotify("done", v)} />
                </Row>
                <Row label={t("notifyError")}>
                  <Switch on={server.notify.error} onChange={(v) => void setNotify("error", v)} />
                </Row>
              </>
            ) : (
              <div className="text-sm text-muted">{t("loading")}</div>
            )}
          </Section>

          <SystemSection />
          <RcSection />

          <Section id="data" title={sectionLabel("data")} icon={Database} hint={t("dataHint")}>
            <Row label={t("dataDir")}>
              <span className="mono text-xs text-muted ltr truncate max-w-80">{server?.dataDir.replace(/^\/Users\/[^/]+/, "~") ?? ""}</span>
              <button onClick={() => void fetch("/api/data/open", { method: "POST" })} className="btn-ghost px-3 py-1.5 text-sm flex items-center gap-1.5">
                <FolderOpen className="size-4" /> {t("openFinder")}
              </button>
            </Row>
            <Row label={t("backups")} hint={backups[0] ? t("lastBackup", { name: backups[0] }) : t("noneYet")}>
              <span className="text-muted">{t("savedCount", { n: backups.length })}</span>
              <button onClick={backupNow} className="btn-ghost px-3 py-1.5 text-sm flex items-center gap-1.5">
                <HardDriveDownload className="size-4" /> {t("backupNow")}
              </button>
            </Row>
            <ExportImport />
          </Section>

          <Section id="keys" title={sectionLabel("keys")} icon={Keyboard}>
            <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm">
              {[
                ["⌘K", pick("חיפוש בכול: סשנים, פרויקטים, משימות ופעולות", "Search everything: sessions, projects, tasks and actions")],
                ["⌘N", pick("סשן חדש", "New session")],
                [pick("לחיצה על סשן", "Click a session"), pick("פתיחה במקום החלונית הראשית", "Open in place of the main pane")],
                [pick("⌘-לחיצה על סשן", "⌘-click a session"), pick("פתיחה בחלונית נוספת", "Open in another pane")],
                ["⌘1", pick("ממתין לך", "Waiting for you")],
                ["⌘2", pick("קנבן", "Board")],
                ["⌘3", pick("אייג'נטים", "Agents")],
                ["⌘4", pick("מאגרים", "Repositories")],
                ["⌘5", pick("הרחבות (MCP ופלאגינים)", "Extensions (MCP and plugins)")],
                ["⌘B", pick("הסתר או הצג סיידבר", "Hide or show sidebar")],
                ["⌥⌘Space", pick("שיחה קולית מכל מקום", "Voice chat from anywhere")],
                ["⌘P", pick("פתיחת קובץ (בסביבת העבודה)", "Open file (in the Workspace)")],
                ["⌘⇧F", pick("חיפוש בפרויקט", "Search in project")],
                ["⌘J", pick("טרמינל", "Terminal")],
                ["⌘S", pick("שמירת קובץ", "Save file")],
                [pick("רווח", "Space"), pick("השתקה בשיחה קולית", "Mute in voice chat")],
                ["Esc", pick("יציאה מהשיחה לצ'אט", "Leave voice chat for the chat")],
              ].map(([k, d]) => (
                <div key={k} className="flex items-center justify-between gap-3 border-b border-border/50 py-1">
                  <span>{d}</span>
                  <kbd className="mono text-xs rounded-md bg-surface-2 px-2 py-0.5 ltr">{k}</kbd>
                </div>
              ))}
            </div>
          </Section>

          <Section id="about" title={sectionLabel("about")} icon={Info}>
            <div className="text-sm text-muted space-y-1">
              <div>{t("about1")}</div>
              <div>{t("about2")}</div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
