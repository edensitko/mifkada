import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { CLAUDE_HOME } from "./paths.js";
import { readThemes } from "./store.js";
import type { AgentInfo, AgentInput } from "../../shared/protocol.js";
import { L } from "./i18n.js";

const PALETTE = ["#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#14b8a6", "#eab308", "#f97316"];
const EMOJIS = ["🛠️", "🛡️", "🔭", "🧭", "🧪", "📡", "🧱", "🎯"];

function hash(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h;
}

/** frontmatter של קובץ אייג'נט. YAML קודם, ואם הוא נכשל (נקודתיים בתיאור) שורות key: value. */
export function parseFrontmatter(raw: string): Record<string, unknown> {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  try {
    const parsed = YAML.parse(m[1]);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    /* נופל לפרסר הפשוט */
  }
  const out: Record<string, unknown> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

export async function listAgents(): Promise<AgentInfo[]> {
  const dir = path.join(CLAUDE_HOME, "agents");
  const themes = await readThemes();
  let names: string[] = [];
  try {
    names = (await fs.readdir(dir)).filter((n) => n.endsWith(".md")).sort();
  } catch {
    return [];
  }
  const out: AgentInfo[] = [];
  for (const n of names) {
    const raw = await fs.readFile(path.join(dir, n), "utf8");
    const fm = parseFrontmatter(raw);
    const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
    const slug = String(fm.name ?? n.replace(/\.md$/, ""));
    const h = hash(slug);
    const t = themes.agents[slug] ?? {};
    out.push({
      slug,
      name: t.displayName ?? slug,
      description: String(fm.description ?? ""),
      model: fm.model ? String(fm.model) : undefined,
      tools: fm.tools ? String(fm.tools) : undefined,
      prompt: body,
      source: "user",
      color: t.color ?? PALETTE[h % PALETTE.length],
      emoji: t.emoji ?? EMOJIS[h % EMOJIS.length],
      image: t.image,
    });
  }
  return out;
}

const SLUG = /^[a-z0-9][a-z0-9-]{1,40}$/;

function yamlString(v: string): string {
  return JSON.stringify(v);
}

/** כותב קובץ אייג'נט ב-~/.claude/agents בפורמט של Claude Code (frontmatter + פרומפט). */
export async function writeAgent(input: AgentInput): Promise<void> {
  if (!SLUG.test(input.slug)) throw new Error(L("שם האייג'נט: אותיות לטיניות קטנות, ספרות ומקפים בלבד", "Agent name: lowercase Latin letters, digits and hyphens only"));
  if (!input.description.trim()) throw new Error(L("חסר תיאור", "Description is missing"));
  if (!input.prompt.trim()) throw new Error(L("חסר פרומפט", "Prompt is missing"));
  const dir = path.join(CLAUDE_HOME, "agents");
  await fs.mkdir(dir, { recursive: true });
  const lines = [`name: ${input.slug}`, `description: ${yamlString(input.description.trim())}`];
  if (input.tools?.trim()) lines.push(`tools: ${input.tools.trim()}`);
  if (input.model?.trim()) lines.push(`model: ${input.model.trim()}`);
  await fs.writeFile(path.join(dir, `${input.slug}.md`), `---\n${lines.join("\n")}\n---\n\n${input.prompt.trim()}\n`);
}

export async function deleteAgent(slug: string): Promise<void> {
  if (!SLUG.test(slug)) throw new Error(L("שם לא תקין", "Invalid name"));
  await fs.rm(path.join(CLAUDE_HOME, "agents", `${slug}.md`));
}
