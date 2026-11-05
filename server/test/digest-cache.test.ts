import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mifkada-digest-"));
process.env.MIFKADA_DATA = path.join(TMP, "data");
// שפה קבועה: הבדיקות מצפות להודעות בעברית
process.env.MIFKADA_LANG = "he";
const { digest } = await import("../src/digest.ts");
type D = Awaited<ReturnType<typeof digest>>;

const FILE = path.join(TMP, "data", "digest.json");
const today = () => new Date().toISOString().slice(0, 10);
const write = (createdAt: number, date = today()) => {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify({ date, createdAt, bullets: ["ישן"], sessions: 3 }));
};
const H = 3600000;

let calls = 0;
const fresh: D = { date: "x", createdAt: 0, bullets: ["חדש"], sessions: 1 };
const gen = async (): Promise<D> => {
  calls++;
  await new Promise((r) => setTimeout(r, 30));
  return { ...fresh, createdAt: Date.now() };
};

beforeEach(() => {
  calls = 0;
  fs.rmSync(FILE, { force: true });
});

test("digest: תקציר טרי מוחזר מיד, בלי יצירה", async () => {
  write(Date.now() - 10 * 60000);
  const d = await digest([], false, gen);
  assert.deepEqual(d.bullets, ["ישן"]);
  assert.equal(d.stale, undefined);
  assert.equal(calls, 0);
});

test("digest: תקציר ישן (מתחת ל-24 שעות) מוחזר מיד כ-stale, ומתחדש ברקע פעם אחת גם בקריאות מקבילות", async () => {
  write(Date.now() - 5 * H, "2000-01-01");
  const t0 = Date.now();
  const [a, b, c] = await Promise.all([digest([], false, gen), digest([], false, gen), digest([], false, gen)]);
  assert.ok(Date.now() - t0 < 25, "לא חיכה ליצירה");
  for (const d of [a, b, c]) {
    assert.equal(d.stale, true);
    assert.deepEqual(d.bullets, ["ישן"]);
  }
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(calls, 1);
});

test("digest: בלי תקציר בכלל, או ישן מ-24 שעות, או עם force: מחכים ליצירה", async () => {
  assert.deepEqual((await digest([], false, gen)).bullets, ["חדש"]);
  write(Date.now() - 30 * H, "2000-01-01");
  assert.deepEqual((await digest([], false, gen)).bullets, ["חדש"]);
  write(Date.now() - 10 * 60000);
  assert.deepEqual((await digest([], true, gen)).bullets, ["חדש"]);
  assert.equal(calls, 3);
});

test("digest: יצירה שנכשלה ברקע לא מפילה את הקריאה שקיבלה תקציר ישן", async () => {
  write(Date.now() - 5 * H, "2000-01-01");
  const bad = async (): Promise<D> => {
    throw new Error("אין רשת");
  };
  const d = await digest([], false, bad);
  assert.equal(d.stale, true);
  await new Promise((r) => setTimeout(r, 20));
  const d2 = await digest([], false, gen);
  assert.equal(d2.stale, true);
});
