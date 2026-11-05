import fs from "node:fs/promises";
import path from "node:path";
import { CLAUDE_HOME } from "./paths.js";
import type { ExternalLive } from "../../shared/protocol.js";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** הסשנים החיים על המחשב לפי ~/.claude/sessions/<pid>.json, רק אלה שהתהליך שלהם עדיין קיים. */
export async function readExternalLives(): Promise<Map<string, ExternalLive>> {
  const dir = path.join(CLAUDE_HOME, "sessions");
  const out = new Map<string, ExternalLive>();
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    try {
      const j = JSON.parse(await fs.readFile(path.join(dir, n), "utf8"));
      if (typeof j.sessionId !== "string" || typeof j.pid !== "number") continue;
      if (!alive(j.pid)) continue;
      out.set(j.sessionId, {
        pid: j.pid,
        name: typeof j.name === "string" ? j.name : "",
        status: typeof j.status === "string" ? j.status : "unknown",
        kind: typeof j.kind === "string" ? j.kind : "",
        entrypoint: typeof j.entrypoint === "string" ? j.entrypoint : "",
        startedAt: typeof j.startedAt === "number" ? j.startedAt : 0,
        updatedAt: typeof j.updatedAt === "number" ? j.updatedAt : 0,
      });
    } catch {
      /* קובץ חלקי או לא תקין - מדלגים */
    }
  }
  return out;
}
