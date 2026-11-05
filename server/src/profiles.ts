import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./paths.js";

/** פרופיל לכל פרויקט: מה נבחר אוטומטית כשפותחים בו סשן או משימה. */
export interface Profile {
  model?: string | null;
  agent?: string | null;
  permissionMode?: string | null;
}
const FILE = path.join(DATA_DIR, "profiles.json");

export async function readProfiles(): Promise<Record<string, Profile>> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as Record<string, Profile>;
  } catch {
    return {};
  }
}

export async function setProfile(cwd: string, p: Profile | null): Promise<Record<string, Profile>> {
  const all = await readProfiles();
  if (p && (p.model || p.agent || p.permissionMode)) all[cwd] = { model: p.model ?? null, agent: p.agent ?? null, permissionMode: p.permissionMode ?? null };
  else delete all[cwd];
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(all, null, 2));
  return all;
}
