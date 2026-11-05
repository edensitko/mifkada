import { query, type SlashCommand } from "@anthropic-ai/claude-agent-sdk";
import { sdkExe } from "./claudeExe.js";
import { applyClaudeAuth } from "./claudeAuth.js";

export interface CommandInfo {
  name: string;
  description: string;
  argumentHint: string;
  aliases?: string[];
  builtin: boolean;
}

/** פקודות שקשורות לטרמינל בלבד ואין להן משמעות במפקדה (גם אם ה-CLI מפרסם אותן) */
const TERMINAL_ONLY = new Set(["exit", "quit", "vim", "terminal-setup", "statusline", "ide", "login", "logout", "upgrade", "doctor", "bug", "feedback", "release-notes", "privacy-settings", "theme", "keybindings", "install-github-app", "install-slack-app", "mobile", "ios", "android", "desktop", "remote-control", "stickers", "passes", "chrome", "extra-usage", "rename", "export", "copy", "btw", "__remote-workflow", "workflow-launch-exec", "heapdump", "color", "focus"]);

const cache = new Map<string, { at: number; list: CommandInfo[] }>();
const inflight = new Map<string, Promise<CommandInfo[]>>();
const TTL = 10 * 60_000;

function shape(list: SlashCommand[]): CommandInfo[] {
  const seen = new Set<string>();
  const out: CommandInfo[] = [];
  for (const c of list) {
    if (TERMINAL_ONLY.has(c.name) || seen.has(c.name)) continue;
    seen.add(c.name);
    out.push({ name: c.name, description: c.description ?? "", argumentHint: c.argumentHint ?? "", aliases: c.aliases, builtin: Boolean(c.builtin) });
  }
  return out;
}

/** מסשן חי: הרשימה העדכנית שה-CLI מחזיק */
export function rememberCommands(cwd: string, list: SlashCommand[]): void {
  cache.set(cwd, { at: Date.now(), list: shape(list) });
}

/**
 * כל פקודות ה-/ של תיקייה: מובנות, פקודות משתמש ופרויקט, skills ו-plugins.
 * בלי סשן חי מרימים תהליך Claude קצר שלא שומר כלום ולא שולח הודעה, שואלים אותו וסוגרים.
 */
export async function listCommands(cwd: string, force = false): Promise<CommandInfo[]> {
  const hit = cache.get(cwd);
  if (hit && !force && Date.now() - hit.at < TTL) return hit.list;
  const running = inflight.get(cwd);
  if (running) return running;
  const p = (async () => {
    const env: Record<string, string | undefined> = { ...process.env };
    applyClaudeAuth(env);
    // קלט שלא נגמר עד שסוגרים: התהליך מאתחל, ולא נשלחת שום הודעה למודל
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    async function* idle() {
      await hold;
    }
    const q = query({ prompt: idle(), options: { ...sdkExe(), cwd, persistSession: false, env, tools: [], stderr: () => undefined } });
    try {
      const list = await Promise.race([q.supportedCommands(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 20_000))]);
      const shaped = shape(list);
      cache.set(cwd, { at: Date.now(), list: shaped });
      return shaped;
    } finally {
      release();
      q.close();
      inflight.delete(cwd);
    }
  })();
  inflight.set(cwd, p);
  return p;
}
