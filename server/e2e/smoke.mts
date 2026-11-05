/**
 * בדיקת קצה-לקצה: שרת מפקדה נפרד (פורט 4791, תיקיית נתונים זמנית) מול Claude אמיתי (Haiku, עולה מעט מאוד):
 * פתיחת סשן ← שליחה ← בקשת אישור לפקודה ← אישור ← תשובה ← סגירה, ובדיקה שהגנות האבטחה חוסמות דף זר.
 * הרצה: npm run e2e (מתיקיית השורש)
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

const PORT = 4791;
const data = fs.mkdtempSync(path.join(os.tmpdir(), "mifkada-e2e-"));
const proj = fs.mkdtempSync(path.join(os.tmpdir(), "mifkada-e2e-proj-"));
// אם Bash מאושר מראש בהגדרות הגלובליות; כלל ask בפרויקט קודם ל-allow, כך שהפקודה תעצור לאישור
fs.mkdirSync(path.join(proj, ".claude"), { recursive: true });
fs.writeFileSync(path.join(proj, ".claude", "settings.json"), JSON.stringify({ permissions: { ask: ["Bash(echo:*)"] } }));
// הפרויקט הזמני נמצא מחוץ לבית: פתיחת סשן ב-WebSocket מותרת רק בתיקייה מוכרת (access.ts), לכן הוא תיקיית פרויקטים
fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ system: { projectRoots: [path.dirname(proj)] } }));
// שומר הפרוד: host מדומה שלא קיים (לעולם לא שרת אמיתי), ו-ssh מדומה ב-PATH שרק כותב לקובץ
const PROD_HOST = "mifkada-e2e-prod.invalid";
const UI_SECRET = "e2".repeat(32);
const fakeBin = path.join(proj, ".fakebin");
const sshLog = path.join(proj, "ssh.log");
fs.mkdirSync(fakeBin);
fs.writeFileSync(path.join(fakeBin, "ssh"), `#!/bin/sh\necho "$@" >> "${sshLog}"\necho fake-ssh-ok\n`, { mode: 0o755 });
const steps: Array<[string, boolean]> = [];
const ok = (name: string, pass: boolean) => {
  steps.push([name, pass]);
  console.log(`${pass ? "✓" : "✗"} ${name}`);
};

const server = spawn(path.join(import.meta.dirname, "..", "node_modules", ".bin", "tsx"), [path.join(import.meta.dirname, "..", "src", "index.ts")], {
  env: { ...process.env, MIFKADA_PORT: String(PORT), MIFKADA_DATA: data, MIFKADA_PROD_HOSTS: PROD_HOST, MIFKADA_UI_SECRET: UI_SECRET, PATH: `${fakeBin}:${process.env.PATH}` },
  stdio: ["ignore", "pipe", "pipe"],
});
const cleanup = () => {
  server.kill();
  fs.rmSync(data, { recursive: true, force: true });
  fs.rmSync(proj, { recursive: true, force: true });
  // התמליל של סשן הבדיקה נשמר תחת ~/.claude/projects: לא להשאיר אותו ברשימה של מפקדה
  const base = path.join(os.homedir(), ".claude", "projects");
  for (const d of fs.readdirSync(base)) if (d.includes("mifkada-e2e-proj")) fs.rmSync(path.join(base, d), { recursive: true, force: true });
};

async function waitHealth() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) return;
    } catch {
      /* עוד לא */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("השרת לא עלה");
}

try {
  await waitHealth();
  ok("השרת עולה", true);

  // אבטחה: דף זר נחסם, עוגיית הטוקן ניתנת בדף הראשי
  ok("אתר זר נחסם (403)", (await fetch(`http://127.0.0.1:${PORT}/api/sessions`, { headers: { Origin: "https://evil.example.com" } })).status === 403);
  ok("דפדפן בלי טוקן נחסם (401)", (await fetch(`http://127.0.0.1:${PORT}/api/sessions`, { headers: { "Sec-Fetch-Site": "same-origin" } })).status === 401);
  ok("הדף הראשי נותן טוקן HttpOnly", /HttpOnly/.test((await fetch(`http://127.0.0.1:${PORT}/`)).headers.get("set-cookie") ?? ""));

  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  await new Promise((r, j) => {
    ws.once("open", r);
    ws.once("error", j);
  });
  const events: Array<Record<string, unknown>> = [];
  const errors: string[] = [];
  let liveId = "";
  let rejected = "";
  ws.on("message", (d) => {
    const m = JSON.parse(String(d)) as Record<string, unknown>;
    if (m.t === "error") errors.push(String(m.message));
    if (m.t === "error" && m.ref === "e2e-etc") rejected = String(m.message);
    if (m.t === "opened" && m.ref === "e2e-etc") liveId = "WRONG";
    if (m.t === "opened" && m.ref === "e2e") liveId = String(m.liveId);
    if (m.t === "event") events.push(m.event as Record<string, unknown>);
  });
  const until = async (pred: () => boolean, ms: number) => {
    const t0 = Date.now();
    while (!pred()) {
      if (Date.now() - t0 > ms) return false;
      await new Promise((r) => setTimeout(r, 200));
    }
    return true;
  };

  // תיקייה זרה: גם בלי הממשק, השרת מסרב לפתוח בה סשן; וגם הבורר לא מדפדף מחוץ לבית
  ws.send(JSON.stringify({ t: "open", ref: "e2e-etc", cwd: "/etc", model: "haiku" }));
  ok("סשן ב-/etc נדחה", (await until(() => Boolean(rejected), 5_000)) && !liveId);
  ok("דפדוף ב-/etc נחסם (403)", (await fetch(`http://127.0.0.1:${PORT}/api/fs/browse?path=/etc`)).status === 403);

  ws.send(JSON.stringify({ t: "open", ref: "e2e", cwd: proj, model: "haiku", permissionMode: "default", text: "Run exactly this bash command and nothing else: echo mifkada-e2e-ok . Then reply with the single word DONE." }));
  ok("סשן נפתח", await until(() => Boolean(liveId), 15_000));

  const gotPerm = await until(() => events.some((e) => e.kind === "permission_request"), 90_000);
  ok("Claude ביקש אישור לפקודה", gotPerm);
  if (gotPerm) {
    const req = events.find((e) => e.kind === "permission_request")!.request as { requestId: string };
    ws.send(JSON.stringify({ t: "permission", liveId, requestId: req.requestId, behavior: "allow" }));
  }
  const done = await until(() => events.some((e) => e.kind === "result"), 120_000);
  ok("התור הסתיים", done);
  const text = JSON.stringify(events.filter((e) => e.kind === "message"));
  ok("הפקודה רצה (mifkada-e2e-ok בתוצאה)", text.includes("mifkada-e2e-ok"));

  // שומר הפרוד: Bash מאושר מראש בהגדרות, ובכל זאת פקודת פרוד עוצרת לכרטיס. לקוח בלי הסוד (כמו סוכן שמתחבר לשקע)
  // לא יכול לאשר; החלון (עם הסוד) כן, ו"אשר פריסה לסשן הזה" מעביר את הפקודה הבאה בלי כרטיס
  const prodReqs = () => events.filter((e) => e.kind === "permission_request" && (e.request as { prod?: unknown }).prod) as Array<{ request: { requestId: string } }>;
  const results = () => events.filter((e) => e.kind === "result").length;
  ws.send(
    JSON.stringify({
      t: "send",
      liveId,
      text: `Run exactly these two bash commands, one after the other, as two separate Bash tool calls: ssh ${PROD_HOST} 'docker compose up -d web' and then ssh ${PROD_HOST} 'docker compose up -d api' . Then reply with the single word DONE.`,
    }),
  );
  const gotProd = await until(() => prodReqs().length > 0, 90_000);
  ok("פקודת פרוד עצרה לכרטיס למרות allow: Bash", gotProd);
  if (gotProd) {
    const id = prodReqs()[0].request.requestId;
    ws.send(JSON.stringify({ t: "permission", liveId, requestId: id, behavior: "allow" }));
    ok("אישור מלקוח בלי הסוד נדחה", await until(() => errors.some((m) => m.includes("רק מהחלון")), 5_000));
    ok("הפקודה לא רצה בלי אישור", !fs.existsSync(sshLog));
    const ui = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { "x-mifkada-ui": UI_SECRET } });
    await new Promise((r, j) => {
      ui.once("open", r);
      ui.once("error", j);
    });
    ui.send(JSON.stringify({ t: "permission", liveId, requestId: id, behavior: "allow", grant: true }));
    const finished = await until(() => results() >= 2, 120_000);
    ok("החלון אישר והתור הסתיים", finished);
    const lines = fs.existsSync(sshLog) ? fs.readFileSync(sshLog, "utf8").trim().split("\n") : [];
    ok("שתי הפקודות רצו", lines.length >= 2 && lines.some((l) => l.includes("api")));
    ok("אחרי אישור לסשן לא היה כרטיס נוסף", prodReqs().length === 1);
    ui.close();
  }

  // bypassPermissions חסום גם כשמבקשים אותו ישירות
  ws.send(JSON.stringify({ t: "set_mode", liveId, mode: "bypassPermissions" }));
  await new Promise((r) => setTimeout(r, 800));
  const lives = (await (await fetch(`http://127.0.0.1:${PORT}/api/sessions`)).json()) as Array<{ live: { liveId: string; permissionMode: string } | null }>;
  ok("מצב bypass נחסם", lives.find((r) => r.live?.liveId === liveId)?.live?.permissionMode !== "bypassPermissions");

  ws.send(JSON.stringify({ t: "close", liveId }));
  await new Promise((r) => setTimeout(r, 1500));
  const after = (await (await fetch(`http://127.0.0.1:${PORT}/api/sessions`)).json()) as Array<{ live: { liveId: string } | null }>;
  ok("הסשן נסגר", !after.some((r) => r.live?.liveId === liveId));
  ws.close();
} catch (e) {
  ok(`שגיאה: ${(e as Error).message}`, false);
} finally {
  cleanup();
}
const failed = steps.filter(([, p]) => !p).length;
console.log(failed ? `\n${failed} שלבים נכשלו` : `\nכל ${steps.length} השלבים עברו`);
process.exit(failed ? 1 : 0);
