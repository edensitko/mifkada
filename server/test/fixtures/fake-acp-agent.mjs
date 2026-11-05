// סוכן ACP מדומה לבדיקות של AcpRuntime: עונה, מריץ "כלי" שמבקש אישור, ומדווח על המצב שנבחר.
import { Readable, Writable } from "node:stream";
import { agent, methods, ndJsonStream, PROTOCOL_VERSION, RequestError } from "@agentclientprotocol/sdk";

let mode = "ask";
let n = 0;
// FAKE_AUTH=1: כמו Codex בלי התחברות. session/new נכשל עד שמתחברים דרך authenticate
let signedIn = process.env.FAKE_AUTH !== "1";

// כמו codex-acp: מצב ההתחברות נשלח ב-_auth/status_update מיד אחרי initialize ואחרי כל התחברות
const authStatus = () => (signedIn ? { kind: "account", label: "ChatGPT Plus", account: { email: "a@example.com", plan: "plus" } } : { kind: "none", label: "Not logged in" });

const app = agent({ name: "fake" })
  .onRequest(methods.agent.initialize, ({ client }) => {
    setTimeout(() => void client.notify("_auth/status_update", { authStatus: authStatus() }), 20);
    return {
    protocolVersion: PROTOCOL_VERSION,
    agentCapabilities: { loadSession: true, promptCapabilities: { image: false }, sessionCapabilities: { list: {} }, _meta: { authStatus: {} } },
    agentInfo: { name: "fake-agent", version: "1.0.0" },
    authMethods: [
      { id: "api-key", name: "API Key" },
      { id: "chat-gpt", name: "ChatGPT" },
    ],
    };
  })
  .onRequest(methods.agent.authenticate, async ({ params, client }) => {
    if (params.methodId !== "chat-gpt") throw new RequestError(-32602, "wrong method");
    signedIn = true;
    await client.notify("_auth/status_update", { authStatus: authStatus() });
    return {};
  })
  .onRequest(methods.agent.session.new, () => {
    if (!signedIn) throw new RequestError(-32000, "Authentication required");
    return {
    sessionId: `fake-${++n}-${process.pid}`,
    modes: {
      currentModeId: mode,
      availableModes: [
        { id: "ask", name: "Ask" },
        { id: "plan", name: "Plan" },
        { id: "yolo", name: "Full access" },
      ],
    },
    configOptions: [{ type: "select", id: "model", name: "Model", category: "model", currentValue: "small", options: [{ value: "small", name: "Small" }, { value: "big", name: "Big" }] }],
    };
  })
  // סשן "מהטרמינל" שמפקדה לא פתחה: מופיע ב-session/list, ו-load משדר את ההיסטוריה שלו
  .onRequest(methods.agent.session.list, () => ({ sessions: [{ sessionId: "outside-1", cwd: "/tmp/outside", title: "from terminal", updatedAt: "2026-10-31T10:00:00Z" }] }))
  .onRequest(methods.agent.session.load, async ({ params, client }) => {
    if (params.sessionId === "outside-1") {
      const up = (update) => client.notify(methods.client.session.update, { sessionId: params.sessionId, update });
      await up({ sessionUpdate: "user_message_chunk", content: { type: "text", text: "hello from " } });
      await up({ sessionUpdate: "user_message_chunk", content: { type: "text", text: "terminal" } });
      await up({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi there" } });
      await up({ sessionUpdate: "tool_call", toolCallId: "old-1", title: "Run ls", kind: "execute", status: "completed", rawInput: { command: "ls" }, content: [{ type: "content", content: { type: "text", text: "a.txt" } }] });
      await up({ sessionUpdate: "user_message_chunk", content: { type: "text", text: "thanks" } });
      return { modes: { currentModeId: mode, availableModes: [{ id: "ask", name: "Ask" }] } };
    }
    // השמעה חוזרת של ההיסטוריה: מפקדה צריכה להתעלם ממנה
    await client.notify(methods.client.session.update, { sessionId: params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "REPLAYED" } } });
    return { modes: { currentModeId: mode, availableModes: [{ id: "ask", name: "Ask" }, { id: "plan", name: "Plan" }] } };
  })
  .onRequest(methods.agent.session.setMode, ({ params }) => {
    mode = params.modeId;
    return {};
  })
  .onRequest(methods.agent.session.setConfigOption, ({ params }) => ({
    configOptions: [{ type: "select", id: "model", name: "Model", category: "model", currentValue: params.value, options: [{ value: "small", name: "Small" }, { value: "big", name: "Big" }] }],
  }))
  .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
    const sessionId = params.sessionId;
    const say = (text) => client.notify(methods.client.session.update, { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } });
    const text = params.prompt.map((b) => (b.type === "text" ? b.text : "")).join("");
    await say(`mode=${mode} `);
    // "wait": עובד דקה בלי לשלוח טקסט, כמו כלי שרץ הרבה זמן (למדידת ביצועים של הממשק בזמן עבודה)
    if (text.includes("wait")) {
      await client.notify(methods.client.session.update, { sessionId, update: { sessionUpdate: "tool_call", toolCallId: "w1", title: "Run sleep 60", kind: "execute", status: "in_progress", rawInput: { command: "sleep 60" } } });
      await new Promise((r) => setTimeout(r, 60000));
      return { stopReason: "end_turn" };
    }
    // "stream": הרבה כלים וטקסט מתמשך, למדידת עלות הרינדור בזמן סטרימינג
    if (text.includes("stream")) {
      for (let i = 0; i < 40; i++) {
        await client.notify(methods.client.session.update, { sessionId, update: { sessionUpdate: "tool_call", toolCallId: `s${i}`, title: `Read file${i}.ts`, kind: "read", status: "completed", rawInput: { file_path: `/tmp/file${i}.ts` } } });
      }
      for (let i = 0; i < 600; i++) {
        await say(i % 20 === 0 ? `\n\n## part ${i}\n\n- item **bold** \`code\` ` : `word${i} `);
        await new Promise((r) => setTimeout(r, 50));
      }
      return { stopReason: "end_turn" };
    }
    if (text.includes("plan")) {
      const plan = (s1, s2) => client.notify(methods.client.session.update, { sessionId, update: { sessionUpdate: "plan", entries: [{ content: "read", priority: "high", status: s1 }, { content: "fix", priority: "high", status: s2 }] } });
      await plan("in_progress", "pending");
      await plan("completed", "in_progress");
      await plan("completed", "completed");
      await say("done");
      return { stopReason: "end_turn" };
    }
    if (!text.includes("run") && !text.includes("commit")) {
      await say("hello");
      await client.notify(methods.client.session.update, { sessionId, update: { sessionUpdate: "usage_update", used: 1200, size: 200000 } });
      return { stopReason: "end_turn" };
    }
    const command = text.includes("commit") ? ["git", "commit", "-m", "x"] : ["git", "status"];
    const toolCall = { toolCallId: "t1", title: `Run ${command.join(" ")}`, kind: "execute", status: "pending", rawInput: { command } };
    await client.notify(methods.client.session.update, { sessionId, update: { sessionUpdate: "tool_call", ...toolCall } });
    const r = await client.request(methods.client.session.requestPermission, {
      sessionId,
      toolCall,
      options: [
        { optionId: "a1", name: "Allow", kind: "allow_once" },
        { optionId: "a2", name: "Always", kind: "allow_always" },
        { optionId: "r1", name: "Reject", kind: "reject_once" },
      ],
    });
    const chosen = r.outcome.outcome === "selected" ? r.outcome.optionId : "cancelled";
    const ok = chosen === "a1" || chosen === "a2";
    await client.notify(methods.client.session.update, {
      sessionId,
      update: { sessionUpdate: "tool_call_update", toolCallId: "t1", status: ok ? "completed" : "failed", content: [{ type: "content", content: { type: "text", text: ok ? "clean" : "denied" } }] },
    });
    await say(`chosen=${chosen}`);
    return { stopReason: chosen === "cancelled" ? "cancelled" : "end_turn" };
  });

app.connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
