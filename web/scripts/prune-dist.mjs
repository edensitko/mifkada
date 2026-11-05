// מוחק מ-dist/assets קבצים שה-index.html החדש כבר לא מפנה אליהם (ושאינם נטענים מקבצים שהוא מפנה אליהם)
import fs from "node:fs";
import path from "node:path";

const dist = path.resolve(import.meta.dirname, "..", "dist");
const assets = path.join(dist, "assets");
if (!fs.existsSync(assets)) process.exit(0);
const keep = new Set();
const queue = [fs.readFileSync(path.join(dist, "index.html"), "utf8")];
while (queue.length) {
  const text = queue.pop();
  for (const m of text.matchAll(/([\w.-]+-[\w-]{6,}\.(?:js|css|woff2?|ttf|svg|png|wasm))/g)) {
    if (keep.has(m[1])) continue;
    keep.add(m[1]);
    const f = path.join(assets, m[1]);
    if (/\.(js|css)$/.test(m[1]) && fs.existsSync(f)) queue.push(fs.readFileSync(f, "utf8"));
  }
}
let removed = 0;
for (const f of fs.readdirSync(assets)) {
  // רק קבצים בני יותר מדקה, כדי לא למחוק משהו שחלון פתוח עוד טוען ברגע זה
  const full = path.join(assets, f);
  if (!keep.has(f) && Date.now() - fs.statSync(full).mtimeMs > 60_000) {
    fs.rmSync(full);
    removed++;
  }
}
if (removed) console.log(`prune-dist: ${removed} קבצים ישנים נמחקו`);
