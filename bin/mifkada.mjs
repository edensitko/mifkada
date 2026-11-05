#!/usr/bin/env node
// מפקדה בלי אפליקציה: מריץ את השרת ופותח את הממשק בדפדפן (חבילת npm: `npx mifkada`).
//   mifkada               שרת על 127.0.0.1:4777 (או פורט פנוי) ופתיחה בדפדפן
//   mifkada --port 5000   פורט קבוע
//   mifkada --no-open     בלי לפתוח דפדפן
// השרת מאזין רק על 127.0.0.1, עם בדיקת Host/Origin וטוקן דפדפן (server/src/origin.ts).
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);

await main();

function arg(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main() {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("mifkada [--port N] [--no-open]");
    return;
  }
  const [major] = process.versions.node.split(".").map(Number);
  if (major < 24) {
    console.error(`מפקדה צריכה Node 24 ומעלה (מותקן ${process.version}) / Mifkada needs Node 24+`);
    process.exit(1);
  }
  const wanted = Number(arg("--port") ?? process.env.MIFKADA_PORT ?? 4777);

  // כבר רץ על הפורט הזה (למשל פתיחה שנייה): רק פותחים את הדפדפן
  if (await isMifkada(wanted)) {
    console.log(`מפקדה כבר רצה: http://127.0.0.1:${wanted}`);
    if (!argv.includes("--no-open")) openBrowser(`http://127.0.0.1:${wanted}/`);
    return;
  }
  const port = (await portFree(wanted)) ? wanted : await randomPort();

  const env = { ...process.env, MIFKADA_PORT: String(port), MIFKADA_ROOT: ROOT };
  // מצב דפדפן: פורט מקומי. שקע ומשתנים של האפליקציה (אם דלפו) לא רלוונטיים כאן
  for (const k of ["MIFKADA_SOCKET", "MIFKADA_HOT", "MIFKADA_PARENT_STDIN", "ELECTRON_RUN_AS_NODE"]) delete env[k];
  const child = spawn(process.execPath, [path.join(ROOT, "server", "dist", "server", "src", "index.js")], { env, stdio: "inherit" });
  const stop = () => child.kill("SIGTERM");
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  child.on("exit", (code) => process.exit(code ?? 0));

  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 100; i++) {
    if (await isMifkada(port)) {
      console.log(`\nמפקדה רצה: ${url}  (Ctrl+C לעצירה)\nMifkada is running: ${url}  (Ctrl+C to stop)\n`);
      if (!argv.includes("--no-open")) openBrowser(url);
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  console.error("השרת לא עלה בזמן / The server didn't start in time");
}

async function isMifkada(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok && "lives" in (await r.json());
  } catch {
    return false;
  }
}

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}

function randomPort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

function openBrowser(url) {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* אין דפדפן: הכתובת מודפסת */
  }
}
