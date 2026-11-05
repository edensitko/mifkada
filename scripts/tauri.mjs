#!/usr/bin/env node
// בנייה של האפליקציה ב-Tauri: שרת וממשק, הכנת מה שנארז (stage-tauri.mjs), ואז tauri build.
//   node scripts/tauri.mjs            → חבילת האפליקציה למערכת הנוכחית (.app / AppImage / exe)
//   node scripts/tauri.mjs --release  → קבצי הפצה: dmg (מק), AppImage + deb (Linux), NSIS (Windows)
//   node scripts/tauri.mjs --install  → (מק) גם התקנה ל-/Applications/Mifkada (Tauri).app
// ה-CLI נעוץ לגרסה ומורץ דרך npx, כדי לא להכניס ל-lockfile חבילות שתלויות במערכת.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI = "@tauri-apps/cli@2.12.4";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const win = process.platform === "win32";
const env = { ...process.env };
// דולף מסשן של Claude Code: הופך את Electron (ש-npm עלול להפעיל) ל-Node
delete env.ELECTRON_RUN_AS_NODE;
// ב-CI סוד שלא הוגדר מגיע כמחרוזת ריקה, ו-Tauri היה מנסה לחתום עם זהות ריקה. ריק = לא קיים (חתימה אד-הוק)
for (const k of Object.keys(env)) if (k.startsWith("APPLE_") && !env[k]) delete env[k];
const run = (cmd, argv, cwd = ROOT) => execFileSync(cmd, argv, { cwd, stdio: "inherit", env, shell: win });

run("npm", ["run", "build", "-w", "server"]);
run("npm", ["run", "build", "-w", "web"]);
run(process.execPath, [path.join(ROOT, "scripts", "stage-tauri.mjs")]);

const bundles = args.has("--release")
  ? process.platform === "darwin"
    ? "app,dmg"
    : process.platform === "linux"
      ? "appimage,deb"
      : "nsis"
  : process.platform === "darwin"
    ? "app"
    : process.platform === "linux"
      ? "appimage"
      : "nsis";
run("npx", ["-y", CLI, "build", "--bundles", bundles], path.join(ROOT, "desktop-tauri"));

const out = path.join(process.env.CARGO_TARGET_DIR ?? path.join(ROOT, "desktop-tauri", "target"), "release", "bundle");
console.log(`\nקבצים: ${out}`);
if (args.has("--install") && process.platform === "darwin") {
  const dest = "/Applications/Mifkada (Tauri).app";
  fs.rmSync(dest, { recursive: true, force: true });
  run("ditto", [path.join(out, "macos", "Mifkada.app"), dest]);
  console.log(`הותקן: ${dest}`);
}
