import fs from "node:fs/promises";
import path from "node:path";
import { listSessions } from "@anthropic-ai/claude-agent-sdk";
import { CLAUDE_HOME, isProtectedDir } from "./paths.js";
import { parseFrontmatter } from "./agents.js";

export interface Capability {
  kind: "skill" | "plugin" | "command";
  name: string;
  description: string;
  scope: "user" | "project" | "plugin" | "synced";
  path: string;
  project?: string;
}

const SKIP = new Set(["node_modules", ".git", "assets", "scripts", "references", "examples", "templates"]);

/**
 * סקילים: כל SKILL.md עד עומק 3. מכסה סקיל רגיל (skills/x/SKILL.md), אוסף (heygen-skills/heygen-video,
 * higgsfield/skills/x) וסקילים שמסונכרנים מ-claude.ai (synced/<id>/pdf). סקיל לא נסרק פנימה.
 */
async function skillsIn(dir: string, scope: Capability["scope"], project?: string, depth = 0): Promise<Capability[]> {
  const out: Capability[] = [];
  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory() || SKIP.has(e.name) || e.name.startsWith(".")) continue;
    const sub = path.join(dir, e.name);
    const file = path.join(sub, "SKILL.md");
    try {
      const fm = parseFrontmatter(await fs.readFile(file, "utf8"));
      const synced = sub.includes(`${path.sep}synced${path.sep}`);
      out.push({ kind: "skill", name: String(fm.name ?? e.name), description: String(fm.description ?? "").slice(0, 300), scope: synced ? "synced" : scope, path: file, project });
    } catch {
      if (depth < 3) out.push(...(await skillsIn(sub, scope, project, depth + 1)));
    }
  }
  return out;
}

/** כל מה ש-Claude Code יודע לעשות מעבר לבסיס: סקילים של המשתמש, של פרויקטים, ופלאגינים מותקנים. */
let capCache: { at: number; list: Capability[] } | null = null;
const BLOCKED = new Set<string>();

export async function capabilities(): Promise<Capability[]> {
  if (capCache && Date.now() - capCache.at < 60_000) return capCache.list;
  const list = await scanCapabilities();
  capCache = { at: Date.now(), list };
  return list;
}

async function scanCapabilities(): Promise<Capability[]> {
  const out: Capability[] = [...(await skillsIn(path.join(CLAUDE_HOME, "skills"), "user"))];
  const cwds = new Set<string>();
  try {
    for (const s of await listSessions({ limit: 500 })) if (s.cwd) cwds.add(s.cwd);
  } catch {
    /* אין */
  }
  // תיקיות מוגנות של macOS (הורדות, iCloud) יכולות לחסום את readdir עד אישור פרטיות שלא יגיע.
  // לכן כל פרויקט נסרק במקביל עם מגבלת זמן, ופרויקט שנתקע פשוט מדולג
  // קריאה תקועה תופסת חוט של libuv לתמיד, לכן תיקייה שנתקעה פעם אחת לא נסרקת שוב
  const scan = [...cwds].filter((c) => !BLOCKED.has(c) && !isProtectedDir(c));
  const perProject = await Promise.all(
    scan.map((cwd) =>
      Promise.race([
        skillsIn(path.join(cwd, ".claude", "skills"), "project", cwd),
        new Promise<Capability[]>((res) =>
          setTimeout(() => {
            BLOCKED.add(cwd);
            res([]);
          }, 2000),
        ),
      ]),
    ),
  );
  for (const list of perProject) out.push(...list);
  try {
    const installed = JSON.parse(await fs.readFile(path.join(CLAUDE_HOME, "plugins", "installed_plugins.json"), "utf8")) as { plugins?: Record<string, Array<{ installPath?: string }>> };
    for (const [id, versions] of Object.entries(installed.plugins ?? {})) {
      const p = versions[0]?.installPath;
      let description = "";
      try {
        description = String((JSON.parse(await fs.readFile(path.join(p ?? "", ".claude-plugin", "plugin.json"), "utf8")) as { description?: string }).description ?? "");
      } catch {
        /* בלי מניפסט */
      }
      out.push({ kind: "plugin", name: id, description, scope: "plugin", path: p ?? "" });
      if (p) out.push(...(await skillsIn(path.join(p, "skills"), "plugin", id)));
    }
  } catch {
    /* אין פלאגינים */
  }
  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.path) ? false : (seen.add(c.path), true)));
}
