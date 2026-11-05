#!/usr/bin/env node
// מכין את חבילת ה-npm של מפקדה ב-dist-npm/ (שרת וממשק בנויים + bin/mifkada.mjs) ומריץ npm pack.
// לא מפרסם: הפרסום (`npm publish dist-npm`) רק באישור.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "dist-npm");
const win = process.platform === "win32";
const run = (cmd, args, cwd = ROOT) => execFileSync(cmd, args, { cwd, stdio: "inherit", shell: win });

if (!process.argv.includes("--no-build")) {
  run("npm", ["run", "build", "-w", "server"]);
  run("npm", ["run", "build", "-w", "web"]);
}
fs.rmSync(OUT, { recursive: true, force: true });
const noMaps = (s) => !s.endsWith(".map");
fs.cpSync(path.join(ROOT, "server", "dist"), path.join(OUT, "server", "dist"), { recursive: true, filter: noMaps });
fs.cpSync(path.join(ROOT, "web", "dist"), path.join(OUT, "web", "dist"), { recursive: true, filter: noMaps });
fs.mkdirSync(path.join(OUT, "bin"));
fs.copyFileSync(path.join(ROOT, "bin", "mifkada.mjs"), path.join(OUT, "bin", "mifkada.mjs"));
fs.chmodSync(path.join(OUT, "bin", "mifkada.mjs"), 0o755);
for (const f of ["LICENSE", "README.md"]) if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));

// התלויות של זמן ריצה: של השורש ושל השרת, בלי electron וכלי בנייה
const root = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const server = JSON.parse(fs.readFileSync(path.join(ROOT, "server", "package.json"), "utf8"));
const pkg = {
  name: "mifkada",
  version: root.version,
  description: "Mission control for Claude Code and other AI coding agents: sessions, kanban, split view and approvals in one window (Hebrew/English).",
  license: root.license ?? "MIT",
  type: "module",
  bin: { mifkada: "bin/mifkada.mjs" },
  files: ["bin", "server/dist", "web/dist", "LICENSE", "README.md"],
  engines: { node: ">=24" },
  // workspaces: השרת מוצא את שורש החבילה (web/dist) לפי package.json עם workspaces
  workspaces: [],
  dependencies: { ...root.dependencies, ...server.dependencies },
  repository: root.repository,
  homepage: root.homepage,
  keywords: ["claude", "claude-code", "ai", "agents", "codex", "acp", "kanban", "ide"],
};
delete pkg.dependencies.electron;
fs.writeFileSync(path.join(OUT, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
run("npm", ["pack"], OUT);
console.log(`\nחבילה: ${path.relative(ROOT, OUT)}/${pkg.name}-${pkg.version}.tgz (לא פורסמה)`);
