import type { EventEmitter } from "node:events";
import type { Attachment, LiveEvent, LiveInfo, LiveState, PermissionMode, ProviderCaps, ProviderId } from "../../../shared/protocol.js";

export interface OpenParams {
  cwd: string;
  /** חסר = claude */
  provider?: ProviderId;
  title?: string;
  resume?: string;
  fork?: boolean;
  agent?: string | null;
  model?: string | null;
  permissionMode?: PermissionMode;
  /** סשן של משימה מהקנבן: git שמשנה היסטוריה או מפרסם חסום (gitPolicy.ts). אינטראקטיבי = false */
  gitLock?: boolean;
}

/**
 * סשן חי של סוכן, בלי קשר למי מריץ אותו (Claude SDK, ACP). ה-Hub, המשימות וההתראות מדברים רק עם זה.
 * אירועים: "event" עם LiveEvent, ו-"info" בלי תוכן כשהמצב או הפרטים משתנים.
 */
export interface AgentRuntime extends EventEmitter {
  readonly liveId: string;
  readonly provider: ProviderId;
  readonly caps: ProviderCaps;
  readonly cwd: string;
  readonly agent: string | null;
  readonly startedAt: number;
  readonly events: LiveEvent[];
  lastActivity: number;
  sessionId: string | null;
  model: string | null;
  permissionMode: PermissionMode;
  state: LiveState;
  title: string;
  costUsd: number;
  partialText: string;
  remoteUrl: string | null;

  info(): LiveInfo;
  send(text: string, attachments?: Attachment[]): void;
  /** opts: trusted = הבקשה הגיעה מהחלון (ערוץ מוגן), grant = "אשר פריסה לסשן הזה". רלוונטי לשומר הפרוד של Claude */
  resolvePermission(requestId: string, behavior: "allow" | "deny", always: boolean, opts?: { trusted?: boolean; grant?: boolean }): void;
  /** ביטול "אשר פריסה לסשן הזה". רק לספקים שיש להם שומר פרוד */
  revokeGrant?(): void;
  /** חסימת git בסשן של משימה. נאכף רק בספק של Claude (hook ב-live.ts) */
  gitLock?: boolean;
  interrupt(): Promise<void>;
  setModel(model: string | null): Promise<void>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  close(): Promise<void>;
  /** רק כש-caps.rewind */
  rewind(uuid: string): Promise<string>;
  /** רק כש-caps.remote */
  setRemote(on: boolean): Promise<string | null>;
}

export const CLAUDE_CAPS: ProviderCaps = {
  resume: true,
  fork: true,
  rewind: true,
  remote: true,
  slashCommands: true,
  agents: true,
  cost: true,
  modes: ["default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"],
  models: null,
};
