import { create } from "zustand";
import type { AgentInfo, AgentTheme, LiveEvent, LiveInfo, LiveState, PermissionRequest, ResultInfo, Routine, SessionMeta, SessionRow, Task, TaskSettings, TranscriptMessage } from "../../shared/protocol";
import { mergeHistoryMessages } from "./lib/transcript";
import type { SystemPrefs } from "./api";
import { paneIdentity, uniqueSplit } from "./lib/split";

/*
 * זיכרון: כל שיחה שנפתחה נשארה עם כל התמליל שלה. משאירים רק סשנים חיים (הם מקבלים אירועים),
 * מה שעל המסך, ו-3 השיחות ההיסטוריות האחרונות. שיחה שנזרקה נטענת שוב מהדיסק כשחוזרים אליה.
 */
const recentHistory: string[] = [];
function pruneTranscripts(s: State, next: Selection): Record<string, Transcript> {
  const key = (x: Selection | ChatSel | null | undefined) => (x?.kind === "live" ? x.liveId : x?.kind === "history" ? x.sessionId : null);
  const k = key(next);
  if (next?.kind === "history" && k) {
    const i = recentHistory.indexOf(k);
    if (i >= 0) recentHistory.splice(i, 1);
    recentHistory.unshift(k);
    recentHistory.length = Math.min(recentHistory.length, 3);
  }
  const keep = new Set<string>([...s.lives.map((l) => l.liveId), ...recentHistory]);
  for (const x of [s.selection, next, ...s.split]) {
    const kk = key(x);
    if (kk) keep.add(kk);
  }
  const all = Object.keys(s.transcripts);
  if (all.every((x) => keep.has(x))) return s.transcripts;
  return Object.fromEntries(Object.entries(s.transcripts).filter(([x]) => keep.has(x)));
}

export type SplitLayout = "auto" | "cols" | "rows" | "grid";

/** ה-sessionId של סשן חי, לפי מה שידוע כרגע (הרשימה מהשרת או סשנים חיים) */
function sessionOfLive(s: Pick<State, "lives" | "sessions">) {
  return (liveId: string) => s.lives.find((l) => l.liveId === liveId)?.sessionId ?? s.sessions.find((r) => r.live?.liveId === liveId)?.sessionId;
}
/** מצב חדש של החלונות בלי כפילויות. חלון שהוסר מאפס את ההגדלה, כי האינדקסים זזו */
function panes(s: State, selection: Selection, split: ChatSel[]): Partial<State> {
  const unique = uniqueSplit(selection, split, sessionOfLive(s));
  return unique.length === split.length ? { selection, split: unique } : { selection, split: unique, zoomPane: null };
}
/**
 * שמים סשן בחלון i (0 = הראשי). אם הוא כבר מוצג בחלון אחר, השניים מחליפים מקום. בלי זה הניקוי של
 * הכפילויות היה מוחק את אחד מהם, וגרירה של סשן שכבר על המסך למשבצת אחרת הייתה סוגרת אותה.
 */
function replaceAt(s: State, i: number, c: ChatSel): Partial<State> {
  if (!(s.selection?.kind === "live" || s.selection?.kind === "history")) return i === 0 ? panes(s, c, s.split) : panes(s, s.selection, s.split.map((x, j) => (j === i - 1 ? c : x)));
  const all: ChatSel[] = [s.selection, ...s.split];
  if (!all[i]) return {};
  const sessionOf = sessionOfLive(s);
  const id = paneIdentity(c, sessionOf);
  const k = all.findIndex((x) => paneIdentity(x, sessionOf) === id);
  if (k >= 0 && k !== i) all[k] = all[i];
  all[i] = c;
  return panes(s, all[0], all.slice(1));
}

const readLS = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeLS = (k: string, v: string): void => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* אין אחסון */
  }
};

export type ChatSel = { kind: "live"; liveId: string } | { kind: "history"; sessionId: string };

export type Selection =
  | { kind: "live"; liveId: string }
  | { kind: "history"; sessionId: string }
  | { kind: "new"; agent?: string | null; cwd?: string }
  | { kind: "board" }
  | { kind: "project"; cwd: string }
  | { kind: "inbox" }
  | { kind: "agents" }
  | { kind: "settings" }
  | { kind: "repos" }
  | { kind: "map" }
  | { kind: "extensions" }
  | null;

export type GroupBy = "project" | "agent";

export interface Transcript {
  messages: TranscriptMessage[];
  partialText: string;
  toolRunning: string | null;
  pending: PermissionRequest[];
  state: LiveState | "history";
  lastResult?: ResultInfo;
  error?: string;
  loading?: boolean;
  loaded?: boolean;
}

/** סשן היסטורי → הסשן החי שנפתח ממנו, כדי שהיסטוריה שהגיעה אחרי הפתיחה תגיע אליו */
export const promotedLive = new Map<string, string>();

const emptyTranscript = (): Transcript => ({ messages: [], partialText: "", toolRunning: null, pending: [], state: "history" });

interface State {
  /** הגדרות המערכת מהשרת (שם, תיקיות פרויקטים...). null עד שנטענו */
  system: SystemPrefs | null;
  setSystemPrefs: (s: SystemPrefs) => void;
  agents: AgentInfo[];
  sessions: SessionRow[];
  lives: LiveInfo[];
  transcripts: Record<string, Transcript>;
  selection: Selection;
  /** חלונות צ'אט נוספים לצד הראשי (עד 5, כלומר 6 על המסך) */
  split: ChatSel[];
  /** סידור המסך המחולק */
  layout: SplitLayout;
  /** גדלי עמודות ושורות (חלקים יחסיים), נשמרים בין הפעלות */
  colSizes: number[];
  rowSizes: number[];
  /** חלון מוגדל זמנית (אינדקס: 0 = הראשי) */
  zoomPane: number | null;
  setLayout: (l: SplitLayout) => void;
  setSizes: (cols: number[] | null, rows: number[] | null) => void;
  setZoomPane: (i: number | null) => void;
  /** אינדקס 0 = הראשי, 1.. = split */
  swapPanes: (a: number, b: number) => void;
  replacePane: (i: number, c: ChatSel) => void;
  /** סגירת חלון לפי אינדקס (0 = הראשי: החלון הבא נהיה הראשי) */
  closePane: (i: number) => void;
  palette: boolean;
  help: boolean;
  setHelp: (v: boolean) => void;
  setPalette: (v: boolean) => void;
  connected: boolean;
  toast: string | null;
  projectThemes: Record<string, AgentTheme>;
  groupBy: GroupBy;
  focusProject: string | null;
  tasks: Task[];
  taskSettings: TaskSettings;
  sessionMeta: Record<string, SessionMeta>;
  tts: boolean;
  voiceAutoSend: boolean;
  voiceMode: boolean;
  setVoiceMode: (v: boolean) => void;
  /** שיחה קולית שצריכה להמשיך אחרי שהסשן נפתח מחדש (היסטוריה ← חי). מה ששמענו, לכתובית */
  voiceResume: { heard: string } | null;
  /** בקשה לפתוח שיחה קולית בסשן הנבחר (מהקיצור ⌥⌘Space) */
  voiceStart: boolean;
  setVoiceStart: (v: boolean) => void;
  setVoiceResume: (v: { heard: string } | null) => void;
  sidebarHidden: boolean;
  /** רוחב סרגל הצד בפיקסלים. מתחת ל-120 = מצב מצומצם (אייקונים בלבד) */
  sidebarWidth: number;
  setSidebarWidth: (w: number) => void;
  toggleSidebar: () => void;
  routines: Array<Routine & { next: number }>;
  /** סשנים חיים שסיימו תור בזמן שלא היו על המסך (נקודה כחולה כמו ב-Mail) */
  unread: Record<string, true>;
  setRoutines: (r: Array<Routine & { next: number }>) => void;
  setTts: (v: boolean) => void;
  setVoiceAutoSend: (v: boolean) => void;

  setTasks: (t: Task[], settings?: TaskSettings) => void;
  setSessionMeta: (m: Record<string, SessionMeta>) => void;
  setProjectThemes: (t: Record<string, AgentTheme>) => void;
  setGroupBy: (g: GroupBy) => void;
  setFocusProject: (cwd: string | null) => void;
  setAgents: (a: AgentInfo[]) => void;
  setSessions: (s: SessionRow[]) => void;
  setLives: (l: LiveInfo[]) => void;
  setConnected: (c: boolean) => void;
  setToast: (t: string | null) => void;
  select: (s: Selection) => void;
  openBeside: (s: ChatSel) => void;
  closeBeside: (i: number) => void;
  replaceBeside: (i: number, s: ChatSel) => void;
  setTranscript: (key: string, patch: Partial<Transcript>) => void;
  promoteToLive: (fromKey: string, liveId: string, pane?: number) => void;
  /** היסטוריה מהדיסק לתוך תמליל: לפני ההודעות החיות, בלי כפילויות */
  mergeHistory: (key: string, history: TranscriptMessage[]) => void;
  applySnapshot: (liveId: string, info: LiveInfo, events: LiveEvent[], partialText: string) => void;
  applyEvent: (liveId: string, e: LiveEvent) => void;
}

function reduce(t: Transcript, e: LiveEvent): Transcript {
  switch (e.kind) {
    case "init":
      return { ...t, error: undefined };
    case "state":
      return { ...t, state: e.state };
    case "text_delta":
      return { ...t, partialText: t.partialText + e.text, toolRunning: null };
    case "tool_start":
      return { ...t, toolRunning: e.name };
    case "message":
      if (t.messages.some((m) => m.uuid === e.message.uuid)) return t;
      return {
        ...t,
        messages: [...t.messages, e.message],
        partialText: e.message.role === "assistant" ? "" : t.partialText,
        toolRunning: e.message.role === "assistant" ? null : t.toolRunning,
        error: e.message.role === "user" ? t.error : undefined,
      };
    case "result":
      return { ...t, lastResult: e.result, partialText: "", toolRunning: null, error: e.result.isError ? e.result.text : t.error };
    case "permission_request":
      if (t.pending.some((p) => p.requestId === e.request.requestId)) return t;
      return { ...t, pending: [...t.pending, e.request] };
    case "permission_resolved":
      return { ...t, pending: t.pending.filter((p) => p.requestId !== e.requestId) };
    case "error":
      return { ...t, error: e.message };
    case "info":
      return t;
  }
}

export const useStore = create<State>((set, get) => ({
  agents: [],
  sessions: [],
  lives: [],
  transcripts: {},
  selection: null,
  split: [],
  layout: (readLS("mifkada.layout") as SplitLayout) || "auto",
  colSizes: JSON.parse(readLS("mifkada.colSizes") || "[]") as number[],
  rowSizes: JSON.parse(readLS("mifkada.rowSizes") || "[]") as number[],
  zoomPane: null,
  setLayout: (layout) => {
    writeLS("mifkada.layout", layout);
    writeLS("mifkada.colSizes", "[]");
    writeLS("mifkada.rowSizes", "[]");
    set({ layout, colSizes: [], rowSizes: [] });
  },
  setSizes: (cols, rows) =>
    set((s) => {
      const colSizes = cols ?? s.colSizes;
      const rowSizes = rows ?? s.rowSizes;
      writeLS("mifkada.colSizes", JSON.stringify(colSizes));
      writeLS("mifkada.rowSizes", JSON.stringify(rowSizes));
      return { colSizes, rowSizes };
    }),
  setZoomPane: (zoomPane) => set({ zoomPane }),
  swapPanes: (a, b) =>
    set((s) => {
      if (a === b || !(s.selection?.kind === "live" || s.selection?.kind === "history")) return {};
      const all: ChatSel[] = [s.selection as ChatSel, ...s.split];
      if (!all[a] || !all[b]) return {};
      [all[a], all[b]] = [all[b], all[a]];
      return { selection: all[0], split: all.slice(1) };
    }),
  replacePane: (i, c) => set((s) => replaceAt(s, i, c)),
  closePane: (i) =>
    set((s) => {
      if (i > 0) return { split: s.split.filter((_, j) => j !== i - 1), zoomPane: null };
      return { selection: s.split[0] ?? null, split: s.split.slice(1), zoomPane: null };
    }),
  palette: false,
  help: false,
  setHelp: (help) => set({ help }),
  setPalette: (palette) => set({ palette }),
  connected: false,
  toast: null,
  projectThemes: {},
  tasks: [],
  taskSettings: { autoRun: false, maxParallel: 2 },
  sessionMeta: {},
  system: null,
  setSystemPrefs: (system) => set({ system }),
  tts: localStorage.getItem("mifkada.tts") === "1",
  voiceAutoSend: localStorage.getItem("mifkada.voiceAutoSend") === "1",
  voiceMode: false,
  setVoiceMode: (voiceMode) => set({ voiceMode }),
  voiceResume: null,
  voiceStart: false,
  setVoiceStart: (voiceStart) => set({ voiceStart }),
  setVoiceResume: (voiceResume) => set({ voiceResume }),
  sidebarHidden: false,
  sidebarWidth: Number(readLS("mifkada.sidebarWidth")) || 336,
  setSidebarWidth: (sidebarWidth) => {
    writeLS("mifkada.sidebarWidth", String(sidebarWidth));
    set({ sidebarWidth });
  },
  routines: [],
  unread: {},
  setRoutines: (routines) => set({ routines }),
  toggleSidebar: () => set((s) => ({ sidebarHidden: !s.sidebarHidden })),
  setTts: (tts) => {
    localStorage.setItem("mifkada.tts", tts ? "1" : "0");
    set({ tts });
  },
  setVoiceAutoSend: (voiceAutoSend) => {
    localStorage.setItem("mifkada.voiceAutoSend", voiceAutoSend ? "1" : "0");
    set({ voiceAutoSend });
  },
  setTasks: (tasks, settings) => set(settings ? { tasks, taskSettings: settings } : { tasks }),
  setSessionMeta: (sessionMeta) => set({ sessionMeta }),
  groupBy: (localStorage.getItem("mifkada.groupBy") as GroupBy | null) ?? "project",
  focusProject: null,

  setProjectThemes: (projectThemes) => set({ projectThemes }),
  setGroupBy: (groupBy) => {
    localStorage.setItem("mifkada.groupBy", groupBy);
    set({ groupBy });
  },
  setFocusProject: (focusProject) => set({ focusProject }),
  setAgents: (agents) => set({ agents }),
  setSessions: (sessions) => set({ sessions }),
  setLives: (lives) =>
    set((s) => {
      const visible = new Set<string>();
      for (const x of [s.selection, ...s.split]) if (x?.kind === "live") visible.add(x.liveId);
      const unread = { ...s.unread };
      for (const l of lives) {
        const prev = s.lives.find((p) => p.liveId === l.liveId);
        if (prev && (prev.state === "running" || prev.state === "starting") && (l.state === "idle" || l.state === "waiting") && !visible.has(l.liveId)) unread[l.liveId] = true;
      }
      for (const id of Object.keys(unread)) if (!lives.some((l) => l.liveId === id)) delete unread[id];
      // עכשיו ידוע לאיזה סשן שייך כל חי: חלון היסטורי ששייך לסשן חי שכבר מוצג הוא כפילות
      const split = uniqueSplit(s.selection, s.split, sessionOfLive({ lives, sessions: s.sessions }));
      return split === s.split ? { lives, unread } : { lives, unread, split, zoomPane: null };
    }),
  setConnected: (connected) => set({ connected }),
  setToast: (toast) => set({ toast }),
  select: (selection) =>
    set((s) => {
      // סשן שכבר פתוח בחלון ליד ועובר לראשי מחליף מקום עם הראשי, כדי שלא יוצג פעמיים ושום חלון לא ייסגר
      let split = s.split;
      if ((selection?.kind === "live" || selection?.kind === "history") && (s.selection?.kind === "live" || s.selection?.kind === "history")) {
        const sessionOf = sessionOfLive(s);
        const id = paneIdentity(selection, sessionOf);
        const j = split.findIndex((x) => paneIdentity(x, sessionOf) === id);
        if (j >= 0) split = split.map((x, k) => (k === j ? (s.selection as ChatSel) : x));
      }
      const out: Partial<State> = { ...panes(s, selection, split), transcripts: pruneTranscripts(s, selection) };
      if (selection?.kind === "live" && s.unread[selection.liveId]) {
        const unread = { ...s.unread };
        delete unread[selection.liveId];
        out.unread = unread;
      }
      return out;
    }),
  openBeside: (c) =>
    set((s) => {
      // כבר על המסך (גם כשאחד חי והשני היסטורי של אותו סשן): לא פותחים שוב
      const sessionOf = sessionOfLive(s);
      const id = paneIdentity(c, sessionOf);
      const same = (x: Selection) => (x?.kind === "live" || x?.kind === "history") && paneIdentity(x, sessionOf) === id;
      if (same(s.selection) || s.split.some(same)) return {};
      // אין צ'אט ראשי: הוא נהיה הראשי
      if (!(s.selection?.kind === "live" || s.selection?.kind === "history")) return { selection: c };
      // עד 6 צ'אטים על המסך: הראשי ועוד 5
      return { split: [...s.split, c].slice(-5) };
    }),
  closeBeside: (i) => set((s) => ({ split: s.split.filter((_, j) => j !== i), zoomPane: null })),
  replaceBeside: (i, c) => set((s) => replaceAt(s, i + 1, c)),

  setTranscript: (key, patch) =>
    set((s) => ({ transcripts: { ...s.transcripts, [key]: { ...(s.transcripts[key] ?? emptyTranscript()), ...patch } } })),

  mergeHistory: (key, history) =>
    set((s) => {
      const t = s.transcripts[key] ?? emptyTranscript();
      const messages = mergeHistoryMessages(t.messages, history);
      return { transcripts: { ...s.transcripts, [key]: { ...t, messages, loading: false, loaded: true } } };
    }),

  // סשן היסטורי שנפתח להמשך: ההיסטוריה עוברת למפתח של הסשן החי
  promoteToLive: (fromKey, liveId, pane) =>
    set((s) => {
      promotedLive.set(fromKey, liveId);
      const from = s.transcripts[fromKey] ?? emptyTranscript();
      const existing = s.transcripts[liveId];
      const merged: Transcript = existing
        ? { ...existing, messages: existing.messages.length ? existing.messages : from.messages }
        : { ...from, pending: [], partialText: "", state: "starting" };
      const transcripts = { ...s.transcripts, [liveId]: merged };
      if (pane !== undefined) return { transcripts, ...panes(s, s.selection, s.split.map((x, j) => (j === pane ? { kind: "live" as const, liveId } : x))) };
      return { transcripts, ...panes(s, { kind: "live", liveId }, s.split) };
    }),

  // תמונת מצב מהשרת: ההיסטוריה שנטענה מהדיסק נשארת, והאירועים מאז הפתיחה מוחלים עליה מחדש
  applySnapshot: (liveId, info, events, partialText) =>
    set((s) => {
      const base = s.transcripts[liveId] ?? emptyTranscript();
      const eventUuids = new Set(events.filter((e) => e.kind === "message").map((e) => (e as { message: TranscriptMessage }).message.uuid));
      let t: Transcript = { ...base, messages: base.messages.filter((m) => !eventUuids.has(m.uuid)), pending: [], partialText: "", error: undefined };
      for (const e of events) t = reduce(t, e);
      t.partialText = partialText;
      t.state = info.state;
      return { transcripts: { ...s.transcripts, [liveId]: t } };
    }),

  applyEvent: (liveId, e) => {
    const s = get();
    const t = s.transcripts[liveId] ?? emptyTranscript();
    set({ transcripts: { ...s.transcripts, [liveId]: reduce(t, e) } });
  },
}));

export function transcriptKey(sel: Selection): string | null {
  if (!sel) return null;
  if (sel.kind === "live") return sel.liveId;
  if (sel.kind === "history") return sel.sessionId;
  return null;
}
