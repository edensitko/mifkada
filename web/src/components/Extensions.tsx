import { useCallback, useEffect, useMemo, useState } from "react";
import { Plug, Puzzle, Store, RefreshCw, Plus, Trash2, Search, ExternalLink, Download, Power, X, ArrowUpCircle } from "lucide-react";
import { api, type AvailablePlugin, type InstalledPlugin, type Marketplace, type McpInput, type McpServer } from "../api";
import { useStore } from "../store";
import { cn } from "../lib/util";
import { strings, useT } from "../i18n";
import { matchPlugin, parsePairs, pluginName, splitCommand } from "../lib/extensions";
import { projectVisual } from "../lib/groups";
import { Spinner } from "./Spinner";
import { ask } from "../lib/dialog";

const S = strings({
  he: {
    kicker: "Claude Code",
    title: "הרחבות",
    sub: "שרתי MCP (connectors), פלאגינים ו-marketplaces. מה שמותקן כאן זמין בכל סשן חדש, גם בטרמינל.",
    tabMcp: "Connectors (MCP)",
    tabPlugins: "פלאגינים",
    tabMarkets: "Marketplaces",
    refresh: "בדוק שוב",
    checking: "בודק חיבורים...",
    context: "בהקשר של",
    allProjects: "כל הפרויקטים (שלך)",
    fromClaudeAi: "מ-claude.ai",
    fromClaudeAiHint: "מחוברים בחשבון שלך. מוסיפים ומנתקים בהגדרות של claude.ai",
    manage: "ניהול",
    yours: "שלך",
    fromPlugins: "מפלאגינים",
    none: "אין עדיין. הוסף שרת MCP כדי לחבר את Claude לכלים ולשירותים (GitHub, מסד נתונים, Figma...).",
    stConnected: "מחובר",
    stFailed: "נכשל",
    stAuth: "צריך התחברות",
    stPending: "ממתין לאישור",
    stUnknown: "לא ידוע",
    authHint: "כדי להתחבר: בסשן, /mcp ואז בחירה בשרת",
    remove: "הסר",
    removeConfirm: "להסיר את {name}?",
    addMcp: "הוסף שרת MCP",
    name: "שם",
    transport: "סוג",
    command: "פקודה",
    commandHint: "למשל: npx -y @modelcontextprotocol/server-filesystem ~/projects",
    env: "משתני סביבה",
    envHint: "שורה לכל משתנה: KEY=value",
    url: "כתובת",
    headers: "כותרות",
    headersHint: "שורה לכל כותרת: Authorization: Bearer ...",
    scope: "איפה",
    scopeUser: "בכל הפרויקטים",
    scopeProject: "בפרויקט, משותף (.mcp.json ב-git)",
    scopeLocal: "בפרויקט, רק אצלך",
    pickProject: "בחר פרויקט למעלה בשביל שרת ברמת פרויקט",
    add: "הוסף",
    cancel: "ביטול",
    added: "{name} נוסף. הוא יעבוד בסשנים חדשים",
    removed: "{name} הוסר",
    installed: "מותקנים",
    available: "זמינים",
    searchPlugins: "חיפוש בפלאגינים",
    install: "התקן",
    uninstall: "הסר",
    enable: "הפעל",
    disable: "כבה",
    update: "עדכן",
    off: "כבוי",
    installs: "{n} התקנות",
    restartNote: "פלאגין חדש או שינוי נטענים בסשנים חדשים. סשן פתוח צריך להיסגר ולהיפתח מחדש.",
    showMore: "הצג עוד",
    noMatch: "לא נמצא פלאגין",
    done: "בוצע: {what}",
    marketsHint: "מקורות של פלאגינים. אפשר להוסיף ריפו של GitHub (owner/repo), כתובת git או תיקייה.",
    addMarket: "הוסף marketplace",
    marketSource: "owner/repo, כתובת או נתיב",
    loading: "טוען...",
  },
  en: {
    kicker: "Claude Code",
    title: "Extensions",
    sub: "MCP servers (connectors), plugins and marketplaces. What you install here works in every new session, in the terminal too.",
    tabMcp: "Connectors (MCP)",
    tabPlugins: "Plugins",
    tabMarkets: "Marketplaces",
    refresh: "Check again",
    checking: "Checking connections...",
    context: "In the context of",
    allProjects: "All projects (yours)",
    fromClaudeAi: "From claude.ai",
    fromClaudeAiHint: "Connected to your account. Add and disconnect them in claude.ai settings",
    manage: "Manage",
    yours: "Yours",
    fromPlugins: "From plugins",
    none: "None yet. Add an MCP server to connect Claude to tools and services (GitHub, a database, Figma...).",
    stConnected: "Connected",
    stFailed: "Failed",
    stAuth: "Needs sign-in",
    stPending: "Pending approval",
    stUnknown: "Unknown",
    authHint: "To sign in: in a session, run /mcp and pick the server",
    remove: "Remove",
    removeConfirm: "Remove {name}?",
    addMcp: "Add an MCP server",
    name: "Name",
    transport: "Type",
    command: "Command",
    commandHint: "For example: npx -y @modelcontextprotocol/server-filesystem ~/projects",
    env: "Environment variables",
    envHint: "One per line: KEY=value",
    url: "URL",
    headers: "Headers",
    headersHint: "One per line: Authorization: Bearer ...",
    scope: "Where",
    scopeUser: "In all projects",
    scopeProject: "In the project, shared (.mcp.json in git)",
    scopeLocal: "In the project, only for you",
    pickProject: "Pick a project above for a project-level server",
    add: "Add",
    cancel: "Cancel",
    added: "{name} was added. It works in new sessions",
    removed: "{name} was removed",
    installed: "Installed",
    available: "Available",
    searchPlugins: "Search plugins",
    install: "Install",
    uninstall: "Uninstall",
    enable: "Enable",
    disable: "Disable",
    update: "Update",
    off: "Off",
    installs: "{n} installs",
    restartNote: "New plugins and changes load in new sessions. An open session has to be closed and reopened.",
    showMore: "Show more",
    noMatch: "No plugin found",
    done: "Done: {what}",
    marketsHint: "Sources of plugins. You can add a GitHub repo (owner/repo), a git URL or a folder.",
    addMarket: "Add a marketplace",
    marketSource: "owner/repo, URL or path",
    loading: "Loading...",
  },
});

type Tab = "mcp" | "plugins" | "markets";

/** מסך ההרחבות, כמו Extensions ב-VS Code: connectors (MCP), פלאגינים ו-marketplaces של Claude Code */
export default function Extensions() {
  const t = useT(S);
  const [tab, setTab] = useState<Tab>("mcp");
  const tabs: Array<[Tab, string, typeof Plug]> = [
    ["mcp", t("tabMcp"), Plug],
    ["plugins", t("tabPlugins"), Puzzle],
    ["markets", t("tabMarkets"), Store],
  ];
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="app-drag h-10" />
      <div className="max-w-4xl mx-auto px-8 pb-14 space-y-6">
        <header className="space-y-1">
          <div className="mono-label">{t("kicker")}</div>
          <h1 className="large-title">{t("title")}</h1>
          <p className="text-sm text-muted">{t("sub")}</p>
        </header>
        <div className="ext-tabs segmented grid grid-cols-3 text-sm max-w-lg">
          {tabs.map(([v, label, Icon]) => (
            <button key={v} data-active={tab === v} onClick={() => setTab(v)} className="py-1.5 flex items-center justify-center gap-1.5">
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
        {tab === "mcp" ? <McpTab /> : tab === "plugins" ? <PluginsTab /> : <MarketsTab />}
      </div>
    </div>
  );
}

function useRunner() {
  const setToast = useStore((s) => s.setToast);
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async (key: string, fn: () => Promise<unknown>, ok?: string) => {
      setBusy(key);
      try {
        await fn();
        if (ok) setToast(ok);
        return true;
      } catch (e) {
        setToast((e as Error).message);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [setToast],
  );
  return { busy, run };
}

const STATUS_DOT: Record<McpServer["status"], string> = { connected: "bg-ok", failed: "bg-danger", auth: "bg-warn", pending: "bg-warn", unknown: "bg-muted" };

function McpTab() {
  const t = useT(S);
  const { sessions, projectThemes } = useStore();
  const [cwd, setCwd] = useState("");
  const [list, setList] = useState<McpServer[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const { busy, run } = useRunner();
  const allCwds = useMemo(() => new Set(sessions.map((s) => s.cwd)), [sessions]);
  const projects = useMemo(() => [...new Set(sessions.map((s) => s.projectCwd || s.cwd))].filter((c) => c && c !== "?").sort(), [sessions]);

  const load = useCallback(
    (refresh = false) => {
      setLoading(true);
      api
        .extMcp(cwd || undefined, refresh)
        .then(setList)
        .catch((e: Error) => {
          setList([]);
          useStore.getState().setToast(e.message);
        })
        .finally(() => setLoading(false));
    },
    [cwd],
  );
  useEffect(() => load(), [load]);

  const groups: Array<[string, McpServer[], string?]> = [
    [t("yours"), (list ?? []).filter((s) => s.source === "config")],
    [t("fromClaudeAi"), (list ?? []).filter((s) => s.source === "claude.ai"), t("fromClaudeAiHint")],
    [t("fromPlugins"), (list ?? []).filter((s) => s.source === "plugin")],
  ];
  const statusLabel = (s: McpServer) => t(({ connected: "stConnected", failed: "stFailed", auth: "stAuth", pending: "stPending", unknown: "stUnknown" } as const)[s.status]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[13px] text-muted">{t("context")}</span>
        <select value={cwd} onChange={(e) => setCwd(e.target.value)} className="mini-select">
          <option value="">{t("allProjects")}</option>
          {projects.map((p) => (
            <option key={p} value={p}>
              {projectVisual(p, allCwds, projectThemes).name}
            </option>
          ))}
        </select>
        <span className="flex-1" />
        <button onClick={() => load(true)} disabled={loading} className="btn-ghost px-3 py-1.5 text-sm flex items-center gap-1.5 disabled:opacity-60">
          {loading ? <Spinner className="size-4" /> : <RefreshCw className="size-4" />} {t("refresh")}
        </button>
        <button onClick={() => setAdding((v) => !v)} className="btn-primary px-3 py-1.5 text-sm flex items-center gap-1.5">
          <Plus className="size-4" /> {t("addMcp")}
        </button>
      </div>

      {adding && <AddMcp cwd={cwd} onDone={() => { setAdding(false); load(true); }} onCancel={() => setAdding(false)} />}

      {list === null ? (
        <div className="text-sm text-muted flex items-center gap-2">
          <Spinner className="size-4" /> {t("checking")}
        </div>
      ) : (
        groups.map(([title, rows, hint]) =>
          rows.length === 0 && title !== t("yours") ? null : (
            <section key={title} className="space-y-2">
              <div className="flex items-baseline gap-2">
                <h2 className="text-[15px] font-semibold">{title}</h2>
                <span className="text-[12px] text-muted">{rows.length}</span>
                {hint && (
                  <button onClick={() => window.open("https://claude.ai/settings/connectors", "_blank")} className="ms-auto text-[12px] text-blue flex items-center gap-1 hover:underline" title={hint}>
                    {t("manage")} <ExternalLink className="size-3" />
                  </button>
                )}
              </div>
              {rows.length === 0 ? (
                <p className="text-sm text-muted">{t("none")}</p>
              ) : (
                <div className="card divide-y divide-[var(--color-separator)] overflow-hidden">
                  {rows.map((s) => (
                    <div key={s.name} className="flex items-center gap-3 px-4 py-2.5 min-w-0">
                      <span className={cn("size-2 rounded-full shrink-0", STATUS_DOT[s.status])} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-medium truncate">{s.name.replace(/^claude\.ai /, "").replace(/^plugin:/, "")}</span>
                        <span className="block mono text-[11.5px] text-muted truncate"><bdi dir="ltr">{s.target}</bdi></span>
                      </span>
                      <span className={cn("text-[12px] shrink-0", s.status === "connected" ? "text-ok" : s.status === "failed" ? "text-danger" : "text-warn")} title={s.status === "auth" ? t("authHint") : s.detail}>
                        {statusLabel(s)}
                      </span>
                      {s.source === "config" && (
                        <button
                          onClick={async () => (await ask(t("removeConfirm", { name: s.name }), { danger: true })) && void run(`rm:${s.name}`, () => api.extMcpRemove(s.name, null, cwd || undefined), t("removed", { name: s.name })).then((ok) => ok && load(true))}
                          disabled={busy === `rm:${s.name}`}
                          className="size-7 rounded-lg grid place-items-center text-muted hover:text-danger hover:bg-[var(--color-fill)]"
                          title={t("remove")}
                        >
                          {busy === `rm:${s.name}` ? <Spinner className="size-4" /> : <Trash2 className="size-4" />}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          ),
        )
      )}
    </div>
  );
}

function AddMcp({ cwd, onDone, onCancel }: { cwd: string; onDone: () => void; onCancel: () => void }) {
  const t = useT(S);
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<McpInput["transport"]>("stdio");
  const [cmd, setCmd] = useState("");
  const [env, setEnv] = useState("");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState("");
  const [scope, setScope] = useState<McpInput["scope"]>("user");
  const { busy, run } = useRunner();
  const needsProject = scope !== "user" && !cwd;
  const submit = () => {
    const c = splitCommand(cmd);
    const input: McpInput & { cwd?: string } =
      transport === "stdio"
        ? { name: name.trim(), transport, command: c.command, args: c.args, env: parsePairs(env, "="), scope, cwd: cwd || undefined }
        : { name: name.trim(), transport, url: url.trim(), headers: parsePairs(headers, ":"), scope, cwd: cwd || undefined };
    void run("add", () => api.extMcpAdd(input), t("added", { name: name.trim() })).then((ok) => ok && onDone());
  };
  const field = "w-full rounded-lg bg-background border px-3 py-2 text-sm outline-none focus:border-blue/60";
  return (
    <div className="card p-4 space-y-3">
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <label className="space-y-1">
          <span className="text-[12px] text-muted">{t("name")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="github" className={cn(field, "ltr mono")} autoFocus />
        </label>
        <label className="space-y-1">
          <span className="text-[12px] text-muted">{t("transport")}</span>
          <div className="segmented grid grid-cols-3 text-sm">
            {(["stdio", "http", "sse"] as const).map((v) => (
              <button key={v} data-active={transport === v} onClick={() => setTransport(v)} className="px-3 py-1.5 mono text-[12.5px]">
                {v}
              </button>
            ))}
          </div>
        </label>
      </div>
      {transport === "stdio" ? (
        <>
          <label className="block space-y-1">
            <span className="text-[12px] text-muted">{t("command")}</span>
            <input value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder={t("commandHint")} className={cn(field, "ltr mono")} />
          </label>
          <label className="block space-y-1">
            <span className="text-[12px] text-muted">{t("env")}</span>
            <textarea value={env} onChange={(e) => setEnv(e.target.value)} placeholder={t("envHint")} rows={2} className={cn(field, "ltr mono resize-y")} />
          </label>
        </>
      ) : (
        <>
          <label className="block space-y-1">
            <span className="text-[12px] text-muted">{t("url")}</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com/mcp" className={cn(field, "ltr mono")} />
          </label>
          <label className="block space-y-1">
            <span className="text-[12px] text-muted">{t("headers")}</span>
            <textarea value={headers} onChange={(e) => setHeaders(e.target.value)} placeholder={t("headersHint")} rows={2} className={cn(field, "ltr mono resize-y")} />
          </label>
        </>
      )}
      <div className="space-y-1">
        <span className="text-[12px] text-muted">{t("scope")}</span>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["user", t("scopeUser")],
              ["project", t("scopeProject")],
              ["local", t("scopeLocal")],
            ] as const
          ).map(([v, label]) => (
            <button key={v} onClick={() => setScope(v)} className={cn("rounded-full px-3 py-1 text-[12.5px] border transition", scope === v ? "border-blue bg-blue/10 text-blue" : "border-transparent bg-[var(--color-fill)] hover:text-foreground text-muted")}>
              {label}
            </button>
          ))}
        </div>
        {needsProject && <p className="text-[12px] text-warn">{t("pickProject")}</p>}
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="btn-ghost px-3 py-1.5 text-sm">
          {t("cancel")}
        </button>
        <button onClick={submit} disabled={busy === "add" || !name.trim() || needsProject || (transport === "stdio" ? !cmd.trim() : !url.trim())} className="btn-primary px-4 py-1.5 text-sm flex items-center gap-1.5 disabled:opacity-50">
          {busy === "add" && <Spinner className="size-4" />} {t("add")}
        </button>
      </div>
    </div>
  );
}

function PluginsTab() {
  const t = useT(S);
  const [data, setData] = useState<{ installed: InstalledPlugin[]; available: AvailablePlugin[] } | null>(null);
  const [q, setQ] = useState("");
  const [market, setMarket] = useState("");
  const [limit, setLimit] = useState(40);
  const { busy, run } = useRunner();
  const load = useCallback((refresh = false) => {
    api
      .extPlugins(refresh)
      .then(setData)
      .catch((e: Error) => {
        setData({ installed: [], available: [] });
        useStore.getState().setToast(e.message);
      });
  }, []);
  useEffect(() => load(), [load]);
  const markets = useMemo(() => [...new Set((data?.available ?? []).map((p) => p.marketplace))].sort(), [data]);
  const shown = useMemo(() => (data?.available ?? []).filter((p) => (!market || p.marketplace === market) && (!q.trim() || matchPlugin(p, q))), [data, q, market]);
  const act = (action: "install" | "uninstall" | "enable" | "disable" | "update", id: string) =>
    void run(`${action}:${id}`, () => api.extPlugin(action, id), t("done", { what: `${t(action)} ${pluginName(id)}` })).then((ok) => ok && load(true));

  if (!data)
    return (
      <div className="text-sm text-muted flex items-center gap-2">
        <Spinner className="size-4" /> {t("loading")}
      </div>
    );
  return (
    <div className="space-y-6">
      <p className="text-[12.5px] text-muted">{t("restartNote")}</p>
      <section className="space-y-2">
        <h2 className="text-[15px] font-semibold">
          {t("installed")} <span className="text-[12px] text-muted font-normal">{data.installed.length}</span>
        </h2>
        <div className="card divide-y divide-[var(--color-separator)] overflow-hidden">
          {data.installed.map((p) => (
            <div key={p.id} className={cn("flex items-center gap-3 px-4 py-2.5", !p.enabled && "opacity-60")}>
              <Puzzle className="size-4 text-muted shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium truncate">
                  {pluginName(p.id)} <span className="text-[11.5px] text-muted font-normal ltr">{p.id.split("@")[1] ?? ""}{p.version ? ` · v${p.version}` : ""}</span>
                </span>
                {p.mcpServers.length > 0 && <span className="block text-[11.5px] text-muted truncate">MCP: {p.mcpServers.join(", ")}</span>}
              </span>
              {!p.enabled && <span className="text-[11.5px] text-muted">{t("off")}</span>}
              {busy?.endsWith(`:${p.id}`) ? (
                <Spinner className="size-4 text-muted" />
              ) : (
                <span className="flex items-center gap-1">
                  <button onClick={() => act(p.enabled ? "disable" : "enable", p.id)} className="size-7 rounded-lg grid place-items-center text-muted hover:text-foreground hover:bg-[var(--color-fill)]" title={p.enabled ? t("disable") : t("enable")}>
                    <Power className={cn("size-4", p.enabled && "text-ok")} />
                  </button>
                  <button onClick={() => act("update", p.id)} className="size-7 rounded-lg grid place-items-center text-muted hover:text-foreground hover:bg-[var(--color-fill)]" title={t("update")}>
                    <ArrowUpCircle className="size-4" />
                  </button>
                  <button onClick={async () => (await ask(t("removeConfirm", { name: pluginName(p.id) }), { danger: true })) && act("uninstall", p.id)} className="size-7 rounded-lg grid place-items-center text-muted hover:text-danger hover:bg-[var(--color-fill)]" title={t("uninstall")}>
                    <Trash2 className="size-4" />
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-[15px] font-semibold">
            {t("available")} <span className="text-[12px] text-muted font-normal">{shown.length}</span>
          </h2>
          <span className="flex-1" />
          <select value={market} onChange={(e) => setMarket(e.target.value)} className="mini-select">
            <option value="">Marketplace: *</option>
            {markets.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 rounded-[10px] fill px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-blue/40">
          <Search className="size-4 text-muted" />
          <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(40); }} placeholder={t("searchPlugins")} data-ext-search className="bg-transparent outline-none flex-1 placeholder:text-muted" />
          {q && (
            <button onClick={() => setQ("")} className="text-muted hover:text-foreground">
              <X className="size-4" />
            </button>
          )}
        </label>
        {shown.length === 0 ? (
          <p className="text-sm text-muted">{t("noMatch")}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {shown.slice(0, limit).map((p) => (
              <div key={p.id} className="card p-3.5 flex flex-col gap-2 min-w-0">
                <div className="flex items-start gap-2 min-w-0">
                  <span className="size-8 rounded-[9px] bg-[var(--color-fill)] grid place-items-center shrink-0">
                    <Puzzle className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold truncate"><bdi dir="ltr">{p.name}</bdi></span>
                    <span className="block text-[11.5px] text-muted truncate">
                      {p.marketplace}
                      {p.installCount > 0 && ` · ${t("installs", { n: p.installCount.toLocaleString() })}`}
                    </span>
                  </span>
                  <button onClick={() => act("install", p.id)} disabled={Boolean(busy)} className="btn-primary px-2.5 py-1 text-[12.5px] flex items-center gap-1 shrink-0 disabled:opacity-50">
                    {busy === `install:${p.id}` ? <Spinner className="size-3.5" /> : <Download className="size-3.5" />} {t("install")}
                  </button>
                </div>
                <p dir="auto" className="text-[12.5px] text-muted line-clamp-3">{p.description}</p>
              </div>
            ))}
          </div>
        )}
        {shown.length > limit && (
          <button onClick={() => setLimit((n) => n + 40)} className="w-full btn-ghost py-2 text-sm">
            {t("showMore")} ({shown.length - limit})
          </button>
        )}
      </section>
    </div>
  );
}

function MarketsTab() {
  const t = useT(S);
  const [list, setList] = useState<Marketplace[] | null>(null);
  const [src, setSrc] = useState("");
  const { busy, run } = useRunner();
  const load = useCallback(() => {
    api
      .extMarketplaces()
      .then(setList)
      .catch((e: Error) => {
        setList([]);
        useStore.getState().setToast(e.message);
      });
  }, []);
  useEffect(() => load(), [load]);
  const act = (action: "add" | "remove" | "update", arg: string) => void run(`${action}:${arg}`, () => api.extMarketplace(action, arg), t("done", { what: `${action} ${arg}` })).then((ok) => ok && (load(), action === "add" && setSrc("")));
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted">{t("marketsHint")}</p>
      <div className="flex gap-2">
        <input value={src} onChange={(e) => setSrc(e.target.value)} onKeyDown={(e) => e.key === "Enter" && src.trim() && act("add", src)} placeholder={t("marketSource")} className="ltr mono flex-1 rounded-lg bg-background border px-3 py-2 text-sm outline-none focus:border-blue/60" />
        <button onClick={() => act("add", src)} disabled={!src.trim() || Boolean(busy)} className="btn-primary px-3 text-sm flex items-center gap-1.5 disabled:opacity-50">
          {busy?.startsWith("add:") ? <Spinner className="size-4" /> : <Plus className="size-4" />} {t("addMarket")}
        </button>
      </div>
      {list === null ? (
        <div className="text-sm text-muted flex items-center gap-2">
          <Spinner className="size-4" /> {t("loading")}
        </div>
      ) : (
        <div className="card divide-y divide-[var(--color-separator)] overflow-hidden">
          {list.map((m) => (
            <div key={m.name} className="flex items-center gap-3 px-4 py-2.5">
              <Store className="size-4 text-muted shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium">{m.name}</span>
                <span className="block mono text-[11.5px] text-muted truncate"><bdi dir="ltr">{m.source}</bdi></span>
              </span>
              {busy?.endsWith(`:${m.name}`) ? (
                <Spinner className="size-4 text-muted" />
              ) : (
                <span className="flex items-center gap-1">
                  <button onClick={() => act("update", m.name)} className="size-7 rounded-lg grid place-items-center text-muted hover:text-foreground hover:bg-[var(--color-fill)]" title={t("update")}>
                    <RefreshCw className="size-4" />
                  </button>
                  <button onClick={async () => (await ask(t("removeConfirm", { name: m.name }), { danger: true })) && act("remove", m.name)} className="size-7 rounded-lg grid place-items-center text-muted hover:text-danger hover:bg-[var(--color-fill)]" title={t("remove")}>
                    <Trash2 className="size-4" />
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
