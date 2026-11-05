import { enqueueSpeech } from "./speech";
import { strings, tr } from "../i18n";

const S = strings({
  he: { code: "יש כאן קוד.", table: "יש כאן טבלה." },
  en: { code: "There's some code here.", table: "There's a table here." },
});

/**
 * הקראה תוך כדי כתיבה: הטקסט שזורם מ-Claude נאסף, וכל משפט שהושלם (נקודה, ?, !, נקודתיים או ירידת שורה)
 * נכנס לתור ההקראה מיד, בזמן שהמשפט הבא עוד נכתב. בלוקי קוד ושורות טבלה מדולגים.
 */
interface State {
  buf: string;
  inCode: boolean;
  saidCode: boolean;
  saidTable: boolean;
}

const states = new Map<string, State>();
const BOUNDARY = /[.!?…:](?=\s)|\n/;

function emit(st: State, segment: string): void {
  const line = segment.trim();
  if (!line) return;
  if (line.startsWith("```")) {
    st.inCode = !st.inCode;
    if (st.inCode && !st.saidCode) {
      st.saidCode = true;
      enqueueSpeech(tr(S, "code"));
    }
    return;
  }
  if (st.inCode) return;
  if (line.startsWith("|")) {
    if (!st.saidTable) {
      st.saidTable = true;
      enqueueSpeech(tr(S, "table"));
    }
    return;
  }
  st.saidTable = false;
  if (/[\p{L}\p{N}]/u.test(line)) enqueueSpeech(line);
}

/** מוסיף טקסט שזרם, ומקריא כל משפט שהושלם. */
export function feedStream(key: string, text: string): void {
  const st = states.get(key) ?? { buf: "", inCode: false, saidCode: false, saidTable: false };
  states.set(key, st);
  st.buf += text;
  for (;;) {
    const m = BOUNDARY.exec(st.buf);
    if (!m) break;
    const end = m.index + m[0].length;
    emit(st, st.buf.slice(0, end));
    st.buf = st.buf.slice(end);
  }
}

/** סוף הודעה או מעבר לכלי: מקריא את מה שנשאר. מחזיר true אם ההודעה הוקראה בזרימה. */
export function flushStream(key: string, endOfMessage = true): boolean {
  const st = states.get(key);
  if (!st) return false;
  if (st.buf.trim()) emit(st, st.buf);
  st.buf = "";
  if (endOfMessage) states.delete(key);
  return true;
}

export function resetStream(key: string): void {
  states.delete(key);
}
