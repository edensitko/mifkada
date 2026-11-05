import { test } from "node:test";
import assert from "node:assert/strict";
import { explainPermissionReason, plainPreview } from "../src/lib/util.ts";

test("plainPreview: מסיר כותרות, הדגשה, קוד וטבלאות, ומחבר לשורה אחת", () => {
  const md = "## כותרת\n\n**חשוב** מאוד, `קוד` [קישור](https://x.y)\n\n| א | ב |\n|---|---|\n| 1 | 2 |\n\n- פריט";
  const out = plainPreview(md);
  assert.ok(!/[#*`|\[\]]/.test(out), out);
  assert.ok(out.includes("חשוב מאוד") && out.includes("קישור") && out.includes("פריט"), out);
  assert.ok(!out.includes("https://x.y") && !out.includes("---"), out);
  assert.ok(!out.includes("\n"));
});

test("plainPreview: חותך באורך מקסימלי עם שלוש נקודות, ולא נוגע בטקסט קצר", () => {
  assert.equal(plainPreview("קצר"), "קצר");
  const long = plainPreview("א".repeat(500), 50);
  assert.equal(long.length, 51);
  assert.ok(long.endsWith("…"));
});

test("explainPermissionReason: cd ו-git מוסבר בעברית, בלי קשר ל-canAlways", () => {
  const r = "This command changes directory before running a version-control command, which can pick up untrusted hooks";
  for (const can of [true, false]) {
    const out = explainPermissionReason(r, can);
    assert.ok(out && out.includes("git -C"), String(out));
  }
});

test("explainPermissionReason: בלי סיבה, או עם 'אשר תמיד' זמין, אין הסבר מיותר", () => {
  assert.equal(explainPermissionReason(undefined, false), null);
  assert.equal(explainPermissionReason("something else", true), null);
  assert.ok(explainPermissionReason("something else", false)?.includes("אשר תמיד"));
});
