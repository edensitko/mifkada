import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./paths.js";
import { L } from "./i18n.js";

/** הגדרות מקומיות של מפקדה. מפתחות נשמרים רק כאן, ולעולם לא נשלחים חזרה ל-UI. */
export interface NotifyPrefs {
  /** התראה כש-Claude מבקש אישור */
  permission: boolean;
  /** התראה כשתור של Claude מסתיים */
  done: boolean;
  /** התראה על שגיאה */
  error: boolean;
}

export interface QuietHours {
  enabled: boolean;
  from: string;
  to: string;
  /** שבת שקטה כולה (משישי בערב, לפי השעה "from") */
  shabbat: boolean;
}

export interface SystemPrefs {
  quiet: QuietHours;
  /** תקציב חודשי מוערך בדולרים (0 = כבוי) */
  monthlyBudget: number;
  /** לפתוח את מפקדה עם הכניסה למחשב */
  launchAtLogin: boolean;
  /** עדכון חם: לטעון את מפקדה מתיקיית הפרויקט (נכנס לתוקף בהפעלה הבאה) */
  devMode: boolean;
  devDir: string;
  /** Remote Control בתוך כל סשן חי (כמו ב-VS Code) */
  rcLive: boolean;
  /** סשן שלא נגעו בו כך וכך ימים עובר לארכיון לבד (0 = כבוי) */
  autoArchiveDays: number;
  /** מתיר מצב bypassPermissions. אין לזה מתג בממשק בכוונה: רק עריכה ידנית של הקובץ */
  allowBypass: boolean;
  /** סשן פעיל שאף אחד לא משתמש בו נסגר אחרי X דקות (0 = לעולם לא) */
  liveIdleMinutes: number;
  /** איך לפנות אליך בממשק ("בוקר טוב, X"). ריק = בלי שם */
  displayName: string;
  /** תיקיות שבתוכן יושבים הפרויקטים (כל תת-תיקייה = פרויקט). נבחרות בהפעלה הראשונה */
  projectRoots: string[];
  /** קריאות רקע למודל שצורכות מהמנוי בלי שביקשת: שיוך סשנים לפרויקט ותקציר "מאז אתמול" */
  aiHelpers: boolean;
  /** שפת הממשק. auto = לפי שפת המערכת */
  lang: "auto" | "he" | "en";
  /** איך הסשנים של Claude מתחברים (claudeAuth.ts). אין לזה מתג בממשק: apiKey כברירת מחדל */
  authMode: "apiKey" | "claudeCode";
  /** שמות ה-host של שרת הפרוד (alias מ-~/.ssh/config או כתובת). ריק = שומר הפרוד לא בודק ssh/scp/rsync (prodGuard.ts) */
  prodHosts: string[];
}

/** ספק סוכנים (ACP) כפי שנשמר: גובר על ה-preset המובנה. env יכול להכיל מפתחות, ולכן לא חוזר ל-UI */
export interface ProviderSettings {
  enabled?: boolean;
  label?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

interface Settings {
  openaiKey?: string;
  /** מפתח API של Anthropic לסשנים של Claude (claudeAuth.ts). הקובץ במצב 600, והמפתח לא חוזר לממשק */
  anthropicKey?: string;
  notify?: Partial<NotifyPrefs>;
  system?: Partial<SystemPrefs>;
  providers?: Record<string, ProviderSettings>;
}

const SYSTEM_DEFAULTS: SystemPrefs = { quiet: { enabled: false, from: "22:00", to: "07:30", shabbat: false }, monthlyBudget: 0, launchAtLogin: false, devMode: false, devDir: "", rcLive: false, autoArchiveDays: 7, allowBypass: false, liveIdleMinutes: 0, displayName: "", projectRoots: [], aiHelpers: false, lang: "auto", authMode: "apiKey", prodHosts: [] };

const FILE = path.join(DATA_DIR, "settings.json");
const NOTIFY_DEFAULTS: NotifyPrefs = { permission: true, done: true, error: true };

async function read(): Promise<Settings> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as Settings;
  } catch {
    return {};
  }
}

async function write(s: Settings): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(s, null, 2), { mode: 0o600 });
}

/* החלטה מהירה אם לשדר התראה, בלי לקרוא את הקובץ בכל אירוע */
let notifyCache: NotifyPrefs = NOTIFY_DEFAULTS;
let systemCache: SystemPrefs = SYSTEM_DEFAULTS;
let anthropicKeyCache: string | null = null;
void read().then((s) => {
  notifyCache = { ...NOTIFY_DEFAULTS, ...s.notify };
  systemCache = mergeSystem(s.system);
  anthropicKeyCache = s.anthropicKey ?? null;
});

function mergeSystem(x?: Partial<SystemPrefs>): SystemPrefs {
  const m = { ...SYSTEM_DEFAULTS, ...x, quiet: { ...SYSTEM_DEFAULTS.quiet, ...x?.quiet } };
  m.authMode = m.authMode === "claudeCode" ? "claudeCode" : "apiKey";
  m.prodHosts = cleanHosts(m.prodHosts);
  return m;
}

/** שמות host: אותיות, ספרות, נקודה, מקף וקו תחתון. בלי רווחים ובלי wildcard */
function cleanHosts(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return [...new Set(x.filter((h): h is string => typeof h === "string").map((h) => h.trim().toLowerCase()).filter((h) => /^[a-z0-9_.-]{1,253}$/.test(h)))].slice(0, 20);
}

/** מפתח ה-API של Anthropic מההגדרות (claudeAuth.ts). רק לשימוש השרת */
export function anthropicKey(): string | null {
  return anthropicKeyCache;
}

export async function setAnthropicKey(key: string | null): Promise<void> {
  const s = await read();
  if (key) s.anthropicKey = key.trim();
  else delete s.anthropicKey;
  await write(s);
  anthropicKeyCache = s.anthropicKey ?? null;
}
export function systemPrefs(): SystemPrefs {
  return systemCache;
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map((n) => Number(n) || 0);
  return h * 60 + m;
};
/** האם עכשיו שעות שקטות (בלי התראות שאינן אישור, ורוטינות נדחות). */
export function isQuiet(d = new Date()): boolean {
  const q = systemCache.quiet;
  if (!q.enabled) return false;
  const now = d.getHours() * 60 + d.getMinutes();
  const from = toMin(q.from);
  const to = toMin(q.to);
  if (q.shabbat) {
    const day = d.getDay();
    if ((day === 5 && now >= from) || day === 6) return true;
  }
  return from <= to ? now >= from && now < to : now >= from || now < to;
}

export async function setSystemPrefs(patch: Partial<SystemPrefs>): Promise<SystemPrefs> {
  const s = await read();
  const cur = mergeSystem(s.system);
  const next: SystemPrefs = { ...cur };
  if (patch.quiet) {
    const q = patch.quiet;
    next.quiet = {
      enabled: typeof q.enabled === "boolean" ? q.enabled : cur.quiet.enabled,
      from: /^\d{1,2}:\d{2}$/.test(String(q.from)) ? String(q.from) : cur.quiet.from,
      to: /^\d{1,2}:\d{2}$/.test(String(q.to)) ? String(q.to) : cur.quiet.to,
      shabbat: typeof q.shabbat === "boolean" ? q.shabbat : cur.quiet.shabbat,
    };
  }
  if (typeof patch.monthlyBudget === "number") next.monthlyBudget = Math.max(0, Math.min(100000, patch.monthlyBudget));
  if (typeof patch.launchAtLogin === "boolean") next.launchAtLogin = patch.launchAtLogin;
  if (typeof patch.devMode === "boolean") next.devMode = patch.devMode;
  if (typeof patch.devDir === "string") next.devDir = patch.devDir.trim();
  if (typeof patch.rcLive === "boolean") next.rcLive = patch.rcLive;
  if (typeof patch.liveIdleMinutes === "number") next.liveIdleMinutes = Math.max(0, Math.min(1440, Math.round(patch.liveIdleMinutes)));
  if (typeof patch.autoArchiveDays === "number") next.autoArchiveDays = Math.max(0, Math.min(365, Math.round(patch.autoArchiveDays)));
  if (typeof patch.displayName === "string") next.displayName = patch.displayName.trim().slice(0, 40);
  if (Array.isArray(patch.projectRoots))
    next.projectRoots = [...new Set(patch.projectRoots.filter((d): d is string => typeof d === "string" && /^(~|\/)/.test(d.trim())).map((d) => d.trim().replace(/\/+$/, "")))].slice(0, 20);
  if (typeof patch.aiHelpers === "boolean") next.aiHelpers = patch.aiHelpers;
  if (patch.lang === "auto" || patch.lang === "he" || patch.lang === "en") next.lang = patch.lang;
  if (Array.isArray(patch.prodHosts)) next.prodHosts = cleanHosts(patch.prodHosts);
  // authMode ו-allowBypass: אין שינוי מהממשק, רק עריכה ידנית של הקובץ
  s.system = next;
  await write(s);
  systemCache = next;
  return next;
}

/** כל קבצי הנתונים, לייצוא. בלי מפתח ה-OpenAI. */
export async function exportData(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { version: 1, exportedAt: new Date().toISOString() };
  for (const f of ["tasks", "routines", "templates", "themes", "profiles", "summaries"]) {
    try {
      out[f] = JSON.parse(await fs.readFile(path.join(DATA_DIR, `${f}.json`), "utf8"));
    } catch {
      /* אין */
    }
  }
  const s = await read();
  out.settings = { notify: s.notify, system: s.system };
  return out;
}

/** ייבוא: כותב את הקבצים שקיימים בייצוא, אחרי גיבוי של מה שיש. מפתח OpenAI נשמר כמו שהוא. */
export async function importData(data: Record<string, unknown>): Promise<string[]> {
  if (data.version !== 1) throw new Error(L("קובץ ייצוא לא מוכר", "Unrecognized export file"));
  const written: string[] = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await fs.mkdir(path.join(DATA_DIR, "backups", `before-import-${stamp}`), { recursive: true });
  for (const f of ["tasks", "routines", "templates", "themes", "profiles", "summaries"]) {
    if (!(f in data)) continue;
    const file = path.join(DATA_DIR, `${f}.json`);
    try {
      await fs.copyFile(file, path.join(DATA_DIR, "backups", `before-import-${stamp}`, `${f}.json`));
    } catch {
      /* לא היה */
    }
    await fs.writeFile(file, JSON.stringify(data[f], null, 2));
    written.push(f);
  }
  const st = data.settings as { notify?: Partial<NotifyPrefs>; system?: Partial<SystemPrefs> } | undefined;
  if (st) {
    const s = await read();
    if (st.notify) s.notify = st.notify;
    if (st.system) s.system = st.system;
    await write(s);
    notifyCache = { ...NOTIFY_DEFAULTS, ...s.notify };
    systemCache = mergeSystem(s.system);
    written.push("settings");
  }
  return written;
}
export function notifyPrefs(): NotifyPrefs {
  return notifyCache;
}

export async function publicSettings(): Promise<{ hasOpenaiKey: boolean; hasAnthropicKey: boolean; notify: NotifyPrefs; dataDir: string; system: SystemPrefs }> {
  const s = await read();
  return { hasOpenaiKey: Boolean(s.openaiKey), hasAnthropicKey: Boolean(s.anthropicKey), notify: { ...NOTIFY_DEFAULTS, ...s.notify }, dataDir: DATA_DIR, system: mergeSystem(s.system) };
}

export async function setNotifyPrefs(patch: Partial<NotifyPrefs>): Promise<NotifyPrefs> {
  const s = await read();
  const next: NotifyPrefs = { ...NOTIFY_DEFAULTS, ...s.notify };
  for (const k of ["permission", "done", "error"] as const) if (typeof patch[k] === "boolean") next[k] = patch[k];
  s.notify = next;
  await write(s);
  notifyCache = next;
  return next;
}

/** כל הגדרות הספקים, כולל ערכי env. לשימוש השרת בלבד */
export async function providerSettings(): Promise<Record<string, ProviderSettings>> {
  return (await read()).providers ?? {};
}

const PROVIDER_ID = /^[a-z][a-z0-9-]{0,30}$/;

/**
 * עדכון ספק. env: ערך ריק מוחק משתנה, משתנה שלא נשלח נשאר כמו שהוא (ה-UI לא מכיר את הערכים).
 * null מוחק את ההגדרות של הספק וחוזר ל-preset.
 */
export async function setProviderSettings(id: string, patch: (Omit<ProviderSettings, "env"> & { env?: Record<string, string | null> }) | null): Promise<void> {
  if (!PROVIDER_ID.test(id) || id === "claude") throw new Error(L("מזהה ספק לא חוקי", "Invalid provider id"));
  const s = await read();
  const all = { ...s.providers };
  if (patch === null) delete all[id];
  else {
    const cur: ProviderSettings = { ...all[id] };
    if (typeof patch.enabled === "boolean") cur.enabled = patch.enabled;
    if (typeof patch.label === "string") cur.label = patch.label.trim().slice(0, 40) || undefined;
    if (typeof patch.command === "string") cur.command = patch.command.trim() || undefined;
    if (Array.isArray(patch.args)) cur.args = patch.args.filter((a): a is string => typeof a === "string").slice(0, 40);
    if (patch.env && typeof patch.env === "object") {
      const env = { ...cur.env };
      for (const [k, v] of Object.entries(patch.env)) {
        if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(k)) continue;
        if (v) env[k] = String(v);
        else delete env[k];
      }
      cur.env = Object.keys(env).length ? env : undefined;
    }
    all[id] = cur;
  }
  s.providers = all;
  await write(s);
}

export async function setOpenaiKey(key: string | null): Promise<void> {
  const s = await read();
  if (key) s.openaiKey = key.trim();
  else delete s.openaiKey;
  await write(s);
}

const VOICES = new Set(["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"]);

/** הקראה דרך OpenAI (gpt-4o-mini-tts). מחזיר mp3. */
export async function openaiSpeech(text: string, voice: string, speed: number): Promise<ArrayBuffer> {
  const { openaiKey } = await read();
  if (!openaiKey) throw new Error(L("לא הוגדר מפתח OpenAI בהגדרות", "No OpenAI key set in Settings"));
  const r = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { authorization: `Bearer ${openaiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: VOICES.has(voice) ? voice : "coral",
      input: text.slice(0, 4000),
      instructions: L("דבר בעברית טבעית, בקצב רגוע וברור, כמו עוזר אישי שמעדכן את מי שהוא עובד איתו.", "Speak natural English at a calm, clear pace, like a personal assistant updating the person they work with."),
      response_format: "mp3",
      speed: Math.min(1.6, Math.max(0.7, speed || 1)),
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`OpenAI TTS ${r.status}: ${body.slice(0, 200)}`);
  }
  return r.arrayBuffer();
}


