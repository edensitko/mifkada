import { execFile } from "node:child_process";
import os from "node:os";
import { L } from "./i18n.js";
import { applyClaudeAuth } from "./claudeAuth.js";

/*
 * הרחבות של Claude Code: שרתי MCP (connectors) ופלאגינים, כמו מסך ה-Extensions ב-VS Code.
 * הכול עובר דרך ה-CLI הרשמי (`claude mcp ...`, `claude plugin ...`), כך שהקבצים נשארים בפורמט של Claude Code
 * (~/.claude.json, .mcp.json, ~/.claude/settings.json, ~/.claude/plugins) ומפקדה לא כותבת אותם בעצמה.
 * execFile עם מערך ארגומנטים (בלי shell), ושמות/מקורות נבדקים לפני שהם עוברים ל-CLI.
 */

function run(args: string[], cwd = os.homedir(), timeout = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    // ההתקנות רצות על ההתחברות של Claude Code, לא על מפתח API
    applyClaudeAuth(env);
    execFile("claude", args, { cwd, timeout, env, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || stdout || err.message).trim().split("\n").slice(-3).join(" ");
        reject(new Error(msg || L("הפקודה של Claude Code נכשלה", "The Claude Code command failed")));
      } else resolve(stdout);
    });
  });
}

// ---------- MCP ----------

export type McpStatus = "connected" | "failed" | "auth" | "pending" | "unknown";
export interface McpServer {
  name: string;
  target: string;
  status: McpStatus;
  detail: string;
  /** מאיפה הוא מגיע: connector של claude.ai, פלאגין, או מוגדר אצלך (user / project / local) */
  source: "claude.ai" | "plugin" | "config";
}

/** שורה של `claude mcp list`: "name: target - ✔ Connected" */
export function parseMcpList(text: string): McpServer[] {
  const out: McpServer[] = [];
  for (const line of text.split("\n")) {
    const m = /^(.+?): (.+) - (.+)$/.exec(line.trim());
    if (!m) continue;
    const [, name, target, st] = m;
    const status: McpStatus = /Connected/i.test(st) ? "connected" : /auth/i.test(st) ? "auth" : /Pending/i.test(st) ? "pending" : /Fail|✗/i.test(st) ? "failed" : "unknown";
    const source = name.startsWith("claude.ai ") ? "claude.ai" : name.startsWith("plugin:") ? "plugin" : "config";
    out.push({ name, target, status, detail: st.replace(/^[^\p{L}]+/u, "").trim(), source });
  }
  return out;
}

let mcpCache: { cwd: string; at: number; list: McpServer[] } | null = null;
export async function listMcp(cwd = os.homedir(), force = false): Promise<McpServer[]> {
  if (!force && mcpCache && mcpCache.cwd === cwd && Date.now() - mcpCache.at < 30_000) return mcpCache.list;
  const list = parseMcpList(await run(["mcp", "list"], cwd, 60_000));
  mcpCache = { cwd, at: Date.now(), list };
  return list;
}

const NAME = /^[A-Za-z0-9][\w.-]{0,63}$/;
export type McpScope = "user" | "project" | "local";
export interface McpInput {
  name: string;
  transport: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  scope: McpScope;
}

export async function addMcp(input: McpInput, cwd = os.homedir()): Promise<void> {
  if (!NAME.test(input.name)) throw new Error(L("שם לא תקין: אותיות באנגלית, מספרים, נקודה, מקף וקו תחתון", "Invalid name: letters, numbers, dot, dash and underscore"));
  if (!["user", "project", "local"].includes(input.scope)) throw new Error("scope");
  let json: Record<string, unknown>;
  if (input.transport === "stdio") {
    if (!input.command?.trim()) throw new Error(L("חסרה פקודה", "Missing command"));
    json = { type: "stdio", command: input.command.trim(), args: input.args ?? [], ...(input.env && Object.keys(input.env).length ? { env: input.env } : {}) };
  } else {
    if (!/^https?:\/\//.test(input.url ?? "")) throw new Error(L("כתובת צריכה להתחיל ב-http:// או https://", "The URL must start with http:// or https://"));
    json = { type: input.transport, url: input.url, ...(input.headers && Object.keys(input.headers).length ? { headers: input.headers } : {}) };
  }
  await run(["mcp", "add-json", "--scope", input.scope, input.name, JSON.stringify(json)], cwd);
  mcpCache = null;
}

export async function removeMcp(name: string, scope: McpScope | null, cwd = os.homedir()): Promise<void> {
  if (!NAME.test(name)) throw new Error("name");
  await run(["mcp", "remove", ...(scope ? ["--scope", scope] : []), name], cwd);
  mcpCache = null;
}

// ---------- פלאגינים ----------

export interface InstalledPlugin {
  id: string;
  version: string | null;
  scope: string;
  enabled: boolean;
  mcpServers: string[];
}
export interface AvailablePlugin {
  id: string;
  name: string;
  description: string;
  marketplace: string;
  installCount: number;
}
export interface Marketplace {
  name: string;
  source: string;
}

let pluginCache: { at: number; installed: InstalledPlugin[]; available: AvailablePlugin[] } | null = null;
export async function listPlugins(force = false): Promise<{ installed: InstalledPlugin[]; available: AvailablePlugin[] }> {
  if (!force && pluginCache && Date.now() - pluginCache.at < 60_000) return pluginCache;
  const raw = JSON.parse(await run(["plugin", "list", "--json", "--available"])) as {
    installed?: Array<{ id: string; version?: string; scope?: string; enabled?: boolean; mcpServers?: Record<string, unknown> }>;
    available?: Array<{ pluginId: string; name: string; description?: string; marketplaceName?: string; installCount?: number }>;
  };
  const installed = (raw.installed ?? []).map((p) => ({ id: p.id, version: p.version ?? null, scope: p.scope ?? "user", enabled: p.enabled !== false, mcpServers: Object.keys(p.mcpServers ?? {}) }));
  const have = new Set(installed.map((p) => p.id));
  const available = (raw.available ?? [])
    .filter((p) => !have.has(p.pluginId))
    .map((p) => ({ id: p.pluginId, name: p.name, description: (p.description ?? "").slice(0, 400), marketplace: p.marketplaceName ?? "", installCount: p.installCount ?? 0 }))
    .sort((a, b) => b.installCount - a.installCount);
  pluginCache = { at: Date.now(), installed, available };
  return pluginCache;
}

const PLUGIN_ID = /^[A-Za-z0-9][\w.-]*(@[A-Za-z0-9][\w.-]*)?$/;
export async function pluginAction(action: "install" | "uninstall" | "enable" | "disable" | "update", id: string): Promise<void> {
  if (!PLUGIN_ID.test(id)) throw new Error(L("מזהה פלאגין לא תקין", "Invalid plugin id"));
  await run(["plugin", action, id], os.homedir(), 300_000);
  pluginCache = null;
  mcpCache = null;
}

export async function listMarketplaces(): Promise<Marketplace[]> {
  const raw = JSON.parse(await run(["plugin", "marketplace", "list", "--json"])) as Array<{ name: string; source?: string; repo?: string; url?: string; path?: string }>;
  return raw.map((m) => ({ name: m.name, source: m.repo ?? m.url ?? m.path ?? m.source ?? "" }));
}

export async function marketplaceAction(action: "add" | "remove" | "update", arg: string): Promise<void> {
  // מקור של add: owner/repo, כתובת git/https, או נתיב מקומי. לא מתחיל במקף, כדי שלא ייקרא כדגל
  if (!arg.trim() || arg.trim().startsWith("-") || arg.length > 300) throw new Error(L("מקור לא תקין", "Invalid source"));
  await run(["plugin", "marketplace", action, arg.trim()], os.homedir(), 300_000);
  pluginCache = null;
}
