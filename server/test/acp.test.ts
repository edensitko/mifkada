import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// הנתונים הולכים לתיקייה זמנית, לפני שמודול כלשהו קורא את paths.ts
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mifkada-acp-"));
process.env.MIFKADA_DATA = path.join(TMP, "data");
process.env.MIFKADA_LANG = "he";
// בלי ~/.claude האמיתי (חיפוש בתמלילים, אייג'נטים)
process.env.CLAUDE_CONFIG_DIR = path.join(TMP, "claude");
fs.mkdirSync(process.env.MIFKADA_DATA, { recursive: true });
const FAKE = path.join(import.meta.dirname, "fixtures", "fake-acp-agent.mjs");
const SETTINGS = JSON.stringify({ providers: { fake: { command: process.execPath, args: [FAKE], label: "Fake" }, fakeauth: { command: process.execPath, args: [FAKE], label: "FakeAuth", env: { FAKE_AUTH: "1" } } } });
fs.writeFileSync(path.join(process.env.MIFKADA_DATA, "settings.json"), SETTINGS);

const { refreshProviders } = await import("../src/providers/presets.ts");
const { createRuntime } = await import("../src/providers/registry.ts");
const { toolInfo, planText, pickMode, loginMethod, unwrapShell } = await import("../src/providers/acp.ts");
const { readProviderTranscript, getProviderSession } = await import("../src/providerSessions.ts");
const { gitOps } = await import("../src/gitGuard.ts");
const { parseRegistry } = await import("../src/providers/acpRegistry.ts");
const { syncAgentSessions, knownAgentSessions } = await import("../src/providers/agentSessions.ts");
const { searchTranscripts } = await import("../src/search.ts");
const { authStatus, startLogin, parseClaudeStatus, loginUrl, fromAcpAuth } = await import("../src/providers/auth.ts");
const { activeInRepo, registerLiveSession, unregisterLiveSession, MIFKADA_SESSIONS } = await import("../src/activity.ts");
const { execFileSync } = await import("node:child_process");
type LiveEvent = import("../../shared/protocol.ts").LiveEvent;
type AgentRuntime = import("../src/providers/types.ts").AgentRuntime;

await refreshProviders();

function waitFor(live: AgentRuntime, pred: (e: LiveEvent) => boolean, ms = 8000): Promise<LiveEvent> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    const on = (e: LiveEvent) => {
      if (!pred(e)) return;
      clearTimeout(t);
      live.off("event", on);
      resolve(e);
    };
    live.on("event", on);
  });
}

const resultText = (e: LiveEvent) => (e.kind === "result" ? e.result.text : "");

test("ACP: הודעה, תשובה בסטרימינג, רישום הסשן ותמליל", async () => {
  const live = createRuntime({ cwd: TMP, provider: "fake" });
  assert.equal(live.provider, "fake");
  const deltas: string[] = [];
  live.on("event", (e: LiveEvent) => e.kind === "text_delta" && deltas.push(e.text));
  live.send("שלום");
  const r = await waitFor(live, (e) => e.kind === "result");
  assert.equal(resultText(r), "mode=ask hello");
  assert.equal(deltas.join(""), "mode=ask hello");
  assert.equal(live.state, "idle");
  assert.ok(live.sessionId?.startsWith("fake-"));
  // המצבים: default + plan (yolo מסוכן ולא מוצע), והמודלים מה-configOptions
  assert.deepEqual(live.info().caps?.modes, ["default", "plan"]);
  assert.deepEqual(live.info().caps?.models?.map((m) => m.id), ["small", "big"]);
  assert.equal(live.model, "small");
  assert.deepEqual(live.info().context, { used: 1200, size: 200000 });
  await new Promise((r) => setTimeout(r, 100));
  const saved = await getProviderSession(live.sessionId!);
  assert.equal(saved?.provider, "fake");
  assert.equal(saved?.title, "שלום");
  const tr = await readProviderTranscript(live.sessionId!);
  assert.deepEqual(tr.map((m) => m.role), ["user", "assistant"]);
  await live.close();
});

test("ACP: בקשת אישור הופכת לכרטיס, ו'אשר תמיד' בוחר allow_always", async () => {
  const live = createRuntime({ cwd: TMP, provider: "fake" });
  live.send("run it");
  const req = await waitFor(live, (e) => e.kind === "permission_request");
  assert.equal(live.state, "waiting");
  assert.ok(req.kind === "permission_request");
  assert.equal(req.request.toolName, "Bash");
  assert.deepEqual(req.request.input, { command: "git status", description: "Run git status" });
  assert.equal(req.request.canAlways, true);
  live.resolvePermission(req.request.requestId, "allow", true);
  const r = await waitFor(live, (e) => e.kind === "result");
  // התוצאה היא הטקסט שאחרי הכלי האחרון, כמו ב-result של Claude
  assert.equal(resultText(r), "chosen=a2");
  await new Promise((r) => setTimeout(r, 100));
  const tr = await readProviderTranscript(live.sessionId!);
  const result = tr.flatMap((m) => m.blocks).find((b) => b.type === "tool_result");
  assert.deepEqual(result, { type: "tool_result", toolUseId: "t1", content: "clean", isError: false });
  await live.close();
});

test("ACP: דחייה, ומצב plan נשלח לסוכן", async () => {
  const live = createRuntime({ cwd: TMP, provider: "fake", permissionMode: "plan" });
  live.send("run");
  const req = await waitFor(live, (e) => e.kind === "permission_request");
  assert.ok(req.kind === "permission_request");
  live.resolvePermission(req.request.requestId, "deny", false);
  const r = await waitFor(live, (e) => e.kind === "result");
  assert.equal(resultText(r), "chosen=r1");
  assert.ok(live.events.some((e) => e.kind === "message" && e.message.blocks.some((b) => b.type === "text" && b.text === "mode=plan ")));
  await live.close();
});

test("ACP: המשך סשן דרך load בלי להציג את ההשמעה החוזרת", async () => {
  const first = createRuntime({ cwd: TMP, provider: "fake" });
  first.send("שלום");
  await waitFor(first, (e) => e.kind === "result");
  const id = first.sessionId!;
  await first.close();
  const live = createRuntime({ cwd: TMP, provider: "fake", resume: id });
  const seen: string[] = [];
  live.on("event", (e: LiveEvent) => e.kind === "text_delta" && seen.push(e.text));
  await waitFor(live, (e) => e.kind === "init");
  assert.equal(live.sessionId, id);
  assert.equal(live.title, "שלום");
  assert.ok(!seen.join("").includes("REPLAYED"));
  await live.close();
});

test("שומר git: פענוח הפקודה", () => {
  assert.deepEqual(gitOps("git commit -m x", "/r"), [{ op: "commit", dir: "/r" }]);
  // path.resolve: ב-Windows נתיב מוחלט מקבל אות כונן
  assert.deepEqual(gitOps("cd /a && git -C sub reset --hard", "/r"), [{ op: "reset", dir: path.resolve("/a/sub") }]);
  assert.deepEqual(gitOps("git stash list", "/r"), []);
  assert.deepEqual(gitOps("git status && git log", "/r"), []);
});

test("ACP: סשן רשום, נראה ב-activeInRepo ובשומר של Claude, ו-git commit מקבל אזהרה", async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "mifkada-acp-repo-"));
  execFileSync("git", ["init", "-q", repo]);
  // סשן "אחר" באותו ריפו (ה-pid של הבדיקה, כדי שייחשב חי)
  await registerLiveSession({ pid: process.pid, sessionId: "other-session", cwd: repo, provider: "fake", name: "עבודה אחרת", status: "running" });
  try {
    const busy = await activeInRepo(repo);
    assert.deepEqual(busy.sessions.map((s) => s.sessionId), ["other-session"]);

    // שומר ה-git של Claude (hook) רואה גם את הסשנים שמפקדה רושמת
    const out = execFileSync(process.execPath, [path.join(import.meta.dirname, "..", "..", "bin", "mifkada-git-guard.mjs")], {
      input: JSON.stringify({ tool_input: { command: "git reset --hard" }, cwd: repo, session_id: "claude-1" }),
      env: { ...process.env, MIFKADA_DATA: process.env.MIFKADA_DATA, CLAUDE_CONFIG_DIR: path.join(TMP, "no-claude") },
      encoding: "utf8",
    });
    const hook = JSON.parse(out) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } };
    assert.equal(hook.hookSpecificOutput.permissionDecision, "ask");
    assert.ok(hook.hookSpecificOutput.permissionDecisionReason.includes("עבודה אחרת (fake · מפקדה"));

    const live = createRuntime({ cwd: repo, provider: "fake" });
    live.send("commit please");
    const req = await waitFor(live, (e) => e.kind === "permission_request");
    assert.ok(req.kind === "permission_request");
    assert.match(req.request.reason ?? "", /git commit בריפו .* עבודה אחרת/);
    assert.equal(req.request.defaultToNo, true);
    assert.equal(req.request.canAlways, false);
    // הסשן החי עצמו רשום בזמן שהוא עובד, ולא מזהיר מעצמו
    const mine = (await activeInRepo(repo, ["other-session"])).sessions;
    assert.deepEqual(mine.map((s) => s.sessionId), [live.sessionId]);
    live.resolvePermission(req.request.requestId, "deny", false);
    await waitFor(live, (e) => e.kind === "result");
    await live.close();
    // הקובץ נמחק אסינכרונית בסגירה: מחכים עד שנייה במקום זמן קבוע
    for (let i = 0; i < 20 && (await activeInRepo(repo, ["other-session"])).sessions.length; i++) await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual((await activeInRepo(repo, ["other-session"])).sessions, []);
  } finally {
    await unregisterLiveSession(process.pid);
  }
  assert.equal(fs.readdirSync(MIFKADA_SESSIONS).length, 0);
});

test("ACP: פקודה שלא קיימת נותנת שגיאה ברורה", async () => {
  fs.writeFileSync(path.join(process.env.MIFKADA_DATA!, "settings.json"), JSON.stringify({ providers: { ghost: { command: "mifkada-no-such-agent-cmd" } } }));
  await refreshProviders();
  const live = createRuntime({ cwd: TMP, provider: "ghost" });
  live.send("hi");
  const e = await waitFor(live, (x) => x.kind === "error");
  assert.ok(e.kind === "error" && e.message.includes("לא נמצאה"));
  assert.equal(live.state, "error");
  assert.throws(() => createRuntime({ cwd: TMP, provider: "nope" }), /ספק לא מוכר/);
  // חזרה להגדרות עם הסוכן המדומה, לבדיקות שאחרי
  fs.writeFileSync(path.join(process.env.MIFKADA_DATA!, "settings.json"), SETTINGS);
  await refreshProviders();
});

test("ACP: מיפוי כלים לשמות של Claude Code", () => {
  assert.deepEqual(toolInfo({ kind: "edit", title: "Edit a.ts", content: [{ type: "diff", path: "/a.ts", oldText: "x", newText: "y" }] }), { name: "Edit", input: { file_path: "/a.ts", old_string: "x", new_string: "y" } });
  assert.deepEqual(toolInfo({ kind: "edit", title: "Create b.ts", content: [{ type: "diff", path: "/b.ts", newText: "z" }] }), { name: "Write", input: { file_path: "/b.ts", content: "z" } });
  assert.deepEqual(toolInfo({ kind: "read", title: "Read", locations: [{ path: "/c.ts" }] }), { name: "Read", input: { file_path: "/c.ts" } });
  assert.equal(toolInfo({ title: "Custom thing" }).name, "Custom thing");
});

test("ACP Registry: npx/uvx הופכים לפקודה, בינארי רק כרמז, וחבילה חשודה נזרקת", () => {
  const list = parseRegistry({
    agents: [
      { id: "codex-acp", name: "Codex", version: "2.5.0", distribution: { npx: { package: "@agentclientprotocol/codex-acp@2.5.0" } } },
      { id: "fast-agent", name: "fast-agent", distribution: { uvx: { package: "fast-agent-acp==0.10.1", args: ["-x"], env: { FAST_AGENT_MODEL: "codexplan", "bad key": "x" } } } },
      { id: "goose", name: "goose", website: "https://goose.ai", distribution: { binary: { "darwin-aarch64": { cmd: "./goose", args: ["acp"] }, "darwin-x86_64": { cmd: "./goose", args: ["acp"] } } } },
      { id: "evil", name: "Evil", distribution: { npx: { package: "x; rm -rf ~" } } },
      { id: "BadId", name: "Bad", distribution: { npx: { package: "ok" } } },
      { id: "site", name: "Site", website: "javascript:alert(1)", distribution: { npx: { package: "site-acp" } } },
    ],
  }, "darwin-aarch64");
  assert.deepEqual(list.map((a) => a.id), ["codex-acp", "fast-agent", "goose", "site"]);
  assert.deepEqual(list[0].run, { command: "npx", args: ["-y", "@agentclientprotocol/codex-acp@2.5.0"], env: {} });
  assert.deepEqual(list[1].run, { command: "uvx", args: ["fast-agent-acp==0.10.1", "-x"], env: { FAST_AGENT_MODEL: "codexplan" } });
  assert.equal(list[2].run, null);
  assert.deepEqual(list[2].binaryHint, { cmd: "goose", args: ["acp"] });
  assert.equal(list[3].website, null);
});

test("ACP: התוכנית של הסוכן מוצגת בתחילת התור ושוב בסוף כשהשתנתה", async () => {
  const live = createRuntime({ cwd: TMP, provider: "fake" });
  live.send("make a plan");
  await waitFor(live, (e) => e.kind === "result");
  const texts = live.events.flatMap((e) => (e.kind === "message" && e.message.role === "assistant" ? e.message.blocks.flatMap((b) => (b.type === "text" ? [b.text] : [])) : []));
  assert.deepEqual(texts, ["mode=ask ", planText([{ content: "read", priority: "high", status: "in_progress" }, { content: "fix", priority: "high", status: "pending" }]), "done", planText([{ content: "read", priority: "high", status: "completed" }, { content: "fix", priority: "high", status: "completed" }])]);
  assert.ok(texts[1].includes("- ← read") && texts[1].includes("- ○ fix"));
  await live.close();
});

test("מצבים מול המצבים האמיתיים של Codex: 'שואל' באמת שואל, ו-Full access לא נבחר אף פעם", () => {
  // מתוך codex-acp 2.5.0 (dist/index.js, AgentMode)
  const codex = [
    { id: "read-only", name: "Read-only" },
    { id: "workspace-write", name: "Workspace access" },
    { id: "agent", name: "Auto review" },
    { id: "agent-full-access", name: "Full access" },
  ];
  assert.deepEqual(pickMode(codex, "default"), { id: "read-only", emulatePlan: false });
  assert.deepEqual(pickMode(codex, "acceptEdits"), { id: "workspace-write", emulatePlan: false });
  assert.deepEqual(pickMode(codex, "auto"), { id: "agent", emulatePlan: false });
  assert.deepEqual(pickMode(codex, "plan"), { id: "read-only", emulatePlan: true });
  assert.ok(!["default", "acceptEdits", "auto", "plan", "bypassPermissions", "dontAsk"].some((m) => pickMode(codex, m as never).id === "agent-full-access"));
  // Gemini: default / autoEdit / plan / yolo
  const gemini = [
    { id: "default", name: "Default" },
    { id: "autoEdit", name: "Auto Edit" },
    { id: "plan", name: "Plan" },
    { id: "yolo", name: "YOLO" },
  ];
  assert.deepEqual(pickMode(gemini, "default").id, "default");
  assert.deepEqual(pickMode(gemini, "acceptEdits").id, "autoEdit");
  assert.deepEqual(pickMode(gemini, "plan"), { id: "plan", emulatePlan: false });
  assert.equal(pickMode(gemini, "auto").id, null);
});

test("התחברות: Codex מפרסם chat-gpt, מפתח API וטרמינל לא נבחרים", () => {
  assert.equal(loginMethod([{ id: "api-key", name: "API Key" }, { id: "chat-gpt", name: "ChatGPT" }, { id: "chat-gpt-device-code", name: "ChatGPT (device code)" }])?.id, "chat-gpt");
  assert.equal(loginMethod([{ id: "api-key", name: "API Key" }]), null);
  assert.equal(loginMethod([{ id: "login", name: "Login", type: "terminal" }]), null);
});

test("ACP: לא מחובר, מפקדה מתחברת דרך authenticate וממשיכה לבד", async () => {
  const live = createRuntime({ cwd: TMP, provider: "fakeauth" });
  const infos: string[] = [];
  live.on("event", (e: LiveEvent) => e.kind === "info" && infos.push(e.text));
  live.send("שלום");
  const r = await waitFor(live, (e) => e.kind === "result" || e.kind === "error");
  assert.equal(r.kind, "result");
  assert.ok(infos[0].includes("לא מחובר: נפתח דפדפן להתחברות (ChatGPT)"));
  assert.ok(infos[1].includes("מחובר ל-FakeAuth"));
  await live.close();
});

test("פקודה בלי עטיפת ה-shell (כמו ש-Codex שולח), ושומר ה-git מזהה אותה", () => {
  assert.equal(unwrapShell(`"printf 'hi from codex.' > hello.txt"`), "printf 'hi from codex.' > hello.txt");
  assert.equal(unwrapShell(`/bin/zsh -lc "git commit -m \\"x\\""`), 'git commit -m "x"');
  assert.equal(unwrapShell(["/bin/bash", "-lc", "git reset --hard"]), "git reset --hard");
  assert.equal(unwrapShell(["git", "status"]), "git status");
  assert.equal(unwrapShell("'ls'"), "ls");
  assert.equal(unwrapShell("echo 'a' && echo 'b'"), "echo 'a' && echo 'b'");
  assert.deepEqual(gitOps(unwrapShell(`"git commit -m x"`)!, "/r"), [{ op: "commit", dir: "/r" }]);
  assert.equal(toolInfo({ kind: "execute", title: "Run command", rawInput: { command: `/bin/zsh -lc "npm test"` } }).input.command, "npm test");
});

test("סשנים מחוץ למפקדה: session/list, ופתיחה עם ההיסטוריה שהסוכן משדר", async () => {
  const listed = await syncAgentSessions("fake");
  assert.deepEqual(listed, [{ sessionId: "outside-1", provider: "fake", cwd: "/tmp/outside", title: "from terminal", updatedAt: Date.parse("2026-10-31T10:00:00Z") }]);
  assert.ok(knownAgentSessions().some((a) => a.sessionId === "outside-1"));

  const live = createRuntime({ cwd: TMP, provider: "fake", resume: "outside-1" });
  await waitFor(live, (e) => e.kind === "init");
  const msgs = live.events.flatMap((e) => (e.kind === "message" ? [e.message] : []));
  assert.deepEqual(
    msgs.map((m) => `${m.role}:${m.blocks.map((b) => (b.type === "text" ? b.text : b.type)).join("+")}`),
    ["user:hello from terminal", "assistant:hi there", "assistant:tool_use", "user:tool_result", "user:thanks"],
  );
  // נשמר: בפתיחה הבאה ההיסטוריה מהתמליל של מפקדה
  await new Promise((r) => setTimeout(r, 100));
  assert.equal((await readProviderTranscript("outside-1")).length, 5);
  await live.close();
});

test("חיפוש בשיחות מוצא גם סשנים של ספקים אחרים", async () => {
  // התמליל של outside-1 נשמר בבדיקה הקודמת
  const hits = await searchTranscripts("from terminal");
  assert.ok(hits.some((h) => h.sessionId === "outside-1" && h.snippet.includes("hello from terminal")), JSON.stringify(hits));
});

test("התחברות: פענוח הסטטוס של Claude ושל ACP, וקישור מתוך הפלט", () => {
  assert.deepEqual(parseClaudeStatus(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "a@b.c", subscriptionType: "max" })), { status: "signedIn", label: "Claude Max", email: "a@b.c" });
  assert.deepEqual(parseClaudeStatus(JSON.stringify({ loggedIn: false })), { status: "signedOut" });
  assert.equal(parseClaudeStatus(JSON.stringify({ loggedIn: true, authMethod: "console" })).label, "מפתח API (חיוב לפי שימוש)");
  assert.equal(loginUrl("\x1b[1mOpen\x1b[0m https://claude.ai/oauth/authorize?code=true&x=1 to continue"), "https://claude.ai/oauth/authorize?code=true&x=1");
  assert.equal(loginUrl("no link here https://example.com/x"), undefined);
  assert.deepEqual(fromAcpAuth({ kind: "none", label: "Not logged in" }), { status: "signedOut", label: "Not logged in" });
  assert.deepEqual(fromAcpAuth({ kind: "account", label: "ChatGPT Plus", account: { email: "a@b.c" } }), { status: "signedIn", label: "ChatGPT Plus", email: "a@b.c" });
});

test("התחברות ACP: סטטוס מ-_auth/status_update, והתחברות בלחיצה", async () => {
  fs.writeFileSync(path.join(process.env.MIFKADA_DATA!, "settings.json"), SETTINGS);
  await refreshProviders();
  const s1 = await authStatus("fakeauth", true);
  assert.equal(s1.status, "signedOut");
  const s2 = await authStatus("fake", true);
  assert.deepEqual([s2.status, s2.label, s2.email], ["signedIn", "ChatGPT Plus", "a@example.com"]);
  // התחברות: מצב ביניים, ואחרי authenticate הסוכן מדווח שהוא מחובר
  const started = await startLogin("fakeauth");
  assert.equal(started.status, "signingIn");
  let s3 = await authStatus("fakeauth");
  for (let i = 0; i < 50 && s3.status === "signingIn"; i++) {
    await new Promise((r) => setTimeout(r, 100));
    s3 = await authStatus("fakeauth");
  }
  assert.deepEqual([s3.status, s3.label], ["signedIn", "ChatGPT Plus"]);
});
