import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Square, X, GitBranch, Palette, Code2, Volume2, VolumeX, ListChecks, PanelLeftClose, Download, ArrowDown, GripVertical, Maximize2, MoreHorizontal, Smartphone, Mic } from "lucide-react";
import SummaryPanel from "./SummaryPanel";
// כבדים (עורך Monaco, טרמינל, כדור הקול): נטענים רק כשפותחים אותם
const Workspace = lazy(() => import("./Workspace"));
import { stopSpeaking } from "../lib/speech";
import { useVoiceConversation } from "../lib/useVoiceConversation";
const VoiceOrb = lazy(() => import("./VoiceOrb"));
import { promotedLive, useStore, type Selection } from "../store";
import { cachedHistory, loadHistory } from "../lib/historyCache";
import { getPrefs } from "../lib/prefs";
import { api } from "../api";
import { openSession, send, syncAttached } from "../ws";
import { refreshSessions, refreshThemes } from "../App";
import { cn, confirmMode, modelLabel, MODEL_OPTIONS, MODE_OPTIONS } from "../lib/util";
import { ACP_MODES, isClaude, providerLabel, useProviders } from "../lib/providers";
import { agentVisual, projectVisual } from "../lib/groups";
import { MessageViewMemo, MarkdownText, ToolRunMemo, groupRuns } from "./Blocks";

import PermissionCard, { DeployGrantPill } from "./PermissionCard";
import Composer from "./Composer";
import { RcLivePill } from "./RemoteControl";
import { useChatFind, ChatFindBar } from "./chat/FindBar";
import { exportChatMarkdown } from "../lib/exportChat";
import { runUiCommand } from "../lib/chatCommands";
import { SESSION_DRAG } from "../lib/split";
import StatusDot, { liveStateLabel } from "./StatusDot";
import { AgentSelect, SessionThemeEditor, ThemeEditor } from "./AgentPicker";
import { paneStyle } from "../lib/sessionStyle";
import ResizeHandle, { useStoredSize } from "./ResizeHandle";
import Avatar from "./Avatar";
import type { Attachment, PermissionMode, SessionMeta } from "../../../shared/protocol";
import { isRTL, strings, useT } from "../i18n";
import { Spinner } from "./Spinner";
import { ask } from "../lib/dialog";

const S = strings({
  he: {
    notFound: "הסשן לא נמצא ברשימה",
    phClosed: "הסשן נסגר. אפשר להמשיך אותו מהרשימה כסשן היסטורי",
    phExternal: "הסשן רץ כרגע בטרמינל או ב-VS Code. שליחה תפתח עותק שלו במפקדה",
    phHistory: "המשך את השיחה כאן. ההודעה תפתח את הסשן במפקדה",
    phBusy: "אפשר להקליד, ההודעה תיכנס לתור",
    phIdle: "כתוב ל-Claude",
    session: "סשן",
    chMifkada: "מפקדה",
    chTerminal: "טרמינל",
    chHistory: "היסטוריה",
    dragPane: "גרור כדי להזיז את החלון",
    renameHint: "לחיצה כפולה לשינוי שם",
    more: "עוד",
    summary: "סיכום ומשימות",
    summaryHint: "מה נעשה ומה נשאר",
    closeWorkspace: "סגור סביבת עבודה",
    workspace: "סביבת עבודה",
    code: "קוד",
    workspaceHint: "קבצים, שינויים, עורך וטרמינל",
    sessionStyle: "עיצוב הסשן",
    stopReading: "הפסק הקראה",
    readAloud: "הקראת תשובות",
    autoSendOn: "✓ שליחה אוטומטית אחרי דיבור",
    autoSend: "שליחה אוטומטית אחרי דיבור",
    autoSendHint: "מה שאמרת במיקרופון נשלח בלי ללחוץ",
    exportMd: "ייצוא ל-Markdown",
    rcOff: "הוצא מהאפליקציה של Claude",
    rcOn: "זמין באפליקציה של Claude",
    scopeAgent: "לכל הסשנים של {name}",
    scopeProject: "לכל הפרויקט",
    projectNamed: "הפרויקט {name}",
    styleOf: "עיצוב {name}",
    styleProject: "עיצוב הפרויקט {name}",
    stopClaude: "עצור את Claude",
    stop: "עצור",
    closeLive: "סגור את הסשן · ⌥-לחיצה: סגירה עם סיכום, משימות וארכיון",
    closeHistory: "סגור · ⌥-לחיצה: סיכום, משימות וארכיון",
    zoom: "הגדל את החלון הזה (ושוב לחזרה)",
    unsplit: "הוצא מהמסך המפוצל (הסשן ממשיך לרוץ)",
    loadingHistory: "טוען את ההיסטוריה",
    showEarlier: "הצג הודעות קודמות ({n})",
    rewindConfirm: "להחזיר את הקבצים בפרויקט למצב שלפני ההודעה הזו? שינויים שClaude עשה אחריה יבוטלו.",
    running: "מריץ",
    starting: "מפעיל את Claude Code",
    thinking: "חושב",
    toBottom: "לסוף השיחה",
    model: "מודל",
    loadingWorkspace: "טוען סביבת עבודה...",
  },
  en: {
    notFound: "This session isn't in the list",
    phClosed: "This session is closed. You can continue it from the list as a past session",
    phExternal: "This session is running in a terminal or in VS Code. Sending will open a copy of it in Mifkada",
    phHistory: "Continue the conversation here. Your message will open the session in Mifkada",
    phBusy: "Keep typing, your message will be queued",
    phIdle: "Message Claude",
    session: "Session",
    chMifkada: "Mifkada",
    chTerminal: "Terminal",
    chHistory: "History",
    dragPane: "Drag to move this pane",
    renameHint: "Double-click to rename",
    more: "More",
    summary: "Summary and tasks",
    summaryHint: "What was done and what's left",
    closeWorkspace: "Close workspace",
    workspace: "Workspace",
    code: "Code",
    workspaceHint: "Files, changes, editor and terminal",
    sessionStyle: "Session style",
    stopReading: "Stop reading aloud",
    readAloud: "Read replies aloud",
    autoSendOn: "✓ Auto-send after speaking",
    autoSend: "Auto-send after speaking",
    autoSendHint: "What you say into the mic is sent without clicking",
    exportMd: "Export to Markdown",
    rcOff: "Remove from the Claude app",
    rcOn: "Available in the Claude app",
    scopeAgent: "For all of {name}'s sessions",
    scopeProject: "For the whole project",
    projectNamed: "The {name} project",
    styleOf: "{name} style",
    styleProject: "{name} project style",
    stopClaude: "Stop Claude",
    stop: "Stop",
    closeLive: "Close the session · ⌥-click: close with summary, tasks and archive",
    closeHistory: "Close · ⌥-click: summary, tasks and archive",
    zoom: "Enlarge this pane (click again to restore)",
    unsplit: "Remove from split view (the session keeps running)",
    loadingHistory: "Loading history",
    showEarlier: "Show earlier messages ({n})",
    rewindConfirm: "Restore the project files to how they were before this message? Changes Claude made after it will be undone.",
    running: "Running",
    starting: "Starting Claude Code",
    thinking: "Thinking",
    toBottom: "Jump to the latest message",
    model: "Model",
    loadingWorkspace: "Loading workspace...",
  },
});

type Props = {
  selection: Extract<Selection, { kind: "live" } | { kind: "history" }>;
  /** אינדקס החלון בפיצול; undefined = החלון הראשי */
  pane?: number;
  /** מסך מפוצל: כותרת מצומצמת ובלי סביבת עבודה */
  compact?: boolean;
  /** 3 צ'אטים ומעלה: גם בלי סרגלי הכלים, רק כותרת, עצירה וסגירה */
  tiny?: boolean;
  /** המיקום במסך המחולק (0 = הראשי), לגרירה ולהגדלה */
  slot?: number;
};

export default function ChatView({ selection, pane, compact, tiny, slot }: Props) {
  const key = selection.kind === "live" ? selection.liveId : selection.sessionId;
  const transcript = useStore((s) => s.transcripts[key]);
  const setTranscript = useStore((s) => s.setTranscript);
  const promoteToLive = useStore((s) => s.promoteToLive);
  const sessions = useStore((s) => s.sessions);
  const lives = useStore((s) => s.lives);
  const agents = useStore((s) => s.agents);
  const projectThemes = useStore((s) => s.projectThemes);
  const setToast = useStore((s) => s.setToast);
  const tx = useT(S);

  const live = selection.kind === "live" ? lives.find((l) => l.liveId === selection.liveId) : undefined;
  const row = useMemo(
    () => (selection.kind === "live" ? sessions.find((s) => s.live?.liveId === selection.liveId) : sessions.find((s) => s.sessionId === selection.sessionId)),
    [sessions, selection],
  );
  const sessionId = live?.sessionId ?? row?.sessionId ?? (selection.kind === "history" ? selection.sessionId : null);
  const cwd = row?.cwd ?? live?.cwd ?? "";
  // סביבת העבודה (קבצים, טרמינל, תצוגה מקדימה) נפתחת בתיקיית הפרויקט שהסשן משויך אליו, גם כשהסשן עצמו נפתח מתיקייה אחרת.
  // חוץ מסשן שרץ בענף נפרד (worktree): הקבצים שהוא משנה נמצאים שם ולא בריפו הראשי
  const workCwd = /[\\/]\.mifkada-worktrees[\\/]/.test(cwd) ? cwd : row?.projectCwd || cwd;
  const agentSlug = row?.tag ?? live?.agent ?? null;
  // ספק: Claude (כל היכולות) או ACP (Codex וכו'). מה שהספק לא יודע לעשות לא מוצג
  const provider = live?.provider ?? row?.provider ?? "claude";
  const claude = isClaude(provider);
  const caps = live?.caps;
  const providers = useProviders();
  const modelOptions: Array<{ value: string | null; label: string }> = claude ? MODEL_OPTIONS : [{ value: null, label: MODEL_OPTIONS[0].label }, ...(caps?.models ?? []).map((m) => ({ value: m.id, label: m.label }))];
  const modeOptions = MODE_OPTIONS.filter((o) => (caps ? caps.modes.includes(o.value) : claude || ACP_MODES.includes(o.value)));
  const agent = agents.find((a) => a.slug === agentSlug) ?? null;
  const allCwds = useMemo(() => new Set(sessions.map((s) => s.cwd)), [sessions]);
  const projectVis = projectVisual(cwd, allCwds, projectThemes);
  const baseVis = agent ? agentVisual(agent) : projectVis;
  // עיצוב לסשן הזה בלבד גובר על הפרויקט/האייג'נט. styleDraft = תצוגה מקדימה בזמן שהעורך פתוח
  const savedStyle = useStore((s) => (sessionId ? s.sessionMeta[sessionId] : undefined));
  const [styleDraft, setStyleDraft] = useState<SessionMeta | null>(null);
  const sessionStyle = styleDraft ?? savedStyle;
  const vis = sessionStyle?.color ? { ...baseVis, color: sessionStyle.color } : baseVis;
  const pane_ = paneStyle(sessionStyle);

  const [pendingModel, setPendingModel] = useState<string | null>(getPrefs().defaultModel);
  const [pendingMode, setPendingMode] = useState<PermissionMode>(getPrefs().defaultMode);
  // סשן היסטורי שעוד לא נפתח: ברירות המחדל באות מהפרופיל של הפרויקט
  useEffect(() => {
    if (live || !cwd) return;
    api
      .profiles()
      .then((all) => {
        const pr = all[cwd];
        if (!pr) return;
        if (pr.model) setPendingModel(pr.model);
        if (pr.permissionMode) setPendingMode(pr.permissionMode as PermissionMode);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);
  const [themeOpen, setThemeOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const off = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [menuOpen]);
  // רוחב סביבת העבודה (קוד, טרמינל) מול הצ'אט, נשמר בין הפעלות
  const [wsWidth, setWsWidth] = useStoredSize("mifkada.workspaceWidth", 320, 4000);
  const wsRef = useRef<HTMLDivElement>(null);
  const wsStart = useRef(0);
  /** העורך פתוח על: הסשן הזה, או כל הפרויקט/האייג'נט (העורך הישן) */
  const [themeScope, setThemeScope] = useState<"session" | "shared">("session");
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  // ברירת מחדל: במסך רחב הקוד פתוח ליד הצ'אט (זה IDE); אחרי שבחרת פעם אחת, הבחירה נשמרת
  const [workspace, setWorkspace] = useState(() => {
    const v = localStorage.getItem("mifkada.workspace");
    return v === null ? window.innerWidth >= 1500 : v === "1";
  });
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const finishSession = async ({ archive }: { archive: boolean }) => {
    if (live) send({ t: "close", liveId: live.liveId });
    if (archive && sessionId) await api.archive(sessionId, true);
    setSummaryOpen(false);
    setClosing(false);
    if (pane !== undefined) useStore.getState().closeBeside(pane);
    else useStore.getState().select(null);
    refreshSessions();
    refreshThemes();
  };
  const toggleWorkspace = () => {
    localStorage.setItem("mifkada.workspace", workspace ? "0" : "1");
    setWorkspace(!workspace);
  };
  // ⌘E פותח/סוגר את הקוד (רק בצ'אט שתופס את כל המסך). ⌘J שמור לטרמינל בתוך סביבת העבודה, כמו ב-VS Code
  useEffect(() => {
    if (compact) return;
    const on = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "e" || e.shiftKey) return;
      e.preventDefault();
      setWorkspace((w) => {
        localStorage.setItem("mifkada.workspace", w ? "0" : "1");
        return !w;
      });
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [compact]);
  const tts = useStore((s) => s.tts);
  const setTts = useStore((s) => s.setTts);
  const voiceAutoSend = useStore((s) => s.voiceAutoSend);
  const setVoiceAutoSend = useStore((s) => s.setVoiceAutoSend);
  const commitTitle = async () => {
    const t = editingTitle?.trim();
    setEditingTitle(null);
    if (!t || !sessionId || t === title) return;
    try {
      await api.rename(sessionId, t);
      refreshSessions();
    } catch (e) {
      setToast((e as Error).message);
    }
  };

  // סשן חי שהלקוח הזה עוד לא נרשם אליו (נפתח מהקנבן, מהתראה או מחלון אחר): לבקש תמונת מצב
  useEffect(() => {
    if (selection.kind === "live") syncAttached();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  // ההיסטוריה מהדיסק, גם לסשן חי (שנפתח עכשיו מהרשימה, או אחרי טעינה מחדש של החלון: תמונת המצב
  // מהשרת מכילה רק את מה שקרה מאז הפתיחה). מהמטמון אם יש, ובלי לחכות לה כדי להציג משהו.
  const historyId = selection.kind === "history" ? selection.sessionId : live?.sessionId ?? null;
  useEffect(() => {
    if (!historyId || transcript?.loaded || transcript?.loading) return;
    const merge = useStore.getState().mergeHistory;
    const stamp = row?.lastModified ?? 0;
    const hit = cachedHistory(historyId, stamp);
    if (hit) return merge(key, hit);
    setTranscript(key, { loading: true });
    loadHistory(historyId, stamp)
      .then((messages) => {
        merge(key, messages);
        // נפתח בינתיים כסשן חי (המרוץ עם הפתיחה האוטומטית): ההיסטוריה עוברת גם אליו
        const promoted = promotedLive.get(historyId);
        if (promoted && promoted !== key) merge(promoted, messages);
      })
      .catch((e: Error) => setTranscript(key, { loading: false, loaded: true, error: selection.kind === "history" ? e.message : undefined }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyId, key, transcript?.loaded, transcript?.loading]);

  const scrollRef = useRef<HTMLDivElement>(null);
  // רק 150 הפריטים האחרונים מצוירים; היסטוריה ארוכה נטענת בלחיצה.
  // בפתיחה מציירים קודם 30 (מה שעל המסך), ואת השאר בפריים הבא, כדי שהשיחה תופיע מיד.
  const allItems = useMemo(() => groupRuns(transcript?.messages ?? []), [transcript?.messages]);
  const [showCount, setShowCount] = useState(30);
  useEffect(() => {
    if (showCount !== 30 || allItems.length <= 30) return;
    const id = requestAnimationFrame(() => setTimeout(() => setShowCount((n) => Math.max(n, 150)), 0));
    return () => cancelAnimationFrame(id);
  }, [allItems.length, showCount]);
  const hiddenCount = Math.max(0, allItems.length - showCount);
  const shownItems = useMemo(() => (hiddenCount ? allItems.slice(-showCount) : allItems), [allItems, hiddenCount, showCount]);
  const stickRef = useRef(true);
  const finder = useChatFind(scrollRef, stickRef, pane);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [transcript?.messages.length, transcript?.partialText, transcript?.pending.length, transcript?.toolRunning, showCount]);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickRef.current = gap < 80;
    setAwayFromBottom(gap > 400);
  };
  const toBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  const handleSend = async (text: string, attachments?: Attachment[]) => {
    if (selection.kind === "live") {
      send({ t: "send", liveId: selection.liveId, text, attachments });
      return;
    }
    if (!row) {
      setToast(tx("notFound"));
      return;
    }
    const liveId = await openSession({ cwd: row.cwd, provider: row.provider, resume: row.sessionId, fork: Boolean(row.external && !row.external.entrypoint.includes("sdk")), agent: agentSlug, model: pendingModel, permissionMode: pendingMode, text, attachments });
    // השיחה הקולית ממשיכה אחרי שהמסך נטען מחדש על הסשן החי
    if (voiceRef.current?.active) useStore.getState().setVoiceResume({ heard: voiceRef.current.heardNow });
    promoteToLive(key, liveId, pane);
    refreshSessions();
  };

  // פתיחת סשן מהרשימה הופכת אותו לפעיל מיד (Claude רץ ומופיע בטלפון), בלי לחכות להודעה הראשונה.
  // לא לסשן שרץ עכשיו בטרמינל/VS Code (שם זה היה פותח עותק), ולא כשכבוי בהגדרות
  const autoOpened = useRef(false);
  useEffect(() => {
    if (selection.kind !== "history" || !row || autoOpened.current || !getPrefs().autoLive) return;
    if (row.external || row.live) return;
    autoOpened.current = true;
    void openSession({ cwd: row.cwd, provider: row.provider, resume: row.sessionId, agent: agentSlug, model: pendingModel, permissionMode: pendingMode }).then((liveId) => {
      promoteToLive(key, liveId, pane);
      refreshSessions();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.kind, row?.sessionId]);

  const exportMd = () => exportChatMarkdown(title, projectVis.name, transcript?.messages ?? []);

  // פקודות / שיש להן מקבילה בממשק: מטופלות כאן ולא נשלחות ל-Claude
  const onCommand = (name: string, args: string) => runUiCommand(name, args, { cwd, agent: agentSlug, liveId: live?.liveId, setModel: setPendingModel, setMode: setPendingMode, toast: setToast });

  const setAgent = async (slug: string | null) => {
    if (!sessionId) return;
    try {
      await api.tag(sessionId, slug);
      refreshSessions();
    } catch (e) {
      setToast((e as Error).message);
    }
  };

  const saveTheme = async (t: { color: string; emoji: string; displayName: string }) => {
    if (agent) {
      await api.setTheme("agents", agent.slug, t);
      useStore.getState().setAgents(await api.agents());
    } else if (cwd) {
      await api.setTheme("projects", cwd, t);
      refreshThemes();
    }
  };

  /** רק התמונה, בלי לגעת בצבע ובשם: השרת ממזג את השדות, ו-"" מוחק. */
  const saveImage = async (image: string) => {
    if (agent) {
      await api.setTheme("agents", agent.slug, { image });
      useStore.getState().setAgents(await api.agents());
    } else if (cwd) {
      await api.setTheme("projects", cwd, { image });
      refreshThemes();
    }
  };

  const voice = useVoiceConversation(transcript, handleSend, live ? () => send({ t: "interrupt", liveId: live.liveId }) : undefined);
  const [orbHidden, setOrbHidden] = useState(false);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const voiceStart = useStore((s) => s.voiceStart);
  useEffect(() => {
    if (!voiceStart || pane !== undefined) return;
    useStore.getState().setVoiceStart(false);
    if (!voice.active) voice.toggle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceStart]);
  useEffect(() => {
    const r = useStore.getState().voiceResume;
    if (r && selection.kind === "live" && pane === undefined) {
      useStore.getState().setVoiceResume(null);
      voice.resume(r.heard);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (voice.active) setOrbHidden(false);
  }, [voice.active]);
  const state = live?.state ?? transcript?.state ?? "history";
  const busy = state === "running" || state === "starting" || state === "waiting";
  const closed = state === "closed" || state === "error";
  const placeholder = closed
    ? tx("phClosed")
      : row?.external && selection.kind === "history"
      ? tx("phExternal")
      : selection.kind === "history"
        ? tx("phHistory")
        : busy
          ? tx("phBusy")
          : tx("phIdle");
  const title = live?.title && live.title !== "המשך סשן" && live.title !== "Continue session" ? live.title : (row?.title ?? tx("session"));
  const channel = live ? tx("chMifkada") : row?.external ? (row.external.entrypoint.includes("vscode") ? "VS Code" : tx("chTerminal")) : tx("chHistory");

  return (
    <div data-chat-pane data-scheme={pane_.scheme} data-bg={sessionStyle?.background} className={cn("flex-1 min-h-0 flex flex-col relative", tiny && "pane-tiny")} style={{ ...pane_.style, "--agent-color": vis.color } as CSSProperties}>
      {voice.active && !orbHidden && (
        <Suspense fallback={null}>
        <VoiceOrb
          phase={voice.phase}
          level={voice.level}
          outLevel={voice.outLevel}
          onTapOrb={voice.interrupt}
          muted={voice.muted}
          heard={voice.heard}
          reply={voice.reply}
          color={vis.color}
          name={vis.name}
          onMute={voice.toggleMute}
          onEnd={voice.stop}
          onHide={() => setOrbHidden(true)}
        />
        </Suspense>
      )}
      <header
        className="app-drag main-header glass border-b border-border/60 px-4 py-2 flex items-center gap-3 relative z-10">
        {slot !== undefined && (
          <span
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(SESSION_DRAG, JSON.stringify({ ...selection, from: slot }));
              e.dataTransfer.effectAllowed = "move";
            }}
            className="no-drag cursor-grab active:cursor-grabbing text-muted hover:text-foreground -ms-2"
            title={tx("dragPane")}
          >
            <GripVertical className="size-4" />
          </span>
        )}
        <Avatar emoji={vis.emoji} color={vis.color} image={vis.image} size={tiny ? "sm" : "md"} square={vis.square} />
        <div className="min-w-0 flex-1">
          {editingTitle !== null ? (
            <input
              autoFocus
              value={editingTitle}
              onChange={(e) => setEditingTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitTitle();
                if (e.key === "Escape") setEditingTitle(null);
              }}
              className="no-drag w-full bg-background/70 border border-accent/50 rounded-md px-2 py-0.5 font-medium outline-none"
            />
          ) : (
            <div dir="auto" className="truncate font-medium leading-tight cursor-text w-fit max-w-full" title={tx("renameHint")} onDoubleClick={() => sessionId && setEditingTitle(title)}>
              {title}
            </div>
          )}
          <div className="flex items-center gap-2 text-[11.5px] text-muted mt-0.5 whitespace-nowrap overflow-hidden min-w-0 [&>*]:shrink-0">
            <StatusDot state={live?.state} external={row?.external?.status} />
            <span>{live ? liveStateLabel(live.state) : channel}</span>
            <span className="opacity-40">·</span>
            <span className="font-medium" style={{ color: projectVis.color }}>
              {projectVis.name}
            </span>
            {row?.gitBranch && (
              <span className="flex items-center gap-1 normal-case !shrink min-w-0">
                <GitBranch className="size-3 shrink-0" /> <span className="truncate">{row.gitBranch}</span>
              </span>
            )}
            {live && live.costUsd > 0 && <span className="tabular">${live.costUsd.toFixed(2)}</span>}
            {live && <RcLivePill url={live.remoteUrl} />}
            {live && <DeployGrantPill until={live.deployGrantUntil} onRevoke={() => send({ t: "revoke_grant", liveId: live.liveId })} />}
          </div>
        </div>

        <div className="flex items-center gap-2 relative">
          {/* כל הכלים בתפריט אחד, גם במסך מפוצל. אייג'נט, מודל ומצב נמצאים מתחת לשדה ההודעה */}
          {!compact && (
            <button onClick={toggleWorkspace} data-active={workspace} className="tool-btn !flex items-center gap-1.5 !w-auto px-2.5" title={`${tx("workspaceHint")} (⌘E)`} aria-pressed={workspace}>
              <Code2 className="size-4" />
              <span className="text-[13px] font-medium">{tx("code")}</span>
            </button>
          )}
          <div className="relative" ref={menuRef}>
            <button onClick={() => setMenuOpen((o) => !o)} data-active={menuOpen} className="tool-btn" title={tx("more")} aria-label={tx("more")}>
              <MoreHorizontal className="size-4" />
            </button>
            {menuOpen && (
              <div className="no-drag absolute top-full mt-1.5 end-0 z-40 w-60 card p-1 shadow-2xl text-[13.5px]" onClick={() => setMenuOpen(false)}>
                <MenuItem icon={ListChecks} label={tx("summary")} hint={tx("summaryHint")} disabled={!sessionId} onClick={() => { setClosing(false); setSummaryOpen(true); }} />
                {!compact && <MenuItem icon={Code2} label={workspace ? tx("closeWorkspace") : tx("workspace")} hint={tx("workspaceHint")} onClick={toggleWorkspace} />}
                <MenuItem icon={Palette} label={tx("sessionStyle")} onClick={() => { setThemeScope(sessionId ? "session" : "shared"); setStyleDraft(null); setThemeOpen(true); }} />
                <MenuItem icon={tts ? Volume2 : VolumeX} label={tts ? tx("stopReading") : tx("readAloud")} onClick={() => { if (tts) stopSpeaking(); setTts(!tts); }} />
                <MenuItem icon={Mic} label={voiceAutoSend ? tx("autoSendOn") : tx("autoSend")} hint={tx("autoSendHint")} onClick={() => setVoiceAutoSend(!voiceAutoSend)} />
                <MenuItem icon={Download} label={tx("exportMd")} disabled={!transcript?.messages.length} onClick={exportMd} />
                {live && (caps?.remote ?? claude) && <MenuItem icon={Smartphone} label={live.remoteUrl ? tx("rcOff") : tx("rcOn")} hint="Remote Control" onClick={() => send({ t: "set_remote", liveId: live.liveId, on: !live.remoteUrl })} />}
              </div>
            )}
          </div>
          {themeOpen && themeScope === "session" && sessionId && (
            <SessionThemeEditor
              initial={savedStyle ?? {}}
              inheritedColor={baseVis.color}
              scopeLabel={agent ? tx("scopeAgent", { name: baseVis.name }) : tx("scopeProject")}
              onPreview={setStyleDraft}
              onSave={async (m) => {
                const res = await api.sessionStyle(sessionId, { color: m.color ?? "", background: m.background ?? "", scheme: m.scheme ?? "" });
                const st = useStore.getState();
                const next = { ...st.sessionMeta };
                if (Object.keys(res).length) next[sessionId] = res;
                else delete next[sessionId];
                st.setSessionMeta(next);
              }}
              onClose={() => setThemeOpen(false)}
              onScope={() => {
                setStyleDraft(null);
                setThemeScope("shared");
              }}
              image={
                agent || cwd
                  ? {
                      label: agent ? baseVis.name : tx("projectNamed", { name: baseVis.name }),
                      current: baseVis.image,
                      emoji: baseVis.emoji,
                      color: baseVis.color,
                      square: !agent,
                      onChange: saveImage,
                    }
                  : undefined
              }
            />
          )}
          {themeOpen && themeScope === "shared" && (
            <ThemeEditor
              title={agent ? tx("styleOf", { name: vis.name }) : tx("styleProject", { name: vis.name })}
              initial={{ color: baseVis.color, emoji: baseVis.emoji, name: baseVis.name, image: baseVis.image }}
              onSave={saveTheme}
              onClose={() => setThemeOpen(false)}
            />
          )}

          {live && busy && (
            <button onClick={() => send({ t: "interrupt", liveId: live.liveId })} className="h-8 rounded-full bg-danger/12 text-danger hover:bg-danger/20 px-3 text-sm flex items-center gap-1.5" title={tx("stopClaude")}>
              <Square className="size-3 fill-current" /> {tx("stop")}
            </button>
          )}
          {sessionId && (
            <button
              onClick={(e) => {
                // ברירת מחדל: סגירה מיידית. ⌥ פותח את פאנל הסגירה עם סיכום ומשימות למה שנשאר
                if (e.altKey || e.shiftKey) {
                  setClosing(true);
                  setSummaryOpen(true);
                  return;
                }
                void finishSession({ archive: false });
              }}
              className={cn("size-8 rounded-full grid place-items-center transition", closing && summaryOpen ? "bg-blue/15 text-blue" : "text-muted hover:bg-surface-2 hover:text-foreground")}
              title={live ? tx("closeLive") : tx("closeHistory")}
            >
              <X className="size-4" />
            </button>
          )}
          {slot !== undefined && (
            <button
              onClick={() => {
                const st = useStore.getState();
                st.setZoomPane(st.zoomPane === slot ? null : slot);
              }}
              className="size-8 rounded-full grid place-items-center text-muted hover:bg-surface-2 hover:text-foreground transition"
              title={tx("zoom")}
            >
              <Maximize2 className="size-4" />
            </button>
          )}
          {/* במסך המחולק גם הראשי (slot 0) יוצא: החלון הבא תופס את מקומו */}
          {slot !== undefined && (
            <button onClick={() => useStore.getState().closePane(slot)} className="size-8 rounded-full grid place-items-center text-muted hover:bg-surface-2 hover:text-foreground transition" title={tx("unsplit")}>
              <PanelLeftClose className="size-4" />
            </button>
          )}
        </div>
      </header>

      <ChatFindBar f={finder} />
      <div className="flex-1 min-h-0 flex">
      <div className="flex-1 min-w-0 flex flex-col">
      <div ref={scrollRef} onScroll={onScroll} className="pane-clear flex-1 min-h-0 overflow-y-auto px-5 py-5 bg-background">
        <div className="max-w-4xl mx-auto space-y-5">
          {transcript?.loading && (
            <div className="flex items-center gap-2 text-muted text-sm">
              <Spinner className="size-4" /> {tx("loadingHistory")}
            </div>
          )}
          {hiddenCount > 0 && (
            <div className="flex justify-center">
              <button onClick={() => setShowCount((n) => n + 150)} className="btn-ghost rounded-full px-4 py-1.5 text-sm">
                {tx("showEarlier", { n: hiddenCount })}
              </button>
            </div>
          )}
          {shownItems.map((item, k, items) =>
            item.run ? (
              <ToolRunMemo key={item.run[0].uuid} msgs={item.run} who={vis} active={busy && k === items.length - 1} />
            ) : (
              <MessageViewMemo key={item.m.uuid} m={item.m} who={vis} continued={item.continued} onRewind={live && (caps?.rewind ?? claude) ? async (uuid) => (await ask(tx("rewindConfirm"), { danger: true })) && send({ t: "rewind", liveId: live.liveId, uuid }) : undefined} />
            ),
          )}
          {transcript?.partialText && (
            <div className="flex gap-3">
              <Avatar emoji={vis.emoji} color={vis.color} image={vis.image} size="sm" square={vis.square} className="mt-1" />
              <div className="min-w-0 flex-1">
                <div className="bubble-assistant px-4 py-2 max-w-[88%] w-fit">
                  <MarkdownText text={transcript.partialText} />
                </div>
              </div>
            </div>
          )}
          {transcript?.toolRunning && (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Spinner className="size-4 text-accent" /> {tx("running")} <span className="mono">{transcript.toolRunning}</span>
            </div>
          )}
          {busy && !transcript?.partialText && !transcript?.toolRunning && transcript?.pending.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Spinner className="size-4 text-accent" /> {state === "starting" ? tx("starting") : tx("thinking")}
            </div>
          )}
          {transcript?.pending.map((p) => (
            <PermissionCard key={p.requestId} req={p} onAnswer={(behavior, always, grant) => live && send({ t: "permission", liveId: live.liveId, requestId: p.requestId, behavior, always, grant })} />
          ))}
          {transcript?.error && <div className="rounded-xl border border-danger/50 bg-danger/10 px-3 py-2 text-sm">{transcript.error}</div>}
          {transcript?.lastResult && !busy && (
            <div className={cn("mono-label ltr", isRTL() ? "text-right" : "text-left", transcript.lastResult.isError && "text-danger")}>
              {transcript.lastResult.numTurns} turns · {(transcript.lastResult.durationMs / 1000).toFixed(1)}s · ${transcript.lastResult.costUsd.toFixed(3)}
            </div>
          )}
        </div>
      </div>

      {summaryOpen && sessionId && (
        <SummaryPanel
          sessionId={sessionId}
          cwd={cwd}
          agent={agentSlug}
          closing={closing}
          isLive={Boolean(live)}
          onFinish={finishSession}
          onClose={() => {
            setSummaryOpen(false);
            setClosing(false);
          }}
        />
      )}
      <div className="relative h-0">
        {awayFromBottom && (
          <button onClick={toBottom} className="absolute -top-14 left-1/2 -translate-x-1/2 z-10 size-10 rounded-full ios-toast grid place-items-center text-foreground hover:scale-105 transition" title={tx("toBottom")}>
            <ArrowDown className="size-5" />
          </button>
        )}
      </div>
      <Composer
        controls={
          <>
            <AgentSelect value={agentSlug} onChange={setAgent} disabled={!sessionId} className="mini-select" />
            {!claude && <span className="mini-select pointer-events-none">{providerLabel(provider, providers)}</span>}
            <select
              value={(live ? live.model : pendingModel) ?? ""}
              onChange={(e) => {
                const v = e.target.value || null;
                if (live) send({ t: "set_model", liveId: live.liveId, model: v });
                else setPendingModel(v);
              }}
              className="mini-select"
              title={tx("model")}
            >
              {modelOptions.map((o) => (
                <option key={o.label} value={o.value ?? ""}>
                  {o.label}
                </option>
              ))}
              {live?.model && !modelOptions.some((o) => o.value === live.model) && <option value={live.model}>{claude ? modelLabel(live.model) : live.model}</option>}
            </select>
            <select
              value={live ? live.permissionMode : pendingMode}
              onChange={(e) => {
                const v = e.target.value as PermissionMode;
                void confirmMode(v).then((ok) => {
                  if (!ok) return;
                  if (live) send({ t: "set_mode", liveId: live.liveId, mode: v });
                  else setPendingMode(v);
                });
              }}
              className="mini-select"
              data-mode={live ? live.permissionMode : pendingMode}
              title={MODE_OPTIONS.find((o) => o.value === (live ? live.permissionMode : pendingMode))?.hint}
            >
              {modeOptions.map((o) => (
                <option key={o.value} value={o.value} title={o.hint}>
                  {o.label}
                </option>
              ))}
            </select>
          </>
        }
        draftKey={sessionId ?? key} cwd={claude ? cwd || undefined : undefined} onCommand={onCommand} current={{ model: live ? live.model : pendingModel, mode: live ? live.permissionMode : pendingMode }} disabled={closed} placeholder={placeholder} onSend={handleSend} voice={{ active: voice.active, phase: voice.phase, toggle: () => (voice.active && orbHidden ? setOrbHidden(false) : voice.toggle()) }} />
      </div>
      {workspace && workCwd && !compact && (
        <ResizeHandle
          axis="x"
          onStart={() => (wsStart.current = wsRef.current?.offsetWidth ?? 600)}
          // ב-RTL סביבת העבודה משמאל לצ'אט: גרירה ימינה מרחיבה אותה. ב-LTR היא מימין, אז גרירה שמאלה מרחיבה
          onDrag={(dx) => setWsWidth(wsStart.current + (isRTL() ? dx : -dx))}
          onReset={() => setWsWidth(null)}
        />
      )}
      {workspace && workCwd && !compact && (
        <div ref={wsRef} className={cn("min-w-[320px] max-w-[calc(100%-320px)] shrink-0", wsWidth === null && "w-[52%]")} style={wsWidth === null ? undefined : { width: wsWidth }}>
          <Suspense fallback={<div className="h-full grid place-items-center text-muted text-sm">{tx("loadingWorkspace")}</div>}>
            <Workspace cwd={workCwd} />
          </Suspense>
        </div>
      )}
      </div>
    </div>
  );
}

/** שורה בתפריט "עוד" של הצ'אט */
function MenuItem({ icon: Icon, label, hint, disabled, onClick }: { icon: typeof Palette; label: string; hint?: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button disabled={disabled} onClick={onClick} className="w-full text-start rounded-lg px-2.5 py-1.5 flex items-center gap-2.5 hover:bg-[var(--color-fill)] disabled:opacity-40 disabled:pointer-events-none">
      <Icon className="size-4 text-muted shrink-0" />
      <span className="flex-1 min-w-0">
        <span className="block">{label}</span>
        {hint && <span className="block text-[11px] text-muted truncate">{hint}</span>}
      </span>
    </button>
  );
}
