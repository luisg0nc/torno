---
paths:
  - "app/src/main/sessions/transcript.ts"
  - "app/src/main/sessions/transcript.test.ts"
  - "app/src/main/sessions/stream.ts"
  - "app/src/main/sessions/stream.test.ts"
  - "app/src/main/sessions/claude.ts"
  - "app/src/main/sessions/claude.test.ts"
  - "app/src/shared/chat.ts"
  - "app/src/shared/chat.test.ts"
  - "app/test/fixtures/**"
---

# The transcript, and what the CLI says of itself

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Agents (`app/src/main`)

- The transcript (`Transcript`) knows what the stream means and nothing of processes or files: it reduces
  messages and torno's own records (a prompt sent, a hook answered, an ask, the end) to the items of
  `shared/chat.ts`, at most 2,000, and the 40 newest pictures keep their data. Items are never changed once
  handed out. A prompt sent while the agent works is `queued`: it is drawn last, and is sent, moving to the end,
  when the CLI takes it up; the transcript is the one source of that order, for live and for reload, and of
  whether any prompt is still untaken (`untakenCount`, which `Sessions` asks: there is no counter of its own). The
  CLI takes a prompt up in one of two ways, as measured on the real one: a `UserPromptSubmit` hook that names it
  (matched by text; else the oldest untaken that is not a command), which also folds a prompt sent while a tool
  ran into the running turn with no `init` and no result of its own; or, for a prompt beginning with `/`, an
  `init` that no hook explains (`explained`). After a `result`, prompts still untaken are given 1.5 s
  (`IDLE_GRACE_MS`) for their hook or `init` to come; if nothing came, the CLI is idle and they are taken
  (`idle()`), so nothing waits for good. The context of a `UserPromptSubmit` (`text`, `sentMarkIds`, and as data
  the build and selection) is put under the prompt that hook names; the window never parses text for it. Every
  prompt torno writes carries a `uuid` (kept by the transcript, not on the item), and the CLI's `command_lifecycle`
  with `state: "started"` for it takes it up first and whatever else has or has not happened (the other rules are
  fallbacks for a CLI without those events); a prompt taken up that way is not taken twice, and the `init` it
  explains takes no other. An `interrupt` drops nothing: the prompts in its `still_queued` stay queued and the CLI runs
  them afterwards, together, in one turn with one `init`. A prompt the CLI never took up is `not-sent` when the session
  ends, and only then. A tool whose ask the person refused is `denied`, one whose ask ended with the turn stopped
  `cancelled` (the later error result does not make either "failed"); `error` is for a failure the person did not cause. The messages of a subagent
  (`parent_tool_use_id`) are not the agent's words: they are counted on the `Task` card (`steps`) and its tool
  calls listed in `inside`. A thought's `seconds` run from its block's start to its stop. A `user` message that is the
  compaction summary (`isSynthetic`) is not drawn; one that is `<local-command-stdout>` (what `/cost` or
  `/context` print) is a quiet note, and the "Compacted" of `/compact` is not a second one.
- **What the CLI says of itself** (`Transcript.system`, `finished`). From the `init`, the meta (`ChatMeta`) takes
  `version` (`claude_code_version`), `apiKeySource` and `pluginLoaded`; `result` adds `costUsd` (`total_cost_usd`) and
  `context` (the tokens of the last request, `usage.iterations`' last or else `usage`, against the `contextWindow` of
  the session's model in `modelUsage`; unchanged when the result has no tokens, as a `/compact`'s has none);
  the `turn` item takes the tokens the `result` counts as `usage` (`TurnUsage`: `usage` summed, `num_turns` as `requests`,
  and `modelUsage` per model; numbers only, so it is in the chat's log; none when the result counts none);
  a `warn` note `NO_HOOKS` says once per session that the hooks do not arrive: a prompt of ours the CLI started
  (`command_lifecycle`, not a `/` command) with no `UserPromptSubmit` by `hookWaitMs` (8 s) or the end of its turn, in a
  session where none has come (a setting that limits `httpHookAllowedEnvVars` makes every hook 404). It never moves
  the status; the stand-in's `FAKE_AGENT_NO_HOOKS=1` plays it. The terminal view cannot tell it: the manual's
  troubleshooting names it.
  `api_retry` sets `retrying` (`{ attempt }`) until a `stream_event`, an `assistant`, a `user` or a `result` comes.
  Notes: a `warn` when torno's tools are `failed` (with the text of the entry of `mcp_server_errors` that is
  `torno`'s own: a `name`, `plugin`, `plugin_name` or `server` field that is `torno`, or a string that is or begins
  `torno:` or `torno@`; a path or another plugin's message that holds the word is not), a `warn` when the plugin torno passed did not load, a `quiet` once a session when `apiKeySource` is
  anything but `none` or `oauth` ("This chat is billed to an API key (Claude Code names its source: `user`), not to
  your Claude login: you pay per token."; `ANTHROPIC_API_KEY` is named only as an example, since the source may be a
  helper or a setting), a `quiet` once a session when the version is older than `TESTED_CLAUDE`'s minimum or of a
  newer major or minor than its maximum (`claude.ts`: the versions of the recordings in `test/fixtures/`, held to them
  by `claude.test.ts`; any patch of the tested minor is quiet; the note ends "if something in the chat looks wrong,
  this may be why"), and a `warn` at a `result` for each
  `permission_denials` entry no card shows (a tool card `denied`, `cancelled` or `stopped` is shown), once per
  `tool_use_id`. The plugin did not load when it is not in `plugins` or an entry of `plugin_errors` is `torno`'s own. The
  `skills` are read only when they show skills of plugins (an entry with a `<plugin>:` name): the recordings list
  the plugins loaded and, in `skills`, none of theirs, so a list without any says nothing; with some, a skill of
  `TORNO_PLUGIN` missing (named alone or as `torno:<skill>`) is a failure. It is judged only when the
  session was started with the plugin (`Transcript` `plugin`, from `adapter.plugin` and `skills`). **A field that is
  missing or is not the shape expected is "not known", never a warning,** and nothing here throws. `Sessions.start`
  takes `skills: false` (the window's "Restart with the whole prompt", which stops the session and starts it again
  resumed): the system prompt is then the whole text (`systemPromptFor` is given the adapter with `skills` false) and
  `--plugin-dir` is left out (`LaunchContext.skills`). **A turn that could not authenticate** (#117: `-p` under `--bare` reads no login, and the CLI says `--bare` will become its default) is known by one typed field alone, an assistant message's `error: "authentication_failed"` (the Agent SDK's `SDKAssistantMessage.error`; not yet seen from a real CLI), never by the words of the message or of the `result`, and never by `apiKeySource` `none`, which a login reports too: a `warn` note once a session after what the CLI said, `LOGIN_FAILED` ("Claude Code's chat could not use your login: …"), with `action: 'terminal'`, the window's button that writes `view` `terminal` and starts a terminal session resuming the conversation, live chat or ended (`readLog` drops any other `action`). It moves no status. What is known before any session (`main/ready.ts`, The first screen) is the one place torno
  runs `claude --version` and `claude auth status`; a session says what it can of itself through its `init`. Nothing
  of the person's settings is read, and of the instruction files Claude Code reads only the paths and sizes are.
