import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { AgentInfo, MapData, MapGap, MapLink, MapNode, Routine, SessionRow, Task } from "../../shared/protocol.js";
import type { Capability } from "./capabilities.js";
import type { RepoStatus } from "./repos.js";
import { CLAUDE_HOME } from "./paths.js";
import { parseFrontmatter } from "./agents.js";
import { L } from "./i18n.js";

/*
 * המפה: גרף אחד של כל מה שיש. במרכז המשתמש, סביבו חמש "שמשות משנה" (פרויקטים, אייג'נטים, סקילס,
 * זיכרון, אוטומציה), ומכל אחת יוצאים הפריטים. הקשרים האמיתיים (סשן → פרויקט, סשן → אייג'נט,
 * פתק זיכרון → פרויקט, [[קישור]] בין פתקים) הם מה שמושך דברים קשורים זה לזה.
 * "מה חסר" מחושב כאן ולא ב-UI, כדי שאפשר יהיה לבדוק אותו.
 */

const DAY = 86_400_000;

interface MemoryNote {
  file: string;
  name: string;
  description: string;
  body: string;
  /** תיקיית הפרויקט שהזיכרון שלו (projects/<מקודד>/memory), אם יש */
  projectDir: string | null;
}

/** Claude Code מקודד את ה-cwd לשם תיקייה: כל תו שאינו אות/ספרה הופך ל-"-" */
export const encodeCwd = (cwd: string): string => cwd.replace(/[^a-zA-Z0-9]/g, "-");

async function readNotes(dir: string, projectDir: string | null): Promise<MemoryNote[]> {
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  const out: MemoryNote[] = [];
  for (const f of files) {
    if (!f.endsWith(".md") || f === "MEMORY.md") continue;
    const file = path.join(dir, f);
    const raw = await fs.readFile(file, "utf8").catch(() => "");
    const fm = parseFrontmatter(raw);
    const body = raw.replace(/^---[\s\S]*?\n---\n?/, "");
    out.push({ file, name: String(fm.name ?? f.replace(/\.md$/, "")), description: String(fm.description ?? "").slice(0, 300), body, projectDir });
  }
  return out;
}

/** הזיכרון הגלובלי (~/.claude/memory) והזיכרון של כל פרויקט (~/.claude/projects/<מקודד>/memory) */
export async function memoryNotes(home = CLAUDE_HOME): Promise<{ notes: MemoryNote[]; projectDirs: Map<string, string> }> {
  const notes = await readNotes(path.join(home, "memory"), null);
  const projectDirs = new Map<string, string>();
  const enc = await fs.readdir(path.join(home, "projects")).catch(() => [] as string[]);
  for (const e of enc) {
    const dir = path.join(home, "projects", e, "memory");
    const list = await readNotes(dir, e);
    if (list.length) projectDirs.set(e, dir);
    notes.push(...list);
  }
  return { notes, projectDirs };
}

/** מילות מפתח לפרויקט מתוך שם התיקייה: "acme.io-main" → acme; "billing-api" → billing-api, billing */
export function projectKeywords(cwd: string): string[] {
  const base = path.basename(cwd).toLowerCase();
  const generic = new Set(["main", "app", "web", "site", "server", "backend", "frontend", "clients", "projects", "desktop", "landing", "page", "flutter"]);
  const parts = base.split(/[^a-z0-9א-ת]+/).filter((p) => p.length >= 4 && !generic.has(p));
  return [...new Set([base, ...parts])].filter((k) => k.length >= 4);
}

const includesWord = (text: string, word: string) => new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(text);

/** מצב git לפרויקט. תיקייה בתוך מונורפו (repo/x) מקבלת רק את השינויים שלה, ו-ahead נספר פעם אחת בשורש */
function gitOf(repo: RepoStatus, cwd: string): NonNullable<MapNode["git"]> {
  if (repo.root === cwd) return { branch: repo.branch, changed: repo.changed + repo.untracked, ahead: repo.ahead, remote: Boolean(repo.remote) };
  const top = path.relative(repo.root, cwd).split(path.sep)[0];
  const changed = repo.byFolder?.find((f) => f.folder === top || f.folder === `${top}/`)?.changed ?? 0;
  return { branch: repo.branch, changed, ahead: 0, remote: Boolean(repo.remote) };
}

export interface MapInput {
  sessions: SessionRow[];
  agents: AgentInfo[];
  capabilities: Capability[];
  repos: RepoStatus[];
  tasks: Task[];
  routines: Routine[];
  notes: MemoryNote[];
  /** תיקיות פרויקט ידועות (תת-תיקיות של "תיקיות הפרויקטים" בהגדרות) גם בלי סשנים */
  projectDirs: string[];
  /** "תיקיות הפרויקטים" עצמן: לא פרויקט, אלא קבוצה */
  projectRoots?: string[];
  /** השם במרכז המפה ("השם שלך" בהגדרות) */
  centerLabel?: string;
  now?: number;
}

export function buildMap(input: MapInput): MapData {
  const now = input.now ?? Date.now();
  const home = os.homedir();
  const nodes = new Map<string, MapNode>();
  const links: MapLink[] = [];
  const linkKeys = new Set<string>();
  const add = (n: MapNode) => {
    if (!nodes.has(n.id)) nodes.set(n.id, n);
    return n.id;
  };
  const link = (source: string, target: string, kind: MapLink["kind"]) => {
    if (source === target || !nodes.has(source) || !nodes.has(target)) return;
    const k = source < target ? `${source}|${target}` : `${target}|${source}`;
    if (linkKeys.has(k)) return;
    linkKeys.add(k);
    links.push({ source, target, kind });
  };

  // ── המרכז וחמשת הענפים ──
  add({ id: "hub", type: "hub", label: input.centerLabel || L("אני", "Me") });
  const branches = [
    ["b:projects", L("פרויקטים", "Projects")],
    ["b:agents", L("אייג'נטים", "Agents")],
    ["b:skills", L("סקילס וכלים", "Skills and tools")],
    ["b:memory", L("זיכרון", "Memory")],
    ["b:auto", L("משימות ורוטינות", "Tasks and routines")],
  ] as const;
  for (const [id, label] of branches) {
    add({ id, type: "branch", label });
    link("hub", id, "tree");
  }

  // ── פרויקטים: מתיקיות הסשנים + תיקיות ידועות. תיקיית הבית ו-/tmp לא נחשבות פרויקט ──
  const junk = (cwd: string) => !cwd || cwd === home || cwd === "/" || cwd.startsWith("/private/tmp") || cwd.startsWith("/tmp") || /[\\/]\.mifkada-worktrees[\\/]/.test(cwd);
  const projSessions = new Map<string, SessionRow[]>();
  for (const s of input.sessions) {
    const cwd = s.projectCwd || s.cwd;
    if (junk(cwd)) continue;
    projSessions.set(cwd, [...(projSessions.get(cwd) ?? []), s]);
  }
  const repoByRoot = new Map(input.repos.map((r) => [r.root, r]));
  const allCwds = new Set<string>([...projSessions.keys(), ...input.projectDirs.filter((d) => !junk(d))]);
  // תת-תיקייה של פרויקט ידוע (למשל app/backend) מתמזגת להורה הקרוב ביותר שיש לו סשנים או ריפו. תיקיית-אב מההגדרות היא קבוצה, לא הורה
  const roots = [...allCwds].sort((a, b) => a.length - b.length);
  const rootSet = new Set(input.projectRoots ?? []);
  const ownerOf = new Map<string, string>();
  for (const cwd of roots) {
    const parent = roots.find((r) => r !== cwd && cwd.startsWith(r + "/") && !rootSet.has(r) && r !== home);
    ownerOf.set(cwd, parent ? (ownerOf.get(parent) ?? parent) : cwd);
  }
  const projectId = (cwd: string) => `p:${ownerOf.get(cwd) ?? cwd}`;

  for (const cwd of roots) {
    if (ownerOf.get(cwd) !== cwd) continue;
    const sessions = [...projSessions.entries()].filter(([c]) => (ownerOf.get(c) ?? c) === cwd).flatMap(([, v]) => v);
    const last = sessions.reduce((m, s) => Math.max(m, s.lastModified), 0);
    const repo = repoByRoot.get(cwd) ?? input.repos.find((r) => cwd.startsWith(r.root + "/"));
    const groupRoot = (input.projectRoots ?? []).find((r) => cwd.startsWith(r + "/"));
    const group = groupRoot ? path.basename(groupRoot) : L("אחר", "Other");
    add({
      id: projectId(cwd),
      type: "project",
      label: path.basename(cwd),
      path: cwd,
      group,
      count: sessions.length,
      lastActive: last || null,
      live: sessions.some((s) => s.live || s.external),
      git: repo ? gitOf(repo, cwd) : null,
    });
    link("b:projects", projectId(cwd), "tree");
  }

  // ── אייג'נטים ──
  const agentSlugs = new Set(input.agents.map((a) => a.slug));
  for (const a of input.agents) {
    add({ id: `a:${a.slug}`, type: "agent", label: a.name || a.slug, description: a.description.slice(0, 300), color: a.color, emoji: a.emoji, count: 0 });
    link("b:agents", `a:${a.slug}`, "tree");
  }

  // ── סשנים: כל אחד מתחבר לפרויקט שלו ולאייג'נט שלו (tag) ──
  for (const s of input.sessions) {
    const cwd = s.projectCwd || s.cwd;
    const agent = s.tag && agentSlugs.has(s.tag) ? s.tag : s.live?.agent && agentSlugs.has(s.live.agent) ? s.live.agent : null;
    const id = add({
      id: `s:${s.sessionId}`,
      type: "session",
      label: s.title.slice(0, 80),
      path: s.cwd,
      sessionId: s.sessionId,
      lastActive: s.lastModified,
      live: Boolean(s.live || s.external),
      agent,
    });
    if (!junk(cwd)) link(id, projectId(cwd), "belongs");
    else link(id, "hub", "belongs");
    if (agent) {
      link(id, `a:${agent}`, "uses");
      const an = nodes.get(`a:${agent}`);
      if (an) {
        an.count = (an.count ?? 0) + 1;
        an.lastActive = Math.max(an.lastActive ?? 0, s.lastModified);
      }
    }
  }

  // ── סקילס ופלאגינים: של המשתמש לענף, של פרויקט לפרויקט ──
  for (const c of input.capabilities) {
    if (c.kind === "command") continue;
    const id = add({ id: `k:${c.scope}:${c.name}`, type: "skill", label: c.name, description: c.description, path: c.path, group: c.scope === "synced" ? L("מסונכרן מ-claude.ai", "Synced from claude.ai") : c.scope === "plugin" ? L("פלאגין", "Plugin") : c.scope === "project" ? L("של פרויקט", "Project") : L("שלי", "Mine") });
    if (c.project && !junk(c.project)) link(id, projectId(c.project), "belongs");
    link("b:skills", id, "tree");
  }

  // ── זיכרון: פתק מתחבר לפרויקט שהוא שלו (תיקייה מקודדת) או שהשם שלו מופיע בו, ולפתקים שהוא מקשר אליהם ──
  const projectNodes = [...nodes.values()].filter((n) => n.type === "project");
  const byEncoded = new Map(projectNodes.map((p) => [encodeCwd(p.path!), p.id]));
  const keywords = projectNodes.map((p) => ({ id: p.id, words: projectKeywords(p.path!) }));
  const noteIds = new Map<string, string>();
  for (const n of input.notes) {
    const id = add({ id: `m:${n.file}`, type: "memory", label: n.name, description: n.description, path: n.file, group: n.projectDir ? L("זיכרון של פרויקט", "Project memory") : L("זיכרון כללי", "General memory") });
    noteIds.set(n.name, id);
    noteIds.set(path.basename(n.file, ".md"), id);
    link("b:memory", id, "tree");
  }
  for (const n of input.notes) {
    const id = `m:${n.file}`;
    const own = n.projectDir ? byEncoded.get(n.projectDir) : undefined;
    if (own) link(id, own, "about");
    // פתק של פרויקט שייך רק לפרויקט שלו. התאמה לפי שם רק בזיכרון הכללי, אחרת הכול מתחבר להכול
    if (!n.projectDir) {
      const hay = `${path.basename(n.file)} ${n.name} ${n.description}`.toLowerCase();
      for (const k of keywords) if (k.words.some((w) => includesWord(hay, w))) link(id, k.id, "about");
    }
    for (const m of n.body.matchAll(/\[\[([^\]|#]+)/g)) {
      const target = noteIds.get(m[1].trim());
      if (target) link(id, target, "mentions");
    }
  }

  // ── משימות (לא גמורות) ורוטינות ──
  for (const t of input.tasks) {
    if (t.status === "done") continue;
    const id = add({ id: `t:${t.id}`, type: "task", label: t.title, description: t.summary ?? t.prompt.slice(0, 200), status: t.status, path: t.cwd, lastActive: t.updatedAt });
    link("b:auto", id, "tree");
    if (!junk(t.cwd)) link(id, projectId(t.cwd), "belongs");
    if (t.agent) link(id, `a:${t.agent}`, "uses");
    if (t.sessionId) link(id, `s:${t.sessionId}`, "uses");
  }
  for (const r of input.routines) {
    const id = add({ id: `r:${r.id}`, type: "routine", label: r.title, description: r.prompt.slice(0, 200), status: r.enabled ? "on" : "off", path: r.cwd, lastActive: r.lastRun });
    link("b:auto", id, "tree");
    if (!junk(r.cwd)) link(id, projectId(r.cwd), "belongs");
    if (r.agent) link(id, `a:${r.agent}`, "uses");
  }

  // ── מה חסר / מה דורש תשומת לב ──
  const gaps: MapGap[] = [];
  const hasLink = (id: string, type: MapNode["type"]) => links.some((l) => (l.source === id && nodes.get(l.target)?.type === type) || (l.target === id && nodes.get(l.source)?.type === type));
  for (const p of projectNodes) {
    const active = p.lastActive && now - p.lastActive < 30 * DAY;
    if (p.git && p.git.changed > 0) gaps.push({ id: p.id, level: "warn", text: L(`${p.label}: ${p.git.changed} שינויים שלא נשמרו ב-git`, `${p.label}: ${p.git.changed} uncommitted changes in git`) });
    if (p.git && p.git.ahead > 0) gaps.push({ id: p.id, level: "warn", text: L(`${p.label}: ${p.git.ahead} קומיטים שלא נדחפו`, `${p.label}: ${p.git.ahead} unpushed commits`) });
    if (p.git && !p.git.remote) gaps.push({ id: p.id, level: "info", text: L(`${p.label}: אין remote (אין גיבוי ב-GitHub)`, `${p.label}: no remote (no backup on GitHub)`) });
    if (!p.git && p.count) gaps.push({ id: p.id, level: "info", text: L(`${p.label}: לא ריפו git`, `${p.label}: not a git repo`) });
    if (active && !hasLink(p.id, "memory")) gaps.push({ id: p.id, level: "info", text: L(`${p.label}: פעיל אבל אין עליו פתק זיכרון`, `${p.label}: active but has no memory note`) });
    if (!p.count) gaps.push({ id: p.id, level: "quiet", text: L(`${p.label}: אין בו סשנים במחשב הזה`, `${p.label}: no sessions on this computer`) });
    else if (!active) gaps.push({ id: p.id, level: "quiet", text: L(`${p.label}: רדום יותר מחודש`, `${p.label}: inactive for over a month`) });
  }
  for (const n of nodes.values()) {
    if (n.type === "agent" && !n.count) gaps.push({ id: n.id, level: "quiet", text: L(`האייג'נט ${n.label} עוד לא שימש באף סשן`, `The agent ${n.label} hasn't been used in any session yet`) });
    if (n.type === "task" && n.status === "review") gaps.push({ id: n.id, level: "warn", text: L(`משימה מחכה לבדיקה שלך: ${n.label}`, `Task waiting for your review: ${n.label}`) });
    if (n.type === "memory" && !links.some((l) => (l.source === n.id || l.target === n.id) && l.kind !== "tree")) gaps.push({ id: n.id, level: "quiet", text: L(`פתק הזיכרון ${n.label} לא מחובר לשום פרויקט`, `The memory note ${n.label} isn't linked to any project`) });
  }
  const order = { warn: 0, info: 1, quiet: 2 } as const;
  gaps.sort((a, b) => order[a.level] - order[b.level]);

  return { nodes: [...nodes.values()], links, gaps, at: now };
}

/** הפרונטמטר של פתק זיכרון, לפאנל הפרטים */
export async function readNote(file: string): Promise<string> {
  const memRoot = path.join(CLAUDE_HOME, "memory");
  const projRoot = path.join(CLAUDE_HOME, "projects");
  const abs = path.resolve(file);
  const ok = abs.endsWith(".md") && (abs.startsWith(memRoot + path.sep) || (abs.startsWith(projRoot + path.sep) && abs.split(path.sep).includes("memory")));
  if (!ok) throw new Error("not a memory note");
  return fs.readFile(abs, "utf8");
}
