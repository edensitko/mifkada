import { create } from "zustand";
import type { ChatSel } from "../store";

/**
 * כרטיסיות של שיחות פתוחות, כמו קבצים פתוחים ב-IDE. כל שיחה שנבחרת נכנסת לשורה ונשארת עד שסוגרים אותה.
 * נשמר ב-localStorage כהיסטוריה (sessionId): סשן חי לא שורד הפעלה מחדש, ואז נפתח מהתמליל.
 */
export interface Tab {
  sel: ChatSel;
  /** ה-sessionId של סשן חי, ברגע שידוע: כשהוא נסגר הכרטיסייה הופכת להיסטוריה במקום להיעלם */
  sessionId?: string;
}

const KEY = "mifkada.tabs";
/** סשנים חיים שכבר הופיעו ברשימה מהשרת. סשן חדש נבחר לפני שהרשימה מגיעה, ואסור לסגור לו את הכרטיסייה בגלל זה */
const knownLives = new Set<string>();
const MAX = 14;

function load(): Tab[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as Tab[];
    return raw.flatMap((t) => (t.sel.kind === "history" ? [t] : t.sessionId ? [{ sel: { kind: "history" as const, sessionId: t.sessionId } }] : []));
  } catch {
    return [];
  }
}

function save(tabs: Tab[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(tabs));
  } catch {
    /* אין אחסון */
  }
}

/** מזהה יציב לכרטיסייה: ה-sessionId אם ידוע, אחרת ה-liveId */
export function tabId(t: Tab): string {
  return t.sel.kind === "history" ? t.sel.sessionId : (t.sessionId ?? `live:${t.sel.liveId}`);
}

interface TabsState {
  tabs: Tab[];
  /** מוסיף או מעדכן (סשן היסטורי שהפך לחי מחליף את הכרטיסייה שלו באותו מקום) */
  touch: (sel: ChatSel, sessionId?: string) => void;
  close: (id: string) => void;
  closeOthers: (id: string) => void;
  closeAll: () => void;
  /** סידור מחדש בגרירה: הכרטיסייה id עוברת למקום של before (או לסוף) */
  move: (id: string, before: string | null) => void;
  /** מתקן כרטיסיות של סשנים חיים: מקבל sessionId, או הופך להיסטוריה כשהסשן נסגר */
  sync: (lives: Array<{ liveId: string; sessionId: string | null }>) => void;
}

export const useTabs = create<TabsState>((set, get) => ({
  tabs: load(),
  touch: (sel, sessionId) => {
    const t: Tab = { sel, sessionId: sel.kind === "history" ? sel.sessionId : sessionId };
    const id = tabId(t);
    const tabs = [...get().tabs];
    // אותה שיחה כבר פתוחה (לפי sessionId או liveId)
    const i = tabs.findIndex((x) => tabId(x) === id || (sel.kind === "live" && x.sel.kind === "live" && x.sel.liveId === sel.liveId));
    if (i >= 0) {
      if (JSON.stringify(tabs[i]) === JSON.stringify(t)) return;
      tabs[i] = t;
    } else {
      tabs.push(t);
      if (tabs.length > MAX) tabs.shift();
    }
    save(tabs);
    set({ tabs });
  },
  close: (id) => {
    const tabs = get().tabs.filter((x) => tabId(x) !== id);
    save(tabs);
    set({ tabs });
  },
  closeOthers: (id) => {
    const tabs = get().tabs.filter((x) => tabId(x) === id);
    save(tabs);
    set({ tabs });
  },
  closeAll: () => {
    save([]);
    set({ tabs: [] });
  },
  move: (id, before) => {
    if (id === before) return;
    const cur = get().tabs;
    const t = cur.find((x) => tabId(x) === id);
    if (!t) return;
    const rest = cur.filter((x) => x !== t);
    const i = before ? rest.findIndex((x) => tabId(x) === before) : -1;
    const tabs = i < 0 ? [...rest, t] : [...rest.slice(0, i), t, ...rest.slice(i)];
    save(tabs);
    set({ tabs });
  },
  sync: (lives) => {
    for (const l of lives) knownLives.add(l.liveId);
    let changed = false;
    const seen = new Set<string>();
    const tabs: Tab[] = [];
    for (const t of get().tabs) {
      let next = t;
      if (t.sel.kind === "live") {
        const live = lives.find((l) => t.sel.kind === "live" && l.liveId === t.sel.liveId);
        if (live?.sessionId && live.sessionId !== t.sessionId) next = { ...t, sessionId: live.sessionId };
        else if (!live && knownLives.has(t.sel.liveId)) next = t.sessionId ? { sel: { kind: "history", sessionId: t.sessionId }, sessionId: t.sessionId } : (null as unknown as Tab);
      }
      if (next !== t) changed = true;
      if (!next) continue;
      const id = tabId(next);
      if (seen.has(id)) {
        changed = true;
        continue;
      }
      seen.add(id);
      tabs.push(next);
    }
    if (!changed) return;
    save(tabs);
    set({ tabs });
  },
}));
