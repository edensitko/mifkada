import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "../paths.js";
import { registryPlatformKey } from "../platform.js";

/**
 * ה-ACP Registry (agentclientprotocol.com): קטלוג ציבורי של סוכנים שמדברים ACP, עם פקודת ההרצה של כל אחד.
 * תוכן חיצוני: מוצג כהצעה בלבד, ונכנס להגדרות רק בלחיצה של המשתמש שרואה את הפקודה המדויקת. קבצים בינאריים לא מורדים
 * ולא מורצים מכאן (צריך להתקין לבד ואז לכוון את הפקודה).
 */
const URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const CACHE = path.join(DATA_DIR, "acp-registry.json");
const TTL = 6 * 3600_000;

export interface RegistryAgent {
  id: string;
  name: string;
  description: string;
  version: string;
  website: string | null;
  license: string | null;
  /** npx / uvx: אפשר להוסיף כמו שזה. binary: צריך להתקין לבד */
  kind: "npx" | "uvx" | "binary";
  run: { command: string; args: string[]; env: Record<string, string> } | null;
  /** בינארי: שם הפקודה והארגומנטים, כדי להשלים אחרי התקנה ידנית */
  binaryHint: { cmd: string; args: string[] } | null;
}

type RawDist = {
  npx?: { package?: string; args?: string[]; env?: Record<string, string> };
  uvx?: { package?: string; args?: string[]; env?: Record<string, string> };
  binary?: Record<string, { cmd?: string; args?: string[] }>;
};
type RawAgent = { id?: string; name?: string; description?: string; version?: string; website?: string; repository?: string; license?: string; distribution?: RawDist };

const strs = (a: unknown): string[] => (Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : []);
const env = (e: unknown): Record<string, string> =>
  e && typeof e === "object" ? Object.fromEntries(Object.entries(e as Record<string, unknown>).filter(([k, v]) => /^[A-Z_][A-Z0-9_]{0,63}$/.test(k) && typeof v === "string") as Array<[string, string]>) : {};
/** חבילת npm/pypi עם גרסה, בלי רווחים ובלי תווים של shell */
const SAFE_PKG = /^[@a-zA-Z0-9][\w.@/=~^-]{0,200}$/;

export function parseRegistry(raw: unknown, platformKey = registryPlatformKey()): RegistryAgent[] {
  const agents = (raw as { agents?: RawAgent[] })?.agents;
  if (!Array.isArray(agents)) return [];
  const out: RegistryAgent[] = [];
  for (const a of agents) {
    if (typeof a.id !== "string" || !/^[a-z][a-z0-9-]{0,30}$/.test(a.id) || typeof a.name !== "string") continue;
    const d = a.distribution ?? {};
    let kind: RegistryAgent["kind"] | null = null;
    let run: RegistryAgent["run"] = null;
    let binaryHint: RegistryAgent["binaryHint"] = null;
    if (d.npx?.package && SAFE_PKG.test(d.npx.package)) {
      kind = "npx";
      run = { command: "npx", args: ["-y", d.npx.package, ...strs(d.npx.args)], env: env(d.npx.env) };
    } else if (d.uvx?.package && SAFE_PKG.test(d.uvx.package)) {
      kind = "uvx";
      run = { command: "uvx", args: [d.uvx.package, ...strs(d.uvx.args)], env: env(d.uvx.env) };
    } else if (d.binary) {
      kind = "binary";
      const b = d.binary[platformKey];
      if (b?.cmd) binaryHint = { cmd: path.basename(b.cmd), args: strs(b.args) };
    }
    if (!kind) continue;
    out.push({
      id: a.id,
      name: a.name.slice(0, 60),
      description: String(a.description ?? "").slice(0, 300),
      version: String(a.version ?? ""),
      website: typeof a.website === "string" && /^https:\/\//.test(a.website) ? a.website : typeof a.repository === "string" && /^https:\/\//.test(a.repository) ? a.repository : null,
      license: typeof a.license === "string" ? a.license.slice(0, 40) : null,
      kind,
      run,
      binaryHint,
    });
  }
  return out.sort((x, y) => x.name.localeCompare(y.name));
}

let mem: { at: number; agents: RegistryAgent[] } | null = null;

/** הקטלוג, עם קאש של 6 שעות (בזיכרון ובקובץ). בלי רשת: הקאש האחרון, גם אם ישן */
export async function acpRegistry(force = false): Promise<RegistryAgent[]> {
  if (!force && mem && Date.now() - mem.at < TTL) return mem.agents;
  let stale: RegistryAgent[] | null = null;
  try {
    const c = JSON.parse(await fs.readFile(CACHE, "utf8")) as { at: number; raw: unknown };
    stale = parseRegistry(c.raw);
    if (!force && Date.now() - c.at < TTL) {
      mem = { at: c.at, agents: stale };
      return stale;
    }
  } catch {
    /* אין קאש */
  }
  try {
    const r = await fetch(URL, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`registry ${r.status}`);
    const raw = (await r.json()) as unknown;
    const agents = parseRegistry(raw);
    mem = { at: Date.now(), agents };
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(CACHE, JSON.stringify({ at: mem.at, raw }));
    return agents;
  } catch (e) {
    if (stale) return stale;
    throw e;
  }
}
