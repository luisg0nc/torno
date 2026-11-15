---
paths:
  - "app/src/main/http.ts"
  - "app/src/main/http.test.ts"
  - "app/src/main/door.ts"
  - "app/src/main/door.itest.ts"
  - "scripts/torno-mcp.mjs"
  - "app/src/main/sessions/adapter.ts"
  - "app/src/main/sessions/claude.ts"
  - "app/src/main/sessions/claude.test.ts"
  - "app/src/main/sessions/agentEnv.ts"
  - "app/src/main/sessions/agentEnv.test.ts"
  - "app/src/main/mcp/server.ts"
  - "app/src/main/mcp/server.itest.ts"
  - "app/test/fake-agent.mjs"
---

# Launching the agent: the HTTP server, the tokens, the second door, the environment

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Global Constraints (root `CLAUDE.md`)

- HTTP server binds `127.0.0.1` only, on an OS-assigned port. An address holds no secret (`/mcp/<object id>`,
  `/hooks/<session id>/<event>`) and is made only by `HttpRouter.url`. Every request carries a token in the
  `X-Torno-Session` header, compared in constant time (hashed, against every live token); a missing, empty, wrong,
  revoked or unexpanded one (`${TORNO_SESSION}`, `$TORNO_SESSION`), or one of another session, is answered 404. Each
  session has its own (`HttpRouter.grant` in `Sessions.begin`: 32 random bytes as base64url), which opens its own
  hooks and its object's MCP server and is revoked when it has gone. It reaches the agent only in its environment
  (`TORNO_SESSION`), never in an argument: a command line is readable by every user of the machine
  (`/proc/<pid>/cmdline`, `ps`), the environment by its owner alone. Claude Code sends it itself: each http hook has
  `headers` with `$TORNO_SESSION` and `allowedEnvVars: ["TORNO_SESSION"]`, and `--mcp-config` is the path of a file
  under `<userData>/agent/` (never a workspace; removed with the session, the folder cleared at start) whose
  `headers` hold the placeholder `${TORNO_SESSION}`, never the token. It is kept in memory only, never logged
  (`HttpRouter.redact` takes every token of the run out of whatever is logged or kept of an agent's arguments or
  output) and never written to `state.md`, `.torno/chat/` or any other file. The test hook `__tornoMain.mcpFor(id)`
  gives an object's MCP address and a token that opens it; the stand-in agent reads `--mcp-config` from its file and
  expands both placeholders from its environment, as Claude Code does.
- The second door (#54, a spike, only with `TORNO_OUTSIDE_AGENTS=1`; `main/door.ts`, `scripts/torno-mcp.mjs`): one
  Unix socket, `door.sock` in `$XDG_RUNTIME_DIR/torno/` (else `$TMPDIR/torno-<uid>/`), the folder `0700` (a link or
  another user's is refused, other bits taken off) and the socket `0600`; never a TCP port, never in a workspace,
  never a file with a secret. A connection's first line names a folder; main maps it to a project of the open
  workspace (or refuses every request) and answers nothing until the person allows that connection in the window,
  asked for each connection. Allowed, main grants it a token of its own (`HttpRouter.grant`, that project's
  `/mcp/<object id>` only, never hooks) and posts each line to the MCP server with it in the header: the token never
  leaves main, and is revoked when the connection closes. What the bridge says of its client is its word only, shown
  as such. Tested with the MCP SDK's client over stdio (`door.itest.ts`), never a real CLI.

## Agents (`app/src/main`)

- Claude Code is the one agent torno runs. It is started by an adapter (`src/main/sessions/adapter.ts`: `AgentAdapter`; `claude.ts`
  `claudeAdapter`, the one there is), which says the `command` looked for on PATH, whether it is given torno's
  `skills`, how its client names a tool of torno's to the model (`toolName`: `mcp__torno__scene`), and
  `launch(ctx)`: the command, its arguments as a list of strings (never a line for a shell), variables to
  add to the environment, and files to write (`AgentLaunch.files`). Everything the agent is given of torno is on its
  command line, in its environment, or in a config file of torno's that holds no secret (the `--mcp-config` file,
  `<userData>/agent/<session id>.mcp.json`, written before the agent starts and removed when it has gone; the folder
  is cleared at start). The session's token (`LaunchContext.token`) is in its environment alone, as `TORNO_SESSION`:
  never in an argument or a file. A `TORNO_SESSION`, `TORNO_OBJECT` or `TORNO_SESSION_ID` torno itself was started with
  (from inside a session of another torno) reaches no process it starts: `withoutSession` of `sessions/agentEnv.ts`
  takes them out of the environment of the kernel, the import of a scan, `runCommand` and `makeEnvironment` of
  `ready.ts`, and `agentEnv` of the agent's, whose own the session then sets; an outer token would otherwise reach a
  model that prints its environment, and from its output a chat log that `redact` does not know it for. Nothing of the person's configuration of it is written, and none of its settings is
  read (the instruction files Claude Code reads are listed by path and size, below, and never read), and nothing is
  written in the object folder outside `.torno/`. The MCP address given is of that object alone, and the session's
  token opens that object's MCP server and that session's hooks, nothing else.
