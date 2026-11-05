import { SETTINGS_COLORS } from "../lib/settingsColors";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ShieldCheck, FolderCog, Moon, Mic, Download, Upload, Trash2, Plus } from "lucide-react";
import { api, type Profile, type SafetyState, type SystemPrefs } from "../api";
import { useStore } from "../store";
import { basename, cn, MODEL_OPTIONS, MODE_OPTIONS } from "../lib/util";
import { getPrefs, setPrefs, type Prefs } from "../lib/prefs";
import { pick, strings, useT } from "../i18n";
import { ask } from "../lib/dialog";

const S = strings({
  he: {
    safetyTitle: "מגבלות ובטיחות",
    safetyHint: "כללי ההרשאה של Claude Code. חלים על כל הסשנים, גם בטרמינל וב-VS Code. גיבוי נשמר לפני כל שינוי.",
    defaultMode: "מצב ברירת מחדל",
    defaultModeHint: "לכל סשן שלא נבחר לו מצב",
    presets: "כללים מוכנים",
    blocked: "חסום",
    ask: "לשאול",
    ownRule: "כלל משלך",
    block: "לחסום",
    add: "הוסף",
    preApproved: 'מאושרים מראש: {n} כללים (נוספים כשלוחצים "אשר תמיד").',
    profilesTitle: "פרופיל לכל פרויקט",
    profilesHint: "מה ייבחר אוטומטית כשפותחים סשן או משימה בפרויקט. ריק = ברירת המחדל הכללית.",
    modelDefault: "מודל: ברירת מחדל",
    modeDefault: "הרשאות: ברירת מחדל",
    noAgent: "בלי אייג'נט",
    systemTitle: "מערכת",
    quiet: "שעות שקטות",
    quietHint: "בלי התראות (חוץ מבקשת אישור), והרוטינות מחכות",
    until: "עד",
    shabbat: "כל השבת",
    budget: "תקציב חודשי",
    budgetHint: "התראה כשהשווי המוערך עובר אותו. 0 = כבוי",
    autoLive: "סשן פעיל מיד",
    autoLiveHint: "פתיחת שיחה מהרשימה מריצה אותה מיד (ומופיעה בטלפון), בלי לחכות להודעה",
    idle: "סגירת סשן לא בשימוש",
    idleHint: "סשן פעיל שאף מסך לא פתוח עליו ולא עבד נסגר, כדי שלא יצטברו תהליכים",
    after: "אחרי",
    minutes: "דקות",
    archive: "ארכיון אוטומטי",
    archiveHint: "סשן שלא נגעת בו עובר לארכיון לבד. סשן שהוצאת מהארכיון בעצמך לא חוזר לשם",
    days: "ימים",
    login: "פתיחה עם המחשב",
    loginHint: "מפקדה עולה ברקע, כדי שהרוטינות לא יפספסו בוקר",
    hot: "עדכון חם",
    hotHint: "לעבודה על מפקדה עצמה: נטענת מתיקיית הפרויקט, ושינויים נכנסים בלי התקנה. בתוקף אחרי הפעלה מחדש אחת",
    hotOn: "פעיל עכשיו",
    hotOff: "לא פעיל עכשיו",
    hotRestart: "צריך לצאת מהאפליקציה (⌘Q) ולפתוח אותה",
    voiceChatTitle: "שיחה קולית",
    silence: "סוף משפט אחרי",
    silenceHint: "כמה שקט נחשב שסיימת לדבר",
    seconds: "{n} שנ׳",
    bargeIn: "קטיעה בדיבור",
    bargeInHint: "כשהוא מדבר ואתה מתחיל לדבר, הוא שותק",
    stopWords: "מילים לסיום",
    stopWordsHint: "מופרדות בפסיק",
    fresh: "שיחה בסשן חדש",
    freshHint: "⌥⌘Space פותח שיחה בסשן קל ומהיר, באותו פרויקט. כבוי: בסשן שפתוח כרגע",
    haiku: "Haiku - הכי מהיר",
    sonnet: "Sonnet - מהיר וחכם",
    opus: "Opus - הכי חכם, איטי יותר",
    hotkey: "קיצור מכל מקום",
    hotkeyHint: "מביא את מפקדה ופותח שיחה קולית",
    importConfirm: "לייבא? המצב הנוכחי יגובה קודם.",
    imported: "יובא: {what}. מומלץ לטעון מחדש (⌘R)",
    exportImport: "ייצוא וייבוא",
    exportImportHint: "משימות, רוטינות, תבניות, פרופילים והגדרות. בלי מפתחות",
    export: "ייצוא",
    import: "ייבוא",
  },
  en: {
    safetyTitle: "Limits and safety",
    safetyHint: "Claude Code permission rules. They apply to all sessions, including the terminal and VS Code. A backup is saved before every change.",
    defaultMode: "Default permission mode",
    defaultModeHint: "For every session without a mode of its own",
    presets: "Ready-made rules",
    blocked: "Blocked",
    ask: "Ask",
    ownRule: "Your own rule",
    block: "Block",
    add: "Add",
    preApproved: 'Pre-approved: {n} rules (added when you click "Always allow").',
    profilesTitle: "Profile per project",
    profilesHint: "What gets picked automatically when you open a session or task in the project. Empty = the general default.",
    modelDefault: "Model: default",
    modeDefault: "Permission mode: default",
    noAgent: "No agent",
    systemTitle: "System",
    quiet: "Quiet hours",
    quietHint: "No notifications (except approval requests), and routines wait",
    until: "to",
    shabbat: "Shabbat (Friday evening to Saturday night)",
    budget: "Monthly budget",
    budgetHint: "Alert when the estimated cost passes it. 0 = off",
    autoLive: "Start sessions right away",
    autoLiveHint: "Opening a conversation from the list runs it immediately (and it shows up on your phone), without waiting for a message",
    idle: "Close unused sessions",
    idleHint: "A running session that no screen has open and that isn't working gets closed, so processes don't pile up",
    after: "After",
    minutes: "minutes",
    archive: "Auto archive",
    archiveHint: "A session you haven't touched moves to the archive on its own. A session you took out of the archive yourself won't go back",
    days: "days",
    login: "Open at login",
    loginHint: "Mifkada starts in the background, so routines don't miss a morning",
    hot: "Hot reload",
    hotHint: "For working on Mifkada itself: loads from the project folder, and changes come in without reinstalling. Takes effect after one restart",
    hotOn: "Active now",
    hotOff: "Not active now",
    hotRestart: "Quit the app (⌘Q) and open it again",
    voiceChatTitle: "Voice chat",
    silence: "End of sentence after",
    silenceHint: "How much silence counts as you being done talking",
    seconds: "{n} s",
    bargeIn: "Interrupt by speaking",
    bargeInHint: "When it's talking and you start speaking, it goes quiet",
    stopWords: "Stop words",
    stopWordsHint: "Comma separated",
    fresh: "Talk in a new session",
    freshHint: "⌥⌘Space opens a conversation in a light, fast session in the same project. Off: in the session that's open now",
    haiku: "Haiku - fastest",
    sonnet: "Sonnet - fast and smart",
    opus: "Opus - smartest, slower",
    hotkey: "Global shortcut",
    hotkeyHint: "Brings up Mifkada and starts a voice chat",
    importConfirm: "Import? The current state will be backed up first.",
    imported: "Imported: {what}. Reloading is recommended (⌘R)",
    exportImport: "Export and import",
    exportImportHint: "Tasks, routines, templates, profiles and settings. No keys",
    export: "Export",
    import: "Import",
  },
});

export function Card({ id, title, icon: Icon, hint, children }: { id: string; title: string; icon: typeof Moon; hint?: string; children: ReactNode }) {
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

export function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} className={cn("relative h-[26px] w-[46px] rounded-full transition-colors duration-200 shrink-0", on ? "bg-teal" : "bg-[var(--color-fill)]")}>
      <span className={cn("absolute top-[2px] size-[22px] rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,.18)] transition-all duration-200", on ? "start-[22px]" : "start-[2px]")} />
    </button>
  );
}

/* ---------- בטיחות ---------- */

const PRESETS: Array<{ rule: string; list: "ask" | "deny"; label: string }> = [
  { rule: "Bash(git push:*)", list: "ask", get label() { return pick("לשאול לפני git push", "Ask before git push"); } },
  { rule: "Bash(git reset --hard:*)", list: "ask", get label() { return pick("לשאול לפני git reset --hard", "Ask before git reset --hard"); } },
  { rule: "Bash(rm -rf:*)", list: "deny", get label() { return pick("לחסום rm -rf", "Block rm -rf"); } },
  { rule: "Bash(ssh:*)", list: "ask", get label() { return pick("לשאול לפני כל חיבור SSH", "Ask before every SSH connection"); } },
  { rule: "Bash(docker compose up:*)", list: "ask", get label() { return pick("לשאול לפני docker compose up", "Ask before docker compose up"); } },
  { rule: "Bash(npm publish:*)", list: "deny", get label() { return pick("לחסום npm publish", "Block npm publish"); } },
  { rule: "Read(./.env)", list: "ask", get label() { return pick("לשאול לפני קריאת .env", "Ask before reading .env"); } },
];

export function SafetySection() {
  const setToast = useStore((s) => s.setToast);
  const [st, setSt] = useState<SafetyState | null>(null);
  const [rule, setRule] = useState("");
  const [list, setList] = useState<"ask" | "deny">("ask");
  const t = useT(S);
  useEffect(() => {
    api.safety().then(setSt).catch((e: Error) => setToast(e.message));
  }, [setToast]);
  const apply = async (r: string, l: "allow" | "ask" | "deny" | null) => {
    try {
      setSt(await api.setRule(r, l));
    } catch (e) {
      setToast((e as Error).message);
    }
  };
  const where = (r: string) => (st?.deny.includes(r) ? "deny" : st?.ask.includes(r) ? "ask" : st?.allow.includes(r) ? "allow" : null);

  return (
    <Card id="safety" title={t("safetyTitle")} icon={ShieldCheck} hint={t("safetyHint")}>
      {st && (
        <>
          <Row label={t("defaultMode")} hint={t("defaultModeHint")}>
            <select value={st.defaultMode ?? "default"} onChange={(e) => void api.setDefaultMode(e.target.value).then(setSt)} className="px-2 py-1.5 text-sm w-56">
              {MODE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Row>
          <div className="space-y-1.5">
            <div className="text-sm font-medium">{t("presets")}</div>
            {PRESETS.map((p) => {
              const on = where(p.rule) === p.list;
              return (
                <div key={p.rule} className="flex items-center gap-3 text-sm">
                  <Switch on={on} onChange={(v) => void apply(p.rule, v ? p.list : null)} />
                  <span>{p.label}</span>
                  <span className={cn("text-[11px] rounded px-1.5", p.list === "deny" ? "bg-danger/12 text-danger" : "bg-amber/15 text-amber")}>{p.list === "deny" ? t("blocked") : t("ask")}</span>
                </div>
              );
            })}
          </div>
          <div className="space-y-1.5">
            <div className="text-sm font-medium">{t("ownRule")}</div>
            <div className="flex items-center gap-2">
              <input value={rule} onChange={(e) => setRule(e.target.value)} placeholder="Bash(terraform apply:*)" className="ltr flex-1 max-w-sm rounded-lg bg-background border px-2 py-1.5 mono text-xs outline-none focus:border-blue/60" />
              <select value={list} onChange={(e) => setList(e.target.value as "ask" | "deny")} className="px-2 py-1.5 text-sm">
                <option value="ask">{t("ask")}</option>
                <option value="deny">{t("block")}</option>
              </select>
              <button
                onClick={() => {
                  if (!rule.trim()) return;
                  void apply(rule.trim(), list).then(() => setRule(""));
                }}
                className="btn-ghost px-3 py-1.5 text-sm flex items-center gap-1"
              >
                <Plus className="size-4" /> {t("add")}
              </button>
            </div>
            {[...st.deny.map((r) => [r, "deny"] as const), ...st.ask.map((r) => [r, "ask"] as const)]
              .filter(([r]) => !PRESETS.some((p) => p.rule === r))
              .map(([r, l]) => (
                <div key={r} className="flex items-center gap-2 text-sm">
                  <span className={cn("text-[11px] rounded px-1.5", l === "deny" ? "bg-danger/12 text-danger" : "bg-amber/15 text-amber")}>{l === "deny" ? t("blocked") : t("ask")}</span>
                  <span className="mono text-xs ltr">{r}</span>
                  <button onClick={() => void apply(r, null)} className="text-muted hover:text-danger">
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            <div className="text-xs text-muted">{t("preApproved", { n: st.allow.length })}</div>
          </div>
        </>
      )}
    </Card>
  );
}

/* ---------- פרופיל לכל פרויקט ---------- */

export function ProfilesSection() {
  const { sessions, agents } = useStore();
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const t = useT(S);
  const projects = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sessions) if (s.cwd) m.set(s.cwd, (m.get(s.cwd) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([cwd]) => cwd);
  }, [sessions]);
  useEffect(() => {
    api.profiles().then(setProfiles).catch(() => undefined);
  }, []);
  const save = async (cwd: string, patch: Profile) => setProfiles(await api.setProfile(cwd, { ...profiles[cwd], ...patch }));

  return (
    <Card id="profiles" title={t("profilesTitle")} icon={FolderCog} hint={t("profilesHint")}>
      <div className="divide-y divide-border/60">
        {projects.map((cwd) => {
          const pr = profiles[cwd] ?? {};
          return (
            <div key={cwd} className="flex items-center gap-2 py-2 text-sm">
              <span className="w-40 truncate font-medium" title={cwd}>
                {basename(cwd)}
              </span>
              <select value={pr.model ?? ""} onChange={(e) => void save(cwd, { model: e.target.value || null })} className="px-2 py-1 text-xs w-32">
                {MODEL_OPTIONS.map((o) => (
                  <option key={o.label} value={o.value ?? ""}>
                    {o.value ? o.label : t("modelDefault")}
                  </option>
                ))}
              </select>
              <select value={pr.permissionMode ?? ""} onChange={(e) => void save(cwd, { permissionMode: e.target.value || null })} className="px-2 py-1 text-xs w-36">
                <option value="">{t("modeDefault")}</option>
                {MODE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <select value={pr.agent ?? ""} onChange={(e) => void save(cwd, { agent: e.target.value || null })} className="px-2 py-1 text-xs w-36">
                <option value="">{t("noAgent")}</option>
                {agents.map((a) => (
                  <option key={a.slug} value={a.slug}>
                    {a.emoji} {a.name}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ---------- מערכת: שעות שקטות, תקציב, פתיחה עם המחשב ---------- */

export function SystemSection() {
  const [sys, setSys] = useState<SystemPrefs | null>(null);
  const t = useT(S);
  useEffect(() => {
    api
      .settings()
      .then((s) => setSys((s as unknown as { system: SystemPrefs }).system))
      .catch(() => undefined);
  }, []);
  const save = async (patch: Partial<SystemPrefs>) => setSys(await api.setSystem(patch));
  const [hot, setHot] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((h: { hot?: boolean }) => setHot(Boolean(h.hot)))
      .catch(() => undefined);
  }, []);
  if (!sys) return null;
  const q = sys.quiet;
  return (
    <Card id="system" title={t("systemTitle")} icon={Moon}>
      <Row label={t("quiet")} hint={t("quietHint")}>
        <Switch on={q.enabled} onChange={(v) => void save({ quiet: { ...q, enabled: v } })} />
        <input type="time" value={q.from} onChange={(e) => void save({ quiet: { ...q, from: e.target.value } })} disabled={!q.enabled} className="rounded-lg bg-background border px-2 py-1 text-sm disabled:opacity-40" />
        <span className="text-muted">{t("until")}</span>
        <input type="time" value={q.to} onChange={(e) => void save({ quiet: { ...q, to: e.target.value } })} disabled={!q.enabled} className="rounded-lg bg-background border px-2 py-1 text-sm disabled:opacity-40" />
        <label className={cn("flex items-center gap-1.5 ms-2", !q.enabled && "opacity-40")}>
          <input type="checkbox" checked={q.shabbat} disabled={!q.enabled} onChange={(e) => void save({ quiet: { ...q, shabbat: e.target.checked } })} className="accent-blue" />
          {t("shabbat")}
        </label>
      </Row>
      <Row label={t("budget")} hint={t("budgetHint")}>
        <span className="text-muted">$</span>
        <input type="number" min={0} step={50} value={sys.monthlyBudget} onChange={(e) => void save({ monthlyBudget: Number(e.target.value) || 0 })} className="w-28 rounded-lg bg-background border px-2 py-1 text-sm tabular" />
      </Row>
      <Row label={t("autoLive")} hint={t("autoLiveHint")}>
        <Switch on={getPrefs().autoLive} onChange={(v) => { setPrefs({ autoLive: v }); setSys({ ...sys }); }} />
      </Row>
      <Row label={t("idle")} hint={t("idleHint")}>
        <Switch on={sys.liveIdleMinutes > 0} onChange={(v) => void save({ liveIdleMinutes: v ? 30 : 0 })} />
        {sys.liveIdleMinutes > 0 && (
          <>
            <span className="text-muted">{t("after")}</span>
            <input type="number" min={5} max={1440} value={sys.liveIdleMinutes} onChange={(e) => void save({ liveIdleMinutes: Math.max(5, Number(e.target.value) || 30) })} className="w-16 rounded-lg bg-background border px-2 py-1 text-sm tabular" />
            <span className="text-muted">{t("minutes")}</span>
          </>
        )}
      </Row>
      <Row label={t("archive")} hint={t("archiveHint")}>
        <Switch on={sys.autoArchiveDays > 0} onChange={(v) => void save({ autoArchiveDays: v ? 7 : 0 })} />
        {sys.autoArchiveDays > 0 && (
          <>
            <span className="text-muted">{t("after")}</span>
            <input type="number" min={1} max={365} value={sys.autoArchiveDays} onChange={(e) => void save({ autoArchiveDays: Math.max(1, Number(e.target.value) || 7) })} className="w-16 rounded-lg bg-background border px-2 py-1 text-sm tabular" />
            <span className="text-muted">{t("days")}</span>
          </>
        )}
      </Row>
      <Row label={t("login")} hint={t("loginHint")}>
        <Switch on={sys.launchAtLogin} onChange={(v) => void save({ launchAtLogin: v })} />
      </Row>
      <Row label={t("hot")} hint={t("hotHint")}>
        <Switch on={sys.devMode} onChange={(v) => void save({ devMode: v })} />
        {hot !== null && <span className={cn("text-xs rounded px-1.5 py-0.5", hot ? "bg-teal/15 text-teal" : "bg-surface-2 text-muted")}>{hot ? t("hotOn") : t("hotOff")}</span>}
        {sys.devMode && hot === false && <span className="text-xs text-muted">{t("hotRestart")}</span>}
      </Row>
    </Card>
  );
}

/* ---------- שיחה קולית ---------- */

export function VoiceChatSection() {
  const [p, setP] = useState<Prefs>(getPrefs());
  const t = useT(S);
  const update = (patch: Partial<Prefs>) => setP(setPrefs(patch));
  return (
    <Card id="voicechat" title={t("voiceChatTitle")} icon={Mic}>
      <Row label={t("silence")} hint={t("silenceHint")}>
        <input type="range" min={600} max={2500} step={100} value={p.voiceSilenceMs} onChange={(e) => update({ voiceSilenceMs: Number(e.target.value) })} className="w-56 accent-blue" />
        <span className="tabular text-muted">{t("seconds", { n: (p.voiceSilenceMs / 1000).toFixed(1) })}</span>
      </Row>
      <Row label={t("bargeIn")} hint={t("bargeInHint")}>
        <Switch on={p.voiceBargeIn} onChange={(v) => update({ voiceBargeIn: v })} />
      </Row>
      <Row label={t("stopWords")} hint={t("stopWordsHint")}>
        <input value={p.voiceStopWords} onChange={(e) => update({ voiceStopWords: e.target.value })} className="flex-1 max-w-sm rounded-lg bg-background border px-2 py-1.5 text-sm outline-none focus:border-blue/60" />
      </Row>
      <Row label={t("fresh")} hint={t("freshHint")}>
        <Switch on={p.voiceFresh} onChange={(v) => update({ voiceFresh: v })} />
        <select value={p.voiceModel} onChange={(e) => update({ voiceModel: e.target.value })} disabled={!p.voiceFresh} className="px-2 py-1 text-sm disabled:opacity-40">
          <option value="haiku">{t("haiku")}</option>
          <option value="sonnet">{t("sonnet")}</option>
          <option value="opus">{t("opus")}</option>
        </select>
      </Row>
      <Row label={t("hotkey")}>
        <kbd className="mono text-xs rounded-md bg-surface-2 px-2 py-0.5 ltr">⌥⌘Space</kbd>
        <span className="text-muted text-xs">{t("hotkeyHint")}</span>
      </Row>
    </Card>
  );
}

/* ---------- ייצוא וייבוא ---------- */

export function ExportImport() {
  const setToast = useStore((s) => s.setToast);
  const file = useRef<HTMLInputElement>(null);
  const t = useT(S);
  const doExport = async () => {
    const data = { ...(await api.exportData()), prefs: getPrefs(), voice: JSON.parse(localStorage.getItem("mifkada.voice") ?? "{}") };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    a.download = `mifkada-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const doImport = async (f: File) => {
    try {
      const data = JSON.parse(await f.text()) as Record<string, unknown>;
      if (!(await ask(t("importConfirm")))) return;
      const r = await api.importData(data);
      if (data.prefs) setPrefs(data.prefs as Partial<Prefs>);
      if (data.voice) localStorage.setItem("mifkada.voice", JSON.stringify(data.voice));
      setToast(t("imported", { what: r.written.join(", ") }));
    } catch (e) {
      setToast((e as Error).message);
    }
  };
  return (
    <Row label={t("exportImport")} hint={t("exportImportHint")}>
      <button onClick={() => void doExport()} className="btn-ghost px-3 py-1.5 text-sm flex items-center gap-1.5">
        <Download className="size-4" /> {t("export")}
      </button>
      <button onClick={() => file.current?.click()} className="btn-ghost px-3 py-1.5 text-sm flex items-center gap-1.5">
        <Upload className="size-4" /> {t("import")}
      </button>
      <input ref={file} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && void doImport(e.target.files[0])} />
    </Row>
  );
}
