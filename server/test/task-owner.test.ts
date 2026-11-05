import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// הנתונים הולכים לתיקייה זמנית, לפני שמודול כלשהו קורא את paths.ts
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mifkada-owner-"));
process.env.MIFKADA_DATA = path.join(TMP, "data");
// שפה קבועה: הבדיקות מצפות להודעות בעברית
process.env.MIFKADA_LANG = "he";

const { TaskStore } = await import("../src/tasks.ts");

class FakeLive extends EventEmitter {
  state = "running";
  constructor(public liveId: string) {
    super();
  }
  send() {}
  close() {}
}
function fakeHub() {
  const opened: string[] = [];
  const lives = new Map<string, FakeLive>();
  const hub = {
    lives,
    open: (o: { title: string }) => {
      const l = new FakeLive(`live-${opened.length + 1}`);
      opened.push(o.title);
      lives.set(l.liveId, l);
      return l;
    },
  };
  return { hub: hub as never, opened };
}

test("owner: משימה שלי לא מופעלת ב-autoRun, משימת סוכן כן", async () => {
  const { hub, opened } = fakeHub();
  const store = new TaskStore(hub);
  await store.load();
  await store.create({ title: "שלי", prompt: "לעשות", cwd: TMP, owner: "me" });
  await store.create({ title: "של סוכן", prompt: "לעשות", cwd: TMP });
  await store.updateSettings({ autoRun: true, maxParallel: 4 });
  // ה-autoRun רץ ברקע: מחכים עד שנפתח סשן (על Windows זה לוקח יותר מ-50ms), ועוד רגע כדי לוודא שלא נפתח שני
  for (let i = 0; i < 100 && opened.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(opened, ["של סוכן"]);
  assert.equal(store.list().find((t) => t.title === "שלי")?.status, "todo");
});

test("owner: run על משימה שלי נזרק, ולא נפתח סשן", async () => {
  const { hub, opened } = fakeHub();
  const store = new TaskStore(hub);
  await store.load();
  const t = await store.create({ title: "ידנית", prompt: "x", cwd: TMP, owner: "me" });
  await assert.rejects(() => store.run(t.id), /משימה שלך/);
  assert.equal(opened.length, 0);
});

test("owner: ברירת המחדל היא agent, ועדכון owner עובד", async () => {
  const { hub } = fakeHub();
  const store = new TaskStore(hub);
  await store.load();
  const t = await store.create({ title: "רגילה", prompt: "x", cwd: TMP });
  assert.equal(t.owner, "agent");
  const u = await store.update(t.id, { owner: "me" });
  assert.equal(u.owner, "me");
});

test("owner: משימה ישנה בלי שדה owner נחשבת של סוכן", async () => {
  const dir = path.join(TMP, "data");
  fs.mkdirSync(dir, { recursive: true });
  // ה-store של הבדיקות הקודמות (autoRun) עוד כותב את tasks.json אסינכרונית. ב-Linux הכתיבה הזו נחתה בין הכתיבה
  // של הבדיקה לבין load ודרסה אותה. מחכים עד שהקובץ מפסיק להשתנות
  const file = path.join(dir, "tasks.json");
  for (let last = -1, i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 25));
    const m = fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0;
    if (m === last) break;
    last = m;
  }
  const old = { id: "old-1", title: "ישנה", prompt: "x", cwd: TMP, agent: null, model: null, permissionMode: "default", status: "todo", order: 1, createdAt: 1, updatedAt: 1, liveId: null, sessionId: null, summary: null, costUsd: 0, lastError: null };
  fs.writeFileSync(path.join(dir, "tasks.json"), JSON.stringify({ tasks: [old], settings: { autoRun: false, maxParallel: 2 } }));
  const { hub, opened } = fakeHub();
  const store = new TaskStore(hub);
  await store.load();
  await store.run("old-1");
  assert.deepEqual(opened, ["ישנה"]);
});
