import { LiveSession } from "../live.js";
import { L } from "../i18n.js";
import { AcpRuntime } from "./acp.js";
import { cachedProvider } from "./presets.js";
import type { AgentRuntime, OpenParams } from "./types.js";

/** פותח סשן חי אצל הספק המתאים. חסר = claude, כל השאר ACP לפי ההגדרות */
export function createRuntime(p: OpenParams): AgentRuntime {
  const provider = p.provider || "claude";
  if (provider === "claude") return new LiveSession(p);
  const cfg = cachedProvider(provider);
  if (!cfg) throw new Error(L(`ספק לא מוכר: ${provider}`, `Unknown provider: ${provider}`));
  if (!cfg.enabled) throw new Error(L(`הספק ${cfg.label} כבוי בהגדרות`, `${cfg.label} is turned off in Settings`));
  return new AcpRuntime(cfg, p);
}
