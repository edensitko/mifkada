#!/usr/bin/env node
// מכין את מה שנארז בתוך האפליקציה של Tauri (desktop-tauri/stage): Node, השרת הבנוי, הממשק הבנוי,
// ורק התלויות של זמן ריצה, באותן גרסאות שמותקנות כאן (npm ls --omit=dev), בלי התקנה מחדש.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "desktop-tauri", "stage");
const APP = path.join(OUT, "app");

for (const need of ["server/dist/server/src/index.js", "web/dist/index.html"]) {
  if (!fs.existsSync(path.join(ROOT, need))) {
    console.error(`חסר ${need}: קודם npm run build -w server && npm run build -w web`);
    process.exit(1);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(APP, { recursive: true });

const noMaps = (src) => !src.endsWith(".map");
fs.cpSync(path.join(ROOT, "server", "dist"), path.join(APP, "server", "dist"), { recursive: true, filter: noMaps });
fs.cpSync(path.join(ROOT, "web", "dist"), path.join(APP, "web", "dist"), { recursive: true, filter: noMaps });
fs.copyFileSync(path.join(ROOT, "package.json"), path.join(APP, "package.json"));

// התלויות: רק מה שהשרת צריך בזמן ריצה (השורש + workspace של השרת), מתוך node_modules של השורש.
// הממשק כבר בנוי עם התלויות שלו (vite), אז monaco, react וכו' לא נארזים
const list = execFileSync("npm", ["ls", "--omit=dev", "--all", "--parseable", "--workspace", "server", "--include-workspace-root"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20, shell: process.platform === "win32" });
const nm = path.join(ROOT, "node_modules") + path.sep;
const pkgs = [...new Set(list.split(/\r?\n/).filter((p) => p.startsWith(nm)))]
  // חבילה מקוננת נכנסת עם ההורה שלה
  .sort();
let copied = 0;
let last = "";
for (const p of pkgs) {
  if (last && p.startsWith(last + path.sep)) continue;
  const real = fs.realpathSync(p);
  // workspace (קישור לתיקייה בריפו) לא נארז: השרת והממשק כבר הועתקו כבנויים
  if (!real.startsWith(nm)) continue;
  // Claude Code שה-SDK מביא (272MB) לא נארז: האפליקציה משתמשת ב-claude שמותקן במחשב (server/src/claudeExe.ts)
  if (/@anthropic-ai[\\/]claude-agent-sdk-[a-z0-9]+-[a-z0-9]+$/.test(p)) continue;
  last = p;
  const rel = path.relative(nm, p);
  fs.cpSync(p, path.join(APP, "node_modules", rel), { recursive: true, dereference: false, filter: (s) => !s.includes(`${path.sep}.bin`) && noMaps(s) });
  copied++;
}

// node-pty: רק הבינארי של המערכת הזו (ב-prebuilds יש לכל המערכות)
const prebuilds = path.join(APP, "node_modules", "node-pty", "prebuilds");
if (fs.existsSync(prebuilds)) {
  for (const d of fs.readdirSync(prebuilds)) if (d !== `${process.platform}-${process.arch}`) fs.rmSync(path.join(prebuilds, d), { recursive: true, force: true });
}

// Node עצמו: זה שמריץ את הסקריפט (אותה גרסה שהבדיקות רצות עליה)
const nodeOut = path.join(OUT, process.platform === "win32" ? "node.exe" : "node");
fs.copyFileSync(process.execPath, nodeOut);
fs.chmodSync(nodeOut, 0o755);

const size = (dir) => {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    n += e.isDirectory() ? size(f) : e.isFile() ? fs.statSync(f).size : 0;
  }
  return n;
};
console.log(`stage: ${copied} חבילות, ${(size(OUT) / 1048576).toFixed(0)}MB (Node ${process.version}) → ${path.relative(ROOT, OUT)}`);
