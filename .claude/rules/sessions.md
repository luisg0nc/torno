---
paths:
  - "app/src/main/sessions/**"
  - "app/src/main/attention.ts"
  - "app/src/main/attention.test.ts"
  - "app/src/shared/chat.ts"
  - "app/src/shared/chat.test.ts"
  - "app/src/shared/agents.ts"
  - "app/src/shared/agents.test.ts"
  - "app/src/main/builds.ts"
---

# Sessions: the agent, its view, the chat transport, mode, model and effort

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## What crosses processes (root `CLAUDE.md`)

- Claude Code is the one agent torno runs. It is shown as a chat by default (`view` in `.torno/agent.json`). The
  chat is the CLI's own headless mode (`-p --input-format stream-json --output-format stream-json`) on pipes,
  under the person's own login, never run by a test. Hooks stay the one source of status and of the marks sent;
  the stream adds only that a request waiting for the person is `needs_input`, and torno's own `ask` (below, `Sessions.holdAsk`) does the same while a question of its is open; what the CLI says of itself (its `init`,
  `api_retry`, the denials of a `result`, a turn it marks `authentication_failed`) is shown as notes and meta, and never
  changes the status. `Sessions` drives the chat through `AgentTransport` (`sessions/transport.ts`); the CLI on pipes
  (`ClaudeStream`) is the one transport. `.torno/chat/` holds text only:
  no address, no secret, no picture data; a reference picture is recorded by its path in `reference/` and shown from
  that file again. A permission answer never writes the person's settings: "Allow for
  this session" sends only `addRules` suggestions, rewritten to `destination: "session"`.

## Agents (`app/src/main`)

- The view of an object's sessions, chat or terminal, is chosen under the session header and kept in
  `<object>/.torno/agent.json` (`{ "agent": "claude", "view": "terminal" }`; `sessions/choice.ts`, main's alone,
  atomic; `agent` is written still, so that the file is one an older torno reads). No file is the chat. A file
  that cannot be read, that names another agent (Copilot CLI: "which torno no longer supports"; or one torno
  never knew) or a view torno does not know is the chat too, with a `note` the pane shows beside "Use Claude
  Code", which writes the file anew. Main refuses a choice while a session runs or starts in the object (`End
  the session first`). `TORNO_AGENT_CMD` is run in place of `claude`, with Claude Code's arguments.
- `session.json` holds the conversation to resume, with `"agent": "claude"` (`sessions/resume.ts`, written
  through `writeFileAtomic`, one change at a time). A file without the key is Claude Code's; one an older torno
  wrote with another agent's conversation last holds Claude Code's under `kept.claude`, and that one is resumed;
  any other conversation is not. `Sessions.start` is a promise (the view is read from the disk); a second start
  for an object while the first is under way is answered with the first, and `stopAll` waits for one that is.
- `agent.json` is not ignored: the choice is the object's and travels with it, as `scene.json` does. `session.json`
  is ignored from the first conversation put on file. The `prompt.md` and `agent/` that sessions of Copilot CLI
  left under `.torno/` are neither read nor removed, nor their lines in `.gitignore`.
- The pane says in one line what the next prompt carries (`nextPromptLine`, `nextCarries` in `shared/agents.ts`).
- `stopAll` ends the sessions there are and those being started when it is called, not one started while it
  waits (`Sessions.busy` says whether any is there or on its way).
- "End" in the session header (`ui/SessionPane.tsx`) ends the session shown through `session.stop` and starts
  none; it asks first when the session is busy (`busyWith`), as "New session" does.
- A session that moves to `needs_input` while the window is not focused draws the eye once: `Attention.moved`
  (`attention.ts`) is true for the move into `needs_input` only (not for the same status told again, nor for an ask
  that came while the window was in use), and `index.ts` then flashes the frame (`flashFrame(true)`, put out on
  `focus`) or, on macOS, bounces the dock icon (`informational`). There is no system notification: it would touch
  the person's system, so it would have to be asked for. Under `TORNO_TEST=1` the rule runs and nothing is flashed.
- **The chat session** (Claude Code with `view` `chat`; `sessions/transport.ts`, `stream.ts`, `transcript.ts`,
  `chatlog.ts`, `permissions.ts`, `Sessions` in `manager.ts`). `Sessions` drives a chat through `AgentTransport`
  (`transport.ts`: `prompt`, `control` for `initialize`, `set_model` and `set_permission_mode`, `interrupt`, `answer` to an ask, `end`, and `terminate` and `kill` for
  an agent that stays after `end` (`Sessions.stop` times them; the process group is the transport's, `signals.ts`), and the events `message`, `ask`, `note`, `stderr`, `exit`) and never through a class of its own:
  the adapter makes it (`AgentAdapter.chat`), and `ClaudeStream` (`stream.ts`) is the one there is. `sessions/memory.itest.ts`
  drives `Sessions` with a transport in memory. Another
  transport (the Agent SDK's) would be another `chat` of an adapter, with the messages in the CLI's shapes, the
  transcript unchanged. The adapter adds `HEADLESS` to the same arguments as a terminal
  session (`claude.ts`); the CLI is spawned on pipes, detached, in the object's folder, with the terminal
  session's environment. There is no PTY. The stream is framed by line and a line that is no JSON, or a message
  of a type nobody knows, is passed over: what the CLI prints changes between versions, and nothing here throws
  at it. Torno answers `initialize` (the commands and models, told to the window as a `capabilities` event),
  `interrupt`, `set_model`, which changes this session's model and nothing of the person's, and `apply_flag_settings`
  for its effort (below).
- **Which saves are Claude's** (`writes.ts` `ClaudeWrites`, asked by `Sessions.wroteBy` for each save a project's
  watcher hears; #384). Only a tool call accounts for one, never a turn at work. The manager tells the ledger of a
  `PreToolUse` torno does not refuse (with the prompt it is made for, `turnOfWrite`: the transcript's `taken()`, which a
  command, with no hook, sets by its `init` or lifecycle; in a terminal `t-<conversation>-<n>`), a request for it that
  waits (`can_use_tool`, by `tool_use_id`: the hook comes before the request, and while it waits nothing is written),
  the person's answer, its `PostToolUse`, its `tool_result` in the stream (which also ends one that failed or that the
  CLI denied by itself), and the end of the turn (`result`, `Stop`, `StopFailure`) or of the session.
  - `Write`, `Edit`, `MultiEdit`, `NotebookEdit`: that file's saves while the call runs, and after it while the file is
    as the tool left it (mtime and size), however late the save is heard. A call that failed wrote nothing.
  - `Bash` names no file, so any watched file whose mtime falls while the command runs is taken for Claude's (one that
    is gone: heard while it runs or within 0.5 s). The person's save during such a command is counted as Claude's:
    that is the price of not calling Claude's own the person's. A command that surely writes nothing
    (`surelyWritesNothing`: no redirect or substitution, only programs that read) claims nothing, and `aroundBash`
    takes it for no change. What a background command writes after its call returned is the person's, and so may be
    what a background subagent writes in a call still under way when the main turn's `result` comes.
  - A tool of an MCP server of the person's own counts as a writer of the `.py` files its input names, and of no other.
    torno's own tools write none.
  - A terminal has no stream: a call there is not known to wait or to have failed (no `PostToolUse`), and claims until
    the turn's `Stop`. With no hooks (`NO_HOOKS`) every save is the person's.
- **The mode of a session** (`MODES`, `isMode`, `MODE_NOTE` in `shared/chat.ts`; `ModeMenu`). The edits menu beside the
  model offers `default`, `acceptEdits` and `plan`. `Sessions.setMode` (`chat:setMode`, the mode checked by `isMode`
  first) sends the control request `set_permission_mode` and, once the CLI has answered, the transcript says it
  (`modeSet`). The CLI holds it in memory for that session: no settings file is written, so a permission answer and a
  mode alike never write the person's settings. `ChatMeta.permissionMode` is the `permissionMode` of every `init`
  (the person's own start mode may be one torno does not offer; it is shown as the CLI names it). The `setMode`
  suggestion of an ask is still never passed on (below): the mode is chosen by the menu alone. The request is built
  on the Agent SDK's documented control request; the stand-in answers it, and a real CLI is still to be checked
  (the manual's last section).
- **The model and effort of a session** (`AgentChoice`, `agentChoiceOf`, `MODEL_NAME`, `EFFORTS` in `shared/chat.ts`).
  `Sessions.start` takes `model` and `effort` (`StartOptions`), for that session alone; `claude.ts` passes them as one
  argument each, `--model=<name>` and `--effort=<level>`, so that a value can never be read as a flag, and nothing
  when absent (the person's own default). What the window sends is held to the rule first: a model of `MODEL_NAME`
  (starts with a letter or digit), an effort of `EFFORTS`; anything else is dropped, never refused. The effort is on
  the meta (`ChatMeta.effort`: the one started with or set since; absent for the person's default, which the CLI
  does not say). `Sessions.setEffort` (`chat:setEffort`) sends `apply_flag_settings` with `{ effortLevel }`, the
  CLI's flag layer, held in its memory as `--effort` is: no settings file is written; once taken the transcript says
  `Effort: <level>` (`effortSet`). Each model the CLI offers carries the efforts it says it takes (`modelsOf` in
  `sessions/models.ts`, from `supportedEffortLevels`; empty for `supportsEffort: false`). The last list a chat's CLI
  offered is kept for the page of a new object (`KnownModels`, `models.json` beside the config file, atomically, or
  for the run alone with none; `chat:models`), and before any chat Claude Code's aliases (`MODEL_ALIASES`).
- When the CLI stops without being asked to (not through `stop`), or with a non-zero code, the pane gets a `warn`
  note "Claude Code stopped (exit code N): <its last stderr line>" (the last 20 lines of stderr are kept, redacted)
  and, when it never printed a line, "It did not start: is `claude` up to date and signed in? …". An `initialize`
  that fails is a quiet note. `send` runs one prompt after another (a picture is awaited before the next). Closing
  the workspace lets go of the transcripts of sessions that have ended (`forgetEnded`); `endedChat` names the one an
  object still has, for a window loaded since. `Sessions` events `stream`, `ask`, `asked` and `context` have no
  listener in the app: they are the probe the integration tests watch the stand-in through.
- **The agent's writes** (`sessions/reach.ts`, `refusalOf`, answered in `Sessions.hook`). A `PreToolUse` of `Write`, `Edit`,
  `MultiEdit` or `NotebookEdit` whose path is outside the session's project folder and the workspace's `common/` (by real
  paths, `isInsideFolder`) is answered `permissionDecision: deny` with a reason naming the project, so a session cannot
  edit another project, the workspace's root or make a folder. The answer is given before the build tracking and also
  where there is no build state (the hook body is read for a `PreToolUse` always). `Bash` is never judged: no path can be
  read from a command, so the CLI's own card stays; the prompt says which folder is the project (`agent-prompt`).
  The project's `brief.md` is refused too (`BRIEF_REFUSAL`, #337: the person's words; Claude writes cards), except in the one turn
  that moves Claude's old sections out of it (`opts.brief`, #341, `board`).
  A file the build imports from another project (`uses`) is no longer one the agent may write. `isInsideFolder` takes
  `..notes/x.py` as inside: only a first part that is exactly `..` is outside. The stand-in's `write` and `edit` play a
  refusal: nothing is written and the tool's result is the reason, an error.
  The same answer refuses a write under `<project>/.torno/` (main alone writes it: ids, atomic writes), the reason naming
  the tool to use (`add_mark`, `add_set`, `add_tracing`, `add_layer`, `add_card`, …); `Read` of those files stays allowed.
