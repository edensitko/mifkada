import { anthropicKey, systemPrefs } from "./settings.js";

/*
 * איך הסשנים של Claude מתחברים.
 *
 * apiKey (ברירת המחדל): לפי התנאים של Anthropic ל-Agent SDK, מוצר של צד שלישי לא מציע התחברות עם claude.ai,
 * ולכן הסשנים רצים על מפתח API של Anthropic (שנשמר בהגדרות או ANTHROPIC_API_KEY מהסביבה), או על Amazon Bedrock /
 * Google Vertex AI כשהמשתנים שלהם מוגדרים (CLAUDE_CODE_USE_BEDROCK / CLAUDE_CODE_USE_VERTEX).
 *
 * claudeCode: ההתחברות הקיימת של Claude Code במחשב (מה ש-`claude` משתמש בו בטרמינל), בלי מפתח. אין לזה מתג בממשק:
 * רק עריכה ידנית של system.authMode ב-settings.json, למי שמריץ את מפקדה לשימוש אישי ואחראי לתנאים בעצמו.
 */

export type AuthMode = "apiKey" | "claudeCode";

export function authMode(): AuthMode {
  return systemPrefs().authMode === "claudeCode" ? "claudeCode" : "apiKey";
}

/** Bedrock או Vertex מוגדרים בסביבה: אז אין צורך במפתח של Anthropic */
export function cloudProvider(env: NodeJS.ProcessEnv = process.env): "bedrock" | "vertex" | null {
  const on = (v?: string) => Boolean(v && v !== "0" && v.toLowerCase() !== "false");
  if (on(env.CLAUDE_CODE_USE_BEDROCK)) return "bedrock";
  if (on(env.CLAUDE_CODE_USE_VERTEX)) return "vertex";
  return null;
}

/** המפתח שישמש את הסשנים: מההגדרות, ואם אין אז מהסביבה */
export function effectiveApiKey(): string | null {
  return anthropicKey() ?? (process.env.ANTHROPIC_API_KEY?.trim() || null);
}

/** מכין env לתהליך של Claude Code (סשן, סיכום, פקודות) לפי מצב ההתחברות. משנה את האובייקט ומחזיר אותו */
export function applyClaudeAuth<T extends Record<string, string | undefined>>(env: T): T {
  if (authMode() === "claudeCode") {
    delete env.ANTHROPIC_API_KEY;
    return env;
  }
  const key = effectiveApiKey();
  if (key) (env as Record<string, string | undefined>).ANTHROPIC_API_KEY = key;
  return env;
}

/** האם יש ל-Claude דרך להתחבר במצב apiKey */
export function apiAuthReady(): boolean {
  return Boolean(effectiveApiKey() || cloudProvider());
}
