import { execFile } from "node:child_process";
import { listSessions } from "@anthropic-ai/claude-agent-sdk";
import { sttAvailable } from "./stt.js";
import { authStatus, claudeBin, type AuthState } from "./providers/auth.js";
import { claudeExe, minClaudeVersion } from "./claudeExe.js";
import { authMode, type AuthMode } from "./claudeAuth.js";

/** גרסה של כלי בשורת הפקודה, או null אם הוא לא מותקן / לא ב-PATH */
function version(cmd: string, args: string[] = ["--version"]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000 }, (err, out) => resolve(err ? null : out.trim().split("\n")[0].slice(0, 80) || null));
  });
}

/**
 * בדיקת סביבה להפעלה הראשונה: איזה Claude Code מריץ את הסשנים (claudeExe.ts), ההתחברות (מפתח API או, ב-authMode
 * claudeCode, `claude auth status`), git ו-gh מה-PATH, וקול מקומי.
 */
export async function doctor(): Promise<{ platform: NodeJS.Platform; claude: string | null; claudeSource: "env" | "bundled" | "installed" | null; claudeMin: string; claudeAuth: AuthState; sessions: number; git: string | null; gh: string | null; voice: boolean; apiKeyEnv: boolean; authMode: AuthMode }> {
  const [claude, claudeAuth, git, gh, voice, sessions] = await Promise.all([
    // רק Claude Code שבאמת יריץ את הסשנים (של ה-SDK, או מותקן בגרסה מספקת)
    claudeExe() ? version(claudeBin()) : Promise.resolve(null),
    authStatus("claude", true),
    version("git"),
    version("gh"),
    sttAvailable().catch(() => false),
    listSessions({ limit: 500 }).then((r) => r.length, () => 0),
  ]);
  return { platform: process.platform, claude, claudeSource: claudeExe()?.source ?? null, claudeMin: minClaudeVersion(), claudeAuth, sessions, git, gh, voice, apiKeyEnv: Boolean(process.env.ANTHROPIC_API_KEY), authMode: authMode() };
}
