import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./paths.js";
import type { AgentTheme, SessionMeta, Themes } from "../../shared/protocol.js";

const FILE = path.join(DATA_DIR, "themes.json");

function isTheme(v: unknown): v is AgentTheme {
  return !!v && typeof v === "object" && !("agents" in (v as object)) && !("projects" in (v as object));
}

/** קורא את קובץ הארגון: ערכות עיצוב לאייג'נטים ולפרויקטים, ומטא-נתונים לסשנים (ארכיון). */
export async function readThemes(): Promise<Themes> {
  const empty: Themes = { agents: {}, projects: {}, sessions: {} };
  try {
    const raw = JSON.parse(await fs.readFile(FILE, "utf8")) as Record<string, unknown>;
    if (raw && typeof raw === "object" && ("agents" in raw || "projects" in raw)) {
      return {
        agents: (raw.agents as Record<string, AgentTheme>) ?? {},
        projects: (raw.projects as Record<string, AgentTheme>) ?? {},
        sessions: (raw.sessions as Record<string, SessionMeta>) ?? {},
      };
    }
    // גרסה ישנה: מפה שטוחה של אייג'נטים
    const agents: Record<string, AgentTheme> = {};
    for (const [k, v] of Object.entries(raw ?? {})) if (isTheme(v)) agents[k] = v;
    return { ...empty, agents };
  } catch {
    return empty;
  }
}

async function persist(all: Themes): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(all, null, 2));
}

export async function writeTheme(kind: "agents" | "projects", key: string, theme: AgentTheme): Promise<AgentTheme> {
  const all = await readThemes();
  all[kind][key] = { ...all[kind][key], ...theme };
  await persist(all);
  return all[kind][key];
}

export async function writeSessionMeta(sessionId: string, meta: SessionMeta): Promise<SessionMeta> {
  const all = await readThemes();
  const next = { ...all.sessions[sessionId], ...meta };
  for (const k of Object.keys(next) as Array<keyof SessionMeta>) if (next[k] === undefined) delete next[k];
  if (next.archived || next.pinned || next.kept || next.project || next.color || next.background || next.scheme) all.sessions[sessionId] = next;
  else delete all.sessions[sessionId];
  await persist(all);
  return all.sessions[sessionId] ?? {};
}
