// המודול של electron הוא CommonJS, לכן ב-ESM מייבאים את ברירת המחדל ומפרקים
import electron from "electron";
const { app, BrowserWindow, Menu, nativeImage, shell, Notification, Tray, protocol, ipcMain } = electron;
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createHash } from "node:crypto";
import net from "node:net";
import { randomBytes } from "node:crypto";
import http from "node:http";
import { Readable } from "node:stream";
import { createRequire } from "node:module";
import path from "node:path";

const DEV = process.env.MIFKADA_DEV === "1";
app.setName("מפקדה");
// לבדיקות: תיקיית נתונים נפרדת, כדי להריץ עותק בדיקה בלי לגעת בנתונים האמיתיים
if (process.env.MIFKADA_USER_DATA) app.setPath("userData", process.env.MIFKADA_USER_DATA);
const ROOT = app.getAppPath();

/**
 * עדכון חם: כשמופעל בהגדרות, ה-daemon והממשק נטענים מתיקיית הפרויקט (אחרי `npm run hot`) ולא מהעותק הארוז.
 * שינוי בממשק = רענון החלון לבד; שינוי בשרת = ה-daemon עולה מחדש לבד. בלי התקנה מחדש.
 */
function runtimeRoot(): { root: string; hot: boolean } {
  try {
    const st = JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "settings.json"), "utf8")) as { system?: { devMode?: boolean; devDir?: string } };
    // עדכון חם דורש תיקיית קוד מפורשת (devDir). בלי ניחוש של מקום ה-clone
    const dir = st.system?.devDir ?? "";
    if (dir && st.system?.devMode && fs.existsSync(path.join(dir, "server", "dist", "server", "src", "index.js")) && fs.existsSync(path.join(dir, "web", "dist", "index.html"))) {
      return { root: dir, hot: true };
    }
  } catch {
    /* אין הגדרות */
  }
  return { root: ROOT, hot: false };
}
const RUNTIME = runtimeRoot();

/**
 * שפת התפריטים וההתראות: system.lang מההגדרות של מפקדה; auto = לפי שפת המערכת (app.getLocale).
 * נקרא מחדש כשהקובץ משתנה (לפי mtime), כך ששינוי בהגדרות חל בבנייה הבאה של התפריט או בהתראה הבאה, בלי הפעלה מחדש.
 */
let langCache: { mtime: number; lang: "he" | "en" } | null = null;
function uiLang(): "he" | "en" {
  const file = path.join(app.getPath("userData"), "settings.json");
  let mtime = -1;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    /* אין הגדרות */
  }
  if (langCache && langCache.mtime === mtime) return langCache.lang;
  let set: unknown;
  try {
    set = (JSON.parse(fs.readFileSync(file, "utf8")) as { system?: { lang?: unknown } }).system?.lang;
  } catch {
    /* אין הגדרות */
  }
  const sys = (app.isReady() ? app.getLocale() : "") || process.env.LC_ALL || process.env.LANG || "";
  const lang = set === "he" || set === "en" ? set : /^(he|iw)/i.test(sys) ? "he" : "en";
  // לפני ready ה-locale עוד לא ידוע, ולכן לא שומרים
  if (app.isReady()) langCache = { mtime, lang };
  return lang;
}
const L = (he: string, en: string): string => (uiLang() === "he" ? he : en);
/** לוג של התהליך הראשי, לאבחון הפעלות דרך Finder/LaunchServices שאין להן טרמינל. */
function mlog(msg: string): void {
  try {
    fs.appendFileSync(path.join(app.getPath("userData"), "main.log"), `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* אין עדיין תיקייה */
  }
}
process.on("uncaughtException", (e) => mlog(`uncaughtException: ${e.stack ?? e.message}`));
process.on("unhandledRejection", (e) => mlog(`unhandledRejection: ${e instanceof Error ? e.stack ?? e.message : String(e)}`));
mlog(`start pid=${process.pid} argv=${JSON.stringify(process.argv)} dev=${DEV}`);
// אחרי setName, כדי שהתיקייה תהיה ~/Library/Application Support/מפקדה
const USER_DATA = app.getPath("userData");
/**
 * בלי פורט ברשת: ה-daemon מאזין על קובץ שקע (הרשאות 600) בתיקיית הנתונים, והחלון מגיע אליו רק דרך התהליך הזה:
 * בקשות HTTP בפרוטוקול mifkada:// ו-WebSocket דרך גשר ה-preload. שום דף בדפדפן לא יכול להגיע לשרת.
 */
const SOCKET =
  process.platform === "win32"
    ? // Windows: named pipe במקום קובץ שקע. אותו שם כמו socketPath ב-server/src/platform.ts (לא מיובא: desktop נבנה לבד)
      `\\\\.\\pipe\\mifkada-${createHash("sha256").update(USER_DATA.toLowerCase()).digest("hex").slice(0, 12)}`
    : path.join(USER_DATA, "mifkada.sock");

/**
 * WebSocket לשרת על השקע. לא דרך כתובת ws+unix: ה-ws מפרק אותה עם URL, והנתיב מגיע ל-connect מקודד
 * (Application%20Support/%D7%9E...) → ENOENT. לכן הנתיב האמיתי נמסר ישירות ל-net.connect.
 */
/**
 * סוד לערוץ המוגן (server/src/uiTrust.ts): נוצר בכל הפעלה, עובר ל-daemon ב-postMessage (לא ב-env), ומצורף ככותרת
 * לכל בקשה ו-WebSocket מהחלון. ככה רק החלון יכול לאשר פקודה שמשנה פרוד, ולא סוכן שמדבר עם השקע בעצמו
 */
const UI_SECRET = randomBytes(32).toString("hex");
function socketWs(p: string): import("ws").default {
  return new WS(`ws://localhost${p}`, { createConnection: () => net.connect(SOCKET), headers: { "x-mifkada-ui": UI_SECRET } });
}
const APP_URL = "mifkada://app/";
const WS = createRequire(import.meta.url)("ws") as typeof import("ws").default;
// חייב לפני ready: mifkada:// כמקור מאובטח רגיל (fetch, עוגיות, workers של העורך)
protocol.registerSchemesAsPrivileged([{ scheme: "mifkada", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } }]);
const BG = "#f2f2f7";

let daemon: Electron.UtilityProcess | null = null;
let win: Electron.BrowserWindow | null = null;
let appUrl = "";
let daemonPort = 0;
let quitting = false;
let notifySocket: import("ws").default | null = null;
let tray: Electron.Tray | null = null;
let pendingCount = 0;

type NotifyMsg = { t: "notify"; kind: "permission" | "done" | "error"; title: string; body: string; liveId: string; sessionId: string | null };
type LivesMsg = { t: "lives"; lives: Array<{ pendingPermissions: number }> };

/** מאזין ל-daemon ומציג התראות מערכת כשהחלון לא בפוקוס. לחיצה פותחת את הסשן. */
function connectNotifications(port: number): void {
  const open = () => {
    const ws = DEV ? new WS(`ws://127.0.0.1:${port}/ws`) : socketWs("/ws");
    notifySocket = ws;
    ws.on("message", (data) => {
      let m: NotifyMsg | LivesMsg;
      try {
        m = JSON.parse(String(data));
      } catch {
        return;
      }
      if (m.t === "lives") {
        pendingCount = m.lives.reduce((s, l) => s + l.pendingPermissions, 0);
        app.dock?.setBadge(pendingCount > 0 ? String(pendingCount) : "");
        updateTray();
        return;
      }
      if ((m as unknown as { t: string }).t === "app") {
        const want = Boolean((m as unknown as { launchAtLogin?: boolean }).launchAtLogin);
        if (!DEV) app.setLoginItemSettings({ openAtLogin: want });
        return;
      }
      if (m.t !== "notify") return;
      const focused = Boolean(win && !win.isDestroyed() && win.isVisible() && win.isFocused() && !win.isMinimized());
      if (focused && m.kind !== "permission") return;
      if (!Notification.isSupported()) return;
      const n = new Notification({ title: m.title, body: m.body, silent: false });
      n.on("click", () => {
        if (!win || win.isDestroyed()) createWindow(appUrl);
        win?.show();
        win?.focus();
        void win?.webContents.executeJavaScript(`location.hash = ${JSON.stringify("#live=" + m.liveId)}`);
      });
      n.show();
    });
    ws.on("close", () => {
      notifySocket = null;
      if (!quitting) setTimeout(open, 2000);
    });
    ws.on("error", () => ws.close());
  };
  open();
}

/** פורט פנוי: קודם המועדף, ואם תפוס אז אקראי. */
function freePort(preferred: number): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => {
      const s2 = net.createServer();
      s2.listen(0, "127.0.0.1", () => {
        const p = (s2.address() as net.AddressInfo).port;
        s2.close(() => resolve(p));
      });
    });
    srv.listen(preferred, "127.0.0.1", () => srv.close(() => resolve(preferred)));
  });
}

/** ה-PATH של ה-shell של המשתמש. אפליקציה שנפתחת מ-Finder מקבלת PATH מינימלי, ו-Claude Code צריך git, node וכו'. */
function loginPath(): Promise<string> {
  // ב-Windows אפליקציה מקבלת את ה-PATH המלא של המשתמש, אין login shell לשאול
  if (process.platform === "win32") return Promise.resolve("");
  const shellBin = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
  return new Promise((resolve) => {
    const child = execFile(shellBin, ["-ilc", 'echo -n "$PATH"'], { timeout: 5000 }, (err, stdout) => {
      resolve(err ? "" : String(stdout).trim());
    });
    child.on("error", () => resolve(""));
  });
}

function mergePath(login: string): string {
  const extra = process.platform === "win32" ? [] : ["/opt/homebrew/bin", "/usr/local/bin", `${process.env.HOME}/.local/bin`, `${process.env.HOME}/.local/node/bin`];
  const parts = [...login.split(path.delimiter), ...(process.env.PATH ?? "").split(path.delimiter), ...extra];
  return [...new Set(parts.filter(Boolean))].join(path.delimiter);
}

function socketHealth(): Promise<boolean> {
  return new Promise((resolve) => {
    const r = http.get({ socketPath: SOCKET, path: "/api/health" }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    r.on("error", () => resolve(false));
  });
}

async function waitHealth(port: number, timeoutMs = 25000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const ok = DEV ? (await fetch(`http://127.0.0.1:${port}/api/health`)).ok : await socketHealth();
      if (ok) return;
    } catch {
      /* עדיין לא עלה */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(L("ה-daemon של מפקדה לא עלה בזמן", "Mifkada's daemon didn't start in time"));
}

/**
 * ה-daemon רץ ב-utilityProcess של Electron (Node מלא בתהליך נפרד), ולא דרך ELECTRON_RUN_AS_NODE,
 * כך שבבילד הארוז אפשר לכבות את ה-fuse של RunAsNode והאפליקציה לא נשברת כשהמשתנה דולף מטרמינל.
 */
function startDaemon(port: number): void {
  const script = path.join(RUNTIME.root, "server", "dist", "server", "src", "index.js");
  const log = fs.createWriteStream(path.join(USER_DATA, "daemon.log"), { flags: "a" });
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === "string" && k !== "ELECTRON_RUN_AS_NODE") env[k] = v;
  const child = electron.utilityProcess.fork(script, [], {
    env: { ...env, MIFKADA_PORT: String(port), MIFKADA_SOCKET: SOCKET, MIFKADA_ROOT: RUNTIME.root, MIFKADA_DATA: USER_DATA, MIFKADA_HOT: RUNTIME.hot ? "1" : "0" },
    stdio: "pipe",
    serviceName: "mifkada-daemon",
  });
  child.postMessage({ t: "ui-secret", secret: UI_SECRET });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  child.on("exit", (code) => {
    log.write(`\n[daemon exited ${code}]\n`);
    daemon = null;
    if (!quitting) scheduleRestart(port);
  });
  daemon = child;
}

/**
 * Watchdog: אם ה-daemon נפל שלא בזמן יציאה, מרים אותו מחדש על אותו פורט וטוען מחדש את החלון.
 * הסשנים החיים שהיו בו אבדו, אבל אפשר להמשיך אותם מהרשימה. עד 5 ניסיונות בדקה, כדי לא להיכנס ללולאה.
 */
const restarts: number[] = [];
function scheduleRestart(port: number): void {
  const now = Date.now();
  while (restarts.length && now - restarts[0] > 60000) restarts.shift();
  if (restarts.length >= 5) {
    mlog("daemon crashed 5 times in a minute, giving up");
    if (Notification.isSupported()) new Notification({ title: L("מפקדה", "Mifkada"), body: L("השרת הפנימי נופל שוב ושוב. פרטים ב-daemon.log.", "The internal server keeps crashing. Details in daemon.log.") }).show();
    return;
  }
  restarts.push(now);
  mlog(`daemon exited unexpectedly, restarting (${restarts.length})`);
  setTimeout(async () => {
    if (quitting) return;
    startDaemon(port);
    try {
      await waitHealth(port);
      mlog("daemon restarted");
      if (win && !win.isDestroyed()) notifyUpdate("server");
    } catch (e) {
      mlog(`restart health failed: ${(e as Error).message}`);
    }
  }, 800);
}

/** במצב עדכון חם: מאזינים לבילד בתיקיית הפרויקט. ממשק חדש → רענון; שרת חדש → הפעלה מחדש של ה-daemon. */
/**
 * עדכון חם בלי לקטוע: במקום לטעון את החלון מחדש באמצע הקלדה, מודיעים לממשק. הוא נטען לבד כשאין טיוטה,
 * שיחה קולית או פוקוס, ואחרת מציג פס "יש גרסה חדשה". (גרסאות ממשק ישנות בלי המאזין נטענות כרגיל.)
 */
function notifyUpdate(kind: "web" | "server"): void {
  if (!win || win.isDestroyed()) return;
  void win.webContents
    .executeJavaScript(`window.__mifkadaUpdate ? (window.__mifkadaUpdate(${JSON.stringify(kind)}), true) : false`)
    .then((handled: boolean) => {
      if (!handled && kind === "web" && win && !win.isDestroyed()) win.webContents.reload();
    })
    .catch(() => win?.webContents.reload());
}

function watchHot(port: number): void {
  mlog(`hot mode from ${RUNTIME.root}`);
  let webTimer: NodeJS.Timeout | null = null;
  let srvTimer: NodeJS.Timeout | null = null;
  try {
    fs.watch(path.join(RUNTIME.root, "web", "dist"), { recursive: true }, () => {
      if (webTimer) clearTimeout(webTimer);
      webTimer = setTimeout(() => {
        // vite מרוקן את התיקייה ושותק כמה שניות עד הכתיבה: רענון ברווח הזה נופל על 404. הכתיבה תפעיל אותנו שוב
        if (!fs.existsSync(path.join(RUNTIME.root, "web", "dist", "index.html"))) return;
        mlog("hot: web changed, reloading");
        if (win && !win.isDestroyed()) notifyUpdate("web");
      }, 600);
    });
    fs.watch(path.join(RUNTIME.root, "server", "dist"), { recursive: true }, () => {
      if (srvTimer) clearTimeout(srvTimer);
      srvTimer = setTimeout(() => {
        mlog("hot: server changed, restarting daemon");
        // ה-watchdog מרים אותו מחדש על אותו פורט וטוען את החלון
        daemon?.kill();
      }, 900);
    });
  } catch (e) {
    mlog(`hot watch failed: ${(e as Error).message}`);
  }
  void port;
}

/** בקשה מהחלון (mifkada://app/...) עוברת לשרת דרך קובץ השקע. בלי Origin ובלי עוגיות: השקע עצמו הוא ההגנה */
function proxyToDaemon(req: Request): Promise<Response> {
  const u = new URL(req.url);
  return (async () => {
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.from(await req.arrayBuffer());
    const headers: Record<string, string> = { host: "localhost" };
    req.headers.forEach((v, k) => {
      if (!/^(origin|cookie|host|referer|sec-fetch-)/i.test(k)) headers[k] = v;
    });
    if (body) headers["content-length"] = String(body.length);
    // אחרי ההעתקה: גם אם הדף שלח כותרת כזו בעצמו, היא נדרסת
    headers["x-mifkada-ui"] = UI_SECRET;
    return new Promise<Response>((resolve) => {
      const r = http.request({ socketPath: SOCKET, path: u.pathname + u.search, method: req.method, headers }, (res) => {
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined && k !== "set-cookie") h.set(k, Array.isArray(v) ? v.join(", ") : String(v));
        const status = res.statusCode ?? 500;
        const noBody = status === 204 || status === 304 || req.method === "HEAD";
        if (noBody) res.resume();
        resolve(new Response(noBody ? null : (Readable.toWeb(res) as ReadableStream), { status, headers: h }));
      });
      r.on("error", () => resolve(new Response(L("השרת של מפקדה לא זמין כרגע", "Mifkada's server isn't available right now"), { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } })));
      if (body) r.write(body);
      r.end();
    });
  })();
}

/** WebSocket מהחלון דרך התהליך הראשי (preload.cjs): רק /ws ו-/ws/term, ורק לשרת על השקע */
function registerBridge(): void {
  protocol.handle("mifkada", (req) => proxyToDaemon(req));
  const sockets = new Map<string, import("ws").default>();
  ipcMain.on("net:open", (e, id: string, p: string) => {
    if (p !== "/ws" && p !== "/ws/term") return;
    const sender = e.sender;
    const ws = socketWs(p);
    sockets.set(id, ws);
    const emit = (ev: { id: string; type: "open" | "message" | "close"; data?: string | Uint8Array }) => {
      if (!sender.isDestroyed()) sender.send("net:event", ev);
    };
    ws.on("open", () => emit({ id, type: "open" }));
    ws.on("message", (data, isBinary) => emit({ id, type: "message", data: isBinary ? new Uint8Array(data as Buffer) : String(data) }));
    ws.on("close", () => {
      sockets.delete(id);
      emit({ id, type: "close" });
    });
    ws.on("error", (err) => {
      mlog(`bridge ws error ${p}: ${err.message}`);
      ws.close();
    });
    sender.once("destroyed", () => ws.close());
  });
  ipcMain.on("net:send", (_e, id: string, data: string) => {
    const ws = sockets.get(id);
    if (ws && ws.readyState === ws.OPEN) ws.send(data);
  });
  ipcMain.on("net:close", (_e, id: string) => sockets.get(id)?.close());
}

type Bounds = { x?: number; y?: number; width: number; height: number };
const boundsFile = path.join(USER_DATA, "window.json");

function loadBounds(): Bounds {
  try {
    const b = JSON.parse(fs.readFileSync(boundsFile, "utf8")) as Bounds;
    if (b.width > 600 && b.height > 400) return b;
  } catch {
    /* ברירת מחדל */
  }
  return { width: 1440, height: 900 };
}

function createWindow(url: string): void {
  const bounds = loadBounds();
  win = new BrowserWindow({
    ...bounds,
    minWidth: 1000,
    minHeight: 640,
    title: L("מפקדה", "Mifkada"),
    backgroundColor: BG,
    // macOS: בלי פס כותרת, עם הכפתורים בתוך החלון. Windows/Linux: מסגרת רגילה, ושורת התפריטים מוסתרת (Alt מציג)
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 16, y: 18 } } : { autoHideMenuBar: true, icon: path.join(ROOT, "desktop", "icon.png") }),
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, ...(DEV ? {} : { preload: path.join(ROOT, "desktop", "preload.cjs") }) },
  });
  win.once("ready-to-show", () => win?.show());
  // בעותק בדיקה: שגיאות מהחלון נכתבות ל-main.log
  if (process.env.MIFKADA_USER_DATA) win.webContents.on("console-message", (_e, level, message) => level >= 2 && mlog(`renderer: ${message}`));
  win.webContents.on("preload-error", (_e, p, err) => mlog(`preload error ${p}: ${err.message}`));
  let saveTimer: NodeJS.Timeout | null = null;
  const save = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (win && !win.isDestroyed()) fs.writeFileSync(boundsFile, JSON.stringify(win.getBounds()));
    }, 400);
  };
  win.on("resize", save);
  win.on("move", save);
  // קישורים החוצה נפתחים בדפדפן, ורק http/https (קישור file:// או סכמה של אפליקציה אחרת לא יופעל)
  const openOutside = (target: string) => {
    try {
      const u = new URL(target);
      if (u.protocol === "http:" || u.protocol === "https:") void shell.openExternal(u.toString());
    } catch {
      /* כתובת לא תקינה */
    }
  };
  // רק המקור המדויק של מפקדה ("http://127.0.0.1.evil.com" עבר בבדיקת startsWith הקודמת)
  const ownOrigin = new URL(url).origin;
  win.webContents.setWindowOpenHandler(({ url: target }: { url: string }) => {
    openOutside(target);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e: Electron.Event, target: string) => {
    let same = false;
    try {
      same = new URL(target).origin === ownOrigin;
    } catch {
      /* לא תקין */
    }
    if (!same) {
      e.preventDefault();
      openOutside(target);
    }
  });
  // לא לצרף webview ולא להוריד קבצים בשקט
  win.webContents.on("will-attach-webview", (e: Electron.Event) => e.preventDefault());
  win.on("close", (e: Electron.Event) => {
    if (process.platform === "darwin" && !quitting && !process.env.MIFKADA_SCREENSHOT) {
      e.preventDefault();
      win?.hide();
    }
  });
  win.on("closed", () => (win = null));

  // מצב צילום מסך לבדיקות: MIFKADA_SCREENSHOT=/path.png מצלם את החלון ויוצא
  const shot = process.env.MIFKADA_SCREENSHOT;
  if (shot) {
    win.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        const img = await win!.webContents.capturePage();
        fs.writeFileSync(shot, img.toPNG());
        app.quit();
      }, Number(process.env.MIFKADA_SCREENSHOT_DELAY ?? 3000));
    });
  }
  void win.loadURL(url);
}

/** אייקון בסרגל התפריטים: פתיחה, סשן חדש, מספר האישורים הממתינים. */
function showWindow(hash?: string): void {
  if (!win || win.isDestroyed()) createWindow(appUrl);
  win?.show();
  win?.focus();
  if (hash) void win?.webContents.executeJavaScript(`location.hash = ${JSON.stringify(hash)}`);
}

/** השפה שבה נבנה תפריט האפליקציה. כשהיא משתנה, התפריט נבנה מחדש בעדכון הבא של האייקון */
let menuLang: "he" | "en" | null = null;

function updateTray(): void {
  if (menuLang && menuLang !== uiLang()) buildMenu();
  if (!tray) return;
  tray.setTitle(pendingCount > 0 ? String(pendingCount) : "");
  tray.setToolTip(L("מפקדה", "Mifkada"));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: L("פתח את מפקדה", "Open Mifkada"), click: () => showWindow() },
      { label: L("סשן חדש", "New session"), click: () => showWindow("#new") },
      {
        label: pendingCount > 0 ? L(`${pendingCount} אישורים ממתינים`, `${pendingCount} pending approvals`) : L("אין אישורים ממתינים", "No pending approvals"),
        enabled: pendingCount > 0,
        click: () => showWindow("#inbox"),
      },
      { type: "separator" },
      { label: L("יציאה", "Quit"), click: () => app.quit() },
    ]),
  );
}

function createTray(): void {
  // macOS: אייקון template (מתאים את עצמו לבהיר/כהה). Windows/Linux: האייקון הצבעוני, מוקטן
  const mac = process.platform === "darwin";
  const p = path.join(ROOT, "desktop", mac ? "trayTemplate.png" : "icon.png");
  if (!fs.existsSync(p)) return;
  const img = mac ? nativeImage.createFromPath(p) : nativeImage.createFromPath(p).resize({ width: 16, height: 16 });
  if (mac) img.setTemplateImage(true);
  tray = new Tray(img);
  tray.on("click", () => showWindow());
  updateTray();
}

function buildMenu(): void {
  menuLang = uiLang();
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: L("מפקדה", "Mifkada"),
      submenu: [{ role: "about", label: L("על מפקדה", "About Mifkada") }, { type: "separator" }, { role: "hide", label: L("הסתר", "Hide") }, { role: "quit", label: L("יציאה", "Quit") }],
    },
    { label: L("עריכה", "Edit"), submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: L("תצוגה", "View"), submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
    // כמו ב-VS Code: ⌘W סוגר כרטיסייה של שיחה (EditorTabs), ⇧⌘W סוגר את החלון
    { label: L("חלון", "Window"), submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close", accelerator: "CmdOrCtrl+Shift+W" }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  mlog("ready");
  // ⌥⌘Space מכל מקום במק: מביא את מפקדה ופותח שיחה קולית
  try {
    electron.globalShortcut.register("Alt+CommandOrControl+Space", () => showWindow("#voice"));
  } catch (e) {
    mlog(`globalShortcut failed: ${(e as Error).message}`);
  }
  buildMenu();
  try {
    createTray();
    mlog("tray ok");
  } catch (e) {
    mlog(`tray failed: ${(e as Error).message}`);
  }
  // מיקרופון לדיבור והתראות: לאשר מהרנדרר בלי שאלות (macOS שואל בעצמו דרך TCC)
  electron.session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "media" || permission === "notifications" || permission === "clipboard-read"));
  electron.session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === "media" || permission === "notifications" || permission === "clipboard-read");
  const iconPng = path.join(ROOT, "desktop", "icon.png");
  if (process.platform === "darwin" && fs.existsSync(iconPng)) app.dock?.setIcon(nativeImage.createFromPath(iconPng));
  process.env.PATH = mergePath(await loginPath());
  mlog("path ok");

  let url: string;
  let port: number;
  if (DEV) {
    url = "http://127.0.0.1:4778";
    port = 4777;
  } else {
    port = await freePort(4777);
    daemonPort = port;
    startDaemon(port);
    if (RUNTIME.hot) watchHot(port);
    mlog(`daemon spawned on ${port}`);
    await waitHealth(port);
    mlog("daemon healthy");
    registerBridge();
    url = APP_URL;
  }
  appUrl = url;
  createWindow(url);
  mlog("window created");
  connectNotifications(port);
  try {
    const st = JSON.parse(fs.readFileSync(path.join(USER_DATA, "settings.json"), "utf8")) as { system?: { launchAtLogin?: boolean } };
    if (!DEV && typeof st.system?.launchAtLogin === "boolean") app.setLoginItemSettings({ openAtLogin: st.system.launchAtLogin });
  } catch {
    /* אין הגדרות עדיין */
  }
  if (process.env.MIFKADA_TEST_NOTIFY === "1" && Notification.isSupported()) {
    new Notification({ title: L("מפקדה", "Mifkada"), body: L("ההתראות עובדות", "Notifications are working") }).show();
  }

  // לחיצה על האייקון ב-Dock כשאין חלון: לפתוח חלון חדש מול אותו daemon, הסשנים ממשיכים
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(appUrl);
    else win?.show();
  });
});

// ב-mac סגירת החלון משאירה את האפליקציה ב-Dock. יציאה אמיתית רק ב-Cmd+Q
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  mlog("before-quit");
  quitting = true;
  notifySocket?.close();
  daemon?.kill();
});
