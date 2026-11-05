import type { IncomingHttpHeaders } from "node:http";

/**
 * הגנה מאתרים זרים: השרת מאזין על 127.0.0.1, אבל כל דף שפתוח בדפדפן יכול לשלוח אליו בקשות,
 * ו-WebSocket בכלל לא מוגן ב-CORS. בלי הבדיקה הזו אתר זר יכול לפתוח סשן ולהריץ פקודות במחשב.
 *  - Host חייב להיות localhost / 127.0.0.1 (חוסם DNS rebinding: דומיין זר שמצביע ל-127.0.0.1)
 *  - Origin, אם נשלח, חייב להיות מפקדה עצמה (השרת או שרת הפיתוח של הממשק)
 *  - Sec-Fetch-Site: cross-site נחסם תמיד
 * בקשה בלי Origin (תהליך מקומי: Electron, curl, סקריפטים) מותרת: תהליך מקומי כבר יכול לעשות הכול במחשב.
 */
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function allowedPorts(): Set<string> {
  return new Set([String(process.env.MIFKADA_PORT ?? 4777), String(process.env.MIFKADA_WEB_PORT ?? 4778)]);
}

export function isAllowedRequest(h: Pick<IncomingHttpHeaders, "host" | "origin"> & { "sec-fetch-site"?: string | string[] }, ports = allowedPorts()): boolean {
  const host = String(h.host ?? "");
  const hostName = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  if (host && !LOCAL_HOSTS.has(hostName)) return false;
  if (String(h["sec-fetch-site"] ?? "") === "cross-site") return false;
  const origin = h.origin;
  if (origin === undefined || origin === "") return true;
  try {
    const u = new URL(String(origin));
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    return (u.protocol === "http:" || u.protocol === "ws:") && LOCAL_HOSTS.has(u.hostname) && ports.has(port);
  } catch {
    return false; // כולל Origin: null (iframe בארגז חול, קובץ מקומי)
  }
}

/* ---------- שכבה שנייה: טוקן לדפדפן ---------- */

import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./paths.js";

/** טוקן אקראי חדש בכל הפעלה של השרת. נמסר רק בעוגייה HttpOnly + SameSite=Strict בטעינת הדף הראשי */
export const BROWSER_TOKEN = loadToken();

/** נשמר בתיקיית הנתונים (הרשאות 600), כדי שהפעלה מחדש של השרת לא תנתק חלון פתוח */
function loadToken(): string {
  const file = path.join(DATA_DIR, ".browser-token");
  try {
    const t = fs.readFileSync(file, "utf8").trim();
    if (/^[0-9a-f]{64}$/.test(t)) return t;
  } catch {
    /* אין עדיין */
  }
  const t = randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, t, { mode: 0o600 });
  } catch {
    /* בלי שמירה: טוקן לזמן הריצה בלבד */
  }
  return t;
}
export const TOKEN_COOKIE = "mifkada_t";

function cookieValue(cookieHeader: string | undefined, name: string): string {
  for (const part of (cookieHeader ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return "";
}

/**
 * בקשה מדפדפן (יש לה Origin או Sec-Fetch-Site) חייבת להביא את העוגייה. כך גם אם בדיקת ה-Origin תיפרץ,
 * דף זר עדיין לא יכול לדבר עם השרת: הוא לא יכול לקרוא את העוגייה, והדפדפן לא שולח אותה לבקשה חוצת-אתרים.
 * תהליך מקומי (Electron main, curl) לא שולח את הכותרות האלה ועובר רק בבדיקת ה-Host.
 */
export function hasBrowserToken(h: { origin?: string; cookie?: string; "sec-fetch-site"?: string | string[] }): boolean {
  const fromBrowser = Boolean(h.origin) || Boolean(h["sec-fetch-site"]);
  if (!fromBrowser) return true;
  const got = Buffer.from(cookieValue(h.cookie, TOKEN_COOKIE));
  const want = Buffer.from(BROWSER_TOKEN);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** כותרות אבטחה לכל תשובה: בלי הטמעה בדפים זרים, בלי סקריפטים חיצוניים, בלי ניחוש סוג קובץ */
export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob: data:",
    // באפליקציה (שקע מקומי) ה-WebSocket עובר דרך הגשר של Electron, אז הדף לא מתחבר לשום כתובת רשת
    process.env.MIFKADA_SOCKET ? "connect-src 'self'" : "connect-src 'self' ws://127.0.0.1:* ws://localhost:*",
    "worker-src 'self' blob:",
    "frame-src http://localhost:* http://127.0.0.1:*",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; "),
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), geolocation=(), usb=(), payment=()",
};
