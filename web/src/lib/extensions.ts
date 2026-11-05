/** פקודה בשורה אחת → פקודה וארגומנטים. מכבד מירכאות ("a b" או 'a b'), בלי הרחבות של shell */
export function splitCommand(line: string): { command: string; args: string[] } {
  const parts: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let has = false;
  for (const ch of line.trim()) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) parts.push(cur);
      cur = "";
      has = false;
    } else {
      cur += ch;
      has = true;
    }
  }
  if (has || cur) parts.push(cur);
  return { command: parts[0] ?? "", args: parts.slice(1) };
}

/** שורות "KEY=value" (משתני סביבה) או "Name: value" (כותרות HTTP) → אובייקט. שורות ריקות ו-# מדולגות */
export function parsePairs(text: string, sep: "=" | ":"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf(sep);
    if (i <= 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

/** "name@marketplace" → השם בלבד, לתצוגה */
export const pluginName = (id: string) => id.split("@")[0];

/** חיפוש בפלאגינים: כל מילה צריכה להופיע בשם, בתיאור או ב-marketplace */
export function matchPlugin(p: { name: string; description: string; marketplace: string }, q: string): boolean {
  const hay = `${p.name} ${p.description} ${p.marketplace}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}
