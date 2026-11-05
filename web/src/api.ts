import { pick } from "./i18n";
import type { AgentInfo, AgentInput, AgentTheme, BrowseResult, GitInfo, MapData, Routine, RoutineSchedule, SessionMeta, SessionRow, SessionSummary, Task, TaskInput, TaskSettings, Themes, TranscriptMessage } from "../../shared/protocol";

async function j<T>(input: string, init?: RequestInit): Promise<T> {
  const r = await fetch(input, { headers: { "content-type": "application/json" }, ...init });
  if (!r.ok) throw new Error(`${init?.method ?? "GET"} ${input}: ${r.status}`);
  return (await r.json()) as T;
}

export interface FsEntry {
  name: string;
  path: string;
  type: "dir" | "file";
  size: number;
  skipped?: boolean;
}

export interface McpServer {
  name: string;
  target: string;
  status: "connected" | "failed" | "auth" | "pending" | "unknown";
  detail: string;
  source: "claude.ai" | "plugin" | "config";
}
export interface McpInput {
  name: string;
  transport: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  scope: "user" | "project" | "local";
}
export interface InstalledPlugin {
  id: string;
  version: string | null;
  scope: string;
  enabled: boolean;
  mcpServers: string[];
}
export interface AvailablePlugin {
  id: string;
  name: string;
  description: string;
  marketplace: string;
  installCount: number;
}
export interface Marketplace {
  name: string;
  source: string;
}
export interface ChangedFile {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflict";
  staged: boolean;
  additions: number;
  deletions: number;
}
export interface SearchHit {
  path: string;
  line: number;
  text: string;
}
export interface TranscriptHit {
  sessionId: string;
  snippet: string;
  count: number;
}

export interface UsageReport {
  today: number;
  week: number;
  month: number;
  days: Array<{ date: string; cost: number; input: number; output: number }>;
  projects: Array<{ cwd: string; cost: number }>;
  models: Array<{ model: string; cost: number }>;
}
export interface Digest {
  date: string;
  createdAt: number;
  bullets: string[];
  sessions: number;
  /** תקציר ישן שמוצג מיד בזמן שחדש נכתב ברקע בשרת. */
  stale?: boolean;
  /** "עוזרי רקע" כבויים בהגדרות: אין תקציר אוטומטי (אפשר לבקש אחד ידנית) */
  disabled?: boolean;
}

export interface Template {
  id: string;
  name: string;
  title: string;
  prompt: string;
  agent: string | null;
  permissionMode: string;
  isolate: boolean;
}

export interface Capability {
  kind: "skill" | "plugin" | "command";
  name: string;
  description: string;
  scope: "user" | "project" | "plugin" | "synced";
  path: string;
  project?: string;
}

export interface Profile {
  model?: string | null;
  agent?: string | null;
  permissionMode?: string | null;
}
export interface SafetyState {
  defaultMode: string | null;
  allow: string[];
  ask: string[];
  deny: string[];
}
export interface CommandInfo {
  name: string;
  description: string;
  argumentHint: string;
  aliases?: string[];
  builtin: boolean;
}

export interface DevPort {
  port: number;
  command: string;
  pid: number;
  cwd: string | null;
}

export interface SystemPrefs {
  quiet: { enabled: boolean; from: string; to: string; shabbat: boolean };
  monthlyBudget: number;
  launchAtLogin: boolean;
  devMode: boolean;
  devDir: string;
  rcLive: boolean;
  autoArchiveDays: number;
  liveIdleMinutes: number;
  displayName: string;
  projectRoots: string[];
  aiHelpers: boolean;
  lang: "auto" | "he" | "en";
  /** איך הסשנים של Claude מתחברים. רק עריכה ידנית של settings.json */
  authMode: "apiKey" | "claudeCode";
  /** שרתי הפרוד ששומר הפרוד בודק */
  prodHosts: string[];
}
const put = <T,>(url: string, body: unknown) => j<T>(url, { method: "PUT", body: JSON.stringify(body) });

/** ספק סוכנים כפי שהשרת מחזיר אותו: בלי ערכי env, רק השמות */
export interface ProviderInfo {
  id: string;
  label: string;
  command: string;
  args: string[];
  envKeys: string[];
  login: string | null;
  enabled: boolean;
  builtin: boolean;
  /** הפקודה נמצאה במחשב */
  available: boolean;
  /** הסנכרון האחרון של סשנים שהתחילו מחוץ למפקדה (session/list), או null */
  sessions?: { at: number; count: number; error?: string } | null;
}

/** סוכן מהקטלוג של ACP Registry. added = מזהה הספק אם כבר מוגדר */
export interface RegistryAgent {
  id: string;
  name: string;
  description: string;
  version: string;
  website: string | null;
  license: string | null;
  kind: "npx" | "uvx" | "binary";
  run: { command: string; args: string[]; env: Record<string, string> } | null;
  binaryHint: { cmd: string; args: string[] } | null;
  added: string | null;
}

/** מצב ההתחברות של ספק (server/src/providers/auth.ts) */
export interface AuthState {
  provider: string;
  status: "signedIn" | "signedOut" | "unknown" | "signingIn";
  label?: string;
  email?: string;
  url?: string;
  needsCode?: boolean;
  error?: string;
  at: number;
}

export const api = {
  providers: () => j<ProviderInfo[]>("/api/providers"),
  providerAuth: (refresh = false) => j<AuthState[]>(`/api/providers/auth${refresh ? "?refresh=1" : ""}`),
  providerLogin: (id: string) => j<AuthState>(`/api/providers/${encodeURIComponent(id)}/login`, { method: "POST" }),
  claudeLoginCode: (code: string) => j<{ ok: true }>("/api/providers/claude/login-code", { method: "POST", body: JSON.stringify({ code }) }),
  syncProvider: (id: string) => j<{ count: number }>(`/api/providers/${encodeURIComponent(id)}/sync`, { method: "POST" }),
  providerRegistry: (refresh = false) => j<RegistryAgent[]>(`/api/providers/registry${refresh ? "?refresh=1" : ""}`),
  setProvider: (id: string, patch: { enabled?: boolean; label?: string; command?: string; args?: string[]; env?: Record<string, string | null> } | null) => put<{ ok: true }>(`/api/providers/${encodeURIComponent(id)}`, patch),
  // הגוף הוא ArrayBuffer ולא ה-File עצמו: ב-Tauri (WKWebView, mifkada://) גוף של Blob מקובץ בדיסק מגיע לשרת ריק
  upload: async (name: string, type: string, bytes: ArrayBuffer): Promise<import("../../shared/protocol").Attachment> => {
    const r = await fetch(`/api/uploads?name=${encodeURIComponent(name || "paste.png")}`, { method: "POST", headers: { "content-type": type || "application/octet-stream" }, body: bytes });
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? pick(`העלאה נכשלה (${r.status})`, `Upload failed (${r.status})`));
    return r.json();
  },
  profiles: () => j<Record<string, Profile>>("/api/profiles"),
  setProfile: (cwd: string, profile: Profile | null) => put<Record<string, Profile>>("/api/profiles", { cwd, profile }),
  safety: () => j<SafetyState>("/api/safety"),
  setRule: (rule: string, list: "allow" | "ask" | "deny" | null) => put<SafetyState>("/api/safety/rule", { rule, list }),
  setDefaultMode: (mode: string) => put<SafetyState>("/api/safety/mode", { mode }),
  setSystem: (patch: Partial<SystemPrefs>) => put<SystemPrefs>("/api/settings/system", patch),
  commands: (cwd: string, force = false) => j<CommandInfo[]>(`/api/commands?cwd=${encodeURIComponent(cwd)}${force ? "&force=1" : ""}`),
  planUsage: (force = false) => j<Array<{ label: string; percent: number; resets: string | null }>>(`/api/plan-usage${force ? "?force=1" : ""}`),
  resources: () => j<{ mifkada: { count: number; mb: number }; other: { count: number; mb: number }; daemonMB: number; totalGB: number }>("/api/resources"),
  ports: () => j<DevPort[]>("/api/ports"),
  exportData: () => j<Record<string, unknown>>("/api/export"),
  importData: (data: unknown) => j<{ written: string[] }>("/api/import", { method: "POST", body: JSON.stringify(data) }),
  capabilities: () => j<Capability[]>("/api/capabilities"),
  doctor: () => j<{ platform: string; claude: string | null; claudeSource: "env" | "bundled" | "installed" | null; claudeMin: string; claudeAuth: AuthState; sessions: number; git: string | null; gh: string | null; voice: boolean; apiKeyEnv: boolean; authMode: "apiKey" | "claudeCode" }>("/api/doctor"),
  /** סשנים חיים של Claude Code באותו ריפו (שורש git) של התיקייה */
  activity: (cwd: string) => j<{ root: string | null; sessions: Array<{ sessionId: string; cwd: string; entrypoint: string; status: string; name: string }> }>(`/api/activity?cwd=${encodeURIComponent(cwd)}`),
  map: () => j<MapData>("/api/map"),
  mapNote: (path: string) => j<{ text: string }>(`/api/map/note?path=${encodeURIComponent(path)}`),
  settings: () => j<{ hasOpenaiKey: boolean; hasAnthropicKey: boolean; notify: { permission: boolean; done: boolean; error: boolean }; dataDir: string; system: SystemPrefs }>("/api/settings"),
  setAnthropicKey: (key: string | null) => j<{ hasAnthropicKey: boolean }>("/api/settings/anthropic-key", { method: "PUT", body: JSON.stringify({ key }) }),
  setOpenaiKey: (key: string | null) => j<{ hasOpenaiKey: boolean }>("/api/settings/openai-key", { method: "PUT", body: JSON.stringify({ key }) }),
  templates: () => j<Template[]>("/api/templates"),
  saveTemplate: (t: Partial<Template> & { name: string; prompt: string }) => j<Template[]>("/api/templates", { method: "POST", body: JSON.stringify(t) }),
  deleteTemplate: (id: string) => j<Template[]>(`/api/templates/${id}`, { method: "DELETE" }),
  usage: (days = 30) => j<UsageReport>(`/api/usage?days=${days}`),
  digest: (force = false) => j<Digest>(`/api/digest${force ? "?force=1" : ""}`),
  autotag: (dryRun: boolean) => j<{ tagged: number; proposals: Array<{ sessionId: string; title: string; agent: string | null }> }>("/api/sessions/autotag", { method: "POST", body: JSON.stringify({ dryRun }) }),
  extMcp: (cwd?: string, refresh = false) => j<McpServer[]>(`/api/ext/mcp?${new URLSearchParams({ ...(cwd ? { cwd } : {}), ...(refresh ? { refresh: "1" } : {}) })}`),
  extMcpAdd: (input: McpInput & { cwd?: string }) => j<{ ok: true }>("/api/ext/mcp", { method: "POST", body: JSON.stringify(input) }),
  extMcpRemove: (name: string, scope: McpInput["scope"] | null, cwd?: string) =>
    j<{ ok: true }>(`/api/ext/mcp/${encodeURIComponent(name)}?${new URLSearchParams({ ...(scope ? { scope } : {}), ...(cwd ? { cwd } : {}) })}`, { method: "DELETE" }),
  extPlugins: (refresh = false) => j<{ installed: InstalledPlugin[]; available: AvailablePlugin[] }>(`/api/ext/plugins${refresh ? "?refresh=1" : ""}`),
  extPlugin: (action: "install" | "uninstall" | "enable" | "disable" | "update", id: string) => j<{ ok: true }>(`/api/ext/plugins/${action}`, { method: "POST", body: JSON.stringify({ id }) }),
  extMarketplaces: () => j<Marketplace[]>("/api/ext/marketplaces"),
  extMarketplace: (action: "add" | "remove" | "update", arg: string) => j<{ ok: true }>(`/api/ext/marketplaces/${action}`, { method: "POST", body: JSON.stringify({ arg }) }),
  gitChanges: (cwd: string) => j<ChangedFile[]>(`/api/git/changes?cwd=${encodeURIComponent(cwd)}`),
  gitDiff: (cwd: string, path: string) => j<{ before: string; after: string; binary: boolean }>(`/api/git/diff?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`),
  gitDiscard: (cwd: string, path: string) => j<{ ok: true }>("/api/git/discard", { method: "POST", body: JSON.stringify({ cwd, path }) }),
  gitCommit: (cwd: string, message: string, paths?: string[]) => j<{ hash: string }>("/api/git/commit", { method: "POST", body: JSON.stringify({ cwd, message, paths }) }),
  fsFiles: (cwd: string) => j<string[]>(`/api/fs/files?cwd=${encodeURIComponent(cwd)}`),
  fsSearch: (cwd: string, q: string) => j<SearchHit[]>(`/api/fs/search?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(q)}`),
  sessionSearch: (q: string) => j<TranscriptHit[]>(`/api/sessions/search?q=${encodeURIComponent(q)}`),
  /** בורר התיקיות. שגיאה עם status (403 מחוץ לגבולות, 404 לא קיימת) והודעה מהשרת */
  fsBrowse: async (path: string, hidden = false): Promise<BrowseResult> => {
    const r = await fetch(`/api/fs/browse?path=${encodeURIComponent(path)}${hidden ? "&hidden=1" : ""}`);
    if (!r.ok) throw Object.assign(new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? String(r.status)), { status: r.status });
    return r.json();
  },
  fsList: (cwd: string, path: string) => j<FsEntry[]>(`/api/fs/list?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`),
  fsRead: (cwd: string, path: string) => j<{ content: string; size: number; truncated: boolean }>(`/api/fs/read?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`),
  fsWrite: (cwd: string, path: string, content: string) => j<{ ok: true }>("/api/fs/write", { method: "PUT", body: JSON.stringify({ cwd, path, content }) }),
  sttAvailable: () => j<{ available: boolean }>("/api/stt/available"),
  stt: async (audio: Blob): Promise<string> => {
    const r = await fetch("/api/stt", { method: "POST", headers: { "content-type": "audio/webm" }, body: audio });
    if (!r.ok) throw new Error(pick(`תמלול נכשל (${r.status})`, `Transcription failed (${r.status})`));
    return ((await r.json()) as { text: string }).text;
  },
  agents: () => j<AgentInfo[]>("/api/agents"),
  sessions: () => j<SessionRow[]>("/api/sessions"),
  projects: () => j<Array<{ cwd: string; sessions: number }>>("/api/projects"),
  transcript: (sessionId: string) => j<TranscriptMessage[]>(`/api/sessions/${sessionId}/messages`),
  tag: (sessionId: string, tag: string | null) => j<{ ok: true }>(`/api/sessions/${sessionId}/tag`, { method: "PUT", body: JSON.stringify({ tag }) }),
  themes: () => j<Themes>("/api/themes"),
  tasks: () => j<{ tasks: Task[]; settings: TaskSettings }>("/api/tasks"),
  taskSettings: (patch: Partial<TaskSettings>) => j<TaskSettings>("/api/tasks/settings", { method: "PUT", body: JSON.stringify(patch) }),
  saveAgent: (input: AgentInput) => j<AgentInfo[]>("/api/agents", { method: "POST", body: JSON.stringify(input) }),
  deleteAgent: (slug: string) => j<AgentInfo[]>(`/api/agents/${encodeURIComponent(slug)}`, { method: "DELETE" }),
  createTask: (input: TaskInput, run: boolean) => j<Task>(`/api/tasks${run ? "?run=1" : ""}`, { method: "POST", body: JSON.stringify(input) }),
  updateTask: (id: string, patch: Partial<Task>) => j<Task>(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteTask: (id: string) => j<{ ok: true }>(`/api/tasks/${id}`, { method: "DELETE" }),
  runTask: (id: string) => j<Task>(`/api/tasks/${id}/run`, { method: "POST" }),
  mergeTask: (id: string) => j<{ task: Task; hash: string }>(`/api/tasks/${id}/merge`, { method: "POST" }),
  discardBranch: (id: string) => j<Task>(`/api/tasks/${id}/discard-branch`, { method: "POST" }),
  branchStatus: (id: string) => j<{ changed: number; commits: number } | null>(`/api/tasks/${id}/branch`),
  routines: () => j<Array<Routine & { next: number }>>("/api/routines"),
  saveRoutine: (r: Partial<Routine> & { title: string; prompt: string; cwd: string; schedule: RoutineSchedule }) => j<Routine>("/api/routines", { method: "POST", body: JSON.stringify(r) }),
  deleteRoutine: (id: string) => j<{ ok: true }>(`/api/routines/${id}`, { method: "DELETE" }),
  runRoutine: (id: string) => j<{ ok: true }>(`/api/routines/${id}/run`, { method: "POST" }),
  summary: (sessionId: string) => j<SessionSummary | null>(`/api/sessions/${sessionId}/summary`),
  summarize: (sessionId: string, model?: string) => j<SessionSummary>(`/api/sessions/${sessionId}/summary`, { method: "POST", body: JSON.stringify({ model }) }),
  rename: (sessionId: string, title: string) => j<{ ok: true }>(`/api/sessions/${sessionId}/rename`, { method: "PUT", body: JSON.stringify({ title }) }),
  projectDirs: () => j<string[]>("/api/project-dirs"),
  setProject: (sessionId: string, project: string | null) => j<{ project?: string }>(`/api/sessions/${sessionId}/meta`, { method: "PUT", body: JSON.stringify({ project: project ?? "" }) }),
  pin: (sessionId: string, pinned: boolean) => j<{ pinned?: boolean }>(`/api/sessions/${sessionId}/meta`, { method: "PUT", body: JSON.stringify({ pinned }) }),
  /** עיצוב לסשן בלבד. מחרוזת ריקה מחזירה לעיצוב של הפרויקט/האייג'נט */
  sessionStyle: (sessionId: string, style: { color?: string; background?: string; scheme?: string }) => j<SessionMeta>(`/api/sessions/${sessionId}/meta`, { method: "PUT", body: JSON.stringify(style) }),
  archive: (sessionId: string, archived: boolean) => j<{ archived?: boolean }>(`/api/sessions/${sessionId}/meta`, { method: "PUT", body: JSON.stringify({ archived }) }),
  deleteSession: (sessionId: string) => j<{ ok: true }>(`/api/sessions/${sessionId}`, { method: "DELETE" }),
  git: (cwd: string) => j<GitInfo>(`/api/projects/git?cwd=${encodeURIComponent(cwd)}`),
  openIn: (cwd: string, app: "vscode" | "finder" | "terminal") => j<{ ok: true }>("/api/projects/open", { method: "POST", body: JSON.stringify({ cwd, app }) }),
  setTheme: (kind: "agents" | "projects", key: string, theme: AgentTheme) => j<AgentTheme>(`/api/themes/${kind}`, { method: "PUT", body: JSON.stringify({ key, ...theme }) }),
  theme: (slug: string, theme: AgentTheme) => j<AgentTheme>(`/api/agents/${encodeURIComponent(slug)}/theme`, { method: "PUT", body: JSON.stringify(theme) }),
};
