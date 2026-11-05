import { useEffect, useState, lazy, Suspense } from "react";
import { useStore, transcriptKey, type ChatSel, type Selection } from "./store";
import { api } from "./api";
import { connect, openSession } from "./ws";
import { getPrefs, usePref } from "./lib/prefs";
import { applyLang, lang, onLangChange, resolveLang, strings, tr } from "./i18n";
import { dateLocale } from "./lib/util";

const S = strings({
  he: { voiceTitle: "שיחה קולית · {time}", noVoiceProject: "אין פרויקט לפתוח בו שיחה קולית", appName: "מפקדה" },
  en: { voiceTitle: "Voice chat · {time}", noVoiceProject: "No project to open a voice chat in", appName: "Mifkada" },
});
import { uniqueSplit } from "./lib/split";

/** ניווט מהתראת מערכת: #live=<id> או #session=<id> או #board */
function applyHash(): void {
  const h = location.hash.slice(1);
  if (!h) return;
  const s = useStore.getState();
  if (h === "voice") {
    // שיחה קולית: בסשן הפתוח, ואם אין אז בסשן החי האחרון או האחרון ברשימה
    const sel = s.selection;
    // ברירת מחדל: סשן חדש וקל לשיחה, באותו פרויקט. סשן ארוך וכבד מאט כל תשובה בכמה שניות
    if (getPrefs().voiceFresh) {
      const title = tr(S, "voiceTitle", { time: new Date().toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit" }) });
      // הקיצור יכול להגיע לפני שהחיבור לשרת ורשימת הסשנים עלו (חלון שרק נפתח): מחכים עד 5 שניות
      const go = (tries: number) => {
        const st = useStore.getState();
        const cur = st.selection;
        const cwd =
          (cur?.kind === "live" ? st.lives.find((l) => l.liveId === cur.liveId)?.cwd : cur?.kind === "history" ? st.sessions.find((r) => r.sessionId === cur.sessionId)?.cwd : undefined) ??
          st.sessions[0]?.cwd;
        if (!st.connected || !cwd) {
          if (tries > 0) setTimeout(() => go(tries - 1), 250);
          else st.setToast(tr(S, "noVoiceProject"));
          return;
        }
        void openSession({ cwd, title, model: getPrefs().voiceModel || null, permissionMode: getPrefs().defaultMode }).then((liveId) => {
          useStore.getState().select({ kind: "live", liveId });
          useStore.getState().setVoiceStart(true);
          refreshSessions();
        });
      };
      go(20);
      history.replaceState(null, "", location.pathname + location.search);
      return;
    }
    if (!(sel?.kind === "live" || sel?.kind === "history")) {
      const live = s.lives[0];
      const row = s.sessions[0];
      if (live) s.select({ kind: "live", liveId: live.liveId });
      else if (row) s.select({ kind: "history", sessionId: row.sessionId });
    }
    s.setVoiceStart(true);
  } else if (h === "board") s.select({ kind: "board" });
  else if (h === "new") s.select({ kind: "new" });
  else if (h === "settings") s.select({ kind: "settings" });
  else if (h === "repos") s.select({ kind: "repos" });
  else if (h === "map") s.select({ kind: "map" });
  else if (h === "extensions") s.select({ kind: "extensions" });
  else if (h === "inbox") s.select({ kind: "inbox" });
  else if (h.startsWith("live=")) s.select({ kind: "live", liveId: h.slice(5) });
  else if (h.startsWith("session=")) s.select({ kind: "history", sessionId: h.slice(8) });
  history.replaceState(null, "", location.pathname + location.search);
}
import Sidebar from "./components/Sidebar";
import ActivityBar from "./components/ActivityBar";
import StatusBar from "./components/StatusBar";
import ChatView from "./components/ChatView";
import NewSession from "./components/NewSession";
import Toast from "./components/Toast";
import Dashboard from "./components/Dashboard";
const Board = lazy(() => import("./components/Board"));
const Project = lazy(() => import("./components/Project"));
const Inbox = lazy(() => import("./components/Inbox"));
const Agents = lazy(() => import("./components/Agents"));
const Settings = lazy(() => import("./components/SettingsPage"));
const Repos = lazy(() => import("./components/Repos"));
const Extensions = lazy(() => import("./components/Extensions"));
const MapView = lazy(() => import("./components/MapView"));
const Mobile = lazy(() => import("./components/Mobile"));
import CommandPalette from "./components/CommandPalette";
import Onboarding from "./components/Onboarding";
import KeyboardHelp from "./components/KeyboardHelp";
import UpdateBanner from "./components/UpdateBanner";
import DropSplit from "./components/DropSplit";
import SplitGrid from "./components/SplitGrid";
import EditorTabs from "./components/EditorTabs";
import ErrorBoundary from "./components/ErrorBoundary";
import DialogHost from "./components/DialogHost";

/** מסך טלפון: נפתח מהקישור של "גישה מהטלפון" (?m=1) או במסך צר */
const isMobile = () => new URLSearchParams(location.search).has("m") || window.innerWidth < 640;

// אפליקציית מחשב (Electron או Tauri): מקום לכפתורי החלון ואזורי גרירה
if (navigator.userAgent.includes("Electron") || "__TAURI_INTERNALS__" in window) document.documentElement.classList.add("desktop");

/*
 * שמירת המסך הנוכחי לרענון: עדכון חם (בנייה של הממשק) או אתחול של השרת טוענים את החלון מחדש,
 * ובלי זה המסך היה קופץ ללוח הבקרה. סשן חי נשמר לפי ה-sessionId שלו, כי אחרי אתחול השרת ה-liveId כבר לא קיים.
 */
const VIEW_KEY = "mifkada.view";
type Saved = { selection: Selection; split: ChatSel[] };
function durable(sel: Selection): Selection {
  if (sel?.kind !== "live") return sel;
  const live = useStore.getState().lives.find((l) => l.liveId === sel.liveId);
  return live?.sessionId ? { kind: "history", sessionId: live.sessionId } : sel;
}
function saveView(): void {
  const s = useStore.getState();
  try {
    sessionStorage.setItem(VIEW_KEY, JSON.stringify({ selection: durable(s.selection), split: s.split.map((x) => durable(x) as ChatSel) } satisfies Saved));
  } catch {
    /* אין אחסון */
  }
}
function restoreView(): void {
  try {
    const raw = sessionStorage.getItem(VIEW_KEY);
    if (!raw) return;
    const v = JSON.parse(raw) as Saved;
    const ok = (x: Selection) => x?.kind !== "live" && x?.kind !== "new";
    // חי נשמר כהיסטורי של אותו סשן, ולכן שני חלונות (חי + היסטורי) יכלו לחזור כאותו סשן פעמיים
    const selection = ok(v.selection) ? v.selection : null;
    useStore.setState({ selection, split: uniqueSplit(selection, (v.split ?? []).filter(ok) as ChatSel[], () => undefined) });
  } catch {
    /* פגום */
  }
}
/** סשן היסטורי שיש לו עכשיו סשן חי (אחרי שהשרת עלה): עוברים לחי */
function upgradeToLive(): void {
  const s = useStore.getState();
  const fix = (x: Selection): Selection => {
    if (x?.kind !== "history") return x;
    const live = s.lives.find((l) => l.sessionId === x.sessionId);
    return live ? { kind: "live", liveId: live.liveId } : x;
  };
  const sel = fix(s.selection);
  const split = uniqueSplit(sel, s.split.map((x) => fix(x) as ChatSel), (id) => s.lives.find((l) => l.liveId === id)?.sessionId ?? undefined);
  if (sel !== s.selection || split.length !== s.split.length || split.some((x, i) => x !== s.split[i])) useStore.setState({ selection: sel, split });
}

let lastSessions = "";
export function refreshSessions(): void {
  api
    .sessions()
    .then((rows) => {
      // אותה רשימה כמו בפעם הקודמת: לא מחליפים את המערך, כדי שהסרגל והלשוניות לא יצוירו מחדש סתם
      const sig = JSON.stringify(rows);
      if (sig === lastSessions) return;
      lastSessions = sig;
      useStore.getState().setSessions(rows);
    })
    .catch(() => {});
}

/** כל 4 שניות כשהחלון גלוי. מוסתר: לא מושכים, ובחזרה מרעננים מיד */
function pollSessions(): () => void {
  const id = setInterval(() => {
    if (!document.hidden) refreshSessions();
  }, 4000);
  const onVis = () => {
    if (!document.hidden) refreshSessions();
  };
  document.addEventListener("visibilitychange", onVis);
  return () => {
    clearInterval(id);
    document.removeEventListener("visibilitychange", onVis);
  };
}

export function refreshThemes(): void {
  api
    .themes()
    .then((t) => {
      useStore.getState().setProjectThemes(t.projects);
      useStore.getState().setSessionMeta(t.sessions);
    })
    .catch(() => {});
}

/** ⌘K סשן חדש · ⌘1 ממתין לך · ⌘2 קנבן · ⌘3 אייג'נטים · ⌘4 לוח · ⌘B סיידבר */
function onGlobalKey(e: KeyboardEvent): void {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
  const s = useStore.getState();
  const inField = (e.target as HTMLElement | null)?.tagName === "TEXTAREA" || (e.target as HTMLElement | null)?.tagName === "INPUT";
  if (e.key === "k") {
    e.preventDefault();
    s.setPalette(!s.palette);
  } else if (e.key === "/") {
    e.preventDefault();
    s.setHelp(!s.help);
  } else if (e.key === "n" && !e.shiftKey) {
    e.preventDefault();
    s.select({ kind: "new" });
  } else if (e.key === ",") {
    e.preventDefault();
    s.select({ kind: "settings" });
  } else if (e.key === "b" && !inField) {
    e.preventDefault();
    s.toggleSidebar();
  } else if (["1", "2", "3", "4", "5", "6"].includes(e.key) && !e.shiftKey) {
    e.preventDefault();
    s.select(e.key === "1" ? { kind: "inbox" } : e.key === "2" ? { kind: "board" } : e.key === "3" ? { kind: "agents" } : e.key === "4" ? { kind: "repos" } : e.key === "5" ? { kind: "extensions" } : e.key === "6" ? { kind: "map" } : null);
  }
}

export default function App() {
  const selection = useStore((s) => s.selection);
  const sidebarHidden = useStore((s) => s.sidebarHidden);
  const split = useStore((s) => s.split);
  const skin = usePref("skin");

  useEffect(() => {
    restoreView();
    const unsub = useStore.subscribe((st, prev) => {
      if (st.selection !== prev.selection || st.split !== prev.split) saveView();
      if (st.lives !== prev.lives) upgradeToLive();
    });
    window.addEventListener("beforeunload", saveView);
    // כותרת החלון: כמה דברים מחכים (אישורים + סשנים שסיימו)
    const unsubTitle = useStore.subscribe((st) => {
      const n = st.lives.reduce((k, l) => k + l.pendingPermissions, 0) + Object.keys(st.unread).length;
      const t = n ? `${tr(S, "appName")} (${n})` : tr(S, "appName");
      if (document.title !== t) document.title = t;
    });
    connect();
    api.agents().then(useStore.getState().setAgents).catch(() => {});
    api
      .settings()
      .then((s) => {
        useStore.getState().setSystemPrefs(s.system);
        applyLang(resolveLang(s.system.lang));
      })
      .catch(() => {});
    refreshThemes();
    refreshSessions();
    api.routines().then(useStore.getState().setRoutines).catch(() => {});
    api
      .tasks()
      .then((r) => useStore.getState().setTasks(r.tasks, r.settings))
      .catch(() => {});
    const stopPoll = pollSessions();
    applyHash();
    window.addEventListener("hashchange", applyHash);
    window.addEventListener("keydown", onGlobalKey);
    return () => {
      unsub();
      unsubTitle();
      window.removeEventListener("beforeunload", saveView);
      stopPoll();
      window.removeEventListener("hashchange", applyHash);
      window.removeEventListener("keydown", onGlobalKey);
    };
  }, []);

  // החלפת שפה: בונים את כל העץ מחדש, כך שכל מחרוזת (גם מחוץ ל-useT) מתעדכנת
  const [langKey, setLangKey] = useState(lang());
  useEffect(() => onLangChange(setLangKey), []);
  const [mobile, setMobile] = useState(isMobile);
  useEffect(() => {
    const on = () => setMobile(isMobile());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  if (mobile)
    return (
      <Suspense key={langKey} fallback={null}>
        <Mobile />
      </Suspense>
    );

  return (
    <div key={langKey} className="h-full flex overflow-hidden">
      <ActivityBar />
      {!sidebarHidden && <Sidebar />}
      <main className="flex-1 min-w-0 flex flex-col">
        {skin === "ide" && <EditorTabs />}
        <div className="flex-1 min-h-0 flex flex-col relative">
        <DropSplit />
        <ErrorBoundary resetKey={JSON.stringify(selection)}>
        <Suspense fallback={null}>
        {selection?.kind === "new" ? (
          <NewSession />
        ) : selection?.kind === "board" ? (
          <Board />
        ) : selection?.kind === "project" ? (
          <Project key={selection.cwd} cwd={selection.cwd} />
        ) : selection?.kind === "inbox" ? (
          <Inbox />
        ) : selection?.kind === "agents" ? (
          <Agents />
        ) : selection?.kind === "settings" ? (
          <Settings />
        ) : selection?.kind === "repos" ? (
          <Repos />
        ) : selection?.kind === "map" ? (
          <MapView />
        ) : selection?.kind === "extensions" ? (
          <Extensions />
        ) : selection ? (
          split.length ? (
            <SplitGrid main={selection as Extract<typeof selection, { kind: "live" } | { kind: "history" }>} />
          ) : (
            <ChatView key={transcriptKey(selection) ?? ""} selection={selection as Extract<typeof selection, { kind: "live" } | { kind: "history" }>} />
          )
        ) : (
          <Dashboard />
        )}
        </Suspense>
        </ErrorBoundary>
        </div>
        <StatusBar />
      </main>
      <CommandPalette />
      <Onboarding />
      <KeyboardHelp />
      <UpdateBanner />
      <Toast />
      <DialogHost />
    </div>
  );
}
