import { query } from "@anthropic-ai/claude-agent-sdk";
import { sdkExe } from "./claudeExe.js";
import { applyClaudeAuth } from "./claudeAuth.js";

export interface PlanLimit {
  /** "Current session", "Current week (all models)" וכו' */
  label: string;
  percent: number;
  resets: string | null;
}

let cache: { at: number; limits: PlanLimit[] } | null = null;
let inflight: Promise<PlanLimit[]> | null = null;

/**
 * ניצול המנוי (כמו /usage ב-Claude Code): מריצים את הפקודה המקומית בתהליך קצר שלא שומר כלום.
 * זו פקודה מקומית, היא לא שולחת הודעה למודל ולא עולה טוקנים. קאש 5 דקות.
 */
export async function planUsage(force = false): Promise<PlanLimit[]> {
  if (cache && !force && Date.now() - cache.at < 5 * 60_000) return cache.limits;
  if (inflight) return inflight;
  inflight = (async () => {
    const env: Record<string, string | undefined> = { ...process.env };
    applyClaudeAuth(env);
    const q = query({ prompt: "/usage", options: { ...sdkExe(), persistSession: false, env, maxTurns: 1, tools: [], stderr: () => undefined } });
    let text = "";
    const timer = setTimeout(() => q.close(), 30_000);
    try {
      for await (const m of q) if (m.type === "result" && m.subtype === "success") text = m.result;
    } finally {
      clearTimeout(timer);
    }
    const limits = parsePlanUsage(text);
    cache = { at: Date.now(), limits };
    return limits;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export function parsePlanUsage(text: string): PlanLimit[] {
  const out: PlanLimit[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*(Current [^:]+):\s*(\d+)%\s*used(?:\s*·\s*resets\s+(.+))?/i.exec(line);
    if (m) out.push({ label: m[1].trim(), percent: Number(m[2]), resets: m[3]?.trim() ?? null });
  }
  return out;
}
