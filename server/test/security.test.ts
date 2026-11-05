import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// הכול בתיקייה זמנית, לפני שמודול כלשהו קורא את paths.ts: גם הנתונים של מפקדה וגם ~/.claude המדומה
// .native: ב-Windows גם שמות קצרים (RUNNER~1) נפתחים לשם המלא, כמו בקוד שנבדק
const TMP = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "mifkada-sec-")));
process.env.MIFKADA_DATA = path.join(TMP, "data");
// שפה קבועה: הבדיקות מצפות להודעות בעברית
process.env.MIFKADA_LANG = "he";
process.env.CLAUDE_CONFIG_DIR = path.join(TMP, "claude-home");
fs.mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true });

const { resolveInside, readFile } = await import("../src/fs.ts");
const { assertAllowedCwd, setExtraRoots, resetAccessCache } = await import("../src/access.ts");
const { readSafety, setRule } = await import("../src/safety.ts");

const project = path.join(TMP, "project");
const outside = path.join(TMP, "outside");
fs.mkdirSync(path.join(project, "src"), { recursive: true });
fs.mkdirSync(outside, { recursive: true });
fs.writeFileSync(path.join(project, "src", "a.ts"), "export const a = 1;\n");
fs.writeFileSync(path.join(outside, "secret.txt"), "secret\n");
fs.symlinkSync(outside, path.join(project, "escape"));

test("קבצים: נתיב בתוך הפרויקט עובר, ../ וקישור סימבולי החוצה נחסמים", async () => {
  assert.equal((await readFile(project, "src/a.ts")).content, "export const a = 1;\n");
  assert.throws(() => resolveInside(project, "../outside/secret.txt"), /מחוץ לפרויקט/);
  assert.throws(() => resolveInside(project, "escape/secret.txt"), /קישור סימבולי/);
  // קובץ חדש בתיקייה קיימת מותר, וקובץ חדש דרך הקישור לא
  assert.equal(resolveInside(project, "src/new.ts"), path.join(project, "src", "new.ts"));
  assert.throws(() => resolveInside(project, "escape/new.txt"), /קישור סימבולי/);
});

test("גישה: רק תיקייה מוכרת (או בתוכה), לא תיקייה זרה ולא שורש הדיסק", async () => {
  resetAccessCache();
  setExtraRoots(() => [project]);
  assert.equal(await assertAllowedCwd(path.join(project, "src")), path.join(project, "src"));
  await assert.rejects(assertAllowedCwd(outside), /לא מוכרת/);
  await assert.rejects(assertAllowedCwd(path.join(project, "escape")), /לא מוכרת/);
  await assert.rejects(assertAllowedCwd("/"), /לא מוכרת/);
  await assert.rejects(assertAllowedCwd(path.join(TMP, "does-not-exist")), /לא מוכרת/);
});

test("הגדרות Claude Code: קובץ חסר = ריק, נוצר בכתיבה; קובץ פגום לא נדרס; עד 10 גיבויים", async () => {
  const file = path.join(process.env.CLAUDE_CONFIG_DIR!, "settings.json");
  assert.deepEqual(await readSafety(), { defaultMode: null, allow: [], ask: [], deny: [] });
  await setRule("Bash(git push:*)", "ask");
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).permissions.ask, ["Bash(git push:*)"]);

  for (let i = 0; i < 12; i++) await setRule(`Bash(echo ${i}:*)`, "allow");
  const backups = fs.readdirSync(path.dirname(file)).filter((n) => n.startsWith("settings.json.mifkada-backup-"));
  assert.ok(backups.length > 0 && backups.length <= 10, `גיבויים: ${backups.length}`);
  assert.ok(!fs.readdirSync(path.dirname(file)).some((n) => n.includes("mifkada-tmp")), "לא נשאר קובץ זמני");

  fs.writeFileSync(file, "{ not json");
  await assert.rejects(setRule("Bash(ls:*)", "allow"), /לא JSON תקין/);
  assert.equal(fs.readFileSync(file, "utf8"), "{ not json");
});
