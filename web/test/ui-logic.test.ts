import { test } from "node:test";
import assert from "node:assert/strict";
import { groupRuns, isToolOnly, mergeHistoryMessages } from "../src/lib/transcript.ts";
import { gridDims, uniqueSplit } from "../src/lib/split.ts";
import { shortTime } from "../src/lib/util.ts";
import { applyLang } from "../src/i18n.ts";
import type { TranscriptMessage } from "../../shared/protocol.ts";

const text = (uuid: string, role: "user" | "assistant", t: string): TranscriptMessage => ({ uuid, role, blocks: [{ type: "text", text: t }] });
const use = (uuid: string, name = "Bash"): TranscriptMessage => ({ uuid, role: "assistant", blocks: [{ type: "tool_use", id: uuid, name, input: {} }] });
// הבדיקות כתובות לממשק בעברית: קובעים את השפה במפורש, בלי תלות בשפת המערכת שמריצה אותן
applyLang("he");

const res = (uuid: string): TranscriptMessage => ({ uuid, role: "user", blocks: [{ type: "tool_result", toolUseId: uuid, content: "ok", isError: false }] });

test("קיבוץ כלים: רצף של קריאות ותוצאות הופך לשורה אחת", () => {
  const msgs = [text("1", "user", "שלום"), use("2"), res("3"), use("4", "Read"), res("5"), text("6", "assistant", "סיימתי")];
  const g = groupRuns(msgs);
  assert.equal(g.length, 3);
  assert.equal(g[0].m?.uuid, "1");
  assert.equal(g[1].run?.length, 4);
  assert.equal(g[2].m?.uuid, "6");
  // תשובה אחרי רצף כלים היא המשך של Claude, בלי אווטאר חוזר
  assert.equal(g[2].continued, true);
});

test("קיבוץ כלים: הודעה עם טקסט לא נבלעת ברצף", () => {
  assert.equal(isToolOnly(text("1", "assistant", "היי")), false);
  assert.equal(isToolOnly(use("2")), true);
  assert.equal(isToolOnly(res("3")), true);
  assert.equal(isToolOnly({ uuid: "x", role: "assistant", blocks: [] }), false);
});

test("גריד: סידור אוטומטי לפי מספר החלונות", () => {
  assert.deepEqual(gridDims(2, "auto"), { cols: 2, rows: 1 });
  assert.deepEqual(gridDims(4, "auto"), { cols: 2, rows: 2 });
  assert.deepEqual(gridDims(6, "auto"), { cols: 3, rows: 2 });
  assert.deepEqual(gridDims(5, "grid"), { cols: 3, rows: 2 });
  assert.deepEqual(gridDims(3, "rows"), { cols: 1, rows: 3 });
  assert.deepEqual(gridDims(4, "cols"), { cols: 4, rows: 1 });
});

test("זמן קצר בסרגל הצד", () => {
  const now = Date.now();
  assert.equal(shortTime(now), "עכשיו");
  assert.equal(shortTime(now - 5 * 60_000), "5 ד׳");
  assert.equal(shortTime(now - 3 * 3600_000), "3 ש׳");
  assert.equal(shortTime(0), "");
});

test("מיזוג היסטוריה: 'כן' מוקדם יותר לא נבלע, והעותק של ההודעה החיה כן יורד", () => {
  const history = [text("h1", "user", "כן"), text("h2", "assistant", "בוצע"), text("h3", "user", "כן")];
  const live = [text("l1", "user", "כן"), text("l2", "assistant", "סיימתי")];
  const merged = mergeHistoryMessages(live, history).map((m) => m.uuid);
  assert.deepEqual(merged, ["h1", "h2", "l1", "l2"]);
});

test("מיזוג היסטוריה: uuid זהה בדיסק ובחי מופיע פעם אחת, ו'כן' שלפני נקודת החפיפה נשאר", () => {
  const history = [text("a", "user", "כן"), text("b", "assistant", "x")];
  const live = [text("b", "assistant", "x"), text("c", "user", "כן")];
  assert.deepEqual(mergeHistoryMessages(live, history).map((m) => m.uuid), ["a", "b", "c"]);
});

test("מיזוג היסטוריה: בלי הודעות חיות מחזיר את ההיסטוריה כמו שהיא", () => {
  const history = [text("a", "user", "שלום")];
  assert.equal(mergeHistoryMessages([], history), history);
});

test("תפריט /: אפשרויות לפקודה מתוך ה-argumentHint", async () => {
  const { commandOptions } = await import("../src/lib/slashOptions.ts");
  const v = (name: string, hint?: string) => commandOptions(name, hint)?.map((o) => o.value) ?? null;
  assert.deepEqual(v("model"), ["fable", "opus", "sonnet", "haiku"]);
  assert.ok(!v("mode")!.includes("bypassPermissions"), "מאשר הכול לא מוצע ב-/");
  assert.deepEqual(v("effort", "<low|medium|high|xhigh|max|auto|ultracode [on|off]>"), ["low", "medium", "high", "xhigh", "max", "auto", "ultracode"]);
  assert.deepEqual(v("fast", "[on|off]"), ["on", "off"]);
  assert.deepEqual(v("design", "consent | revoke"), ["consent", "revoke"]);
  assert.deepEqual(v("code-review", "[low|medium|high|xhigh|max|ultra] [--fix] [<pr#>|<branch>]"), ["low", "medium", "high", "xhigh", "max", "ultra"]);
  assert.equal(v("autocompact", "[auto|<tokens>]"), null);
  assert.equal(v("loop", "[interval] [prompt]"), null);
  assert.equal(v("compact", "<optional custom summarization instructions>"), null);
  assert.equal(v("simplify"), null);
  assert.equal(commandOptions("effort", "<low|high>")![0].label, "נמוך - מהיר");
  applyLang("en");
  assert.equal(commandOptions("effort", "<low|high>")![0].label, "Low - fast");
  assert.equal(commandOptions("design", "consent | revoke")![0].label, "consent");
  applyLang("he");
});

test("מסך מפוצל: אותו סשן לא מוצג פעמיים, גם כשאחד חי והשני היסטורי", () => {
  const h = (sessionId: string) => ({ kind: "history" as const, sessionId });
  const live = (liveId: string) => ({ kind: "live" as const, liveId });
  const sessionOf = (id: string) => ({ L1: "a" } as Record<string, string>)[id];
  // מצב שנשמר אצל משתמש ב-31/10: אותו סשן בראשי ובשני חלונות נוספים
  assert.deepEqual(uniqueSplit(h("a"), [h("b"), h("a"), h("c"), h("a")], sessionOf), [h("b"), h("c")]);
  // חי של סשן a שווה להיסטורי של a
  assert.deepEqual(uniqueSplit(live("L1"), [h("a"), h("b")], sessionOf), [h("b")]);
  // חי שעוד לא ידוע לאיזה סשן הוא שייך נשאר
  assert.deepEqual(uniqueSplit(live("L2"), [h("a")], sessionOf), [h("a")]);
  // בלי כפילות מוחזר אותו מערך (לא מעדכנים את ה-store סתם)
  const split = [h("b"), h("c")];
  assert.equal(uniqueSplit(h("a"), split, sessionOf), split);
  // הראשי אינו צ'אט: מורידים רק כפילויות בתוך ה-split
  assert.deepEqual(uniqueSplit({ kind: "board" }, [h("b"), h("b")], sessionOf), [h("b")]);
});


test("הרחבות: פיצול פקודה, זוגות ערכים וחיפוש פלאגינים", async () => {
  const { splitCommand, parsePairs, matchPlugin, pluginName } = await import("../src/lib/extensions.ts");
  assert.deepEqual(splitCommand('npx -y @mcp/server-fs "/Users/me/My Projects" \'a b\''), { command: "npx", args: ["-y", "@mcp/server-fs", "/Users/me/My Projects", "a b"] });
  assert.deepEqual(splitCommand("  "), { command: "", args: [] });
  assert.deepEqual(splitCommand('run ""'), { command: "run", args: [""] });
  assert.deepEqual(parsePairs("API_KEY=abc=1\n# הערה\n\nBAD\nX = y", "="), { API_KEY: "abc=1", X: "y" });
  assert.deepEqual(parsePairs("Authorization: Bearer t:1", ":"), { Authorization: "Bearer t:1" });
  assert.equal(pluginName("takin@acme"), "takin");
  const p = { name: "github", description: "Work with GitHub issues and PRs", marketplace: "claude-plugins-official" };
  assert.ok(matchPlugin(p, "github prs"));
  assert.ok(!matchPlugin(p, "gitlab"));
});

test("diff בצ'אט: רק השורות שהשתנו עם הקשר, ולא כל הקובץ", async () => {
  const { lineDiff } = await import("../src/lib/diff.ts");
  const before = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
  const after = before.replace("line 10", "LINE TEN").replace("line 25", "line 25\nnew line");
  const rows = lineDiff(before, after);
  assert.deepEqual(
    rows.map((r) => `${r.sign}${r.text}`),
    [" line 8", " line 9", "-line 10", "+LINE TEN", " line 11", " line 12", "…", " line 24", " line 25", "+new line", " line 26", " line 27"],
  );
  // קובץ חדש: הכול נוסף
  assert.deepEqual(lineDiff("", "a\nb").map((r) => r.sign), ["+", "+"]);
  // Edit של Claude: שורה משותפת לא מוצגת כמחוקה ונוספת
  assert.deepEqual(lineDiff("x\ny", "x\nz").map((r) => `${r.sign}${r.text}`), [" x", "-y", "+z"]);
});

test("כרטיסיות: סידור מחדש בגרירה, סגירת האחרות וסגירת כולן", async () => {
  const { useTabs, tabId } = await import("../src/lib/tabs.ts");
  const s = useTabs.getState();
  s.closeAll();
  for (const id of ["a", "b", "c"]) useTabs.getState().touch({ kind: "history", sessionId: id });
  const ids = () => useTabs.getState().tabs.map(tabId);
  assert.deepEqual(ids(), ["a", "b", "c"]);
  useTabs.getState().move("c", "a");
  assert.deepEqual(ids(), ["c", "a", "b"]);
  useTabs.getState().move("c", null);
  assert.deepEqual(ids(), ["a", "b", "c"]);
  useTabs.getState().move("a", "a");
  assert.deepEqual(ids(), ["a", "b", "c"]);
  useTabs.getState().closeOthers("b");
  assert.deepEqual(ids(), ["b"]);
  useTabs.getState().closeAll();
  assert.deepEqual(ids(), []);
});

test("בורר תיקיות: breadcrumb מהבית, ונתיב מחוץ לבית מתחיל בשורש", async () => {
  const { crumbs } = await import("../src/lib/folders.ts");
  assert.deepEqual(crumbs("/Users/e", "/Users/e"), [{ name: "~", path: "/Users/e" }]);
  assert.deepEqual(crumbs("/Users/e/Desktop/acme-clients", "/Users/e/"), [
    { name: "~", path: "/Users/e" },
    { name: "Desktop", path: "/Users/e/Desktop" },
    { name: "acme-clients", path: "/Users/e/Desktop/acme-clients" },
  ]);
  // תיקייה ששמה מתחיל כמו הבית אינה בתוכו
  assert.equal(crumbs("/Users/e2/x", "/Users/e")[0].name, "/");
  assert.deepEqual(
    crumbs("C:\\Users\\e\\proj", "C:\\Users\\e").map((c) => c.path),
    ["C:\\Users\\e", "C:\\Users\\e\\proj"],
  );
});
