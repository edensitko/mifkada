#!/usr/bin/env node
// מריץ פקודה (electron, electron-builder) בלי ELECTRON_RUN_AS_NODE בסביבה. מחליף את `env -u`, שלא קיים ב-Windows.
// מתוך Claude Code או טרמינל של VS Code המשתנה דולף, ו-Electron עולה כ-Node רגיל בלי חלון.
import { spawn } from "node:child_process";

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("usage: node scripts/no-run-as-node.mjs <command> [args...]");
  process.exit(2);
}
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
// shell ב-Windows: electron ו-electron-builder הם קבצי .cmd ב-node_modules/.bin
const child = spawn(cmd, args, { stdio: "inherit", env, shell: process.platform === "win32" });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
