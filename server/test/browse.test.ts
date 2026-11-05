import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// בית מדומה: הבורר מוגבל ל-os.homedir(), ו-isProtectedDir קורא את HOME. הכול לפני שמודול כלשהו נטען
const TMP = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "mifkada-browse-")));
const HOME = path.join(TMP, "home");
const OUTSIDE = path.join(TMP, "outside");
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.MIFKADA_DATA = path.join(TMP, "data");
process.env.MIFKADA_LANG = "he";
process.env.CLAUDE_CONFIG_DIR = path.join(TMP, "claude-home");
for (const d of [process.env.CLAUDE_CONFIG_DIR, path.join(HOME, "Desktop", "site", ".git"), path.join(HOME, "Desktop", "notes", "deep"), path.join(HOME, "Downloads", "x"), path.join(HOME, ".secret"), path.join(HOME, "proj", "node_modules", "pkg"), OUTSIDE])
  fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(HOME, "Desktop", "file.txt"), "x");
fs.symlinkSync(OUTSIDE, path.join(HOME, "Desktop", "escape"));
fs.symlinkSync(path.join(HOME, "proj"), path.join(HOME, "Desktop", "proj-link"));

const { browseDir } = await import("../src/browse.ts");
const { assertBrowsable, assertOpenableCwd, setExtraRoots, resetAccessCache, AccessError } = await import("../src/access.ts");

const status = (e: unknown) => (e instanceof AccessError ? e.status : 0);

test("בורר: בלי נתיב מתחיל בבית, רק תיקיות, git קודם, בלי מוסתרות, Downloads וקישור החוצה", async () => {
  const root = await browseDir("");
  assert.equal(root.path, HOME);
  assert.equal(root.parent, null);
  assert.equal(root.display, "~");
  const names = root.entries.map((e) => e.name);
  assert.ok(names.includes("Desktop") && names.includes("proj"));
  assert.ok(!names.includes("Downloads"), "הורדות מוסתרות");
  assert.ok(!names.includes(".secret"), "מוסתרות לא מוצגות");
  assert.ok((await browseDir("", { hidden: true })).entries.some((e) => e.name === ".secret"));

  const desk = await browseDir(path.join(HOME, "Desktop"));
  assert.deepEqual(
    desk.entries.map((e) => e.name),
    ["site", "notes", "proj-link"],
    "ריפו git קודם, בלי קבצים ובלי קישור שיוצא מהבית",
  );
  assert.equal(desk.entries[0].isGitRepo, true);
  assert.equal(desk.entries.find((e) => e.name === "notes")!.hasChildren, true);
  assert.equal(desk.entries[0].hasChildren, false, ".git לא נחשבת תת-תיקייה");
  assert.equal(desk.parent, HOME);
  assert.equal(desk.display, path.join("~", "Desktop"));
  assert.ok(!(await browseDir(path.join(HOME, "proj"))).entries.some((e) => e.name === "node_modules"));
});

test("בורר: לא יוצא מהבית, קישור החוצה, Downloads, node_modules ותיקייה לא קיימת", async () => {
  for (const p of ["/etc", "/", OUTSIDE, path.join(HOME, ".."), path.join(HOME, "Desktop", "escape"), path.join(HOME, "Downloads"), path.join(HOME, "Downloads", "x"), path.join(HOME, "proj", "node_modules"), path.join(HOME, ".secret")]) {
    await assert.rejects(browseDir(p), (e) => status(e) === 403, p);
  }
  await assert.rejects(browseDir(path.join(HOME, "nope")), (e) => status(e) === 404);
  await assert.rejects(browseDir(path.join(HOME, "Desktop", "file.txt")), (e) => status(e) === 404);
  // ההודעה לא חושפת את הנתיב
  await assert.rejects(browseDir("/etc"), (e) => !(e as Error).message.includes("/etc"));
  assert.equal(await assertBrowsable(path.join(HOME, "Desktop", "proj-link")), path.join(HOME, "proj"));
  assert.equal(await assertBrowsable("~/Desktop"), path.join(HOME, "Desktop"));
});

test("פתיחת סשן/משימה: תיקייה מוכרת או תיקייה בבית; לא /etc, לא הבית עצמו, לא מוסתרת ולא קישור החוצה", async () => {
  resetAccessCache();
  setExtraRoots(() => [OUTSIDE]);
  assert.equal(await assertOpenableCwd(OUTSIDE), OUTSIDE, "תיקייה מוכרת מחוץ לבית עוברת");
  setExtraRoots(() => []);
  resetAccessCache();
  assert.equal(await assertOpenableCwd(path.join(HOME, "Desktop", "site")), path.join(HOME, "Desktop", "site"));
  for (const p of ["/etc", "/", OUTSIDE, HOME, path.join(HOME, ".secret"), path.join(HOME, "Desktop", "escape"), path.join(HOME, "Downloads", "x"), path.join(HOME, "nope"), ""]) {
    await assert.rejects(assertOpenableCwd(p), undefined, p || "(ריק)");
  }
});

test("WebSocket: open עם תיקייה זרה נדחה ולא נפתח סשן חי", async () => {
  const { EventEmitter } = await import("node:events");
  const { Hub } = await import("../src/ws.ts");
  resetAccessCache();
  setExtraRoots(() => []);
  const hub = new Hub(new EventEmitter() as never);
  const fake = { attached: new Set(), readyState: 1, send() {} };
  for (const cwd of ["/etc", HOME, path.join(HOME, ".secret")]) {
    await assert.rejects((hub as unknown as { handle: (ws: unknown, m: unknown) => Promise<void> }).handle(fake, { t: "open", ref: "x", cwd }), undefined, cwd);
  }
  assert.equal(hub.lives.size, 0);
});
