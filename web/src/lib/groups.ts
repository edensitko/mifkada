import type { AgentInfo, AgentTheme, SessionRow } from "../../../shared/protocol";
import { initial, projectColor, projectName } from "./util";
import { pick } from "../i18n";

export interface Visual {
  color: string;
  emoji: string;
  name: string;
  square: boolean;
  image?: string;
}

export interface Group {
  key: string;
  visual: Visual;
  rows: SessionRow[];
  sub?: Group[];
  /** במצב משולב: שיחות בלי אייג'נט, מוצגות ישירות תחת הפרויקט ולא כתת-קבוצה */
  loose?: SessionRow[];
  cwd?: string;
  agent?: AgentInfo | null;
  lastModified: number;
  active: number;
  pinned?: boolean;
  hidden?: boolean;
}

export const NONE = "__none__";
export const NONE_VISUAL: Visual = {
  color: "#64748b",
  emoji: "·",
  // getter: השם מתורגם בכל קריאה, לפי השפה הנוכחית
  get name() {
    return pick("כללי", "General");
  },
  square: false,
};

export function rowAgent(r: SessionRow): string | null {
  return r.tag ?? r.live?.agent ?? null;
}

export function projectVisual(cwd: string, allCwds: Iterable<string>, themes: Record<string, AgentTheme>): Visual {
  const t = themes[cwd] ?? {};
  const name = t.displayName || projectName(cwd, allCwds);
  return { color: t.color ?? projectColor(cwd), emoji: t.emoji ?? initial(name), name, square: true, image: t.image };
}

export function agentVisual(a: AgentInfo | null): Visual {
  return a ? { color: a.color, emoji: a.emoji, name: a.name, square: false, image: a.image } : NONE_VISUAL;
}

function finish(g: Group): Group {
  g.rows.sort((a, b) => (b.live ? 1 : 0) - (a.live ? 1 : 0) || (b.external ? 1 : 0) - (a.external ? 1 : 0) || b.lastModified - a.lastModified);
  g.lastModified = Math.max(0, ...g.rows.map((r) => r.lastModified));
  g.active = g.rows.filter((r) => r.live || r.external).length;
  return g;
}

export function groupByAgent(rows: SessionRow[], agents: AgentInfo[]): Group[] {
  const byKey = new Map<string, SessionRow[]>();
  for (const r of rows) {
    const k = rowAgent(r) ?? NONE;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(r);
  }
  const out: Group[] = [];
  for (const a of agents) if (byKey.has(a.slug)) out.push(finish({ key: `agent:${a.slug}`, visual: agentVisual(a), rows: byKey.get(a.slug)!, agent: a, lastModified: 0, active: 0 }));
  for (const [k, rs] of byKey) {
    if (k === NONE || agents.some((a) => a.slug === k)) continue;
    out.push(finish({ key: `agent:${k}`, visual: { color: "#94a3b8", emoji: "🏷️", name: k, square: false }, rows: rs, agent: null, lastModified: 0, active: 0 }));
  }
  if (byKey.has(NONE)) out.push(finish({ key: `agent:${NONE}`, visual: NONE_VISUAL, rows: byKey.get(NONE)!, agent: null, lastModified: 0, active: 0 }));
  return out;
}

export function groupByProject(rows: SessionRow[], themes: Record<string, AgentTheme>, agents: AgentInfo[], nested: boolean): Group[] {
  const byCwd = new Map<string, SessionRow[]>();
  for (const r of rows) {
    // השיוך לפרויקט (אם הסשן נפתח מתיקייה אחרת), ואם אין אז התיקייה שממנה הוא רץ
    const k = r.projectCwd || r.cwd || "?";
    if (!byCwd.has(k)) byCwd.set(k, []);
    byCwd.get(k)!.push(r);
  }
  const all = [...byCwd.keys()];
  const out: Group[] = [];
  for (const [cwd, rs] of byCwd) {
    const g: Group = { key: `project:${cwd}`, visual: projectVisual(cwd, all, themes), rows: rs, cwd, lastModified: 0, active: 0, pinned: Boolean(themes[cwd]?.pinned), hidden: Boolean(themes[cwd]?.hidden) };
    if (nested && rs.some((r) => rowAgent(r))) {
      // רוב השיחות הן עבודה כללית בלי אייג'נט: הן נשארות ישירות תחת הפרויקט, ורק אייג'נטים מקבלים תת-קבוצה
      g.sub = groupByAgent(rs.filter((r) => rowAgent(r)), agents).map((s) => ({ ...s, key: `${g.key}/${s.key}` }));
      g.loose = rs.filter((r) => !rowAgent(r));
    }
    out.push(finish(g));
  }
  out.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.active - a.active || b.lastModified - a.lastModified);
  return out;
}
