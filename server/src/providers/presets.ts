import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { providerSettings } from "../settings.js";
import { whichCommand } from "../platform.js";

const run = promisify(execFile);

/** ספק ACP: פקודה שמדברת ACP על stdio */
export interface ProviderConfig {
  id: string;
  label: string;
  command: string;
  args: string[];
  /** משתנים שמוסרים מהסביבה כדי שהסוכן ירוץ על ההתחברות של ה-CLI (המנוי) ולא על מפתח API */
  dropEnv: string[];
  env: Record<string, string>;
  /** הפקודה שצריך כדי שהספק יעבוד (לבדיקת זמינות). למשל codex-acp צריך את codex */
  requires?: string;
  /** פקודת התחברות להצגה בממשק */
  login?: string;
  /** המזהה של אותו סוכן ב-ACP Registry, כדי לא להציע להוסיף אותו פעמיים */
  registryId?: string;
  enabled: boolean;
  builtin: boolean;
}

type Preset = Omit<ProviderConfig, "env" | "enabled" | "builtin">;

/**
 * ספקים מובנים. הגרסאות נעוצות: ACP זז מהר, ועדכון הוא החלטה ולא תוצאה של npx.
 * את הפקודה, הארגומנטים וה-env אפשר לדרוס בהגדרות (settings.json → providers.<id>).
 */
export const PRESETS: Preset[] = [
  {
    id: "codex",
    label: "Codex",
    command: "npx",
    args: ["-y", "@agentclientprotocol/codex-acp@2.5.0"],
    dropEnv: ["OPENAI_API_KEY", "CODEX_API_KEY"],
    // codex-acp מביא את @openai/codex בעצמו. ההתחברות (ChatGPT) נשמרת ב-~/.codex ומשותפת עם codex מהטרמינל
    login: "npx -y @openai/codex login",
    registryId: "codex-acp",
  },
  { id: "copilot", label: "Copilot", command: "copilot", args: ["--acp"], dropEnv: [], requires: "copilot", login: "copilot", registryId: "github-copilot-cli" },
  { id: "opencode", label: "opencode", command: "opencode", args: ["acp"], dropEnv: [], requires: "opencode", login: "opencode auth login", registryId: "opencode" },
  { id: "cursor", label: "Cursor", command: "agent", args: ["acp"], dropEnv: [], requires: "agent", login: "agent login", registryId: "cursor" },
  // מגרסה 0.66 הדגל הוא --acp (לפני כן --experimental-acp). מנוי אישי של גוגל לא עובד מ-18/6/2026, רק מפתח API
  { id: "gemini", label: "Gemini", command: "gemini", args: ["--acp"], dropEnv: [], requires: "gemini", registryId: "gemini" },
  { id: "goose", label: "Goose", command: "goose", args: ["acp"], dropEnv: [], requires: "goose", registryId: "goose" },
];

/** כל הספקים: ה-presets עם הדריסות מההגדרות, וספקים שהוגדרו ידנית. בלי claude (הוא לא ACP) */
export async function providerConfigs(): Promise<ProviderConfig[]> {
  const saved = await providerSettings();
  const out: ProviderConfig[] = PRESETS.map((p) => {
    const s = saved[p.id] ?? {};
    return { ...p, label: s.label ?? p.label, command: s.command ?? p.command, args: s.args ?? p.args, env: s.env ?? {}, enabled: s.enabled ?? true, builtin: true };
  });
  for (const [id, s] of Object.entries(saved)) {
    if (PRESETS.some((p) => p.id === id) || !s.command) continue;
    out.push({ id, label: s.label ?? id, command: s.command, args: s.args ?? [], dropEnv: [], env: s.env ?? {}, enabled: s.enabled ?? true, builtin: false });
  }
  return out;
}

let cached: ProviderConfig[] = [];

/** טוען מחדש את רשימת הספקים לקאש (בעלייה ואחרי כל שינוי בהגדרות). פתיחת סשן היא סינכרונית ולכן קוראת מהקאש */
export async function refreshProviders(): Promise<ProviderConfig[]> {
  cached = await providerConfigs();
  return cached;
}

export function cachedProvider(id: string): ProviderConfig | undefined {
  return cached.find((p) => p.id === id);
}

const whichCache = new Map<string, { at: number; path: string | null }>();

/** נתיב הפקודה ב-PATH, או null. קאש של דקה: נקרא בכל טעינה של מסך הספקים */
export async function which(cmd: string): Promise<string | null> {
  if (cmd.includes("/") || cmd.includes("\\")) return cmd;
  const hit = whichCache.get(cmd);
  if (hit && Date.now() - hit.at < 60_000) return hit.path;
  let found: string | null = null;
  try {
    // where של Windows מחזיר כמה שורות (cmd, exe...): הראשונה מספיקה
    found = (await run(whichCommand(), [cmd], { timeout: 3000 })).stdout.split(/\r?\n/)[0].trim() || null;
  } catch {
    found = null;
  }
  whichCache.set(cmd, { at: Date.now(), path: found });
  return found;
}
