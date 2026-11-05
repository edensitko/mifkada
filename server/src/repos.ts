import { execFile } from "node:child_process";
import { isProtectedDir } from "./paths.js";
import { projectRoots } from "./roots.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listSessions } from "@anthropic-ai/claude-agent-sdk";

function run(bin: string, args: string[], cwd?: string, timeout = 15000): Promise<{ out: string; code: number }> {
  return new Promise((resolve) => {
    execFile(bin, args, { cwd, timeout, maxBuffer: 8 * 1024 * 1024 }, (e, stdout) => resolve({ out: String(stdout).trim(), code: e ? 1 : 0 }));
  });
}
const git = (cwd: string, ...args: string[]) => run("git", ["-C", cwd, ...args]);

export interface RepoStatus {
  root: string;
  name: string;
  branch: string | null;
  remote: string | null;
  github: string | null;
  changed: number;
  untracked: number;
  ahead: number;
  behind: number;
  noUpstream: boolean;
  lastCommit: { subject: string; time: number } | null;
  /** בריפו גדול: כמה שינויים בכל תיקייה עליונה */
  byFolder: Array<{ folder: string; changed: number }>;
  prs: Array<{ number: number; title: string; url: string; checks: "pass" | "fail" | "pending" | "none" }> | null;
  lastRun: { name: string; status: string; conclusion: string | null; url: string; time: number } | null;
  error?: string;
}

/** כל שורשי הריפו שמפקדה מכירה: מתיקיות הסשנים, ומתיקיות הפרויקטים שבהגדרות (התיקייה עצמה וכל תת-תיקייה). */
async function candidateDirs(): Promise<string[]> {
  const dirs = new Set<string>();
  try {
    for (const s of await listSessions({ limit: 500 })) if (s.cwd) dirs.add(s.cwd);
  } catch {
    /* אין סשנים */
  }
  for (const base of projectRoots()) {
    dirs.add(base);
    try {
      for (const e of await fs.readdir(base, { withFileTypes: true })) if (e.isDirectory() && !e.name.startsWith(".")) dirs.add(path.join(base, e.name));
    } catch {
      /* אין תיקייה */
    }
  }
  return [...dirs].filter((d) => !isProtectedDir(d));
}

async function toplevel(dir: string): Promise<string | null> {
  try {
    await fs.access(dir);
  } catch {
    return null;
  }
  const r = await git(dir, "rev-parse", "--show-toplevel");
  return r.code === 0 && r.out ? r.out : null;
}

function githubSlug(remote: string | null): string | null {
  const m = remote?.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/);
  return m ? m[1] : null;
}

async function ghInfo(root: string, slug: string): Promise<Pick<RepoStatus, "prs" | "lastRun">> {
  const [prs, runs] = await Promise.all([
    run("gh", ["pr", "list", "-R", slug, "--state", "open", "--limit", "10", "--json", "number,title,url,statusCheckRollup"], root, 20000),
    run("gh", ["run", "list", "-R", slug, "--limit", "1", "--json", "workflowName,status,conclusion,url,createdAt"], root, 20000),
  ]);
  let prList: RepoStatus["prs"] = null;
  if (prs.code === 0) {
    try {
      prList = (JSON.parse(prs.out || "[]") as Array<{ number: number; title: string; url: string; statusCheckRollup?: Array<{ conclusion?: string; status?: string; state?: string }> }>).map((p) => {
        const checks = p.statusCheckRollup ?? [];
        const fail = checks.some((c) => ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED"].includes(String(c.conclusion ?? c.state)));
        const pending = checks.some((c) => c.status && c.status !== "COMPLETED");
        return { number: p.number, title: p.title, url: p.url, checks: checks.length === 0 ? "none" : fail ? "fail" : pending ? "pending" : "pass" };
      });
    } catch {
      prList = null;
    }
  }
  let lastRun: RepoStatus["lastRun"] = null;
  if (runs.code === 0) {
    try {
      const r = (JSON.parse(runs.out || "[]") as Array<{ workflowName: string; status: string; conclusion: string | null; url: string; createdAt: string }>)[0];
      if (r) lastRun = { name: r.workflowName, status: r.status, conclusion: r.conclusion || null, url: r.url, time: Date.parse(r.createdAt) };
    } catch {
      /* פלט לא תקין */
    }
  }
  return { prs: prList, lastRun };
}

async function repoStatus(root: string, withGithub: boolean): Promise<RepoStatus> {
  const [branch, remote, status, counts, log] = await Promise.all([
    git(root, "rev-parse", "--abbrev-ref", "HEAD"),
    git(root, "remote", "get-url", "origin"),
    git(root, "status", "--porcelain"),
    git(root, "rev-list", "--left-right", "--count", "HEAD...@{upstream}"),
    git(root, "log", "-1", "--format=%s%n%ct"),
  ]);
  const lines = status.out.split("\n").filter(Boolean);
  const untracked = lines.filter((l) => l.startsWith("??")).length;
  const folders = new Map<string, number>();
  for (const l of lines) {
    const p = l.slice(3).replace(/^"|"$/g, "").split(" -> ").pop() ?? "";
    const top = p.includes("/") ? p.split("/")[0] : ".";
    folders.set(top, (folders.get(top) ?? 0) + 1);
  }
  const [a, b] = counts.out.split(/\s+/).map((n) => Number(n) || 0);
  const [subject, ts] = log.out.split("\n");
  const rem = remote.code === 0 ? remote.out : null;
  const slug = githubSlug(rem);
  const base: RepoStatus = {
    root,
    name: path.basename(root),
    branch: branch.out || null,
    remote: rem,
    github: slug,
    changed: lines.length - untracked,
    untracked,
    ahead: a ?? 0,
    behind: b ?? 0,
    noUpstream: counts.code !== 0,
    lastCommit: subject ? { subject, time: Number(ts) * 1000 || 0 } : null,
    byFolder: [...folders.entries()].map(([folder, changed]) => ({ folder, changed })).sort((x, y) => y.changed - x.changed),
    prs: null,
    lastRun: null,
  };
  if (withGithub && slug) Object.assign(base, await ghInfo(root, slug));
  return base;
}

/** קאש נפרד לבדיקה המקומית (מהירה) ולבדיקה עם GitHub (איטית), כדי שתוצאה מקומית לא תוגש במקום נתוני GitHub. */
const cache: Record<"local" | "github", { at: number; data: RepoStatus[] } | null> = { local: null, github: null };

/** סטטוס כל הריפו, ממוין: מה שדורש תשומת לב קודם. GitHub נשלף רק כשמבקשים (gh איטי). */
export async function allRepos(opts: { github?: boolean; force?: boolean } = {}): Promise<RepoStatus[]> {
  const kind = opts.github ? "github" : "local";
  const hit = cache[kind];
  if (!opts.force && hit && Date.now() - hit.at < (opts.github ? 120000 : 20000)) return hit.data;
  const roots = new Set<string>();
  const dirs = await candidateDirs();
  await Promise.all(dirs.map(async (d) => {
    const t = await toplevel(d);
    if (t && !/[\\/]\.mifkada-worktrees[\\/]/.test(t) && !/[\\/]node_modules[\\/]/.test(t)) roots.add(t);
  }));
  const data = await Promise.all([...roots].map((r) => repoStatus(r, Boolean(opts.github)).catch((e) => ({ root: r, name: path.basename(r), error: String(e) }) as RepoStatus)));
  const score = (r: RepoStatus) => (r.prs?.some((p) => p.checks === "fail") || r.lastRun?.conclusion === "failure" ? 1000 : 0) + r.changed + r.untracked + r.ahead * 5 + (r.remote ? 0 : 3);
  data.sort((x, y) => score(y) - score(x) || x.name.localeCompare(y.name));
  cache[kind] = { at: Date.now(), data };
  return data;
}
