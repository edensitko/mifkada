import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { CLAUDE_HOME } from "./paths.js";

/**
 * getSessionMessages לא מחזיר את זמן ההודעות, אבל קובץ ה-jsonl של הסשן שומר אותו בכל שורה.
 * קוראים את הקובץ שורה-שורה ולוקחים רק uuid ו-timestamp (בלי לפענח את כל ה-JSON).
 */
async function timestampsOf(sessionId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const base = path.join(CLAUDE_HOME, "projects");
  let file: string | null = null;
  try {
    for (const d of await fs.promises.readdir(base)) {
      const f = path.join(base, d, `${sessionId}.jsonl`);
      if (fs.existsSync(f)) {
        file = f;
        break;
      }
    }
  } catch {
    return map;
  }
  if (!file) return map;
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    const u = /"uuid":"([0-9a-f-]{36})"/.exec(line);
    const t = /"timestamp":"([0-9T:.\-Z]+)"/.exec(line);
    if (u && t) map.set(u[1], t[1]);
  }
  return map;
}
import type { Block, TranscriptMessage } from "../../shared/protocol.js";
import { L } from "./i18n.js";

const META_PREFIXES = ["<command-name>", "<command-message>", "<local-command-stdout>", "<local-command-caveat>", "<task-notification>", "[SYSTEM NOTIFICATION"];

function cleanText(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<ide_selection>[\s\S]*?<\/ide_selection>/g, "")
    .trim();
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (!b || typeof b !== "object") return String(b);
        const block = b as { type?: string; text?: string };
        if (block.type === "text") return String(block.text ?? "");
        if (block.type === "image") return L("[תמונה]", "[image]");
        return JSON.stringify(b).slice(0, 2000);
      })
      .join("\n");
  }
  return "";
}

export function toBlocks(content: unknown): Block[] {
  if (typeof content === "string") {
    const t = cleanText(content);
    if (!t || META_PREFIXES.some((p) => t.startsWith(p))) return [];
    return [{ type: "text", text: t }];
  }
  if (!Array.isArray(content)) return [];
  const out: Block[] = [];
  for (const raw of content) {
    if (!raw || typeof raw !== "object") continue;
    const b = raw as Record<string, unknown>;
    switch (b.type) {
      case "text": {
        const t = cleanText(String(b.text ?? ""));
        if (t && !META_PREFIXES.some((p) => t.startsWith(p))) out.push({ type: "text", text: t });
        break;
      }
      case "thinking":
      case "redacted_thinking": {
        const t = String(b.thinking ?? "").trim();
        if (t) out.push({ type: "thinking", text: t });
        break;
      }
      case "tool_use":
        out.push({ type: "tool_use", id: String(b.id ?? ""), name: String(b.name ?? ""), input: b.input });
        break;
      case "tool_result":
        out.push({ type: "tool_result", toolUseId: String(b.tool_use_id ?? ""), content: resultText(b.content), isError: Boolean(b.is_error) });
        break;
      case "image":
        out.push({ type: "image" });
        break;
    }
  }
  return out;
}

export function normalizeMessage(role: "user" | "assistant", uuid: string, message: unknown, timestamp?: string): TranscriptMessage | null {
  if (!message || typeof message !== "object") return null;
  const blocks = toBlocks((message as { content?: unknown }).content);
  if (blocks.length === 0) return null;
  return { uuid, role, blocks, timestamp };
}

/** התמליל של סשן מהדיסק, החוט הראשי בלבד (בלי תת-אייג'נטים). */
export async function readTranscript(sessionId: string): Promise<TranscriptMessage[]> {
  const [msgs, times] = await Promise.all([getSessionMessages(sessionId), timestampsOf(sessionId).catch(() => new Map<string, string>())]);
  const out: TranscriptMessage[] = [];
  for (const m of msgs) {
    if (m.parent_tool_use_id) continue;
    if (m.type !== "user" && m.type !== "assistant") continue;
    const n = normalizeMessage(m.type, m.uuid, m.message, times.get(m.uuid));
    if (n) out.push(n);
  }
  return out;
}
