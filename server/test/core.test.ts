import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// הנתונים של מפקדה הולכים לתיקייה זמנית, לפני שמודול כלשהו קורא את paths.ts
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mifkada-test-"));
process.env.MIFKADA_DATA = path.join(TMP, "data");
// שפה קבועה: הבדיקות מצפות להודעות בעברית
process.env.MIFKADA_LANG = "he";
// ~/.claude מדומה לבדיקת סריקת הסקילים
process.env.CLAUDE_CONFIG_DIR = path.join(TMP, "claude-home");
// הערוץ המוגן לחלון (uiTrust.ts): באפליקציה הסוד מגיע מ-Electron, בבדיקות ממשתנה סביבה
const UI_SECRET = "ab".repeat(32);
process.env.MIFKADA_UI_SECRET = UI_SECRET;
// "0": לא לקרוא מ-stdin בבדיקה, רק לוודא שהדגל לא נשאר בסביבה לתהליכי ילד
process.env.MIFKADA_UI_SECRET_STDIN = "0";

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

function makeRepo(name: string): string {
  const root = path.join(TMP, name);
  fs.mkdirSync(path.join(root, "app", "src"), { recursive: true });
  git(TMP, "init", "-q", "-b", "main", root);
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  fs.writeFileSync(path.join(root, "README.md"), "# repo\n");
  fs.writeFileSync(path.join(root, "app", "src", "a.ts"), "export const a = 1;\n");
  fs.writeFileSync(path.join(root, "other.txt"), "x\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  return root;
}

let repo = "";
before(() => {
  repo = makeRepo("repo");
});
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

test("worktree: עבודה בענף לא נוגעת בעץ הראשי, ומיזוג מביא את השינוי", async () => {
  const { createWorktree, mergeWorktree, worktreeStatus } = await import("../src/worktree.js");
  const wt = await createWorktree(path.join(repo, "app"), "abcdef123456", "demo");
  assert.equal(wt.prefix, "app/");
  assert.equal(wt.base, "main");
  fs.writeFileSync(path.join(wt.path, "app", "new.txt"), "hello\n");
  assert.equal(fs.existsSync(path.join(repo, "app", "new.txt")), false, "העץ הראשי נשאר נקי");
  assert.deepEqual(await worktreeStatus(wt), { changed: 1, commits: 0 });
  const hash = await mergeWorktree(wt, "demo");
  assert.match(hash, /^[0-9a-f]{7,}$/);
  assert.equal(fs.readFileSync(path.join(repo, "app", "new.txt"), "utf8"), "hello\n");
  assert.equal(fs.existsSync(wt.path), false, "ה-worktree נמחק");
  assert.ok(!git(repo, "branch").includes("mifkada/"), "הענף נמחק");
});

test("worktree: הפעלה חוזרת ממשיכה ענף קיים במקום להיכשל", async () => {
  const { createWorktree, removeWorktree } = await import("../src/worktree.js");
  const first = await createWorktree(repo, "aaaa11112222", "again");
  fs.writeFileSync(path.join(first.path, "work.txt"), "x");
  execFileSync("git", ["-C", first.path, "add", "-A"]);
  execFileSync("git", ["-C", first.path, "commit", "-qm", "work"]);
  // אותה משימה שוב, כשה-worktree עוד קיים: מקבלים אותו
  const same = await createWorktree(repo, "aaaa11112222", "again");
  assert.equal(fs.realpathSync(same.path), fs.realpathSync(first.path));
  // ה-worktree נמחק אבל הענף נשאר: worktree חדש על אותו ענף, עם העבודה
  execFileSync("git", ["-C", repo, "worktree", "remove", "--force", first.path]);
  const again = await createWorktree(repo, "aaaa11112222", "again");
  assert.equal(again.branch, first.branch);
  assert.equal(fs.existsSync(path.join(again.path, "work.txt")), true);
  await removeWorktree(again);
});

test("worktree: זריקה מוחקת בלי למזג", async () => {
  const { createWorktree, removeWorktree } = await import("../src/worktree.js");
  const wt = await createWorktree(repo, "ffff00001111", "drop");
  fs.writeFileSync(path.join(wt.path, "junk.txt"), "x");
  await removeWorktree(wt);
  assert.equal(fs.existsSync(path.join(repo, "junk.txt")), false);
  assert.equal(fs.existsSync(wt.path), false);
});

test("worktree: מיזוג נכשל ומתבטל כשהריפו הראשי בענף אחר", async () => {
  const { createWorktree, mergeWorktree, removeWorktree } = await import("../src/worktree.js");
  const wt = await createWorktree(repo, "123412341234", "other");
  git(repo, "checkout", "-qb", "side");
  try {
    await assert.rejects(() => mergeWorktree(wt, "x"), /ענף/);
  } finally {
    git(repo, "checkout", "-q", "main");
    await removeWorktree(wt);
  }
});

test("git: שינויים רק בתיקיית הפרויקט בתוך מונורפו", async () => {
  const { changedFiles, fileDiff, discardFile } = await import("../src/git.js");
  fs.writeFileSync(path.join(repo, "app", "src", "a.ts"), "export const a = 2;\n");
  fs.writeFileSync(path.join(repo, "app", "fresh.ts"), "new\n");
  fs.writeFileSync(path.join(repo, "other.txt"), "changed outside\n");
  const files = await changedFiles(path.join(repo, "app"));
  assert.deepEqual(
    files.map((f) => [f.path, f.status]),
    [
      ["fresh.ts", "untracked"],
      ["src/a.ts", "modified"],
    ],
  );
  const d = await fileDiff(path.join(repo, "app"), "src/a.ts");
  assert.equal(d.before, "export const a = 1;\n");
  assert.equal(d.after, "export const a = 2;\n");
  await discardFile(path.join(repo, "app"), "src/a.ts");
  await discardFile(path.join(repo, "app"), "fresh.ts");
  assert.equal((await changedFiles(path.join(repo, "app"))).length, 0);
  git(repo, "checkout", "--", "other.txt");
});

test("fs: אין גישה מחוץ לפרויקט", async () => {
  const { resolveInside } = await import("../src/fs.js");
  assert.throws(() => resolveInside(repo, "../../etc/passwd"), /מחוץ לפרויקט/);
  assert.throws(() => resolveInside(repo, "/etc/passwd"), /מחוץ לפרויקט/);
  assert.equal(resolveInside(repo, "app/src/a.ts"), path.join(repo, "app", "src", "a.ts"));
});

test("search: רשימת קבצים וחיפוש טקסט", async () => {
  const { listFiles, searchText } = await import("../src/search.js");
  const files = await listFiles(repo);
  assert.ok(files.includes("app/src/a.ts"));
  assert.ok(!files.some((f) => f.startsWith(".git/")));
  const hits = await searchText(repo, "const a");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, "app/src/a.ts");
  assert.equal(hits[0].line, 1);
});

test("routines: חישוב ההרצה הבאה", async () => {
  const { nextRun } = await import("../src/routines.js");
  const base = { id: "r", title: "t", prompt: "p", cwd: "/", agent: null, model: null, permissionMode: "plan" as const, enabled: true, createdAt: 0 };
  const mon9 = new Date(2026, 9, 19, 8, 0, 0).getTime(); // יום שני 08:00
  const daily = { ...base, lastRun: null, schedule: { kind: "daily" as const, time: "09:00", days: [1] } };
  assert.equal(new Date(nextRun(daily, mon9)).getHours(), 9);
  assert.equal(new Date(nextRun(daily, mon9)).getDay(), 1);
  const ranToday = { ...daily, lastRun: new Date(2026, 9, 19, 9, 0, 5).getTime() };
  const n = new Date(nextRun(ranToday, ranToday.lastRun));
  assert.equal(n.getDay(), 1, "בשבוע הבא, שוב ביום שני");
  assert.ok(n.getTime() > ranToday.lastRun + 6 * 86400000);
  const interval = { ...base, lastRun: 1_000_000, schedule: { kind: "interval" as const, minutes: 30 } };
  assert.equal(nextRun(interval), 1_000_000 + 30 * 60000);
});

test("backup: מעתיק את קבצי הנתונים", async () => {
  const { backupNow, listBackups } = await import("../src/backup.js");
  fs.mkdirSync(process.env.MIFKADA_DATA!, { recursive: true });
  fs.writeFileSync(path.join(process.env.MIFKADA_DATA!, "tasks.json"), '{"tasks":[]}');
  const dir = await backupNow();
  assert.ok(dir && fs.existsSync(path.join(dir, "tasks.json")));
  assert.equal((await listBackups()).length, 1);
});

test("agents: frontmatter עם נקודתיים בתיאור", async () => {
  const { parseFrontmatter } = await import("../src/agents.js");
  const fm = parseFrontmatter("---\nname: server-ops\ndescription: תפעול השרת: בדיקות, לוגים\ntools: Bash, Read\n---\nprompt");
  assert.equal(fm.name, "server-ops");
  assert.equal(fm.description, "תפעול השרת: בדיקות, לוגים");
});

test("history: תזכורות מערכת והודעות פקודה לא מוצגות", async () => {
  const { toBlocks } = await import("../src/history.js");
  assert.deepEqual(toBlocks("שלום<system-reminder>סוד</system-reminder>"), [{ type: "text", text: "שלום" }]);
  assert.deepEqual(toBlocks("<command-name>/model</command-name>"), []);
  assert.deepEqual(toBlocks([{ type: "tool_result", tool_use_id: "x", content: [{ type: "text", text: "ok" }] }]), [{ type: "tool_result", toolUseId: "x", content: "ok", isError: false }]);
});

test("capabilities: סקילים בעומק (אוסף ומסונכרנים) נמצאים", async () => {
  const home = process.env.CLAUDE_CONFIG_DIR!;
  const mk = (rel: string, name: string) => {
    fs.mkdirSync(path.join(home, "skills", rel), { recursive: true });
    fs.writeFileSync(path.join(home, "skills", rel, "SKILL.md"), `---\nname: ${name}\ndescription: d\n---\nbody`);
  };
  mk("plain", "plain");
  mk("collection/inner-a", "inner-a");
  mk("synced/abc123/pdf", "pdf");
  fs.mkdirSync(path.join(home, "skills", "plain", "assets", "deep"), { recursive: true });
  const { capabilities } = await import("../src/capabilities.js");
  const caps = await capabilities();
  const by = Object.fromEntries(caps.filter((c) => c.kind === "skill").map((c) => [c.name, c.scope]));
  assert.equal(by.plain, "user");
  assert.equal(by["inner-a"], "user");
  assert.equal(by.pdf, "synced");
});

test("stt: משפטים ש-whisper ממציא על שקט מסוננים", async () => {
  const { isHallucination } = await import("../src/stt.js");
  for (const t of ["תודה רבה.", "תודה רבה!", "תודה רבה תודה רבה", "Thank you.", "כתוביות על ידי קהילת אמארה", ""]) assert.equal(isHallucination(t), true, t);
  for (const t of ["תודה רבה, עכשיו תריץ את הבדיקות", "תפתח סשן חדש בגרינרה", "כן"]) assert.equal(isHallucination(t), false, t);
});

test("settings: שעות שקטות, כולל חציית חצות ושבת", async () => {
  const { setSystemPrefs, isQuiet } = await import("../src/settings.js");
  await setSystemPrefs({ quiet: { enabled: true, from: "22:00", to: "07:30", shabbat: true } });
  assert.equal(isQuiet(new Date(2026, 9, 21, 23, 0)), true, "רביעי 23:00");
  assert.equal(isQuiet(new Date(2026, 9, 22, 6, 59)), true, "חמישי 06:59");
  assert.equal(isQuiet(new Date(2026, 9, 22, 12, 0)), false, "חמישי בצהריים");
  assert.equal(isQuiet(new Date(2026, 9, 24, 14, 0)), true, "שבת בצהריים");
  await setSystemPrefs({ quiet: { enabled: false, from: "22:00", to: "07:30", shabbat: true } });
  assert.equal(isQuiet(new Date(2026, 9, 21, 23, 0)), false, "כבוי");
});

test("safety: כלל עובר בין רשימות, נמחק, ונשמר גיבוי", async () => {
  const home = process.env.CLAUDE_CONFIG_DIR!;
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, "settings.json"), JSON.stringify({ model: "x", permissions: { allow: ["Bash"], defaultMode: "auto" } }));
  const { setRule, readSafety, setDefaultMode } = await import("../src/safety.js");
  let st = await setRule("Bash(git push:*)", "ask");
  assert.deepEqual(st.ask, ["Bash(git push:*)"]);
  st = await setRule("Bash(git push:*)", "deny");
  assert.deepEqual([st.ask, st.deny], [[], ["Bash(git push:*)"]]);
  st = await setRule("Bash(git push:*)", null);
  assert.deepEqual(st.deny, []);
  assert.deepEqual(st.allow, ["Bash"], "כללים אחרים לא נוגעים");
  await setDefaultMode("plan");
  assert.equal((await readSafety()).defaultMode, "plan");
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, "settings.json"), "utf8")).model, "x", "שאר ההגדרות נשמרות");
  assert.ok(fs.readdirSync(home).some((n) => n.startsWith("settings.json.mifkada-backup-")), "גיבוי עם חותמת זמן");
  await assert.rejects(() => setRule("rm -rf /; echo", "deny"), /לא תקין/);
});

test("profiles + export/import", async () => {
  const { setProfile, readProfiles } = await import("../src/profiles.js");
  await setProfile("/p/a", { model: "opus", permissionMode: "plan", agent: null });
  assert.equal((await readProfiles())["/p/a"].model, "opus");
  const { exportData, importData } = await import("../src/settings.js");
  const exp = await exportData();
  assert.ok(exp.profiles && !JSON.stringify(exp).includes("openaiKey"));
  await setProfile("/p/a", null);
  assert.equal((await readProfiles())["/p/a"], undefined);
  const written = await importData(exp);
  assert.ok(written.includes("profiles"));
  assert.equal((await readProfiles())["/p/a"].permissionMode, "plan");
});


test("ניצול המנוי: פענוח הפלט של /usage", async () => {
  const { parsePlanUsage } = await import("../src/planUsage.js");
  const r = parsePlanUsage("You are currently using your subscription\n\nCurrent session: 3% used · resets Oct 22 at 4:30am (Asia/Jerusalem)\nCurrent week (all models): 8% used · resets Oct 22 at 4pm (Asia/Jerusalem)\n");
  assert.equal(r.length, 2);
  assert.equal(r[0].label, "Current session");
  assert.equal(r[0].percent, 3);
  assert.equal(r[1].resets, "Oct 22 at 4pm (Asia/Jerusalem)");
});

test("הגנה מאתרים זרים: Origin ו-Host", async () => {
  const { isAllowedRequest } = await import("../src/origin.js");
  const ports = new Set(["4777", "4778"]);
  // מפקדה עצמה, שרת הפיתוח, ותהליך מקומי בלי Origin
  assert.equal(isAllowedRequest({ host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" }, ports), true);
  assert.equal(isAllowedRequest({ host: "127.0.0.1:4777", origin: "http://localhost:4778" }, ports), true);
  assert.equal(isAllowedRequest({ host: "127.0.0.1:4777" }, ports), true);
  // אתר זר, Origin null, פורט אחר, DNS rebinding, cross-site
  assert.equal(isAllowedRequest({ host: "127.0.0.1:4777", origin: "https://evil.example.com" }, ports), false);
  assert.equal(isAllowedRequest({ host: "127.0.0.1:4777", origin: "null" }, ports), false);
  assert.equal(isAllowedRequest({ host: "127.0.0.1:4777", origin: "http://127.0.0.1:3000" }, ports), false);
  assert.equal(isAllowedRequest({ host: "evil.example.com:4777" }, ports), false);
  assert.equal(isAllowedRequest({ host: "127.0.0.1:4777", "sec-fetch-site": "cross-site" }, ports), false);
});

test("טוקן לדפדפן: בקשה מדפדפן בלי עוגייה נחסמת", async () => {
  const { hasBrowserToken, BROWSER_TOKEN, TOKEN_COOKIE } = await import("../src/origin.js");
  assert.equal(hasBrowserToken({}), true); // תהליך מקומי
  assert.equal(hasBrowserToken({ origin: "http://127.0.0.1:4777" }), false);
  assert.equal(hasBrowserToken({ "sec-fetch-site": "same-origin", cookie: `${TOKEN_COOKIE}=nope` }), false);
  assert.equal(hasBrowserToken({ origin: "http://127.0.0.1:4777", cookie: `a=1; ${TOKEN_COOKIE}=${BROWSER_TOKEN}` }), true);
});

test("תמלול: פלט בשפה זרה בלי עברית הוא רעש", async () => {
  const { isHallucination } = await import("../src/stt.js");
  assert.equal(isHallucination("Kamatikjöld brékt inn kærum nýmlega þá."), true);
  assert.equal(isHallucination("open the deploy script"), false);
  assert.equal(isHallucination("תפתח את ה-README"), false);
});

test("הרחבות: פענוח של claude mcp list", async () => {
  const { parseMcpList } = await import("../src/extensions.ts");
  const out = parseMcpList(
    "Checking MCP server health…\n\nclaude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected\nplugin:takin:engine: sh /x/run.sh - ✔ Connected\nplugin:heygen:heygen: https://mcp.heygen.com/mcp/v1/ (HTTP) - ! Needs authentication\nfs: npx -y server-fs ~/p - ✗ Failed to connect\n",
  );
  assert.deepEqual(
    out.map((s) => [s.name, s.status, s.source]),
    [
      ["claude.ai Gmail", "connected", "claude.ai"],
      ["plugin:takin:engine", "connected", "plugin"],
      ["plugin:heygen:heygen", "auth", "plugin"],
      ["fs", "failed", "config"],
    ],
  );
  assert.equal(out[3].target, "npx -y server-fs ~/p");
});

test("שומר הפרוד: מה נחשב שינוי בשרת", async () => {
  const { classifyCommand } = await import("../src/prodGuard.js");
  const dir = path.join(TMP, "scripts");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "deploy.sh"), '#!/bin/bash\nssh prod-server "docker compose up -d web"\n');
  fs.writeFileSync(path.join(dir, "ok.sh"), "echo hi\n");
  // בפקודת shell נתיב נכתב עם /, גם ב-Windows (Git Bash): \ הוא תו בריחה
  const sh = dir.split(path.sep).join("/");
  const cases: Array<[string, boolean]> = [
    // קריאה בלבד: ops ממשיך לעבוד בלי שאלה
    [`ssh prod-server "docker ps --format 'table {{.Names}}\t{{.Status}}' ; df -h / ; free -m ; systemctl --failed"`, false],
    ["ssh prod-server docker logs --tail 50 app-web 2>&1 | tail -20", false],
    ["ssh prod-server 'cd /home/ubuntu/app && docker compose ps'", false],
    ['ssh prod-server "docker exec app-nginx nginx -t"', false],
    ["docker build --platform linux/amd64 -t x .", false],
    ["gcloud compute instances list", false],
    ["cd ~/projects/acme-clients && git status", false],
    ["grep -rn prod-server ~/notes/docs", false],
    ["curl -sI https://example.com", false],
    ["ssh github.com", false],
    [`bash ${sh}/ok.sh`, false],
    // שינוי בפרוד
    ["ssh prod-server", true],
    ["ssh prod-server 'cd /home/ubuntu/app && docker compose up -d web'", true],
    ['ssh prod-server "docker exec app-nginx nginx -s reload"', true],
    ["ssh prod-server /home/ubuntu/deploy-tag.sh --apply", true],
    ["ssh -i ~/.ssh/deploy.pem ubuntu@203.0.113.10 docker pull x", true],
    ["ssh prod-server bash -s < /tmp/x.sh", true],
    ['ssh prod-server "echo hi > /tmp/x"', true],
    ['ssh prod-server "sudo systemctl restart nginx"', true],
    ["docker push acme/web:latest", true],
    ["docker buildx build --platform linux/amd64 -t x --push .", true],
    ["scp dist.tar prod-server:/home/ubuntu/", true],
    ["rsync -av ./out/ ubuntu@prod-server:/srv/x", true],
    [`bash -c "ssh prod-server 'docker restart web'"`, true],
    [`bash ${sh}/deploy.sh`, true],
    [`${sh}/deploy.sh`, true],
    ["gcloud compute ssh prod-vm --zone x", true],
    ["x=$(ssh prod-server docker ps)", true],
    ["DOCKER_HOST=ssh://prod-server docker compose up -d", true],
    [`python3 -c "import subprocess; subprocess.run(['ssh','prod-server','docker restart web'])"`, true],
  ];
  for (const [cmd, want] of cases) assert.equal(classifyCommand(cmd, TMP).prod, want, cmd);
});

test("ערוץ מוגן: רק כותרת עם הסוד", async () => {
  const { isTrustedUi, hasUiSecret } = await import("../src/uiTrust.js");
  assert.equal(hasUiSecret(), true);
  assert.equal(isTrustedUi({ "x-mifkada-ui": UI_SECRET }), true);
  assert.equal(isTrustedUi({ "x-mifkada-ui": "cd".repeat(32) }), false);
  assert.equal(isTrustedUi({}), false);
});

test("ערוץ מוגן: הסוד מגיע מ-stdin (Tauri) ולא נשאר בסביבה", async () => {
  const { PassThrough } = await import("node:stream");
  const { isTrustedUi, readSecretFrom } = await import("../src/uiTrust.js");
  assert.equal(process.env.MIFKADA_UI_SECRET, undefined);
  assert.equal(process.env.MIFKADA_UI_SECRET_STDIN, undefined);
  const other = "0f".repeat(32);
  const s = new PassThrough();
  readSecretFrom(s);
  // שורה לא תקינה ואז תקינה שמגיעה בשני חלקים
  s.write("ui-secret XYZ\nui-secret " + other.slice(0, 20));
  assert.equal(isTrustedUi({ "x-mifkada-ui": other }), false);
  s.write(other.slice(20) + "\n");
  assert.equal(isTrustedUi({ "x-mifkada-ui": other }), true);
  // אחרי הראשונה לא מקשיבים יותר: שורה נוספת לא מחליפה את הסוד
  s.write(`ui-secret ${"11".repeat(32)}\n`);
  assert.equal(isTrustedUi({ "x-mifkada-ui": other }), true);
  assert.equal(s.listenerCount("data"), 0);
  // מחזירים את הסוד של שאר הבדיקות
  const back = new PassThrough();
  readSecretFrom(back);
  back.write(`ui-secret ${UI_SECRET}\n`);
  assert.equal(isTrustedUi({ "x-mifkada-ui": UI_SECRET }), true);
});

test("שומר הפרוד: אישור רק מהחלון, אישור לסשן נגמר כשהקומיט משתנה", async () => {
  const { LiveSession } = await import("../src/live.js");
  const live = new LiveSession({ cwd: repo, agent: "deployer" });
  type Hook = (input: unknown, signal: AbortSignal) => Promise<{ hookSpecificOutput?: { permissionDecision?: string } }>;
  const hook = (command: string) => (live as unknown as { prodHook: Hook }).prodHook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, cwd: repo }, new AbortController().signal);
  const decision = async (p: ReturnType<typeof hook>) => (await p).hookSpecificOutput?.permissionDecision;
  const nextRequest = () => new Promise<string>((res) => live.on("event", (e: { kind: string; request?: { requestId: string; prod?: unknown } }) => e.kind === "permission_request" && e.request?.prod && res(e.request.requestId)));

  // קריאה בלבד: לא מתערב
  assert.equal(await decision(hook("ssh prod-server docker ps")), undefined);

  // לקוח לא מוגן (סוכן שמדבר עם השקע) לא יכול לאשר. דחייה מכל מקום מותרת
  let req = nextRequest();
  let p = hook("ssh prod-server 'docker compose up -d web'");
  let id = await req;
  assert.throws(() => live.resolvePermission(id, "allow", false, { trusted: false }), /רק מהחלון/);
  assert.equal(live.info().pendingPermissions, 1);
  live.resolvePermission(id, "deny", false, { trusted: false });
  assert.equal(await decision(p), "deny");

  // "רק הפקודה הזו" לא פותח את הבאה
  req = nextRequest();
  p = hook("docker push x");
  live.resolvePermission(await req, "allow", false, { trusted: true });
  assert.equal(await decision(p), "allow");
  assert.equal(live.info().deployGrantUntil, null);

  // "אשר פריסה לסשן הזה": הפקודה הבאה עוברת בלי כרטיס
  req = nextRequest();
  p = hook("ssh prod-server /home/ubuntu/deploy-tag.sh --apply");
  live.resolvePermission(await req, "allow", false, { trusted: true, grant: true });
  assert.equal(await decision(p), "allow");
  assert.ok((live.info().deployGrantUntil ?? 0) > Date.now());
  assert.equal(await decision(hook("ssh prod-server 'docker compose up -d web'")), "allow");

  // קומיט חדש: האישור בטל ושואלים שוב
  fs.writeFileSync(path.join(repo, "other.txt"), "changed\n");
  git(repo, "commit", "-qam", "change");
  req = nextRequest();
  p = hook("ssh prod-server 'docker compose up -d web'");
  id = await req;
  assert.equal(live.info().deployGrantUntil, null);
  live.resolvePermission(id, "deny", false, {});
  assert.equal(await decision(p), "deny");
  await live.close();
});
