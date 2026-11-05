import type { ClientMsg, OpenRequest, ServerMsg } from "../../shared/protocol";
import { useStore } from "./store";
import { pick } from "./i18n";
import { openSocket, SOCKET_OPEN } from "./lib/socket";
import { speakToolHint, enqueueSpeech } from "./lib/speech";
import { feedStream, flushStream, resetStream } from "./lib/streamSpeech";

let socket: WebSocket | null = null;
let retry = 0;
const waiting = new Map<string, { resolve: (liveId: string) => void; reject: (e: Error) => void }>();
/** סשנים חיים שהחלון הזה רשום אליהם. רק מה שמוצג: סשן שלא על המסך לא שולח טוקנים לחלון, והשרת יכול לסגור אותו כשהוא לא בשימוש */
const attached = new Set<string>();
/** סשנים שמוחזקים בלי להיות ב-selection (למשל במסך הטלפון) */
const held = new Map<string, number>();

function displayed(): Set<string> {
  const s = useStore.getState();
  const out = new Set<string>(held.keys());
  for (const x of [s.selection, ...s.split]) if (x?.kind === "live") out.add(x.liveId);
  return out;
}

/** רישום לכל סשן חי שמוצג וביטול הרישום לכל השאר. נקרא בכל שינוי של המסך ושל רשימת החיים */
export function syncAttached(): void {
  if (!socket || socket.readyState !== SOCKET_OPEN) return;
  const want = displayed();
  const alive = new Set(useStore.getState().lives.map((l) => l.liveId));
  for (const id of want) {
    if (attached.has(id) || !alive.has(id)) continue;
    attached.add(id);
    socket.send(JSON.stringify({ t: "attach", liveId: id } satisfies ClientMsg));
  }
  for (const id of [...attached]) {
    if (want.has(id)) continue;
    attached.delete(id);
    if (alive.has(id)) socket.send(JSON.stringify({ t: "detach", liveId: id } satisfies ClientMsg));
  }
}

/** להחזיק סשן חי רשום גם כשהוא לא בבחירה הראשית. מחזיר שחרור */
export function holdLive(liveId: string): () => void {
  held.set(liveId, (held.get(liveId) ?? 0) + 1);
  syncAttached();
  return () => {
    const n = (held.get(liveId) ?? 1) - 1;
    if (n > 0) held.set(liveId, n);
    else held.delete(liveId);
    syncAttached();
  };
}

// טוקנים בזרימה מגיעים עשרות בשנייה. מאחדים אותם לעדכון אחד כל 100ms (שנייה כשהחלון מוסתר),
// אחרת כל טוקן מפרסר מחדש את כל ה-markdown של התשובה ומצייר את הצ'אט
const deltas = new Map<string, string>();
let deltaTimer: ReturnType<typeof setTimeout> | null = null;
function flushDeltas(): void {
  if (deltaTimer) clearTimeout(deltaTimer);
  deltaTimer = null;
  if (!deltas.size) return;
  const s = useStore.getState();
  for (const [liveId, text] of deltas) s.applyEvent(liveId, { kind: "text_delta", text });
  deltas.clear();
}
function queueDelta(liveId: string, text: string): void {
  deltas.set(liveId, (deltas.get(liveId) ?? "") + text);
  if (!deltaTimer) deltaTimer = setTimeout(flushDeltas, document.hidden ? 1000 : 100);
}

export function connect(): void {
  const ws = openSocket("/ws");
  socket = ws;
  ws.onopen = () => {
    retry = 0;
    useStore.getState().setConnected(true);
    // חיבור מחדש: להירשם שוב לסשנים שמוצגים
    attached.clear();
    syncAttached();
  };
  ws.onmessage = (ev) => {
    let m: ServerMsg;
    try {
      m = JSON.parse(ev.data as string) as ServerMsg;
    } catch {
      return;
    }
    handle(m);
  };
  ws.onclose = () => {
    useStore.getState().setConnected(false);
    socket = null;
    retry = Math.min(retry + 1, 6);
    setTimeout(connect, 500 * retry);
  };
}

export function send(m: ClientMsg): void {
  if (!socket || socket.readyState !== SOCKET_OPEN) {
    useStore.getState().setToast(pick("אין חיבור לשרת של מפקדה", "No connection to the Mifkada server"));
    return;
  }
  socket.send(JSON.stringify(m));
}

export function openSession(req: OpenRequest): Promise<string> {
  const ref = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    waiting.set(ref, { resolve, reject });
    send({ t: "open", ref, ...req });
  });
}

let livesTimer: ReturnType<typeof setTimeout> | null = null;

function handle(m: ServerMsg): void {
  const s = useStore.getState();
  switch (m.t) {
    case "opened":
      // השרת רושם את מי שפתח את הסשן
      attached.add(m.liveId);
      waiting.get(m.ref)?.resolve(m.liveId);
      waiting.delete(m.ref);
      return;
    case "snapshot":
      deltas.delete(m.liveId);
      s.applySnapshot(m.liveId, m.info, m.events, m.partialText);
      return;
    case "event":
      if (m.event.kind === "text_delta") queueDelta(m.liveId, m.event.text);
      else {
        flushDeltas();
        s.applyEvent(m.liveId, m.event);
      }
      // מצב קול (רמקול דלוק או שיחה קולית), בסשן הפתוח: מקריאים תוך כדי כתיבה, משפט אחרי משפט
      if ((s.tts || s.voiceMode) && s.selection?.kind === "live" && s.selection.liveId === m.liveId) {
        const e = m.event;
        if (e.kind === "text_delta") feedStream(m.liveId, e.text);
        else if (e.kind === "tool_start") {
          flushStream(m.liveId, false);
          if (s.voiceMode) speakToolHint(e.name);
        }
        else if (e.kind === "message" && e.message.role === "assistant") {
          // אם ההודעה כבר הוקראה בזרימה, רק משלימים את הסוף. אחרת (בלי זרימה) מקריאים את כולה
          if (!flushStream(m.liveId)) {
            const text = e.message.blocks.filter((b) => b.type === "text").map((b) => (b.type === "text" ? b.text : "")).join("\n");
            if (text) enqueueSpeech(text);
          }
        }
      } else if (m.event.kind === "message") resetStream(m.liveId);
      return;
    case "lives":
      s.setLives(m.lives);
      syncAttached();
      // סשן נפתח או נסגר: הרשימה מתעדכנת מיד, לא בסבב הבא של כל 4 שניות
      if (livesTimer) clearTimeout(livesTimer);
      livesTimer = setTimeout(() => void import("./App").then((mod) => mod.refreshSessions()), 150);
      return;
    case "tasks":
      s.setTasks(m.tasks, m.settings);
      return;
    case "error":
      // פתיחה שנכשלה (ספק כבוי, פקודה חסרה): מי שמחכה לסשן מקבל שגיאה במקום לחכות לנצח
      if (m.ref && waiting.has(m.ref)) {
        waiting.get(m.ref)!.reject(new Error(m.message));
        waiting.delete(m.ref);
      }
      s.setToast(m.message);
      return;
    case "routines":
      s.setRoutines(m.routines);
      return;
    case "toast":
      s.setToast(m.message);
      return;
  }
}

// מה שמוצג השתנה (בחירה, מסך מפוצל): לעדכן את הרישום
useStore.subscribe((st, prev) => {
  if (st.selection !== prev.selection || st.split !== prev.split) syncAttached();
});
