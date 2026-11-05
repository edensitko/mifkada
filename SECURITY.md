# Security / אבטחה

Mifkada runs Claude Code sessions on your machine with your permissions. Treat it like a terminal.

## Threat model

- **Local only.** The packaged app listens on a Unix socket (`mifkada.sock`, mode 600) in its data folder, not on a
  network port. In development the server listens on `127.0.0.1` only.
- **Browser requests** must pass three checks (`server/src/origin.ts`): the `Host` must be localhost (blocks DNS
  rebinding), the `Origin` must be Mifkada itself, and an HttpOnly, SameSite=Strict token cookie is required.
  A strict CSP, `X-Frame-Options: DENY` and COOP/CORP are set on every response.
- **Local processes** without browser headers (the Electron main process, `curl`, the task CLI) pass on the Host
  check alone. A process that already runs as you can do anything you can, so this is not a boundary.
- **Electron:** `contextIsolation` and `sandbox` on, navigation pinned to the app's origin, `openExternal` only
  for http/https, and the `RunAsNode` / `NODE_OPTIONS` / inspector fuses disabled in the packaged app.

## File and terminal access

The file browser, editor, search, git panel, terminal and slash-command lookup only work inside folders Mifkada
already knows: your configured project folders, folders that Claude Code sessions ran in, and the folders of live
sessions, tasks and their worktrees (`server/src/access.ts`). Paths are resolved with `realpath`, so `../` and
symlinks that point outside a project are refused. The filesystem root is never allowed.

## Permissions

- Sessions follow your Claude Code permission rules (`~/.claude/settings.json`). Requests that need approval
  become cards in the app.
- `bypassPermissions` is blocked by the server on every path unless you set `system.allowBypass` by hand in
  Mifkada's `settings.json`. "Auto" mode asks for confirmation before it is turned on.
- The **Safety** settings page edits your global `~/.claude/settings.json` (it affects every Claude Code session,
  including the terminal). It is written atomically, a timestamped backup is kept before each change (the last 10), and a file that is not valid JSON is never overwritten.
- The optional **git guard** (`bin/mifkada-git-guard.mjs`) is a Claude Code hook that asks before a state-changing
  git command when another live session works in the same repository.

## Data

Everything stays on your machine: tasks, themes, summaries and settings in the data folder
(`~/Library/Application Support/מפקדה`), sessions in `~/.claude`. An optional OpenAI key (for text to speech)
is stored there with mode 600 and never sent back to the UI.
The same goes for the Anthropic API key used by Claude sessions: mode 600, never sent back to the UI, and passed only
to the Claude processes Mifkada starts.

## Prod guard

If you list your production hosts (`system.prodHosts` in Mifkada's `settings.json`, or `MIFKADA_PROD_HOSTS=host1,host2`),
Bash commands that change them (ssh with a non read-only command, scp/rsync, `docker push`, `gcloud compute`) stop for an
approval card. With no hosts listed, ssh/scp/rsync are not checked.

## Reporting a vulnerability

Please open a private security advisory on GitHub (Security → Report a vulnerability) rather than a public issue.
