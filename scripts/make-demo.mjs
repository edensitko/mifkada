#!/usr/bin/env node
// סביבת הדגמה מלאה בתיקייה נפרדת, לצילומי מסך ולפיתוח בלי הנתונים שלך:
// ~/.claude מדומה (סשנים, אייג'נטים, סקיל, זיכרון), פרויקטים כריפו git אמיתיים, ותיקיית נתונים של מפקדה (משימות, צבעים, הגדרות).
//
//   node scripts/make-demo.mjs /tmp/mifkada-demo en      (או he)
//   CLAUDE_CONFIG_DIR=/tmp/mifkada-demo/claude MIFKADA_DATA=/tmp/mifkada-demo/data npm run dev -w server
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const [root = "/tmp/mifkada-demo", lang = "en"] = process.argv.slice(2);
const he = lang === "he";
const T = (en, heText) => (he ? heText : en);

fs.rmSync(root, { recursive: true, force: true });
const claude = path.join(root, "claude");
const data = path.join(root, "data");
const projectsDir = path.join(root, "projects");
for (const d of [claude, data, projectsDir]) fs.mkdirSync(d, { recursive: true });

const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
const now = Date.now();
const ago = (min) => new Date(now - min * 60_000).toISOString();

// ── פרויקטים ──
const PROJECTS = [
  { name: "atlas-web", files: { "package.json": '{ "name": "atlas-web", "private": true }\n', "app/page.tsx": "export default function Home() {\n  return <main>Atlas</main>;\n}\n", "README.md": "# Atlas\nMarketing site.\n" }, dirty: { "app/pricing/page.tsx": "export default function Pricing() {\n  return null;\n}\n" } },
  { name: "nova-api", files: { "package.json": '{ "name": "nova-api", "private": true }\n', "src/server.ts": "export const port = 8080;\n", "README.md": "# Nova API\n" }, dirty: {} },
  { name: "pixel-store", files: { "package.json": '{ "name": "pixel-store", "private": true }\n', "src/cart.ts": "export const cart: string[] = [];\n", "README.md": "# Pixel Store\n" }, dirty: { "src/checkout.ts": "export function checkout() {}\n" } },
  { name: "field-notes", files: { "app.json": '{ "name": "field-notes" }\n', "README.md": "# Field Notes\nMobile app.\n" }, dirty: {} },
];
for (const p of PROJECTS) {
  const dir = path.join(projectsDir, p.name);
  for (const [f, c] of Object.entries(p.files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), c);
  }
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  git(dir, "config", "user.email", "demo@example.com");
  git(dir, "config", "user.name", "Demo");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "Initial commit");
  for (const [f, c] of Object.entries(p.dirty)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), c);
  }
}
const P = (name) => path.join(projectsDir, name);

// ── אייג'נטים, סקיל, זיכרון ──
const AGENTS = [
  ["lead", T("Lead agent: takes a request, splits it between the other agents and projects, and reports back once.", "הסוכן הראשי: מקבל בקשה, מחלק אותה לשאר הסוכנים ולפרויקטים ומחזיר סיכום אחד.")],
  ["reviewer", T("Reviews code changes for bugs, edge cases and security before a merge.", "סוקר שינויי קוד: באגים, מקרי קצה ואבטחה לפני מיזוג.")],
  ["qa", T("Tests sites in a real browser on desktop and mobile and reports issues with screenshots.", "בודק אתרים בדפדפן, בדסקטופ ובמובייל, ומחזיר ליקויים עם צילומי מסך.")],
  ["writer", T("Writes product copy, release notes and docs in the brand voice.", "כותב טקסטים, הערות גרסה ותיעוד בקול של המותג.")],
];
fs.mkdirSync(path.join(claude, "agents"), { recursive: true });
for (const [slug, desc] of AGENTS) fs.writeFileSync(path.join(claude, "agents", `${slug}.md`), `---\nname: ${slug}\ndescription: ${desc}\n---\n\n${desc}\n`);
fs.mkdirSync(path.join(claude, "skills", "release-notes"), { recursive: true });
fs.writeFileSync(path.join(claude, "skills", "release-notes", "SKILL.md"), `---\nname: release-notes\ndescription: ${T("Draft release notes from the commits since the last tag.", "טיוטת הערות גרסה מה-commits מאז התג האחרון.")}\n---\n`);
fs.mkdirSync(path.join(claude, "memory"), { recursive: true });
fs.writeFileSync(path.join(claude, "memory", "pixel-store-checkout.md"), `---\nname: pixel-store-checkout\ndescription: ${T("pixel-store: checkout uses the Stripe test keys locally", "pixel-store: התשלום משתמש במפתחות הבדיקה של Stripe מקומית")}\n---\n${T("See [[nova-api-deploy]].", "ראו [[nova-api-deploy]].")}\n`);
fs.writeFileSync(path.join(claude, "memory", "nova-api-deploy.md"), `---\nname: nova-api-deploy\ndescription: ${T("nova-api: deploys from main through CI, never by hand", "nova-api: פריסה מ-main דרך CI, אף פעם לא ידנית")}\n---\n`);
fs.writeFileSync(path.join(claude, "memory", "MEMORY.md"), "- [pixel-store checkout](pixel-store-checkout.md)\n- [nova-api deploy](nova-api-deploy.md)\n");

// ── סשנים ──
const SESSIONS = [
  { p: "atlas-web", agent: "lead", min: 6, title: T("Pricing page and launch checklist", "עמוד מחירים ורשימת השקה"), user: T("Add a pricing page with three plans and check the site on mobile before launch.", "תוסיף עמוד מחירים עם שלוש חבילות ותבדוק את האתר במובייל לפני ההשקה."), answer: T("I added `app/pricing/page.tsx` with three plans and asked **qa** to check the home and pricing pages on desktop and mobile.\n\n- Pricing page: done, uncommitted\n- Mobile check: 2 small issues (button wraps on 375px, footer link)\n\nWant me to fix both and commit?", "הוספתי את `app/pricing/page.tsx` עם שלוש חבילות, וביקשתי מ-**qa** לבדוק את הבית ואת המחירים בדסקטופ ובמובייל.\n\n- עמוד מחירים: מוכן, לא שמור ב-commit\n- בדיקת מובייל: 2 ליקויים קטנים (כפתור נשבר ב-375px, קישור בפוטר)\n\nלתקן את שניהם ולעשות commit?") },
  { p: "atlas-web", agent: "qa", min: 18, title: T("Mobile QA: home and pricing", "QA במובייל: בית ומחירים"), user: T("Check the home and pricing pages on mobile.", "תבדוק את הבית ואת המחירים במובייל."), answer: T("Checked at 390px and 1440px. All links return 200, no horizontal scroll. Two issues: the \"Start\" button wraps on narrow screens, and the footer \"Terms\" link points to a missing page.", "בדקתי ב-390px וב-1440px. כל הקישורים מחזירים 200, אין גלילה אופקית. שני ליקויים: כפתור \"התחל\" נשבר במסכים צרים, וקישור \"תנאים\" בפוטר מוביל לעמוד שלא קיים.") },
  { p: "nova-api", agent: "reviewer", min: 45, title: T("Review: rate limiting middleware", "סקירה: הגבלת קצב לבקשות"), user: T("Review the rate limiting change before I merge it.", "תסקור את השינוי של הגבלת הקצב לפני שאני ממזג."), answer: T("Looks good overall. One real issue: the limiter keys on `req.ip`, which behind the proxy is always the proxy's address. Use the forwarded header from your trusted proxy instead.", "נראה טוב באופן כללי. בעיה אחת אמיתית: ההגבלה לפי `req.ip`, שמאחורי ה-proxy הוא תמיד הכתובת של ה-proxy. צריך להשתמש בכותרת שה-proxy המהימן מעביר.") },
  { p: "nova-api", agent: null, min: 130, title: T("Add /health endpoint", "הוספת /health"), user: T("Add a health endpoint that checks the database.", "תוסיף endpoint של health שבודק את מסד הנתונים."), answer: T("Added `GET /health`: returns 200 with `{ ok: true }`, or 503 when the database doesn't answer within 2 seconds.", "הוספתי `GET /health`: מחזיר 200 עם `{ ok: true }`, או 503 כשמסד הנתונים לא עונה תוך 2 שניות.") },
  { p: "pixel-store", agent: "lead", min: 70, title: T("Checkout flow cleanup", "סידור תהליך התשלום"), user: T("The checkout has too many steps. Simplify it.", "בתשלום יש יותר מדי שלבים. תפשט אותו."), answer: T("Merged shipping and payment into one step and moved the coupon field into the summary. The flow is now 2 steps instead of 4.", "איחדתי משלוח ותשלום לשלב אחד והעברתי את שדה הקופון לסיכום. התהליך עכשיו 2 שלבים במקום 4.") },
  { p: "pixel-store", agent: "writer", min: 200, title: T("Product page copy", "טקסטים לעמודי מוצר"), user: T("Write short descriptions for the 6 new products.", "תכתוב תיאורים קצרים ל-6 המוצרים החדשים."), answer: T("Done. Six descriptions, 40-60 words each, in the store's voice. They're in `content/products.json`.", "מוכן. שישה תיאורים, 40-60 מילים כל אחד, בקול של החנות. הם ב-`content/products.json`.") },
  { p: "field-notes", agent: null, min: 60 * 26, title: T("Offline sync bug", "באג בסנכרון אופליין"), user: T("Notes created offline disappear after sync.", "פתקים שנוצרים אופליין נעלמים אחרי סנכרון."), answer: T("Found it: the sync treats a missing server id as a deletion. Fixed by sending local notes first and only then pulling.", "מצאתי: הסנכרון מתייחס למזהה שרת חסר כמחיקה. תיקנתי: שולחים קודם את הפתקים המקומיים, ורק אחר כך מושכים.") },
  { p: "field-notes", agent: "qa", min: 60 * 50, title: T("Release candidate smoke test", "בדיקת עשן לגרסה"), user: T("Smoke test the release candidate.", "תריץ בדיקת עשן לגרסה."), answer: T("All 14 flows pass on iOS and Android. One warning: the onboarding screen is slow on first launch (2.8s).", "כל 14 התהליכים עוברים ב-iOS וב-Android. אזהרה אחת: מסך הפתיחה איטי בהפעלה הראשונה (2.8 שניות).") },
];
const enc = (cwd) => cwd.replace(/[^a-zA-Z0-9]/g, "-");
for (const s of SESSIONS) {
  const id = randomUUID();
  const cwd = P(s.p);
  const dir = path.join(claude, "projects", enc(cwd));
  fs.mkdirSync(dir, { recursive: true });
  const u1 = randomUUID();
  const a1 = randomUUID();
  const base = { sessionId: id, cwd, gitBranch: "main", version: "2.1.0", userType: "external", entrypoint: "sdk-ts", isSidechain: false };
  const lines = [
    { ...base, type: "user", parentUuid: null, uuid: u1, timestamp: ago(s.min + 3), message: { role: "user", content: s.user } },
    { ...base, type: "assistant", parentUuid: u1, uuid: a1, timestamp: ago(s.min), message: { id: `msg_${a1.slice(0, 8)}`, type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [{ type: "text", text: s.answer }], stop_reason: "end_turn", usage: { input_tokens: 1200, output_tokens: 180 } } },
    { type: "custom-title", customTitle: s.title, sessionId: id },
    ...(s.agent ? [{ type: "tag", tag: s.agent, sessionId: id }] : []),
  ];
  const file = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const t = new Date(now - s.min * 60_000);
  fs.utimesSync(file, t, t);
}

// ── הנתונים של מפקדה: הגדרות, צבעים, משימות ──
fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ system: { lang, displayName: T("Alex", "נועה"), projectRoots: [projectsDir], aiHelpers: false } }, null, 2));
const theme = (color, emoji, displayName) => ({ color, emoji, ...(displayName ? { displayName } : {}) });
fs.writeFileSync(
  path.join(data, "themes.json"),
  JSON.stringify(
    {
      agents: { lead: theme("#ffd60a", "🧭", T("Lead", "ראשי")), reviewer: theme("#30d158", "🔍", T("Reviewer", "סוקר")), qa: theme("#bf5af2", "🧪", "QA"), writer: theme("#ff375f", "✍️", T("Writer", "כותב")) },
      projects: {
        [P("atlas-web")]: theme("#0a84ff", "🌐", "Atlas"),
        [P("nova-api")]: theme("#5e5ce6", "⚡", "Nova API"),
        [P("pixel-store")]: theme("#ff9f0a", "🛍️", "Pixel Store"),
        [P("field-notes")]: theme("#30d158", "📓", "Field Notes"),
      },
      sessions: {},
    },
    null,
    2,
  ),
);
const task = (title, prompt, cwd, agent, status, minAgo, extra = {}) => ({
  id: randomUUID(), title, prompt, cwd, agent, model: null, permissionMode: "default", status, owner: "agent", order: 0,
  createdAt: now - minAgo * 60_000, updatedAt: now - minAgo * 60_000, liveId: null, sessionId: null, summary: null, costUsd: 0, lastError: null, ...extra,
});
fs.writeFileSync(
  path.join(data, "tasks.json"),
  JSON.stringify(
    {
      settings: { autoRun: false, maxParallel: 2 },
      tasks: [
        task(T("Fix the two mobile issues on Atlas", "לתקן את שני ליקויי המובייל ב-Atlas"), "...", P("atlas-web"), "lead", "todo", 5),
        task(T("Write the launch announcement", "לכתוב את הודעת ההשקה"), "...", P("atlas-web"), "writer", "todo", 9),
        task(T("Trusted proxy header for rate limiting", "כותרת proxy מהימנה להגבלת הקצב"), "...", P("nova-api"), "reviewer", "review", 40, { summary: T("Switched the limiter to the forwarded header from the trusted proxy and added a test.", "ההגבלה עברה לכותרת מה-proxy המהימן, ונוספה בדיקה."), costUsd: 0.42 }),
        task(T("Weekly QA: all live sites", "QA שבועי לכל האתרים"), "...", P("pixel-store"), "qa", "done", 60 * 30, { summary: T("All pages pass. No new issues.", "כל העמודים עוברים. אין ליקויים חדשים."), costUsd: 0.31 }),
      ],
    },
    null,
    2,
  ),
);
console.log(`demo (${lang}) ready in ${root}\n  CLAUDE_CONFIG_DIR=${claude}\n  MIFKADA_DATA=${data}`);
