import type { TranscriptMessage } from "../../../shared/protocol";
import { api } from "../api";

/*
 * תמלילים מהדיסק, שמורים בזיכרון של החלון. הקריאה בשרת מהירה (כ-0.1 שנייה גם לסשן של 37MB,
 * נמדד 23/10), אבל בלי מטמון כל פתיחה חיכתה לה מחדש, ובפתיחה עם סשן חי היא גם הפסידה במרוץ
 * (ראו mergeHistory ב-store). כאן: טעינה אחת לכל סשן, טעינה מראש במעבר עכבר, ושמירה של האחרונים.
 *
 * תקף כל עוד lastModified של הסשן לא התקדם: סשן שהמשיך לרוץ בטרמינל נטען מחדש.
 */
const MAX = 12;
const cache = new Map<string, { stamp: number; messages: TranscriptMessage[] }>();
const inflight = new Map<string, Promise<TranscriptMessage[]>>();

export function cachedHistory(sessionId: string, stamp = 0): TranscriptMessage[] | null {
  const hit = cache.get(sessionId);
  if (!hit || hit.stamp < stamp) return null;
  // LRU: השימוש האחרון עובר לסוף
  cache.delete(sessionId);
  cache.set(sessionId, hit);
  return hit.messages;
}

export function loadHistory(sessionId: string, stamp = 0): Promise<TranscriptMessage[]> {
  const hit = cachedHistory(sessionId, stamp);
  if (hit) return Promise.resolve(hit);
  const running = inflight.get(sessionId);
  if (running) return running;
  const p = api
    .transcript(sessionId)
    .then((messages) => {
      cache.set(sessionId, { stamp: Math.max(stamp, Date.now()), messages });
      while (cache.size > MAX) cache.delete(cache.keys().next().value as string);
      return messages;
    })
    .finally(() => inflight.delete(sessionId));
  inflight.set(sessionId, p);
  return p;
}

export function prefetchHistory(sessionId: string, stamp = 0): void {
  loadHistory(sessionId, stamp).catch(() => {
    /* טעינה מראש בלבד */
  });
}
