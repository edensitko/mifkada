import { timingSafeEqual } from "node:crypto";
import type { Readable } from "node:stream";

/**
 * הערוץ המוגן לחלון של מפקדה. כל תהליך מקומי (גם סוכן עם Bash) יכול לדבר עם ה-daemon דרך השקע, ולכן
 * אישור שמשנה פרוד מתקבל רק מלקוח שמביא את הסוד הזה.
 *
 * הסוד נוצר בתהליך הראשי של Electron בכל הפעלה ומגיע ל-daemon בהודעה של utilityProcess (process.parentPort),
 * לא במשתנה סביבה (סביבה של תהליך אפשר לקרוא עם ps -E). ה-main מוסיף אותו ככותרת לכל בקשה ו-WebSocket שיוצאים
 * מהחלון (proxyToDaemon, net:open), ולכן הדף עצמו לא צריך להכיר אותו.
 * ב-Tauri (desktop-tauri/src/daemon.rs) הסוד נכתב כשורה `ui-secret <hex>` ל-stdin של השרת (צינור מהמעטפת, שאף תהליך
 * ילד לא יורש), ו-MIFKADA_UI_SECRET_STDIN=1 אומר לקרוא אותו משם. הדגל עצמו לא סודי.
 * MIFKADA_UI_SECRET במשתנה סביבה: רק לבדיקות (npm run e2e), בלי Electron. נמחק מהסביבה מיד, כדי שתהליכי ילד לא יירשו.
 * בלי סוד (פיתוח בדפדפן, npm run dev): אין לקוח מוגן, ואישור פריסה אפשרי רק מהאפליקציה.
 */
export const UI_HEADER = "x-mifkada-ui";

let secret: string | null = process.env.MIFKADA_UI_SECRET && process.env.MIFKADA_UI_SECRET.length >= 32 ? process.env.MIFKADA_UI_SECRET : null;
delete process.env.MIFKADA_UI_SECRET;

const SECRET_RE = /^[0-9a-f]{64}$/;

function setSecret(s: string): void {
  secret = s;
  console.log("[ui] ערוץ מוגן לחלון פעיל");
}

/**
 * קורא מ-stdin את השורה `ui-secret <64 hex>` (רק הראשונה שתקינה) ומפסיק להקשיב. לא מרוקן ולא עוצר את הזרם:
 * index.ts מקשיב לו לסוף קלט (המעטפת מתה). עד 4KB, כדי שזרם בלי שורה כזו לא יצבור זיכרון.
 */
export function readSecretFrom(stream: Readable): void {
  let buf = "";
  const onData = (chunk: Buffer | string) => {
    buf += chunk.toString();
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      const m = /^ui-secret ([0-9a-f]{64})$/.exec(line);
      if (m) {
        stream.off("data", onData);
        setSecret(m[1]);
        return;
      }
    }
    if (buf.length > 4096) stream.off("data", onData);
  };
  stream.on("data", onData);
}

// הדגל נמחק מהסביבה מיד: סשנים של Claude שה-daemon פותח יורשים את process.env, ותהליך Node שהיה רץ מתוך
// סשן כזה (בדיקות, שרת בדיקה) היה מחכה לסוד ב-stdin ולא יוצא לעולם
const SECRET_FROM_STDIN = process.env.MIFKADA_UI_SECRET_STDIN === "1";
delete process.env.MIFKADA_UI_SECRET_STDIN;
if (SECRET_FROM_STDIN) readSecretFrom(process.stdin);

const parentPort = (process as unknown as { parentPort?: { on: (ev: "message", cb: (e: { data: unknown }) => void) => void } }).parentPort;
parentPort?.on("message", (e) => {
  const d = e.data as { t?: string; secret?: string } | null;
  if (d?.t === "ui-secret" && typeof d.secret === "string" && SECRET_RE.test(d.secret)) setSecret(d.secret);
});

export function hasUiSecret(): boolean {
  return secret !== null;
}

export function isTrustedUi(headers: Record<string, string | string[] | undefined>): boolean {
  const got = headers[UI_HEADER];
  if (!secret || typeof got !== "string") return false;
  const a = Buffer.from(got);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
