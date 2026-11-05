import { execFile, spawn } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { client, methods, ndJsonStream, PROTOCOL_VERSION, type ClientConnection } from "@agentclientprotocol/sdk";
import { agentEnv, loginMethod } from "./acp.js";
import { cachedProvider, type ProviderConfig } from "./presets.js";
import { loadPty } from "../terminal.js";
import { L } from "../i18n.js";
import { claudeExe } from "../claudeExe.js";
import { apiAuthReady, applyClaudeAuth, authMode, cloudProvider, effectiveApiKey } from "../claudeAuth.js";

/*
 * מצב ההתחברות של כל ספק, והתחברות בלחיצה (הגדרות ← ספקים). הכול דרך הכלים של הסוכנים עצמם:
 * Claude: `claude auth status/login` של ה-CLI שה-SDK מביא. ACP (Codex): `_auth/status_update` ו-`authenticate`.
 * מפקדה לא קוראת ולא שומרת קבצי התחברות.
 */

export interface AuthState {
  provider: string;
  /** signedIn / signedOut, unknown = הסוכן לא מדווח, signingIn = התחברות באמצע */
  status: "signedIn" | "signedOut" | "unknown" | "signingIn";
  /** "Claude Max", "ChatGPT Plus", "OpenAI API key" */
  label?: string;
  email?: string;
  /** בהתחברות: קישור לפתוח אם הדפדפן לא נפתח לבד */
  url?: string;
  /** Claude: מחכה לקוד שמדביקים (כשהדפדפן לא מצליח להחזיר אותו לבד) */
  needsCode?: boolean;
  error?: string;
  at: number;
}

const cache = new Map<string, AuthState>();
const STATUS_TTL = 60_000;
const LOGIN_TIMEOUT = 5 * 60_000;

/* ---------- Claude ---------- */

/** ה-CLI של Claude Code שמריץ את הסשנים (claudeExe.ts: של ה-SDK או המותקן), ואם אין אז claude מה-PATH */
export function claudeBin(): string {
  return claudeExe()?.bin ?? "claude";
}

function claudeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // אותה התחברות כמו בסשנים (claudeAuth.ts)
  applyClaudeAuth(env);
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

const PLAN: Record<string, string> = { max: "Max", pro: "Pro", team: "Team", enterprise: "Enterprise", free: "Free" };

/** פענוח של `claude auth status --json` */
export function parseClaudeStatus(raw: string): Omit<AuthState, "provider" | "at"> {
  const j = JSON.parse(raw) as { loggedIn?: boolean; authMethod?: string; email?: string; subscriptionType?: string };
  if (!j.loggedIn) return { status: "signedOut" };
  const plan = j.subscriptionType ? (PLAN[j.subscriptionType] ?? j.subscriptionType) : "";
  const label = j.authMethod === "claude.ai" ? `Claude${plan ? ` ${plan}` : ""}` : j.authMethod === "console" || j.authMethod === "api_key" ? L("מפתח API (חיוב לפי שימוש)", "API key (usage billing)") : (j.authMethod ?? "Claude");
  return { status: "signedIn", label, email: j.email };
}

/** מצב apiKey: מוכן אם יש מפתח (בהגדרות או בסביבה) או Bedrock/Vertex. בלי התחברות ל-claude.ai */
function apiKeyStatus(): AuthState {
  const cloud = cloudProvider();
  if (cloud) return { provider: "claude", status: "signedIn", label: cloud === "bedrock" ? "Amazon Bedrock" : "Google Vertex AI", at: Date.now() };
  if (effectiveApiKey()) return { provider: "claude", status: "signedIn", label: L("מפתח API של Anthropic", "Anthropic API key"), at: Date.now() };
  return { provider: "claude", status: "signedOut", label: L("חסר מפתח API", "No API key"), at: Date.now() };
}

async function claudeStatus(): Promise<AuthState> {
  if (authMode() === "apiKey") return apiKeyStatus();
  return new Promise((resolve) => {
    execFile(claudeBin(), ["auth", "status", "--json"], { env: claudeEnv(), timeout: 15_000 }, (err, stdout) => {
      try {
        resolve({ provider: "claude", ...parseClaudeStatus(String(stdout)), at: Date.now() });
      } catch {
        resolve({ provider: "claude", status: "unknown", error: err ? err.message.slice(0, 200) : undefined, at: Date.now() });
      }
    });
  });
}

let claudeLogin: { write: (s: string) => void; kill: () => void } | null = null;

/** קישור התחברות מהפלט של ה-CLI (אחרי הסרת קודי צבע) */
export function loginUrl(out: string): string | undefined {
  const clean = out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, " ");
  return /https:\/\/[^\s"'<>]*(?:claude\.ai|anthropic\.com|openai\.com|chatgpt\.com)[^\s"'<>]*/.exec(clean)?.[0];
}

/**
 * `claude auth login --claudeai` (מנוי, לא Console). ה-CLI פותח את הדפדפן בעצמו. רץ ב-pty, כי אם החזרה מהדפדפן נכשלת
 * הוא מבקש להדביק קוד, ואז הממשק שולח אותו לכאן (claudeLoginCode).
 */
async function startClaudeLogin(): Promise<AuthState> {
  // מצב apiKey: אין התחברות בדפדפן. המפתח נכנס בהגדרות (או בהפעלה הראשונה)
  if (authMode() === "apiKey") {
    const s = apiKeyStatus();
    if (!apiAuthReady()) s.error = L("הוסף מפתח API של Anthropic בהגדרות ← ספקים", "Add an Anthropic API key in Settings → Providers");
    cache.set("claude", s);
    return s;
  }
  claudeLogin?.kill();
  const state: AuthState = { provider: "claude", status: "signingIn", at: Date.now() };
  cache.set("claude", state);
  let out = "";
  const onData = (d: string) => {
    out += d;
    const cur = cache.get("claude");
    if (cur?.status !== "signingIn") return;
    cur.url ??= loginUrl(out);
    if (/paste|code/i.test(d)) cur.needsCode = true;
  };
  const done = (code: number) => {
    claudeLogin = null;
    clearTimeout(timer);
    void claudeStatus().then((s) => cache.set("claude", code === 0 || s.status === "signedIn" ? s : { ...s, status: "signedOut", error: out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").trim().split("\n").slice(-2).join(" ").slice(0, 200) }));
  };
  const pty = await loadPty();
  if (pty) {
    const p = pty.spawn(claudeBin(), ["auth", "login", "--claudeai"], { name: "xterm-256color", cols: 120, rows: 30, cwd: os.homedir(), env: claudeEnv() as Record<string, string> });
    p.onData(onData);
    p.onExit(({ exitCode }) => done(exitCode));
    claudeLogin = { write: (s) => p.write(s), kill: () => p.kill() };
  } else {
    const c = spawn(claudeBin(), ["auth", "login", "--claudeai"], { cwd: os.homedir(), env: claudeEnv() });
    c.stdout.setEncoding("utf8").on("data", onData);
    c.stderr.setEncoding("utf8").on("data", onData);
    c.on("exit", (code) => done(code ?? 1));
    claudeLogin = { write: (s) => c.stdin.write(s), kill: () => c.kill() };
  }
  const timer = setTimeout(() => claudeLogin?.kill(), LOGIN_TIMEOUT);
  return state;
}

export function claudeLoginCode(code: string): void {
  if (!claudeLogin) throw new Error(L("אין התחברות פתוחה", "No sign-in in progress"));
  claudeLogin.write(code.trim() + "\r");
}

/* ---------- ACP (Codex וכו') ---------- */

type AcpAuth = { kind?: string; label?: string; account?: { email?: string; plan?: string } };

export function fromAcpAuth(a: AcpAuth): Omit<AuthState, "provider" | "at"> {
  if (a.kind === "none") return { status: "signedOut", label: a.label };
  return { status: "signedIn", label: a.label, email: a.account?.email };
}

/** מרים את הסוכן, מאזין ל-_auth/status_update (Codex שולח אותו מיד אחרי initialize), ומריץ את fn */
async function withAgent<T>(cfg: ProviderConfig, timeout: number, fn: (conn: ClientConnection, init: Awaited<ReturnType<ClientConnection["agent"]["request"]>>, auth: () => AcpAuth | null) => Promise<T>): Promise<T> {
  const child = spawn(cfg.command, cfg.args, { cwd: os.homedir(), env: agentEnv(cfg), stdio: ["pipe", "pipe", "ignore"] });
  const killer = setTimeout(() => child.kill(), timeout);
  let last: AcpAuth | null = null;
  try {
    await new Promise<void>((res, rej) => {
      child.once("spawn", res);
      child.once("error", rej);
    });
    const conn = client({ name: "mifkada" })
      .onNotification("_auth/status_update", (p: unknown) => p as { authStatus?: AcpAuth }, ({ params }) => {
        if (params?.authStatus) last = params.authStatus;
      })
      .connect(ndJsonStream(Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>, Readable.toWeb(child.stdout!) as unknown as ReadableStream<Uint8Array>));
    const init = await conn.agent.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: "mifkada", version: "0.1.0" } });
    const r = await fn(conn, init, () => last);
    conn.close();
    return r;
  } finally {
    clearTimeout(killer);
    child.kill();
  }
}

/** מחכה עד שהסוכן מדווח מצב התחברות (עד ms), או null */
async function waitAuth(get: () => AcpAuth | null, ms: number): Promise<AcpAuth | null> {
  for (let t = 0; t < ms && !get(); t += 100) await new Promise((r) => setTimeout(r, 100));
  return get();
}

async function acpStatus(cfg: ProviderConfig): Promise<AuthState> {
  try {
    return await withAgent(cfg, 30_000, async (_conn, init, auth) => {
      // הסוכן מכריז שהוא מדווח (_meta.authStatus). אחרת אין דרך תקנית לדעת בלי לפתוח סשן
      const reports = Boolean((init as { agentCapabilities?: { _meta?: Record<string, unknown> } }).agentCapabilities?._meta?.authStatus);
      const a = reports ? await waitAuth(auth, 8000) : null;
      return { provider: cfg.id, ...(a ? fromAcpAuth(a) : { status: "unknown" as const }), at: Date.now() };
    });
  } catch (e) {
    return { provider: cfg.id, status: "unknown", error: (e as Error).message?.slice(0, 200), at: Date.now() };
  }
}

/** authenticate בשיטה שהסוכן מבצע בעצמו (Codex: ChatGPT בדפדפן), ומחכה עד שמסיימים */
function startAcpLogin(cfg: ProviderConfig): AuthState {
  const state: AuthState = { provider: cfg.id, status: "signingIn", at: Date.now() };
  cache.set(cfg.id, state);
  void withAgent(cfg, LOGIN_TIMEOUT, async (conn, init, auth) => {
    const method = loginMethod((init as { authMethods?: Parameters<typeof loginMethod>[0] }).authMethods);
    if (!method) throw new Error(L(`${cfg.label} לא מציע התחברות בדפדפן. אפשר להוסיף מפתח API במשתני הסביבה`, `${cfg.label} doesn't offer a browser sign-in. You can add an API key under environment variables`));
    await conn.agent.request(methods.agent.authenticate, { methodId: method.id });
    const a = await waitAuth(auth, 3000);
    return a ? fromAcpAuth(a) : { status: "signedIn" as const };
  })
    .then((s) => cache.set(cfg.id, { provider: cfg.id, ...s, at: Date.now() }))
    .catch((e: unknown) => cache.set(cfg.id, { provider: cfg.id, status: "signedOut", error: (e as Error).message?.slice(0, 200), at: Date.now() }));
  return state;
}

/* ---------- ממשק ---------- */

const checking = new Map<string, Promise<AuthState>>();

/** מצב ההתחברות של ספק. מהקאש (דקה), חוץ מהתחברות באמצע שתמיד מוחזרת כמו שהיא */
export async function authStatus(id: string, refresh = false): Promise<AuthState> {
  const cur = cache.get(id);
  if (cur?.status === "signingIn") return cur;
  if (cur && !refresh && Date.now() - cur.at < STATUS_TTL) return cur;
  const running = checking.get(id);
  if (running) return running;
  const cfg = id === "claude" ? null : cachedProvider(id);
  if (id !== "claude" && !cfg) return { provider: id, status: "unknown", error: L("ספק לא מוכר", "Unknown provider"), at: Date.now() };
  const p = (cfg ? acpStatus(cfg) : claudeStatus()).then((s) => {
    if (cache.get(id)?.status !== "signingIn") cache.set(id, s);
    return s;
  });
  checking.set(id, p);
  return p.finally(() => checking.delete(id));
}

export async function startLogin(id: string): Promise<AuthState> {
  if (id === "claude") return startClaudeLogin();
  const cfg = cachedProvider(id);
  if (!cfg) throw new Error(L("ספק לא מוכר", "Unknown provider"));
  return startAcpLogin(cfg);
}

/** אחרי שינוי מפתח: הבדיקה הבאה לא מהקאש */
export function invalidateAuth(id: string): void {
  cache.delete(id);
}
