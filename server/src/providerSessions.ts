import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./paths.js";
import type { ProviderId, TranscriptMessage } from "../../shared/protocol.js";

/**
 * סשנים של ספקים שאינם Claude (ACP). ל-Claude יש listSessions ותמליל ב-~/.claude, לאחרים אין דרך אחידה,
 * לכן מפקדה רושמת בעצמה כל סשן שהיא פותחת ושומרת את ההודעות שעברו בו.
 */
export interface ProviderSession {
  sessionId: string;
  provider: ProviderId;
  cwd: string;
  title: string;
  agent: string | null;
  createdAt: number;
  lastModified: number;
}

const FILE = path.join(DATA_DIR, "provider-sessions.json");
const TRANSCRIPTS = path.join(DATA_DIR, "transcripts");
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

let cache: ProviderSession[] | null = null;
let writing: Promise<void> = Promise.resolve();

export async function listProviderSessions(): Promise<ProviderSession[]> {
  if (cache) return cache;
  try {
    const raw = JSON.parse(await fs.readFile(FILE, "utf8")) as { sessions?: ProviderSession[] };
    cache = Array.isArray(raw.sessions) ? raw.sessions : [];
  } catch {
    cache = [];
  }
  return cache;
}

export async function getProviderSession(sessionId: string): Promise<ProviderSession | undefined> {
  return (await listProviderSessions()).find((s) => s.sessionId === sessionId);
}

function save(): Promise<void> {
  const data = JSON.stringify({ sessions: cache ?? [] }, null, 2);
  writing = writing.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(FILE, data);
  });
  return writing;
}

export async function upsertProviderSession(s: Pick<ProviderSession, "sessionId" | "provider" | "cwd"> & Partial<ProviderSession>): Promise<void> {
  const all = await listProviderSessions();
  const cur = all.find((x) => x.sessionId === s.sessionId);
  const now = Date.now();
  if (cur) Object.assign(cur, Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)), { lastModified: s.lastModified ?? now });
  else all.push({ title: "", agent: null, createdAt: now, lastModified: now, ...s });
  await save();
}

export async function deleteProviderSession(sessionId: string): Promise<boolean> {
  const all = await listProviderSessions();
  const i = all.findIndex((x) => x.sessionId === sessionId);
  if (i < 0) return false;
  all.splice(i, 1);
  await save();
  if (SAFE_ID.test(sessionId)) await fs.rm(path.join(TRANSCRIPTS, `${sessionId}.jsonl`), { force: true });
  return true;
}

const appending = new Map<string, Promise<void>>();

/** מוסיף הודעה לתמליל של הסשן (jsonl, שורה להודעה). הכתיבות לאותו סשן בתור, כדי שהסדר יישמר */
export function appendTranscript(sessionId: string, m: TranscriptMessage): Promise<void> {
  if (!SAFE_ID.test(sessionId)) return Promise.resolve();
  const line = JSON.stringify(m) + "\n";
  const next = (appending.get(sessionId) ?? Promise.resolve())
    .then(async () => {
      await fs.mkdir(TRANSCRIPTS, { recursive: true });
      await fs.appendFile(path.join(TRANSCRIPTS, `${sessionId}.jsonl`), line);
    })
    .catch((e: unknown) => console.error("[transcript]", e));
  appending.set(sessionId, next);
  return next;
}

export async function readProviderTranscript(sessionId: string): Promise<TranscriptMessage[]> {
  if (!SAFE_ID.test(sessionId)) return [];
  try {
    const raw = await fs.readFile(path.join(TRANSCRIPTS, `${sessionId}.jsonl`), "utf8");
    const out: TranscriptMessage[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as TranscriptMessage);
      } catch {
        /* שורה חתוכה (נפילה באמצע כתיבה) */
      }
    }
    return out;
  } catch {
    return [];
  }
}
