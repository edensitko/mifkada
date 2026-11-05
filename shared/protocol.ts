// מפקדה - חוזה ההודעות בין השרת ל-UI. הקובץ משותף לשני החבילות.

export type PermissionMode = "default" | "acceptEdits" | "plan" | "auto" | "dontAsk" | "bypassPermissions";

export type LiveState = "ready" | "starting" | "running" | "waiting" | "idle" | "closed" | "error";

/** מי מריץ את הסשן: "claude" (ה-Agent SDK) או מזהה של ספק ACP מההגדרות (codex, copilot...). חסר = claude */
export type ProviderId = string;

/** מה הספק יודע לעשות. הממשק מסתיר כל פעולה שאין לה יכולת מתאימה */
export interface ProviderCaps {
  resume: boolean;
  fork: boolean;
  /** "חזור לכאן" (checkpoints של קבצים) */
  rewind: boolean;
  /** Remote Control של Claude */
  remote: boolean;
  slashCommands: boolean;
  /** אייג'נטים מ-~/.claude/agents כאייג'נט אמיתי (ולא רק כהקדמה לפרומפט) */
  agents: boolean;
  /** מחיר בדולרים בתוצאה */
  cost: boolean;
  /** מצבי הרשאה שהספק תומך בהם */
  modes: PermissionMode[];
  /** מודלים שהספק מציע. null = הרשימה הקבועה של Claude */
  models: Array<{ id: string; label: string }> | null;
}

export interface AgentTheme {
  color?: string;
  emoji?: string;
  displayName?: string;
  pinned?: boolean;
  hidden?: boolean;
  /** תמונה במקום האות/האימוג'י: data URL קטן (מוקטן בדפדפן ל-160px) */
  image?: string;
}

export interface SessionMeta {
  archived?: boolean;
  /** נעוץ בראש הרשימה בסרגל הצד */
  pinned?: boolean;
  /** הוצא מהארכיון ידנית: הארכיון האוטומטי לא נוגע בו */
  kept?: boolean;
  /** הפרויקט האמיתי של הסשן (תיקייה), כשהוא נפתח מתיקייה אחרת. הסשן ממשיך לרוץ מה-cwd המקורי */
  project?: string;
  /** עיצוב לסשן הזה בלבד (גובר על הפרויקט/האייג'נט): צבע הדגשה, רקע מהרשימה, ערכת צבעים */
  color?: string;
  background?: SessionBackground;
  scheme?: "light" | "dark";
}

export type SessionBackground = "tint" | "sunrise" | "ocean" | "forest" | "lavender" | "graphite" | "dots";

/** ערכות העיצוב השמורות: לאייג'נטים לפי slug, לפרויקטים לפי הנתיב המלא. */
export interface Themes {
  agents: Record<string, AgentTheme>;
  projects: Record<string, AgentTheme>;
  sessions: Record<string, SessionMeta>;
}

export interface AgentInfo {
  slug: string;
  name: string;
  description: string;
  model?: string;
  tools?: string;
  prompt?: string;
  source: "user";
  color: string;
  emoji: string;
  image?: string;
}

export interface AgentInput {
  slug: string;
  description: string;
  prompt: string;
  tools?: string;
  model?: string;
}

export interface TaskSettings {
  autoRun: boolean;
  maxParallel: number;
}

/** סשן של Claude Code שרץ מחוץ למפקדה (טרמינל, VS Code), לפי ~/.claude/sessions */
export interface ExternalLive {
  pid: number;
  name: string;
  status: string;
  kind: string;
  entrypoint: string;
  startedAt: number;
  updatedAt: number;
}

/** סשן שמפקדה מחזיקה בעצמה דרך ה-SDK */
export interface LiveInfo {
  liveId: string;
  sessionId: string | null;
  cwd: string;
  /** חסר בשרת ישן = claude */
  provider?: ProviderId;
  caps?: ProviderCaps;
  agent: string | null;
  state: LiveState;
  title: string;
  model: string | null;
  permissionMode: PermissionMode;
  pendingPermissions: number;
  pending: PermissionRequest[];
  startedAt: number;
  costUsd: number;
  /** כמה מחלון ההקשר בשימוש (טוקנים), כשהספק מדווח (ACP usage_update) */
  context?: { used: number; size: number } | null;
  /** Remote Control פעיל: הקישור לסשן ב-claude.ai/code (וגם באפליקציה של Claude) */
  remoteUrl?: string | null;
  /** אישור פריסה לסשן הזה פעיל עד (ms). פקודות פרוד עוברות בלי כרטיס עד אז */
  deployGrantUntil?: number | null;
}

export interface SessionRow {
  sessionId: string;
  title: string;
  cwd: string;
  project: string;
  /** תיקיית הפרויקט לקיבוץ: השיוך הידני/האוטומטי, או ה-cwd */
  projectCwd: string;
  lastModified: number;
  createdAt?: number;
  /** חסר = claude */
  provider?: ProviderId;
  tag: string | null;
  gitBranch?: string;
  external: ExternalLive | null;
  live: LiveInfo | null;
}


/** קובץ שצורף להודעה, שמור במחשב תחת data/uploads */
export interface Attachment {
  path: string;
  name: string;
  mime: string;
  size: number;
}

export type Block =
  | { type: "file"; name: string; path: string; mime: string }
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string; isError: boolean }
  | { type: "image" };

export interface TranscriptMessage {
  uuid: string;
  role: "user" | "assistant";
  blocks: Block[];
  timestamp?: string;
  /** נשלחה מהאפליקציה של Claude (Remote Control) */
  phone?: boolean;
}

export interface ResultInfo {
  subtype: string;
  isError: boolean;
  costUsd: number;
  durationMs: number;
  numTurns: number;
  text: string;
}

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  input: unknown;
  reason?: string;
  defaultToNo?: boolean;
  canAlways: boolean;
  /** פקודה שמשנה את הפרוד (שומר הפרוד ב-live.ts). מאשרים רק מהחלון של מפקדה */
  prod?: ProdRequest;
}

export interface ProdRequest {
  command: string;
  reasons: string[];
  cwd: string;
  branch: string | null;
  commit: string | null;
  /** הסוכן שביקש (deployer כתת-סוכן בתוך manager, או האייג'נט של הסשן) */
  agent: string | null;
  /** כמה דקות תקף "אשר פריסה לסשן הזה" */
  grantMinutes: number;
  /** אין ערוץ מוגן ל-daemon (פיתוח בדפדפן): אי אפשר לאשר מכאן */
  untrustedOnly?: boolean;
}

export type LiveEvent =
  | { kind: "init"; sessionId: string; model: string; permissionMode: PermissionMode; cwd: string; tools: string[]; version: string }
  | { kind: "state"; state: LiveState }
  | { kind: "text_delta"; text: string }
  | { kind: "tool_start"; name: string }
  | { kind: "message"; message: TranscriptMessage }
  | { kind: "result"; result: ResultInfo }
  | { kind: "permission_request"; request: PermissionRequest }
  | { kind: "permission_resolved"; requestId: string; behavior: "allow" | "deny" }
  | { kind: "error"; message: string }
  | { kind: "info"; text: string };

export type TaskStatus = "todo" | "running" | "review" | "done";

/** מי מבצע את המשימה: סוכן (ברירת מחדל, ה-autoRun מפעיל) או המשתמש (לא מופעלת אוטומטית ולא נפתח לה סשן). */
export type TaskOwner = "agent" | "me";

/** משימה בלוח הקנבן. הרצה פותחת סשן חי, והסטטוס מתקדם לבד לפי האירועים שלו. */
export interface Task {
  id: string;
  title: string;
  prompt: string;
  cwd: string;
  /** חסר = claude */
  provider?: ProviderId;
  agent: string | null;
  model: string | null;
  permissionMode: PermissionMode;
  status: TaskStatus;
  /** חסר במשימות ישנות, וזה שווה ל-"agent". */
  owner?: TaskOwner;
  order: number;
  createdAt: number;
  updatedAt: number;
  liveId: string | null;
  sessionId: string | null;
  summary: string | null;
  costUsd: number;
  lastError: string | null;
  /** לעבוד בענף ו-worktree נפרדים */
  isolate?: boolean;
  /** המשתמש התיר git שמשנה היסטוריה או מפרסם (commit, merge, push...). חסר = חסום בסשן של המשימה */
  allowGit?: boolean;
  worktree?: { path: string; branch: string; base: string; root: string; prefix: string } | null;
  routineId?: string | null;
}

export type TaskInput = Pick<Task, "title" | "prompt" | "cwd"> & Partial<Pick<Task, "provider" | "agent" | "model" | "permissionMode" | "status" | "owner" | "isolate" | "allowGit" | "routineId">>;

export type RoutineSchedule = { kind: "daily"; time: string; days: number[] } | { kind: "interval"; minutes: number };

export interface Routine {
  id: string;
  title: string;
  prompt: string;
  cwd: string;
  provider?: ProviderId;
  agent: string | null;
  model: string | null;
  permissionMode: PermissionMode;
  schedule: RoutineSchedule;
  enabled: boolean;
  lastRun: number | null;
  createdAt: number;
}

export interface OpenRequest {
  cwd: string;
  provider?: ProviderId;
  title?: string;
  resume?: string;
  fork?: boolean;
  agent?: string | null;
  model?: string | null;
  permissionMode?: PermissionMode;
  text?: string;
  attachments?: Attachment[];
}

export type ClientMsg =
  | ({ t: "open"; ref: string } & OpenRequest)
  | { t: "attach"; liveId: string }
  | { t: "detach"; liveId: string }
  | { t: "send"; liveId: string; text: string; attachments?: Attachment[] }
  | { t: "permission"; liveId: string; requestId: string; behavior: "allow" | "deny"; always?: boolean; grant?: boolean }
  | { t: "revoke_grant"; liveId: string }
  | { t: "interrupt"; liveId: string }
  | { t: "set_model"; liveId: string; model: string | null }
  | { t: "set_mode"; liveId: string; mode: PermissionMode }
  | { t: "set_remote"; liveId: string; on: boolean }
  | { t: "close"; liveId: string }
  | { t: "rewind"; liveId: string; uuid: string };

export type ServerMsg =
  | { t: "opened"; liveId: string; ref: string }
  | { t: "snapshot"; liveId: string; info: LiveInfo; events: LiveEvent[]; partialText: string }
  | { t: "event"; liveId: string; event: LiveEvent }
  | { t: "lives"; lives: LiveInfo[] }
  | { t: "tasks"; tasks: Task[]; settings: TaskSettings }
  | { t: "routines"; routines: Array<Routine & { next: number }> }
  | { t: "notify"; kind: "permission" | "done" | "error"; title: string; body: string; liveId: string; sessionId: string | null }
  | { t: "error"; message: string; liveId?: string; ref?: string }
  | { t: "toast"; message: string }
  | { t: "app"; launchAtLogin: boolean };


export interface GitInfo {
  isRepo: boolean;
  branch: string | null;
  changed: number;
  ahead: number;
  behind: number;
  lastCommit: { subject: string; time: number } | null;
}

/** סיכום סשן שנוצר על ידי Claude: מה נעשה, ומה נשאר פתוח כמשימות מוכנות. */
export interface SessionSummary {
  sessionId: string;
  createdAt: number;
  model: string;
  messages: number;
  summary: string[];
  done: string[];
  open: Array<{ title: string; prompt: string }>;
}

/** המפה (`/api/map`): גרף של כל מה שיש - פרויקטים, אייג'נטים, סשנים, סקילס, זיכרון, משימות */
export type MapNodeType = "hub" | "branch" | "project" | "agent" | "session" | "skill" | "memory" | "task" | "routine";

export interface MapNode {
  id: string;
  type: MapNodeType;
  label: string;
  description?: string;
  path?: string;
  group?: string;
  sessionId?: string;
  /** פרויקט: מספר סשנים. אייג'נט: בכמה סשנים שימש */
  count?: number;
  lastActive?: number | null;
  live?: boolean;
  agent?: string | null;
  color?: string;
  emoji?: string;
  status?: string;
  git?: { branch: string | null; changed: number; ahead: number; remote: boolean } | null;
}

export interface MapLink {
  source: string;
  target: string;
  /** tree = שייכות לענף; belongs = שייך לפרויקט; uses = משתמש באייג'נט; about = פתק על פרויקט; mentions = [[קישור]] */
  kind: "tree" | "belongs" | "uses" | "about" | "mentions";
}

export interface MapGap {
  id: string;
  level: "warn" | "info" | "quiet";
  text: string;
}

export interface MapData {
  nodes: MapNode[];
  links: MapLink[];
  gaps: MapGap[];
  at: number;
}

/** בורר התיקיות: GET /api/fs/browse?path=&hidden=1 */
export interface BrowseEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
  hasChildren: boolean;
}
export interface BrowseResult {
  path: string;
  /** הנתיב עם ~ במקום הבית */
  display: string;
  /** null בתיקיית הבית: אי אפשר לעלות מעליה */
  parent: string | null;
  home: string;
  isGitRepo: boolean;
  /** נקודות התחלה: תיקיות הפרויקטים מההגדרות, או הבית */
  roots: string[];
  entries: BrowseEntry[];
  truncated: boolean;
}
