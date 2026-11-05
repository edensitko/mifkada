import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { CLAUDE_HOME } from "./paths.js";

/** מחירון לפי מיליון טוקנים (קלט, פלט). קריאת קאש = 10% מהקלט, כתיבת קאש = 125%. הערכה בלבד. */
const PRICES: Array<[RegExp, number, number]> = [
  [/fable-5|mythos-5/, 10, 50],
  [/opus-5-5/, 4, 20],
  [/opus-5|opus-4-[678]/, 5, 25],
  [/sonnet-5|sonnet-4-6/, 2, 10],
  [/haiku-5/, 0.1, 0.5],
  [/haiku-4/, 1, 5],
  [/opus/, 5, 25],
  [/sonnet/, 3, 15],
];

function price(model: string): [number, number] {
  for (const [re, i, o] of PRICES) if (re.test(model)) return [i, o];
  return [3, 15];
}

interface FileAgg {
  mtime: number;
  size: number;
  cwd: string;
  byDay: Record<string, { cost: number; input: number; output: number }>;
  byModel: Record<string, number>;
}

const cache = new Map<string, FileAgg>();

async function aggregateFile(file: string): Promise<FileAgg | null> {
  const st = await fs.stat(file);
  const cached = cache.get(file);
  if (cached && cached.mtime === st.mtimeMs && cached.size === st.size) return cached;
  const agg: FileAgg = { mtime: st.mtimeMs, size: st.size, cwd: "", byDay: {}, byModel: {} };
  // שורה-שורה ולא readFile: תמליל יכול להיות 40MB+, וקריאה שלמה + split החזיקו מאות MB בזיכרון בבת אחת
  const lines = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    if (!agg.cwd && line.includes('"cwd"')) {
      const m = line.match(/"cwd":"((?:[^"\\]|\\.)*)"/);
      if (m) agg.cwd = m[1].replace(/\\"/g, '"');
    }
    if (!line.includes('"usage"')) continue;
    try {
      const rec = JSON.parse(line) as { type?: string; timestamp?: string; message?: { model?: string; usage?: Record<string, number> } };
      if (rec.type !== "assistant" || !rec.message?.usage) continue;
      const u = rec.message.usage;
      const model = rec.message.model ?? "";
      const [pi, po] = price(model);
      const input = u.input_tokens ?? 0;
      const output = u.output_tokens ?? 0;
      const cw = u.cache_creation_input_tokens ?? 0;
      const cr = u.cache_read_input_tokens ?? 0;
      const cost = (input * pi + cw * pi * 1.25 + cr * pi * 0.1 + output * po) / 1e6;
      const day = (rec.timestamp ?? "").slice(0, 10) || "unknown";
      const d = (agg.byDay[day] ??= { cost: 0, input: 0, output: 0 });
      d.cost += cost;
      d.input += input + cw + cr;
      d.output += output;
      agg.byModel[model] = (agg.byModel[model] ?? 0) + cost;
    } catch {
      /* שורה לא תקינה */
    }
  }
  cache.set(file, agg);
  return agg;
}

export interface UsageReport {
  today: number;
  week: number;
  month: number;
  days: Array<{ date: string; cost: number; input: number; output: number }>;
  projects: Array<{ cwd: string; cost: number }>;
  models: Array<{ model: string; cost: number }>;
}

/** שימוש ועלות מוערכת מכל תמלילי Claude Code במחשב, לפי יום, פרויקט ומודל. */
export async function usageReport(days = 30): Promise<UsageReport> {
  const root = path.join(CLAUDE_HOME, "projects");
  const byDay = new Map<string, { cost: number; input: number; output: number }>();
  const byProject = new Map<string, number>();
  const byModel = new Map<string, number>();
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  let dirs: string[] = [];
  try {
    dirs = await fs.readdir(root);
  } catch {
    return { today: 0, week: 0, month: 0, days: [], projects: [], models: [] };
  }
  for (const d of dirs) {
    let files: string[] = [];
    try {
      files = (await fs.readdir(path.join(root, d))).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) {
      const full = path.join(root, d, f);
      try {
        if ((await fs.stat(full)).mtimeMs < Date.now() - (days + 1) * 86400000) continue; // קובץ שלא נגעו בו בתקופה
      } catch {
        continue;
      }
      const agg = await aggregateFile(full).catch(() => null);
      if (!agg) continue;
      let fileCost = 0;
      for (const [day, v] of Object.entries(agg.byDay)) {
        if (day < since) continue;
        const cur = byDay.get(day) ?? { cost: 0, input: 0, output: 0 };
        cur.cost += v.cost;
        cur.input += v.input;
        cur.output += v.output;
        byDay.set(day, cur);
        fileCost += v.cost;
      }
      if (fileCost > 0) byProject.set(agg.cwd || d, (byProject.get(agg.cwd || d) ?? 0) + fileCost);
      for (const [m, c] of Object.entries(agg.byModel)) byModel.set(m, (byModel.get(m) ?? 0) + c);
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const list = [...byDay.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date));
  return {
    today: byDay.get(today)?.cost ?? 0,
    week: list.filter((x) => x.date >= weekAgo).reduce((s, x) => s + x.cost, 0),
    month: list.reduce((s, x) => s + x.cost, 0),
    days: list,
    projects: [...byProject.entries()].map(([cwd, cost]) => ({ cwd, cost })).sort((a, b) => b.cost - a.cost).slice(0, 12),
    models: [...byModel.entries()].map(([model, cost]) => ({ model, cost })).sort((a, b) => b.cost - a.cost),
  };
}
