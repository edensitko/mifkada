import { spawn } from "node:child_process";
import os from "node:os";
import { Readable, Writable } from "node:stream";
import { client, methods, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { agentEnv } from "./acp.js";
import { cachedProvider, providerConfigs, which, type ProviderConfig } from "./presets.js";
import { listProviderSessions } from "../providerSessions.js";
import { providerSettings } from "../settings.js";

/**
 * סשנים של סוכנים אחרים שלא נפתחו במפקדה (Codex מהטרמינל, מ-VS Code), דרך session/list של ACP: ממשק מתועד,
 * בלי לקרוא את הקבצים הפנימיים של כל סוכן. מרים את הסוכן לרגע, שואל ויוצא.
 */
export interface AgentSession {
  sessionId: string;
  provider: string;
  cwd: string;
  title: string;
  updatedAt: number;
}

const PAGES = 3;
const TIMEOUT = 45_000;

/** כל הסשנים שהסוכן מכיר (עד 3 עמודים). [] אם הוא לא תומך ב-session/list */
export async function listAgentSessions(cfg: ProviderConfig): Promise<AgentSession[]> {
  const child = spawn(cfg.command, cfg.args, { cwd: os.homedir(), env: agentEnv(cfg), stdio: ["pipe", "pipe", "ignore"] });
  const killer = setTimeout(() => child.kill(), TIMEOUT);
  try {
    await new Promise<void>((res, rej) => {
      child.once("spawn", res);
      child.once("error", rej);
    });
    const conn = client({ name: "mifkada" }).connect(ndJsonStream(Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>, Readable.toWeb(child.stdout!) as unknown as ReadableStream<Uint8Array>));
    const init = await conn.agent.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: "mifkada", version: "0.1.0" } });
    if (!init.agentCapabilities?.sessionCapabilities?.list) return [];
    const out: AgentSession[] = [];
    let cursor: string | null | undefined;
    for (let page = 0; page < PAGES; page++) {
      const r = await conn.agent.request(methods.agent.session.list, cursor ? { cursor } : {});
      for (const s of r.sessions) {
        out.push({ sessionId: s.sessionId, provider: cfg.id, cwd: s.cwd, title: (s.title ?? "").trim().slice(0, 120), updatedAt: s.updatedAt ? Date.parse(s.updatedAt) || 0 : 0 });
      }
      cursor = r.nextCursor;
      if (!cursor) break;
    }
    conn.close();
    return out;
  } finally {
    clearTimeout(killer);
    child.kill();
  }
}

const cache = new Map<string, { at: number; sessions: AgentSession[]; error?: string }>();
const running = new Map<string, Promise<AgentSession[]>>();

/** רענון של ספק אחד (גם בלחיצה על "סנכרון"). קריאות מקבילות לאותו ספק מחכות לאותה ריצה */
export function syncAgentSessions(id: string): Promise<AgentSession[]> {
  const cur = running.get(id);
  if (cur) return cur;
  const cfg = cachedProvider(id);
  if (!cfg) return Promise.reject(new Error(`unknown provider ${id}`));
  const p = listAgentSessions(cfg)
    .then((sessions) => {
      cache.set(id, { at: Date.now(), sessions });
      return sessions;
    })
    .catch((e: unknown) => {
      const error = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
      cache.set(id, { at: Date.now(), sessions: cache.get(id)?.sessions ?? [], error });
      console.error(`[agent-sessions ${id}]`, error);
      return cache.get(id)!.sessions;
    })
    .finally(() => running.delete(id));
  running.set(id, p);
  return p;
}

/** מה שידוע כרגע מכל הספקים (מהקאש, בלי לחכות): לרשימת הסשנים */
export function knownAgentSessions(): AgentSession[] {
  return [...cache.values()].flatMap((c) => c.sessions);
}

export function agentSessionsStatus(id: string): { at: number; count: number; error?: string } | null {
  const c = cache.get(id);
  return c ? { at: c.at, count: c.sessions.length, error: c.error } : null;
}

/**
 * ספקים שכדאי לסנכרן ברקע: פעילים, מותקנים, ושהשתמשת בהם (סשן שנפתח במפקדה, או הגדרה ששמרת).
 * לא כל preset: הרמה של סוכן עולה כמה שניות, ואין טעם בזה לסוכן שלא נגעת בו
 */
async function syncTargets(): Promise<string[]> {
  const [all, used, saved] = await Promise.all([providerConfigs(), listProviderSessions(), providerSettings()]);
  const usedIds = new Set([...used.map((s) => s.provider), ...Object.keys(saved)]);
  const out: string[] = [];
  for (const p of all) if (p.enabled && usedIds.has(p.id) && (await which(p.requires ?? p.command))) out.push(p.id);
  return out;
}

export async function syncAllAgentSessions(): Promise<void> {
  for (const id of await syncTargets()) await syncAgentSessions(id);
}
