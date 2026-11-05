import fs from "node:fs/promises";
import path from "node:path";
import { CLAUDE_HOME } from "./paths.js";
import { L } from "./i18n.js";
import { systemPrefs } from "./settings.js";

/**
 * כללי ההרשאה של Claude Code (~/.claude/settings.json → permissions.allow / ask / deny).
 * חלים על כל סשן, גם מהטרמינל ו-VS Code. כל שינוי נשמר קודם בגיבוי לצד הקובץ.
 */
const FILE = path.join(CLAUDE_HOME, "settings.json");
export type RuleList = "allow" | "ask" | "deny";

export interface SafetyState {
  defaultMode: string | null;
  allow: string[];
  ask: string[];
  deny: string[];
}

/** אין קובץ (התקנה חדשה) = הגדרות ריקות. קובץ פגום = שגיאה, ולא דורסים אותו */
async function readRaw(): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await fs.readFile(FILE, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw e;
  }
  try {
    const d = JSON.parse(text) as unknown;
    if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error();
    return d as Record<string, unknown>;
  } catch {
    throw new Error(L(`${FILE} לא JSON תקין. לא שיניתי אותו; תקן אותו ונסה שוב`, `${FILE} isn't valid JSON. I left it unchanged; fix it and try again`));
  }
}

/** גיבוי עם חותמת זמן (10 האחרונים נשמרים), ואז כתיבה אטומית: קובץ זמני ו-rename, כך שאין קובץ חצי-כתוב */
async function writeRaw(before: Record<string, unknown>, next: Record<string, unknown>): Promise<void> {
  const dir = path.dirname(FILE);
  await fs.mkdir(dir, { recursive: true });
  if (Object.keys(before).length) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fs.writeFile(`${FILE}.mifkada-backup-${stamp}`, JSON.stringify(before, null, 2));
    const old = (await fs.readdir(dir)).filter((n) => n.startsWith(`${path.basename(FILE)}.mifkada-backup-`)).sort();
    for (const n of old.slice(0, Math.max(0, old.length - 10))) await fs.rm(path.join(dir, n), { force: true });
  }
  const tmp = `${FILE}.mifkada-tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2) + "\n");
  await fs.rename(tmp, FILE);
}

export async function readSafety(): Promise<SafetyState> {
  const d = await readRaw();
  const p = (d.permissions ?? {}) as Record<string, unknown>;
  const list = (k: string) => (Array.isArray(p[k]) ? (p[k] as unknown[]).map(String) : []);
  return { defaultMode: typeof p.defaultMode === "string" ? p.defaultMode : null, allow: list("allow"), ask: list("ask"), deny: list("deny") };
}

const RULE = /^[A-Za-z_][\w-]*(\(.{1,300}\))?$|^mcp__[\w-]+(__[\w-]+)?$/;

/** מוסיף כלל לרשימה (ומוציא אותו משתי האחרות), או מסיר אותו. */
export async function setRule(rule: string, list: RuleList | null): Promise<SafetyState> {
  const r = rule.trim();
  if (!RULE.test(r)) throw new Error(L("כלל לא תקין. הצורה: Bash(git push:*) או WebFetch או Read(./.env)", "Invalid rule. Format: Bash(git push:*), WebFetch or Read(./.env)"));
  const before = await readRaw();
  const d = structuredClone(before);
  const p = ((d.permissions ??= {}) as Record<string, unknown>);
  for (const k of ["allow", "ask", "deny"] as const) {
    const arr = Array.isArray(p[k]) ? (p[k] as string[]) : [];
    const next = arr.filter((x) => x !== r);
    if (k === list) next.push(r);
    if (next.length || Array.isArray(p[k])) p[k] = next;
  }
  await writeRaw(before, d);
  return readSafety();
}

export async function setDefaultMode(mode: string): Promise<SafetyState> {
  const allowed = ["default", "acceptEdits", "plan", "auto", "dontAsk", ...(systemPrefs().allowBypass ? ["bypassPermissions"] : [])];
  if (!allowed.includes(mode)) throw new Error(L("מצב לא מוכר", "Unknown mode"));
  const before = await readRaw();
  const d = structuredClone(before);
  ((d.permissions ??= {}) as Record<string, unknown>).defaultMode = mode;
  await writeRaw(before, d);
  return readSafety();
}
