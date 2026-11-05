import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR } from "./paths.js";
import { serverLang } from "./i18n.js";

export interface Template {
  id: string;
  name: string;
  title: string;
  prompt: string;
  agent: string | null;
  permissionMode: string;
  isolate: boolean;
}

const FILE = path.join(DATA_DIR, "templates.json");

/** תבניות התחלתיות כלליות. אפשר לערוך, למחוק ולהוסיף משלך. נזרעות פעם אחת, בשפת הממשק באותו רגע. */
const seed = (): Omit<Template, "id">[] =>
  serverLang() === "he"
    ? [
        { name: "סקירת קוד", title: "סקירה: {מה}", prompt: "סקור את {מה}: באגים, מקרי קצה, אבטחה וקוד שאפשר לפשט. אל תשנה קבצים. סכם לפי חומרה.", agent: null, permissionMode: "plan", isolate: false },
        { name: "בדיקה לפני פריסה", title: "בדיקה לפני פריסה", prompt: "לפני פריסה: הרץ typecheck, lint ו-build, עבור על ה-diff מול main וחפש באגים, סודות שדלפו ובעיות RTL. אל תפרוס. סכם מה מצאת ומה צריך לתקן.", agent: null, permissionMode: "plan", isolate: false },
        { name: "כתיבת בדיקות", title: "בדיקות ל-{מה}", prompt: "כתוב בדיקות ל-{מה} לפי סגנון הבדיקות שכבר יש בפרויקט, הרץ אותן ותקן רק את הבדיקות (לא את הקוד) אם הן נכשלות בגלל טעות בבדיקה. סכם מה נבדק ומה נמצא.", agent: null, permissionMode: "acceptEdits", isolate: true },
        { name: "תיקון באג", title: "באג: {תיאור}", prompt: "יש באג: {תיאור}\n\nמצא את הסיבה, תקן אותה עם השינוי הקטן ביותר, ובדוק שהתיקון עובד (typecheck ובדיקה ידנית או בדיקה אוטומטית). אל תעשה קומיט.", agent: null, permissionMode: "acceptEdits", isolate: true },
      ]
    : [
        { name: "Code review", title: "Review: {what}", prompt: "Review {what}: bugs, edge cases, security, and code that could be simpler. Don't change files. Summarize by severity.", agent: null, permissionMode: "plan", isolate: false },
        { name: "Pre-deploy check", title: "Pre-deploy check", prompt: "Before deploying: run typecheck, lint and build, go over the diff against main and look for bugs, leaked secrets and RTL issues. Don't deploy. Summarize what you found and what needs fixing.", agent: null, permissionMode: "plan", isolate: false },
        { name: "Write tests", title: "Tests for {what}", prompt: "Write tests for {what} following the test style already in the project, run them, and fix only the tests (not the code) if they fail because of a mistake in the test. Summarize what was tested and what was found.", agent: null, permissionMode: "acceptEdits", isolate: true },
        { name: "Fix a bug", title: "Bug: {description}", prompt: "There's a bug: {description}\n\nFind the cause, fix it with the smallest change, and check that the fix works (typecheck and a manual or automated test). Don't commit.", agent: null, permissionMode: "acceptEdits", isolate: true },
    ];

async function readAll(): Promise<Template[]> {
  try {
    return (JSON.parse(await fs.readFile(FILE, "utf8")) as { templates?: Template[] }).templates ?? [];
  } catch {
    const seeded = seed().map((t) => ({ ...t, id: randomUUID() }));
    await writeAll(seeded);
    return seeded;
  }
}

async function writeAll(list: Template[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify({ templates: list }, null, 2));
}

export async function listTemplates(): Promise<Template[]> {
  return readAll();
}

export async function saveTemplate(t: Partial<Template> & { name: string; prompt: string }): Promise<Template[]> {
  const all = await readAll();
  const item: Template = {
    id: t.id ?? randomUUID(),
    name: t.name.trim().slice(0, 60),
    title: (t.title ?? t.name).slice(0, 120),
    prompt: t.prompt.slice(0, 20000),
    agent: t.agent ?? null,
    permissionMode: t.permissionMode ?? "default",
    isolate: Boolean(t.isolate),
  };
  const next = all.some((x) => x.id === item.id) ? all.map((x) => (x.id === item.id ? item : x)) : [...all, item];
  await writeAll(next);
  return next;
}

export async function deleteTemplate(id: string): Promise<Template[]> {
  const next = (await readAll()).filter((t) => t.id !== id);
  await writeAll(next);
  return next;
}
