import type { TranscriptMessage } from "../../../shared/protocol";

/** הודעה שכולה כלים (קריאה לכלי, תוצאה או מחשבה), בלי טקסט למשתמש */
export function isToolOnly(m: TranscriptMessage): boolean {
  if (!m.blocks.length) return false;
  if (m.role === "assistant") return m.blocks.every((b) => b.type === "tool_use" || b.type === "thinking");
  return m.blocks.every((b) => b.type === "tool_result");
}


/** מקבץ רצפים של הודעות-כלים לשורה אחת מתקפלת */
export function groupRuns(msgs: TranscriptMessage[]): Array<{ m: TranscriptMessage; continued: boolean; run?: undefined } | { run: TranscriptMessage[]; m?: undefined }> {
  const out: Array<{ m: TranscriptMessage; continued: boolean; run?: undefined } | { run: TranscriptMessage[]; m?: undefined }> = [];
  let run: TranscriptMessage[] = [];
  const flush = () => {
    if (run.length) out.push({ run });
    run = [];
  };
  for (const m of msgs) {
    if (isToolOnly(m)) {
      run.push(m);
      continue;
    }
    // טקסט של Claude שמגיע באותה הודעה עם כלים: הטקסט מוצג, הכלים שבו נכנסים לרצף
    flush();
    const prev = out[out.length - 1];
    const continued = m.role === "assistant" && Boolean(prev && (prev.run || prev.m?.role === "assistant"));
    out.push({ m, continued });
  }
  flush();
  return out;
}

/**
 * היסטוריה מהדיסק לפני ההודעות החיות, בלי כפילויות. הודעת משתמש שנשלחה ממפקדה יכולה להופיע בתמליל
 * החי ובדיסק עם uuid שונה, לכן הודעה חיה שאין לה uuid תואם בדיסק מבטלת הודעת משתמש עם אותו טקסט
 * מההיסטוריה - לכל היותר אחת, האחרונה, ורק אחרי ההודעה המשותפת האחרונה, כדי ש"כן" מוקדם יותר לא ייבלע.
 */
export function mergeHistoryMessages(live: TranscriptMessage[], history: TranscriptMessage[]): TranscriptMessage[] {
  if (!live.length) return history;
  const firstText = (m: TranscriptMessage) => (m.blocks[0]?.type === "text" ? m.blocks[0].text : null);
  const liveUuids = new Set(live.map((m) => m.uuid));
  const onDisk = new Set(history.map((m) => m.uuid));
  const unmatched = new Map<string, number>();
  for (const m of live) {
    const text = m.role === "user" && !onDisk.has(m.uuid) ? firstText(m) : null;
    if (text) unmatched.set(text, (unmatched.get(text) ?? 0) + 1);
  }
  // מה שלפני ההודעה האחרונה שמשותפת לדיסק ולחי קרה לפני הפתיחה, ולכן אינו כפילות
  let anchor = -1;
  history.forEach((m, i) => {
    if (liveUuids.has(m.uuid)) anchor = i;
  });
  const older: TranscriptMessage[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history.at(i)!;
    if (liveUuids.has(m.uuid)) continue;
    const text = m.role === "user" ? firstText(m) : null;
    const left = text ? unmatched.get(text) ?? 0 : 0;
    if (text && left > 0 && i > anchor) {
      unmatched.set(text, left - 1);
      continue;
    }
    older.unshift(m);
  }
  return [...older, ...live];
}
