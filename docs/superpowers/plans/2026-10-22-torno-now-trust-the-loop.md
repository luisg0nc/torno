# torno: Now, trust the loop (implementation plan)

Date: 2026-10-22. Branch: `roadmap/now-trust-the-loop`. Spec: the roadmap, issue #43, and each task's issue (its body is
copied into the task below, and is that task's spec). Background: the research in #42, the design spec
`docs/superpowers/specs/2026-10-08-torno-design.md`, and the `CLAUDE.md` of the repository root and of each folder.

The milestone "Now: trust the loop": catch and say the failures nobody reports (lost volume, invented sizes, a done
that is not done), mend the bugs, get the part out as a file, and show the person what the agent already knows.
#51 (checking by hand with a visible screen and the real Claude Code) is the person's, not a task here: each task
that needs such a check says so in its report, and the controller collects them onto #51.

## Global constraints

Copied from the root `CLAUDE.md`; they bind every task. Read the `CLAUDE.md` of every folder a task touches before
changing it.

- Never write inside a user workspace except under `<object>/.torno/` (with the two exceptions the root `CLAUDE.md`
  names: making a new object, and an export's one file at the path the person chose, whole or not at all, through
  `<path>.<random>.tmp`). Never `uv sync` in a workspace: `uv run --no-sync`, and only when `<workspace>/.venv` exists.
- The kernel supervisor only imports. It never loads a model, builds, tessellates or answers a query. Workers never
  fork. Kernel stdout carries protocol frames only; model output goes to a captured buffer.
- Units are millimetres, Z up. Coordinates crossing a process boundary are in the object frame unless named `local`.
- Renderer: `contextIsolation: true`, `nodeIntegration: false`, `backgroundThrottling: false`. No per-frame state in
  React.
- The HTTP server binds `127.0.0.1` only, on an OS-assigned port. An address is made only by `HttpRouter.url`.
  Secrets are never logged (`HttpRouter.redact`) and never written to `state.md`, `.torno/chat/` or any other file.
- Images for the agent: long edge at most 2000 px, default 1280.
- No control-room look: no black/red/amber, no condensed uppercase labels, no corner-tick frames. Follow spec §10
  and the tokens in `app/src/renderer/styles/tokens.css`.
- UI text is sentence case. Every number and ref is set in the monospace face. Numbers shown go through
  `shared/format.ts`.
- Every number told to the agent is the kernel's, from the B-rep, and says whether it is exact (the two exceptions
  are in the root `CLAUDE.md`, Exactness).
- Tests must not open a visible window: `show: false` when `TORNO_TEST=1`. Never `--ozone-platform=headless`, never
  `page.screenshot()`, never the clipboard (`app/e2e/CLAUDE.md`).
- Never run a real agent CLI (`claude`) from tests or from a task: tests use `app/test/fake-agent.mjs`
  (`TORNO_AGENT_CMD`). Extend the stand-in when a task needs a new behaviour of the CLI; say in the report what a
  person must check by hand with the real CLI.
- `app/src/readme.test.ts` holds `README.md` to the code (keys table from `cheatSheet()`, `mcp__torno__<name>` tools
  equal to `TOOLS`, headings in order). A user-visible change updates the README in the same commit, in its plain
  style. `TORNO_README=write pnpm -C app exec vitest run src/readme.test.ts` rewrites the keys table after a key
  changes.
- A task that changes a rule written in a `CLAUDE.md` (root or folder) updates that `CLAUDE.md` in the same commit,
  saying the new rule, not its history.
- House style of code: match the surrounding code (its comment density, naming and idiom). Comments in the plain,
  exact English the codebase uses.

## How each task is done and committed

- Work on the branch `roadmap/now-trust-the-loop` in `<repo>`. Do not push, open PRs, or touch
  GitHub issues: the controller does.
- Shell setup for every command (pnpm is not on the PATH and no display is set):
  `. <scratchpad>/env.sh`
- Test first where it fits (a failing test that shows the bug or the missing behaviour), then the change.
- While iterating, run the focused tests. Before the commit, run the checks named under "Before a commit" below.
- One commit per task (more are fine when a task ships in steps), message: a first line describing the change in
  the repository's style (see `git log --oneline`), a body saying what and why, `Closes #<issue>` on its own line,
  and these two lines at the end:

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

## Before a commit

Every one of these, from the repository root, after sourcing the env file, must pass (the baseline on `main`, after
Task 1, passes all of them; the times are of that baseline):

```sh
. <scratchpad>/env.sh
pnpm -C app typecheck              # 2 s
pnpm test                          # 8 s
pnpm test:kernel                   # 36 s
(cd kernel && uv run pytest -q)    # 2 min
pnpm test:e2e                      # 6 min: builds the app, then the hidden window
```

A test that fails for a reason outside the task (it failed the same way before the change, on the same commit with
the change stashed) is reported, not hidden or "fixed" by weakening it. Report the summary line of each run.

## Rulings (the roadmap's recommendations, adopted)

The person asked for the recommendations of #43 and of each issue's "To decide" to be followed. Where an issue
offers a choice, take its recommendation. These are the ones that change a written rule or cross tasks:

- **The secret** (#113): each session gets its own token, passed in the agent's environment and sent as a
  request header, never in an address or argv. This rewrites the root `CLAUDE.md` rule on addresses and the README's
  "The agent's tools are for whoever was given their address".
- **A dimension the turn broke** may hold the agent back once (#110): the Stop hook's rule becomes "never for a
  dimension that failed before the turn".
- **Readiness** (#68): a lookup of the command on `PATH` always; `claude --version` and `claude auth status` only
  outside tests, each within 3 s. The stand-in answers both under test.
- **The left column** (#73): Objects folds to a switcher by default and the room goes to Marks; this changes a rule
  of `app/src/renderer/CLAUDE.md`.
- **A click on a mark's chip in the view** wins over the tool in hand (#74).
- **The status dot of a working session** is `--muted`; a session that needs input uses the accent (#69).
- **The close and leave questions** become full-window dialogs that name the object and what would be cut short
  (#79); this changes the rule that `Confirm` asks in the panel the question is about.
- **The agent transport** (#117): keep the CLI on pipes, behind an `AgentTransport` interface; detect a first turn
  that fails on authentication and say so, offering the terminal view. Asking Anthropic about the login under `-p` is
  the person's to do.
- **Fillet diagnosis** (#49): name edges in `local` coordinates by default, and by ref only where an edge of the last
  good build matches exactly.

# Tasks


## Task 1: A torno started from a Claude Code session passes CLAUDE_CODE_BRIDGE_SESSION_ID to its agent (#133)

Issue: https://github.com/luisg0nc/torno/issues/133. Found by the baseline: `pnpm test:kernel` fails on `main` from inside a Claude Code session. Makes the baseline green for every later task.

Torno strips what a parent Claude Code session exports before it starts its agent, so that a torno started from inside a Claude Code session does not make its agent take itself for that session's child (`agentEnv` in `app/src/main/sessions/manager.ts:1104`, the list `PARENT_SESSION_VARIABLES` at `:1086`). Claude Code 2.1.307 also exports `CLAUDE_CODE_BRIDGE_SESSION_ID`, which the list does not name, so it reaches the agent.

`pnpm test:kernel` shows it when run from inside a Claude Code session: `manager.itest.ts` "gives the agent torno's environment without what is torno's own or another Claude Code's" receives `CLAUDE_CODE_BRIDGE_SESSION_ID` beside the three names a person sets on purpose.

#### Proposal

Add `CLAUDE_CODE_BRIDGE_SESSION_ID` to `PARENT_SESSION_VARIABLES`, and to the test's set of a parent session's variables.

#### Done when

- `manager.itest.ts` sets `CLAUDE_CODE_BRIDGE_SESSION_ID` among a parent session's variables and the agent does not get it.
- `pnpm test:kernel` passes when run from inside a Claude Code session.


## Task 2: The first prompt of a new object names a tool that does not exist (`scan_section`) (#119)

Issue: https://github.com/luisg0nc/torno/issues/119.

For each imported scan, `onboardPrompt` writes: "It is imported into this object and is not aligned: … Read it
with mcp__torno__scans and mcp__torno__scan_section." (`app/src/main/onboard.ts:111`). There is no tool
`scan_section`. `TOOLS` (`mcp/schemas.ts:312-399`) has `section` with a `scan` argument (`schemas.ts:218`), and
`scan_section` is only the kernel query behind it (`mcp/readTools.ts:390`). The agent then searches for a tool
that is not there and spends a turn. Even `section` with `scan` is refused while the scan is not aligned, which
the same line says it is not. `onboard.test.ts:107` holds the wrong text, and main `CLAUDE.md` (line 794)
repeats it.

#### Proposal

"It is imported into this object and is not aligned yet: the person aligns it in torno. `scans` says how it
stands; once it is aligned, `section` with `scan` cuts it, and `scan_clash` and `scan_deviation` measure against
it."

#### Plan

1. `onboard.ts:111`, `onboard.test.ts:107`, and main `CLAUDE.md` "Onboarding the new object".
2. A test that every `mcp__torno__<name>` in `onboardPrompt`, `systemPrompt`, `PROMPTS` and the skills is a key of
   `TOOLS`, so the next one is caught (the README already has such a test, `readme.test.ts`).

#### Done when

- The new test passes, and fails on the old text.


## Task 3: An inside-out solid is told as a positive volume (#47)

Issue: https://github.com/luisg0nc/torno/issues/47. #108 builds on the signed volume this task keeps.

`extent.volume_and_centre` takes the absolute value of every volume OCC integrates
(`kernel/src/torno_kernel/extent.py:162`, `:202`, `:212`). A solid whose faces are reversed has a negative signed
volume, so torno tells it as a sound part. Of a part that holds a sound solid and a reversed one, it tells the
absolute value of their sum, which is neither.

A probe in the kernel's environment (build123d 0.13.0):

- a 10 mm cube reversed: OCC's signed volume −1000 mm³, `is_valid` True, torno 1000 mm³;
- a compound of a 10 mm cube and a reversed 5 mm cube: signed 875 mm³, `is_valid` True, torno 875 mm³. The sound
  answer is 1125 mm³ of material, or a defect.

ModelRift saw exactly this: raising the boolean tolerance "gave a solid with negative volume that also reported
valid" ([practitioners report](https://github.com/luisg0nc/torno/issues/42#issuecomment-6329178570) 1.1). Torno's exactness rule is that every number told is the B-rep's: here the
number is exact and its sign, the one thing that says the part is broken, is dropped.

#### Proposal

Measure each solid of a part on its own, signed. A part's volume is the sum of its solids' volumes when all are
positive. A solid with a negative volume is reported (`reversed: ["S2"]`, its index among the part's solids), the
part's volume is told as the sum of the absolute values with `volumeExact` as now, and the part carries a flag
the sanity pass (#108) and `check mesh` read. Nothing else changes for a sound part, and the cost is the same
integral, taken per solid (the `known` cache in `extent.volume` already works by solid).

#### Plan

1. `extent.py`: a signed volume per solid, the sum, and the reversed ones. Keep `abs` only where a caller wants a
   size, never where it wants a verdict.
2. `tess._part`, `queries._describe_part`, `measure volume` and `check overlap` carry the flag.
3. `shared/scene.ts` `Part.reversed?`; `scene` and `describe` say it.

#### Done when

- `kernel/tests/test_measure.py` (or a new `test_extent.py`) holds the two probes above as fixtures made in code:
  the cube reports `reversed`, the compound 1125 mm³ with `reversed`.
- The README's "Limits and exactness" says how a reversed solid is told.

#### Constraints

- `kernel/CLAUDE.md`, Exactness: volumes are measured in one place, `extent.py`; keep it so.
- Do not fix the shape (`Solid.fix()`): torno never changes the model's geometry, it tells.


## Task 4: What the model prints never reaches the agent (#109)

Issue: https://github.com/luisg0nc/torno/issues/109.

The system prompt forbids running the model: "torno rebuilds the model every time its file is saved, so do not run
the model yourself" (`app/src/main/prompt.ts:36`). The skill says to "check `len(part.solids())` when one is
meant" (`build123d/SKILL.md:90`), but the agent cannot run that. Its natural probe is a `print()` in the model.
The kernel captures what a model prints and returns it with both outcomes: `output` on a failed build and on a
good scene (`kernel/src/torno_kernel/supervisor.py:503-509`; `shared/scene.ts:46`). The person sees it on a
failed build, in the error sheet's "Output" section (`renderer/ui/BuildErrorSheet.tsx:72`). The agent never sees
it: neither `buildContextFor` (`context.ts:146`) nor `scene` (`mcp/viewTools.ts`, no `output`) passes it on. So
on a failed build the person has text the agent is not given, and a debugging `print` is lost, and so are
build123d's own warnings. On a good build neither sees it.

#### Proposal

- The PostToolUse answer to an edit, failed or good, ends with `Model printed (last N lines):` and the tail of
  `output`: at most 15 lines and 1,000 characters, the end kept. Nothing when the model printed nothing.
- `scene` gives `output` (the tail, same cut) of the last build that ended, failed or good.
- The `torno-model` skill says: to see a value while building, `print()` it in the model, or `assert` it. A failed
  assert fails the build and comes back with its traceback. Remove the `print` once it has served.
- `state.md` does not get it (it is not state).

#### Plan

1. `context.ts`: `outputTail(text)` and its use in `buildContextFor` only. It is cut against `CONTEXT_LIMIT` after
   the status and the digest (#108). A traceback outranks output.
2. `mcp/viewTools.ts` `scene`: `output`; its description in `schemas.ts` (A2 owns the wording).
3. `torno-model/SKILL.md`: the paragraph above; replace the `len(part.solids())` advice in `build123d/SKILL.md:90`
   with "print it, or read the digest" (#108).
4. Can ship alone, before #108.

#### Done when

- `context.test.ts`: output told after a good and after a failed build, the tail cut, nothing when empty.
- `manager.itest.ts` with the real kernel: a fixture model that prints a line, and the line in the PostToolUse answer.
- `readme.test.ts` passes after the README's "What the agent is told" mentions it.

#### Constraints

- The output is the model's text. It may hold anything the model's code prints, such as paths. It goes to the
  agent and the chat log, as tracebacks already do. Run it through `HttpRouter.redact` like any logged text.
- Kernel stdout stays protocol frames only. This changes nothing there: `output` is already a field of the reply.


## Task 5: Read what Claude Code says of itself at start and per turn: plugin, skills, API key, version, retries (#116)

Issue: https://github.com/luisg0nc/torno/issues/116. Lands before #113: it is what makes a torno MCP server that failed to connect visible in the window.

The chat reads one thing of the CLI's `system/init`: whether the `torno` MCP server is `connected`, with a warning when it is not (`app/src/main/sessions/transcript.ts:403-417`). The recorded `init` holds much more that matters to torno (`app/test/fixtures/claude-stream.jsonl`): `plugins`, `skills`, `apiKeySource`, `claude_code_version`, and, per the docs, `plugin_errors` and `mcp_server_errors`. Each `result` holds `total_cost_usd`, `modelUsage` and `permission_denials`; `api_retry` messages say the API is being retried. None is read. What goes wrong today without a word:

- **torno's plugin does not load.** The system prompt then tells the agent to read `torno:torno-model` and `torno:build123d` (`app/src/main/prompt.ts:30`), skills it does not have. `FULL_PROMPT` exists for exactly this case (`skills` false), but only when torno itself passed no plugin folder.
- **The chat is billed to an API key.** In `-p`, `ANTHROPIC_API_KEY` wins over the person's login whenever it is set, and torno passes the environment on (`sessions/manager.ts:1105`). A person with a key in their shell profile pays per token while thinking they use their subscription.
- **The CLI is newer than torno was checked against.** The fixtures are of 2.1.300 and 2.1.301; the CLI is at 2.1.307. Nothing compares.
- **The API is retrying.** The pane says "working" for minutes with no sign of why.

#### Proposal

- `init`: the session's meta gets `version`, `apiKeySource`, `pluginLoaded` (torno's plugin in `plugins` and its four skills in `skills`). A `warn` note when the plugin is missing or in `plugin_errors` ("torno's skills did not load: the agent is told to read skills it does not have"), and the session is restarted with `FULL_PROMPT` on the person's word (the system prompt is fixed at start). A `quiet` note, once per conversation, when `apiKeySource` is an API key: "This chat uses `ANTHROPIC_API_KEY`, not your Claude login: it is billed per token." A `quiet` note when the version is outside `TESTED_CLAUDE` (a range in `claude.ts`, with the fixtures' versions).
- `api_retry`: the status line says "retrying (attempt 3)" while it lasts.
- `result`: `permission_denials` not already shown as a denied card become a note; `total_cost_usd` and the context used (`modelUsage[model].contextWindow` against the input tokens) go to the meta for the window to show if U4 wants them.

#### Plan

1. `sessions/transcript.ts` `system` and `finished`; `shared/chat.ts` `ChatMeta`. Ships alone, with the notes.
2. `sessions/claude.ts`: `TESTED_CLAUDE`; `README.md` names the range, beside "what is still to be checked".
3. `sessions/manager.ts`: restart with `FULL_PROMPT` when asked.
4. Fixtures: a short procedure in `app/test/fixtures/` (by hand, by the person, never in a test) to record a new stream when the CLI moves, and the version range moves with it.

#### Done when

- `transcript.test.ts`: an `init` without torno's plugin warns; with `apiKeySource` an API key notes it once; a newer version notes it once; `api_retry` sets the status.
- `fake-agent.mjs` takes `FAKE_AGENT_INIT` fields to play each case, and `manager.itest.ts` covers one.

#### Constraints

- No test runs `claude`; the stand-in plays every case.
- Nothing of the person's settings is read or changed: torno reads what the CLI says of itself, and says it.
- What the CLI prints changes between versions: a field that is missing means "not known", never a warning.

#### To decide

- Should `claude auth status` be run before the first chat, to warn earlier? Recommendation: no. `init` says the same at no cost, and a second process is one more thing to keep in step.

#### Research

- [Claude Code report](https://github.com/luisg0nc/torno/issues/42#issuecomment-6329179151) section 3 (init fields, result fields, auth precedence: "In -p ANTHROPIC_API_KEY wins whenever present").


## Task 6: The run's secret is on the agent's command line, which every user of the machine can read (#113)

Issue: https://github.com/luisg0nc/torno/issues/113. Ruling, from a reading of the docs on 2026-10-22 (copies under the scratchpad's `docs/`): HTTP hook `headers` interpolate `$VAR` only for names listed in the hook's `allowedEnvVars` (documented, hooks page); MCP `headers` expand `${VAR}` in `.mcp.json` files (documented), and the managed-MCP page says servers given with `--mcp-config` expand "like the rest of `.mcp.json`" (implied, not stated for the flag). So: one token per session, 32 random bytes as base64url, in the agent's environment as `TORNO_SESSION` (a name that does not look like a credential: Claude Code reads names such as `*_API_KEY` or `NPM_TOKEN` as empty toward a remote server), sent as the header `X-Torno-Session`. Hooks: `headers: {"X-Torno-Session": "$TORNO_SESSION"}` with `allowedEnvVars: ["TORNO_SESSION"]`. MCP: pass `--mcp-config` a FILE path (under torno's own data folder, never the workspace) whose JSON holds only the placeholder `${TORNO_SESSION}`, never the token, so nothing secret is written. The server answers 404 to a missing header, an empty one and the literal unexpanded `${TORNO_SESSION}`, in constant time. Addresses keep the object or session id in their path but no secret. Teach the stand-in to expand both forms from its environment. #116 makes a torno server that failed to connect visible; say in the report that a person must check by hand, with the real CLI, that the tools connect and the hooks arrive (this goes on #51). If that check fails, the fallback is a stdio bridge that reads the token from its inherited environment (#54 proposes one): note it, do not build it.

The README says the secret in torno's addresses "keeps out another user of this machine" (`README.md:1156`). It does not. The whole MCP address, secret and all, is in the `--mcp-config` argument (`app/src/main/sessions/claude.ts:65`, `:72`), and every hook address is in the `--settings` argument (`claude.ts:63`, `:76`). On Linux `/proc/<pid>/cmdline` is mode `0444` and `/proc` is mounted without `hidepid` by default (checked on the owner's machine: `-r--r--r--`, mount options `rw,nosuid,nodev,noexec,relatime`), so `ps -eo args` run by any local user prints it. `ps -ww` on macOS shows other users' arguments too. `/proc/<pid>/environ` is `0400`: the environment is the owner's alone.

The secret is also one for the whole run (`app/src/main/http.ts:91`). Whoever has it can call any tool of any object (`/mcp/<secret>/<any object id>`) and post any hook of any session. A forged `UserPromptSubmit` turns the object's draft marks `sent` although no agent read them (`app/src/main/sessions/manager.ts:981`), and rewrites which conversation `session.json` resumes (`manager.ts:937-940`). A forged `resolve_mark` or `add_mark` puts words in the agent's mouth in the person's list of marks.

#### Proposal

Take the secret out of every argument, and give each session a token of its own.

- The addresses keep their shape but lose the secret: `http://127.0.0.1:<port>/mcp/<object id>`, `/hooks/<session id>/<event>`.
- The token goes in a header. Claude Code expands `${VAR}` in the `url` and `headers` of an HTTP MCP server, and HTTP hooks take `headers` with `allowedEnvVars` ("Only variables listed in `allowedEnvVars` are resolved"). So: `--mcp-config` holds `"headers": {"Authorization": "Bearer ${TORNO_TOKEN}"}`, each hook `"headers": {"Authorization": "Bearer $TORNO_TOKEN"}, "allowedEnvVars": ["TORNO_TOKEN"]`, and `TORNO_TOKEN` is in the agent's environment only (`AgentLaunch.env`, which the adapter already has: `adapter.ts:8`).
- The token is made per session in `Sessions.begin` (32 random bytes), names one object and one session, and dies with the session. The router checks it in constant time, as now, and answers 404 without it. A request for another object or another session with a valid token is 404 too.

#### Plan

1. `http.ts`: `route` hands the handler the request's bearer token; a `Tokens` map (token to `{objectId, sessionId}`) checked with `timingSafeEqual` on hashes, as `isSecret` does. `HttpRouter.url` stays the one maker of an address. `redact` takes out every live token.
2. `sessions/manager.ts` `begin`: mint the token, register it, drop it on exit; put it in the launch env.
3. `sessions/claude.ts`: the headers and `allowedEnvVars` above; nothing secret in `args`. The terminal view gets the same.
4. `mcp/server.ts`, the hook handler: refuse a token that is not of that object or session.
5. `app/test/fake-agent.mjs`: send the header from its env (it reads its hook addresses from `--settings` today). `__tornoMain.mcpUrlFor(id)` returns the address and the token.
6. README, the security paragraph: say what the secret keeps out now, and that a program running as the person can still read the agent's environment.

Steps 1 to 3 ship together. Before merging, check by hand against the real CLI that `--mcp-config` (not only `.mcp.json`) expands `${VAR}` in `headers`: the docs list the fields but not the scopes.

#### Done when

- `claude.test.ts`: no argument holds the token or the old secret.
- `http.test.ts`: a request without the header, with another session's token, or with a token for another object is 404; a token stops working when its session ends.
- `manager.itest.ts` with the stand-in: a session's hooks and tools work through the header.
- The README no longer claims what the old design did not give.

#### Constraints

- Root `CLAUDE.md` says "Every address it hands to an agent has the run's secret after the prefix". This changes that rule: the secret moves from the path to a header and from the run to the session. The rest holds: made in main, kept nowhere, never logged, never written to `state.md` or `.torno/chat/`, constant-time compare, 404 without it.
- Everything the agent is given stays "on its command line or in its environment" (`adapter.ts:29`).
- The agent's Bash tool inherits the environment, so a script the agent runs can read the token. It can read the arguments today, so nothing is lost.

#### To decide

- Keep a secret in the path as well, as defence in depth? Recommendation: no; one mechanism, one rule.
- `--mcp-config` and `--settings` also accept a file path. A 0600 file in a 0700 folder under `<userData>` would also work, but it writes the token to disk, which the root rules avoid. Recommendation: the environment.

#### Research

- [Claude Code report](https://github.com/luisg0nc/torno/issues/42#issuecomment-6329179151) section 2; https://code.claude.com/docs/en/hooks (HTTP hook fields: `headers`, `allowedEnvVars`); https://code.claude.com/docs/en/mcp ("Environment variable expansion": `url` and `headers`).


## Task 7: Leaving a folder or closing torno: questions asked in a corner, and failures said nowhere (#79)

Issue: https://github.com/luisg0nc/torno/issues/79. Ruling: the close and leave questions become full-window dialogs (see Rulings).

There are two problems with the questions and failures of the workspace as a whole.

**The questions are in a 248 px strip of the left column.** "Close torno?" and "Leave this folder?" are a
`Confirm` inside `aside.left` (`renderer/App.tsx:353-380`). It is drawn under the folder's name, in the panel's own
ground, with hairline borders. The person pressed the window's close button at the top right, or quit from the menu,
and the question appears at the far left. The text names nothing: "A session is in the middle of its work." "A prompt
written in the chat is not sent yet." (`renderer/closing.ts:24-33`). Which session? Which object? A person with
three objects open cannot tell whether to stay.

**Failures to open are silent.** `goTo` in `renderer/App.tsx:63-74` swallows them: "A folder that cannot be
opened leaves the workspace as it is; main has said why on stderr." The same holds for "Open the example". Choose a
recent folder that went away after the menu was read (an unmounted disk), or one main refuses, and the menu closes
and nothing happens. The first screen does say why (`ui/Welcome.tsx:63-67`, `openProblem`); the folder menu does
not.

There is also a small copy point in the folder menu (`ui/FolderMenu.tsx:285`). The open folder's row says "Open"
in the place where a button would be (`ui-folders-light.png`, top right of the menu). It reads as an action.

#### Proposal

- Close and Leave are asked in a centred `alertdialog` over the window, as the export sheet is: modal, Tab kept in
  it, the button that changes nothing in focus. Each reason names its object and is a link that goes there and
  closes the question: "`bracket`: Claude Code is working", "`hollow`: a prompt is not sent". `closingWhy` returns
  items, not one sentence.
- A failed open is said under the folder button as a `role="alert"` line with `openProblem`'s text, until the next
  action.
- In the folder menu, the open folder is marked by a check and the word "current", in the muted face.

#### Plan

1. `renderer/closing.ts`: `closingWhy` returns `{ objectId, what }[]`. `closing.test.ts` follows.
2. `ui/WorkspaceQuestion.tsx`: the modal, used for both questions in `App.tsx`.
3. `App.tsx` `goTo`: returns the error, and `FolderMenu` shows it.
4. `e2e/quit.spec.ts` and `e2e/workspace.spec.ts`: the question names the object. Opening a folder removed after
   the menu was read says why.

#### Done when

- The tests above pass. A `confirm-close` state is added to `e2e/themes.spec.ts`.

#### Constraints

- `renderer/CLAUDE.md`, The page of objects: a question over the page needs `role="dialog"` or
  `role="alertdialog"`, and Escape goes to it first. Keep that.
- `Confirm` stays as it is for questions about one panel (a scan, a mark). This is only for the window as a whole.


## Task 8: Check every build for lost volume, broken solids and inside-out parts, and push the digest with the build result (#108)

Issue: https://github.com/luisg0nc/torno/issues/108. Builds on #47. The largest task of the plan: ship it in the steps its Plan names, a commit per step if that helps. #110, #118 and #76 read the digest it adds.

The research names one failure above all others: a build that succeeds and is wrong. In ModelRift's experiment a
`union()` dropped the core of a part (7065 mm³ where 10323 were expected). The renders looked right ("renders
caught nothing that mattered"), and the solid still reported `valid=True` and one solid. A volume check found it.
Nine of their sixteen failures were never reported by the tool ([practitioners report](https://github.com/luisg0nc/torno/issues/42#issuecomment-6329178570) 1.1,
https://modelrift.com/blog/cadquery-vs-openscad/). CAD-bench found 12.5 % of attempts built and scored zero, and a
gearbox that built 96.9 % of the time scored 4 % ([academic report](https://github.com/luisg0nc/torno/issues/42#issuecomment-6329178911) 2.2).

Torno has the numbers but never looks at them unless asked. After an edit the agent is told whether the build
passed and which dimensions fail, and no number about the shape. On success `buildContextFor`
(`app/src/main/context.ts:146-150`) gives the first line of `status` (`context.ts:404-421`):
`[torno] bracket · build ok · r8 (0.8 s) · layout assembly · parts: base, post.` The kernel works out each part's
`valid`, volume and face count at every build (`kernel/src/torno_kernel/tess.py:217-235`), and main keeps the
previous build (`app/src/main/builds.ts:265`, `:442`), but nothing compares them on its own. The `diff` tool (#7,
`mcp/readTools.ts:716`) already works out volume, box and face count changes from what the kernel sent with each
build, and asks the kernel nothing. Yet it is pulled, never pushed: neither the system prompt, a skill nor the
reviewer names it (`grep -n diff app/src/main/prompt.ts app/resources/agent-plugin app/src/main/sessions/claude.ts`
finds nothing).

`valid: false` reaches the agent only inside `scene` (`app/src/main/mcp/viewTools.ts:119`) and the person not at
all: the window uses it only to decide whether to cap a section (`app/src/renderer/viewport/partMesh.ts:90`). No
one counts the solids of a part: a part that came apart into two bodies (a boss floating 2 mm above its base, as
in the XDA test) is shown, measured and exported as one. The Stop hook holds the agent back for a failed build or
an edit not looked at, and for nothing the geometry says (`app/src/main/sessions/manager.ts:469-486`).

#### Proposal

A sanity pass at every successful build. The kernel computes, main compares and pushes, in one block with the
build result.

In the worker, per part, as part of `tess.build_scene` (cheap: no boolean):

- `solids`: how many solids the part has (`len(shape.solids())` / `topo.solids` in `tess.py:_part`), and
  `openShells`: shells with free edges.
- `valid`: as now (`BRepCheck_Analyzer` through `shape.is_valid`).
- the signed volume of each solid (#47): a solid whose volume is negative is inside out.
- `meshVolume`: the volume enclosed by the part's own mesh (it is there already). Where it and the B-rep volume
  disagree by more than the mesh's deflection can explain, one of them is wrong. Told as a warning, never as a
  number to rely on.

In main, against the last successful build of the same layout (`Builds.scenes`, the data `diff` already reads),
the PostToolUse answer to an edit that built (`Sessions.afterEdit`, `sessions/manager.ts:434-466`) and the next
prompt carry, after the status line and before the dimensions, a short digest:

```
Changed since r7: tub: volume 28,400 → 26,100 mm³ (−2,300, −8 %), size 60 × 40 × 30 → 60 × 40 × 32 mm, faces 14 → 22; lid: unchanged.
Check: tub is 2 solids (was 1); lid: not valid (OCC finds a defect); clip is gone from assembly; tub's faces were renumbered (describe refs again).
```

- **Changed**: the `line` of `partDiff` (`readTools.ts:672-713`) for each part that changed, in the same words,
  with the volume change also in percent and with `≈` where either build is not exact. Unchanged parts are
  counted, not listed. Added and removed parts are named.
- **Check**: flags worked out from the shape alone, never from a guess at intent:
  - a part the kernel says is not valid (`Part.valid`, already in the scene, never told in a line);
  - a volume at or below 0, or a solid that is inside out;
  - a part of more than one solid, or whose solid count changed;
  - an open shell;
  - a mesh volume that disagrees with its B-rep volume;
  - a part added or removed;
  - face or edge counts changed (`DIFF_REFS`);
  - a pinned dimension that passed on the build before and fails now ("FAIL, passed on r7"; see #110).
- Deltas are told, never judged: torno cannot know whether a pocket was meant.
- Hard defects (not valid, inside out, a solid count that went up, a mesh that disagrees with its B-rep) hold the
  Stop back once, in the same way a failed build does, with a reason that says the agent may answer that it is
  intended. A volume change alone never holds it.
- The system prompt gets one line that says how to read the digest: after you add material the volume must rise,
  after a cut it must fall; a change in a part you did not touch is a defect; the digest is from the B-rep, a
  picture is not.
- At most 1,200 characters, and within `CONTEXT_LIMIT`. It is cut by parts, never mid-line. What is cut is
  counted, with "call `diff`".
- The window shows the hard defects in the build line and the layers (a mark beside the part).

#### Plan

1. Kernel: `solids`, `openShells`, signed volumes and `meshVolume` per part in `tess._part`. Kernel tests on
   fixtures that are a union of two disjoint boxes, inside out and with an open shell
   (`kernel/tests/test_tess.py`). Ships alone: `scene` then lists them. The `solids` count alone is the smallest
   first step.
2. `shared/scene.ts`: `Part` gains `solids?`, `openShells?`, the signed volumes and `meshVolume?`; `diff` and
   `scene` say them (A2 owns the schema text).
3. Main: `sanity(previous, current)` in a new `app/src/main/sanity.ts`, pure, reusing `partDiff`, used by
   `context.ts` (`buildDigest` for `buildContextFor` only, not every prompt; and the build line) and by `state.md`
   (`statefile.ts`). `Sessions.afterEdit` passes the two kept scenes. Ships after 1 and 2 as the agent's half.
4. Stop hook: one more reason in `stopAnswer`, for a hard defect that appeared in the turn.
5. `prompt.ts`: the line on how to read the digest; `prompt.test.ts` length limits stay (SYSTEM_PROMPT under
   6,400).
6. Window: the build line and the layer row show a hard defect (UX track for the look). Ships alone after 2.
7. README "What the agent is told": what is checked, that it is checked at every build, and the digest with an
   example.

#### Done when

- `kernel/tests/test_tess.py` covers each new field on its fixture.
- `app/src/main/sanity.test.ts` and `context.test.ts` cover: a changed part, an unchanged part counted, an added
  and a removed part, an invalid part, a part of two solids, an inside-out part, an open shell, renumbered faces,
  an approximate volume said with `≈`, the 1,200-char cut, the block within `CONTEXT_LIMIT`, and that a volume
  change alone never holds the Stop.
- `manager.itest.ts`: the stand-in agent edits the fixture model and the PostToolUse answer carries the digest; a
  Stop is held once for a part that became two solids.
- The chat shows the digest under the edit's card (`Transcript.toolContext`), as it does the build line now.
- README "What the agent is told" is updated.

#### Constraints

- Exactness: the solid count, `valid` and the signed exact volume are the kernel's, and every number says `≈`
  where the kernel does not say exact; the mesh volume is not exact, is said as `≈` and is used only to raise a
  warning (root `CLAUDE.md`, "Every number told to the agent is the kernel's").
- Build time: nothing here may add a boolean, a second integral or a new query to a build. The digest is made
  from what the kernel already sends; `meshVolume` is a sum over triangles the build already has; the volume
  integral is the one `extent.volume` makes now.
- The Stop is held at most once per turn, as now ([academic report](https://github.com/luisg0nc/torno/issues/42#issuecomment-6329178911) 2.3: a second hold is not worth it).
- Numbers shown go through `shared/format.ts`.

#### To decide

- Should torno flag "volume fell while the box grew", or make "volume fell by more than half" a hard defect?
  Recommend no to both. It guesses intent (a cut can do it on purpose), and a false alarm teaches the agent to
  skip the line. Give the deltas, and let the prompt say how to read them.
- `updatedToolOutput` (it replaces the Edit tool's own result) or `additionalContext`? Keep `additionalContext`.
  Replacing the result hides the CLI's own confirmation of the edit and gains nothing.
- PostToolBatch: an assistant message with three edits of the model gets three builds and three answers, the
  middle ones often of a half-edited file. Answering once per batch would save the waits. Measure how often it
  happens first (#121), then decide. It also needs a CLI new enough to fire PostToolBatch.
- Should an assembly-wide overlap run here? Recommend not at every build; see #59, which can be called from
  here with a short budget once its cost is measured.

#### Research

- [practitioners report](https://github.com/luisg0nc/torno/issues/42#issuecomment-6329178570) 1.1: ModelRift, union dropped the core (7,065 vs 10,323 mm³), `valid=True`,
  `solids=1`; 9 of 16 failures unreported by the tool (https://modelrift.com/blog/cadquery-vs-openscad/).
- build123d-mcp's protocol: after every execute, `measure` (face count changes as expected, volume plausible)
  before any render (https://raw.githubusercontent.com/pzfreo/build123d-mcp/main/default_prompt.md); it gates its
  export on more than `validate()` (https://pypi.org/project/build123d-mcp/0.3.70/).
- jarvis-onshape-mcp pushes geometric diffs (bbox, part count, mass) after every feature ([landscape report](https://github.com/luisg0nc/torno/issues/42#issuecomment-6329178217)
  2.4).
- [academic report](https://github.com/luisg0nc/torno/issues/42#issuecomment-6329178911) 2.2: exact executable tests agree with people at 0.938 against 0.474 for a VLM judge
  (CADTests, arXiv 2605.07807).


## Task 9: Stop hook: hold back on what the turn did, once per reason (#110)

Issue: https://github.com/luisg0nc/torno/issues/110. Ruling: a dimension the turn broke holds the agent back once (see Rulings). Uses the digest of #108.

`stopAnswer` (`app/src/main/sessions/manager.ts:473-485`) holds a Stop back when the turn saw a build fail, or
when an edit had no `look` after it. Any Stop with `stop_hook_active` is let go. One round fits the research: the
first correction round gives most of the gain. But the check misses cases where the agent says "done" wrongly:

- **A build still running.** `state.status === 'building'` meets neither condition, so the Stop is let go. The
  agent can say "done" while the build of its last edit runs.
- **A long build.** `afterEdit` sets `unlooked` only when the build ended within 55 s (`manager.ts:446-462`). A
  build over 55 s, or one that began after the 3 s grace, never asks for a look.
- **An edit no hook saw.** Only `Edit`, `Write` and `MultiEdit` count (`EDIT_TOOLS`, `manager.ts:99`). A model
  rewritten through Bash (`cat > model.py`, `sed -i`) gets no build answer and no hold-back.
- **One hold for everything.** A turn held for a failed build, which the agent then fixes, is let go on the next
  Stop because `stop_hook_active` is true, even though nobody looked at the fixed build.
- **A dimension the turn broke.** "Never for a failing dimension" (main `CLAUDE.md`, Agents) is right for one that
  already failed: the agent may rightly stop to ask. One that passed when the prompt came and fails after the
  agent's edit is the agent's own regression.

#### Proposal

Judge the Stop from what the turn did, and hold back at most once per reason, two holds per turn at most:

1. **Build running**: wait for it (up to 20 s, as `afterEdit` waits), then judge on its result.
2. **Build failed**, as now.
3. **Not looked at**: a build of this object ended in the turn after the turn's last `look` (count `buildEnds` at
   the look's PostToolUse), however the file was written. The reason names the revision.
4. **Dimension broken**: a pinned dimension that passed on the build current at `UserPromptSubmit` fails on the
   latest. The reason: "M4 passed on r7 and fails on r9 (6 mm, expected 8 ± 0.05). Fix it, or say why it must
   change."

The ledger lives in `TurnState` (`manager.ts:90-96`): the reasons already given in this turn. `stop_hook_active`
is no longer the only guard. Claude Code's own cap (8 continuations) is never reached.

#### Plan

1. `TurnState`: `lookedAt` (build-end count at the last look), `held: Set<reason>`, and `passing` (ids of pinned
   dimensions that passed at `UserPromptSubmit`, from `unmetDimensions`, `shared/dimension.ts:84`).
2. `stopAnswer`: the four rules in that order, one reason per Stop, each once; a short wait for a running build.
3. `manager.itest.ts`: one case per rule, plus "a second Stop for the same reason is let go" and "at most two
   holds".
4. Main `CLAUDE.md` (Agents) and README: the new rules in their words.

#### Done when

- The itest cases pass with the stand-in agent, which posts `Stop` with and without `stop_hook_active`.
- A Bash rewrite of the model (the stand-in writes the file itself, then posts `Stop`) is held for "not looked at".

#### Constraints

- Keep "never for a failing dimension" for one that failed before the turn. Only a regression holds.
- The hold reason is said to the agent. It is not a status: a held Stop moves no status (as now).
- The person's own edit in their editor during a turn also ends a build. The reason must say "r9 was built during
  this turn", not "you edited", so it is true either way.

#### To decide

- Should a `look` by `torno-reviewer` count as the turn's look? I recommend yes. Hooks fire for a subagent's tools
  too (confirm by hand once), and the reviewer reporting in text is how pictures stay out of the main context
  (#125).
- Should the digest (#108) stand in for the look when it says the edit changed nothing (a comment, a rename)? I
  recommend yes. Hold for "not looked at" only when some part's volume, box or face count changed. That saves a
  picture of about 1,600 tokens per such turn.

#### Research

- [academic report](https://github.com/luisg0nc/torno/issues/42#issuecomment-6329178911) 2.3: Query2CAD, most of the +23.1 points in the first refinement; CADCodeVerify, no gain
  beyond round two; CADSmith, 88 of 100 converged in one outer round.
- [practitioners report](https://github.com/luisg0nc/torno/issues/42#issuecomment-6329178570) 1.7: agents declare success on a pass flag or a render that cannot show the defect.


## Task 10: State the verify loop in the prompt: numbers first, then one picture (#118)

Issue: https://github.com/luisg0nc/torno/issues/118. Refers to the digest of #108 by what it now says.

The system prompt (`app/src/main/prompt.ts:34-71`) lists tools one by one but never gives the order to use them.
After an edit it says only "look at the result before saying it is done" (`prompt.ts:42`). It never names `diff`.
It names `check` only for clearance, overlap and mesh, not for `thin`, `overhang` or `bed`. `/review` asks for one
`look` per mark: "Look at what each mark points at with look … before you say it is done"
(`mcp/prompts.ts:26`). That is N pictures for N marks, about 1,600 tokens each. The research is consistent: exact
numbers catch what pictures miss, image loops multiply cost ("roughly quadrupled costs"), and a VLM judging its
own render is right about two thirds of the time. One line is also wrong: "next to this terminal"
(`prompt.ts:35`), while the chat is the default view.

#### Proposal

Replace the scattered lines with one paragraph, the loop:

1. After an edit, read the build result and its digest (#108): the build, what changed, the checks, the
   dimensions.
2. Settle what numbers can settle with `measure`, `check`, `section` or `diff`: the size you changed, a wall, a
   clearance, a hole through.
3. Then `look` once, at the view or saved view that shows the change, with every mark drawn. A second look only
   for what the first could not show.
4. After a change of several steps, `torno-reviewer` (#125).

`/review` step 3 becomes "one or two looks that show all the open marks; a look at one mark alone only where the
numbers cannot settle it". "Terminal" becomes "window".

Keep `--append-system-prompt`. A main-thread `--agent` definition gives the session that agent's prompt and tool
list in place of the defaults, so torno would have to carry Claude Code's coding and tool-use rules itself
(confirm the exact behaviour by hand before deciding). An output style would
override the person's own choice of style. The appended text is recorded on the first request, reused on resume,
and stays a stable cache prefix. Neither alternative gains anything here.

#### Plan

1. `prompt.ts`: the paragraph; drop what it replaces; keep SYSTEM_PROMPT under 6,400 characters
   (`prompt.test.ts`).
2. `mcp/prompts.ts` review step 3; `printable` names the check kinds as now.
3. README "What Claude Code is given": one sentence on the loop.

#### Done when

- `prompt.test.ts` and `prompts` tests pass with the new text; `readme.test.ts` passes.
- The eval harness (#121) compares pictures per task and the check pass rate before and after.

#### Constraints

- Images for the agent stay at most 2000 px (root `CLAUDE.md`).

#### Research

- [practitioners report](https://github.com/luisg0nc/torno/issues/42#issuecomment-6329178570) 1.10 (cost), 2 ("numeric checks catch what pictures miss"), implication 10.
- [academic report](https://github.com/luisg0nc/torno/issues/42#issuecomment-6329178911) 2.1 (CADCodeVerify QA accuracy 64.6 to 68.2 %), 2.2.
- [Claude Code report](https://github.com/luisg0nc/torno/issues/42#issuecomment-6329179151) 5 (prompt caching; `--append-system-prompt` reused on resume) and 5
  ("Torno could: make the CAD agent the main thread with `--agent`"), argued against here.


## Task 11: Say the build an edit started as a build, under the edit, with what it did to the dimensions (#76)

Issue: https://github.com/luisg0nc/torno/issues/76. The stand-in gains `edit <file> <old> <new>` here (the issue says how); #75 reuses it. The per-part lines of #108's digest may be shown in step 3.

When the agent edits the model, the build it starts is put under the edit's card (`Transcript.toolContext`), but it
is drawn by the same component as a prompt's context (`ui/chat/Items.tsx:36`), so it reads `torno added r2 failed
Show text`. Three things go wrong. "torno added" says nothing of a build; the person has to know that this line is
the result of the edit above it. A failed build says only `failed`: the error is behind "Show text", and nothing
opens the traceback sheet the status line opens. And the `r2` chip does nothing: a build ref is never live
(`ui/chat/refs.ts:41`, `live: false`). Meanwhile the hook text the agent got names the dimensions that pass and fail
(`buildContextFor` in `main/context.ts`), and the person sees none of it in line. The research names the gap: "Did
the hole move, did the wall get thinner?" (#7), and practitioners' first ask is to catch silent wrong geometry after
every build ([practitioners report](https://github.com/luisg0nc/torno/issues/42#issuecomment-6329178570) §1).

#### Proposal

Under an edit's card, a build line of its own (`ui/chat/BuildLine.tsx`), drawn when the `context` item's `forUser` is
a tool:

- `Built r2 · ok · 1.2 s` or `r2 failed: NameError: name 'WAL' is not defined` (the last line of the error), in
  `--fail`, with "Show error" opening `BuildErrorSheet` for that build when it is still the latest, and "Show text"
  as now.
- The dimensions whose verdict changed with this build: `M3` now passes, `M2` now fails, as chips with the word.
- Later, with #7's numbers: one line of what changed per part (`tub: volume −1.2 cm³, box Z 40 → 42`), exact or not
  as the kernel says.

The `r2` chip becomes live when it is the build on show: hover nothing, click opens the status line's build detail
(the error sheet for a failed one). An older build stays inert, with its title.

#### Plan

1. `shared/chat.ts`: the `context` item gains `dimensions?: Array<{ id: string; was?: 'pass' | 'fail' | 'none'; now:
   'pass' | 'fail' | 'none' }>` and `error?: string` (the last line), filled in `main/sessions/manager.ts` where
   `toolContext` is called; data, never parsed by the window.
2. `ui/chat/Items.tsx`: `ChatItems` draws a `BuildLine` for a context under a tool, `Added` for one under a prompt.
3. `refs.ts`: `r<n>` equal to the current revision is live, `act: 'build'`; `RefChip` opens the error sheet through
   the store (`App.tsx` holds `errorOpen` today: lift it to the store or an event).
4. Step 3 of the proposal waits on #7's data in the hook ([practitioners report](https://github.com/luisg0nc/torno/issues/42#issuecomment-6329178570) §1 asks for the same in the hook text).

#### Done when

- `transcript.test.ts` and a `manager.itest.ts` case give the fields for a passing and a failing build.
- The stand-in gains `edit <file> <old> <new>`: it writes the file in its working folder (the agent writes the model,
  not torno) between `PreToolUse` and `PostToolUse` of an `Edit`. `e2e/chat.spec.ts` then sees `Built r2 · ok` under the
  card, a failing edit sees `r3 failed:` and "Show error" opens the sheet.
- The `chat` capture shows an edit and its build.

#### Constraints

- The text the agent got stays whole behind "Show text"; the line is drawn from fields only.
- Every number is the kernel's and says whether it is exact (`CLAUDE.md`, Exactness).


## Task 12: Show an edit of the model as a diff, in the permission card and in the tool card (#75)

Issue: https://github.com/luisg0nc/torno/issues/75. Reuse the stand-in's `edit` command from #76.

The person cannot see what an edit of the model changes, before or after. A permission card for `Edit` shows only
`new_string` (`ui/chat/ask.ts:27`: `content ?? new_string ?? new_source`), so a change of `WALL = 2` to `WALL = 3`
reads `WALL = 3`, with nothing to say what it was. A `MultiEdit` has neither field (its input is `edits: [...]`), so
its card shows the path and no body at all. A `Write` shows the first six lines of the new file
(`ui-chat-light.png`, the card "Claude Code asks to use Write": `WALL = 3`, `LID = 2`), not what differs from the file
on disk. Once done, the tool card's "Input" is the input as indented JSON (`ui/chat/ToolCard.tsx:20`), so a
multi-line `old_string` reads as one line with `\n` in it. Every vibe-coding tool the person knows (Cursor, Zed's
agent panel, Claude Code's own TUI) shows an edit as removed and added lines. In torno the edit is the one thing the
agent does to the person's part; it is the line they most need to read.

#### Proposal

One component, `ui/chat/Diff.tsx`, that draws a file change as lines removed and added, used in two places:

- **The permission card** (`AskCard.tsx`, `Permission`): for `Edit`, `old_string` against `new_string`; for
  `MultiEdit`, each of `edits` in turn, numbered; for `Write`, the new content (a new file) as now, with "New file" or
  the count of lines. Six changed lines shown, "Show all N lines" as now.
- **The tool card once opened** (`ToolCard.tsx`): the same diff in place of the JSON for these tools; the JSON stays
  for the rest. The result (Claude Code's `cat -n` excerpt) stays under it.

`Write` over an existing file can be shown as a diff only against the file's text before the write. That needs main
to read it (#83 takes snapshots); until then, `Write` keeps today's body.

Colours: removed and added lines must not be read as marks or verdicts. No red, no green: the mark colours belong to
marks, and `--ok`/`--fail` to verdicts (renderer `CLAUDE.md`, Light and dark). Two new tokens in `tokens.css`,
`--diff-removed-wash` (a step of `--hairline` on `--panel`) and `--diff-added-wash` (`--accent-wash`), with `−` and
`+` in the gutter in `--muted`, and removed text struck through. The sign and the strike carry the meaning; the wash
only groups.

#### Plan

1. `ui/chat/diff.ts`: a pure line diff of two strings (no dependency needed for snippets this size; cap at 400
   lines and say "too long to compare" beyond). `diff.test.ts`.
2. `ui/chat/Diff.tsx` and the two tokens, with `shared/contrast.test.ts` holding the text on both washes to 4.5:1 and
   the washes away from both mark colours.
3. `ask.ts` `describeInput` returns `{ lead, hunks }` for `Edit`/`MultiEdit`; `AskCard.tsx` draws them.
4. `ToolCard.tsx` draws the diff for the same tools when opened. Can ship with step 3 or alone.

#### Done when

- `ask.test.ts` covers `Edit`, `MultiEdit` (two edits) and `Write`; `diff.test.ts` the diff and its cap.
- The stand-in (`app/test/fake-agent.mjs`) is given an `ask Edit {...}` and an `ask MultiEdit {...}` in
  `e2e/chatask.spec.ts`: the card shows the removed and the added line.
- The `chat` capture of `e2e/themes.spec.ts` asks an `Edit` in place of the `Write`, in both themes.

#### Constraints

- Only the mark colours draw marks; verdicts are not mark colours (`tokens.css`, `contrast.test.ts`).
- Numbers and code in the monospace face; text is React text nodes, never HTML (`markdown.tsx` rule).


## Task 13: Mark the read tools read-only, give the server instructions, and keep the core tools loaded (#114)

Issue: https://github.com/luisg0nc/torno/issues/114. Mind the risk the issue names: parallel read calls queue in one worker, and the kernel times a query from when it is queued.

torno registers its 16 tools with a description and a schema only (`app/src/main/mcp/tools.ts:129`). No `annotations`, no `title`, no `_meta`. The server has no `instructions` (`app/src/main/mcp/server.ts:35`). Tool search is on by default in Claude Code and defers every MCP tool: "Only tool names and server instructions load at session start". So at the start of a torno session Claude Code sees 16 bare names, `mcp__torno__scene` and so on, with no word of what they do, and must call `ToolSearch` before its first `scene`, `look` or `measure`. The `torno-reviewer` subagent (`claude.ts:21`) starts the same way. And without `readOnlyHint`, Claude Code cannot batch read-only calls in parallel: three `measure` calls after an edit run one after another.

#### Proposal

1. **Annotations.** `readOnlyHint: true` on `scene`, `marks`, `describe`, `measure`, `section`, `check`, `diff`, `scans`, `scan_clash`, `scan_deviation` and `look` (it writes only torno's own picture under `.torno/views/`). `show`, `highlight`, `save_view`, `add_mark`, `resolve_mark` get `readOnlyHint: false, destructiveHint: false`. Every tool gets `openWorldHint: false` and a `title` in sentence case.
2. **Server instructions** (under 4,096 characters, the cut): one paragraph that says torno's server reads and measures the CAD part of the object this session works on, and one line per tool, so that tool search finds them by the words an agent would search with (measure, wall thickness, section, clearance, picture, marks).
3. **Load the core upfront.** `_meta["anthropic/alwaysLoad"]: true` on `scene`, `look`, `marks`, `describe` and `measure`. The others stay deferred. Every description is under 4,096 characters (the longest, `marks`, is about 1,700), so none is cut when loaded upfront.
4. **Queue what is batched.** The kernel times a query from when it is queued, not from when the worker takes it up (`kernel/src/torno_kernel/supervisor.py:408`), and a worker answers one at a time. Five parallel calls behind a `check thin` of 10 s, or an `area` of a 2,635-face part (10 s, `kernel/CLAUDE.md`), can time out without having run. Either the supervisor starts the 30 s when the worker begins a query, or main sends one query per object at a time. Recommendation: the supervisor (one place, and it is the timeout's owner).

#### Plan

1. `mcp/schemas.ts`: `annotations`, `title` and `meta` beside each description in `TOOLS`; `SERVER_INSTRUCTIONS`.
2. `mcp/tools.ts` `registerTools` passes them; `mcp/server.ts` gives `instructions` to `McpServer`.
3. `kernel/src/torno_kernel/supervisor.py`: a query's deadline set when it is sent to the worker; a kernel test with three queued queries, the first slow.
4. Check by hand that two parallel `look` calls give two right pictures (the window answers each request by id, `renderer/state/agent.ts:363-368`, but nothing tests two at once).

Steps 1 and 2 ship alone. Step 3 should land before or with them.

#### Done when

- `server.itest.ts`: `tools/list` has the annotations and `_meta` above, and `initialize` returns the instructions.
- A test holds the instructions under 4,096 characters and naming every tool in `TOOLS`.
- `readme.test.ts` still passes; the README's Tools section says which tools load upfront.
- Kernel test: a queued query is not timed out by the one ahead of it.

#### Constraints

- Upfront tools cost context every turn and are a prompt-cache prefix: keep the list short. Changing it later is a cache miss for running sessions only.
- `--allowedTools mcp__torno__*` (`claude.ts:74`) stays; annotations do not change permissions.

#### To decide

- Set `alwaysLoad: true` on the whole server in `--mcp-config` instead (torno writes that config)? Recommendation: per tool. Five tools are needed every turn; `scan_deviation` is not.

#### Research

- https://code.claude.com/docs/en/mcp, "Tool search for MCP server authors" and "Mark a tool to load upfront or stay deferred"; [Claude Code report](https://github.com/luisg0nc/torno/issues/42#issuecomment-6329179151) section 2 (readOnlyHint batching).


## Task 14: build123d skill: the known traps, and an API reference that works offline in any workspace (#112)

Issue: https://github.com/luisg0nc/torno/issues/112.

`torno:build123d` (`app/resources/agent-plugin/skills/build123d/SKILL.md`) is sound but has three gaps.

**It cannot be followed in the common case.** To check a signature it says to run `uv run --no-sync python -c
"import build123d; help(...)"`, "only where the workspace has a `.venv`" (`SKILL.md:13-17`). A workspace with no
`pyproject.toml`, the usual one and the example, builds in the kernel's own project (`kernel/client.ts:73-78`).
In a packaged app that is `<userData>/kernel-env`. The agent is told neither path. So the advice is unusable,
and the agent writes from memory.

**It misses traps the research lists, most of all the top one:**
- A union or cut can silently drop geometry and still be "valid". Nothing in the skill says so, or says to check
  the volume after a boolean (the digest of #108 is where to read it).
- A `ShapeList` is unordered. Indexing `faces()[3]` is wrong across edits; always `sort_by`, `filter_by` or
  `group_by` first. The skill says to prefer selecting by position (`SKILL.md:71`), not why.
- A result not assigned is lost (`fillet(...)` returns a new shape). It appears only as a comment in an example.
- After an operation, the new edges are `new_edges(...)` or `bp.edges(Select.LAST)`. Edges selected before an
  earlier chamfer drift.
- A batch fillet can fail where each edge alone passes: bisect the batch. Do not wrap a fillet in `try` and
  silently shrink it.
- Import from `build123d` only (`build123d.exporters` does not exist).
- `bd_warehouse` is not in torno's kernel (`kernel/pyproject.toml`). The skill must say so, and give hole sizes for
  common screws and inserts as `Params` with sources, rather than leaving the agent to import it and fail the build.

**Frontmatter unused**: no `when_to_use` (the trigger shares the description), no reference files beside
`SKILL.md` for progressive disclosure.

#### Proposal

1. A file `skills/build123d/reference/api-0.13.0.txt`: every public name of the pinned build123d, with its
   signature and the first line of its docstring, grouped by module. It is generated by a kernel test from the
   installed version, like the template (`tests/test_skill_template.py`), and the test fails when the file is
   stale. About 60 to 120 KB. The skill tells the agent to `Grep` it (`${CLAUDE_SKILL_DIR}/reference/…`), never
   to run Python for it.
2. Optionally, build123d's own `llms-full.txt` for that version beside it (Apache-2.0, kept with its notice), for
   the concepts the signatures do not carry. It is grepped, not read whole.
3. A "Silent failures" section at the top, and the bullets above in their sections. The skill stays under
   500 lines.
4. `when_to_use` in the frontmatter for the triggers: a build failed in a fillet, chamfer or boolean; an import
   error from build123d.
5. The `uv run --no-sync` lines stay for a workspace with its own `.venv`, said as the exception.

#### Plan

1. Kernel: `tests/test_skill_api.py` writes and checks `api-<version>.txt` (`inspect.signature`, `__doc__`), with
   a `--write` mode as `readme.test.ts` has.
2. The skill text; `prompt.ts` unchanged (it names the skill).
3. `electron-builder.yml`: the file ships with `agent-plugin` (it already ships the folder; check the size budget).
4. Items 3 and 4 can ship alone.

#### Done when

- The kernel test passes and fails on a changed version.
- `claude plugin validate app/resources/agent-plugin` passes (by hand, once).
- The eval harness (#121) shows fewer failed first builds on the T2 cases (bosses, fillets, holes).

#### Constraints

- No network: the reference ships with torno and is read offline.
- Never `uv sync` or a plain `uv run` in a workspace (root `CLAUDE.md`). The skill must not send the agent to the
  kernel's environment to run code there either: the reference makes that needless.

#### To decide

- Add `bd_warehouse` to the kernel? It is a kernel and packaging decision, out of this slice. Until then, the skill
  says it is absent.
- Algebra only? The research finds no evidence for either mode. Keep "prefer algebra, never mix", as now.

#### Research

- [practitioners report](https://github.com/luisg0nc/torno/issues/42#issuecomment-6329178570) 1.1 to 1.4, 2 ("Use the library"), 4, implications 6 and 14 (ship `llms-full.txt`;
  build123d PR #1074, https://github.com/gumyr/build123d/discussions/1409; probe with `inspect.signature`,
  https://pypi.org/project/build123d-mcp/0.3.70/).
- [Claude Code report](https://github.com/luisg0nc/torno/issues/42#issuecomment-6329179151) 5 (skills frontmatter, reference files, `${CLAUDE_SKILL_DIR}`, under 500
  lines).


## Task 15: Ask for the missing sizes before building the first model (#111)

Issue: https://github.com/luisg0nc/torno/issues/111.

The first prompt of a new object ends: "Read brief.md, look at what was given, ask what you need to know, then
replace the placeholder with the real model" (`app/src/main/onboard.ts:126`). "Ask what you need to know" leaves
it to the model, and the research says models guess instead: the sensor case 48.5 × 12.5 mm against the real
55.2 × 21.3 mm, a ring radius 12 mm off, a vendor said to "not publish dimensions" that did. In the academic
review, asking about missing dimensions is the single cheapest gain: ProCAD cut mean geometric error by 79.9 %
with simulated users, and in a human study by a factor of 7.6. In the chat, the agent's `AskUserQuestion` is
already a card the person answers (main `CLAUDE.md`, Agents, "Asks"). Nothing tells the agent to use it.

#### Proposal

The first prompt, and the `torno-model` skill under "Before the first model", say:

1. List the sizes that decide fit or function: overall size, wall, the mating parts' sizes, hole and fastener
   sizes, clearances. For each, say where it comes from: `brief.md`, a reference picture's note, a scan (≈, to a
   few mm), another object, or nowhere.
2. For those from nowhere that decide fit or function, ask in one round before building: `AskUserQuestion`, at most
   4 questions, each with 2 to 4 options, one of them a typical value labelled as typical ("0.2 mm per side, usual
   for PLA at a 0.4 mm nozzle"). Do not ask about what you can choose freely (a fillet radius, a chamfer).
3. Build with the answers. Anything still unknown is built with a stated assumption (#120), and the reply lists
   the assumptions.

The rule holds for later prompts too: a new feature whose key size is not given gets the same one round.

#### Plan

1. `onboard.ts` `onboardPrompt`: the three lines in place of "ask what you need to know". `onboard.test.ts`
   and `transcript.test.ts` (which builds its prompt with `onboardPrompt`) are updated.
2. `torno-model/SKILL.md`: the section "Before the first model".
3. `prompt.ts`: one sentence ("When a size that decides fit or function is given nowhere, ask before you build:
   see torno:torno-model").
4. README "Making a new object": what the first prompt asks the agent to do.

#### Done when

- `onboard.test.ts` holds the new text; `prompt.test.ts` holds the length limits.
- The eval harness (#121) has a missing-dimension track: the share of runs that ask before the first write of the
  model, and the size error with and without the rule.

#### Constraints

- The person stays in charge. One round, at most four questions; never a questionnaire before every change.
- In the terminal view `AskUserQuestion` is the CLI's own. In the chat it is a card. Both work, so nothing new is
  needed in the window.

#### To decide

- MCP elicitation instead of `AskUserQuestion`? No. Elicitation is torno asking. Here the agent is the one that
  knows what it lacks. `AskUserQuestion` already has a card, and a terminal session has it too.

#### Research

- [academic report](https://github.com/luisg0nc/torno/issues/42#issuecomment-6329178911) 2.4: ProCAD, "Clarify Before You Draw" (arXiv 2602.03045).
- [practitioners report](https://github.com/luisg0nc/torno/issues/42#issuecomment-6329178570) 1.6 (Boettger, XDA, the Adam thread: "The agent shouldn't be making up dimensions").


## Task 16: `look` at a ref: frame the picture on a face, an edge, a mark or a box (#115)

Issue: https://github.com/luisg0nc/torno/issues/115.

To see a detail the agent must give `look` a camera: `{position, target, up, fov}` in mm (`app/src/main/mcp/schemas.ts:49-77`). It has to work out where to stand from a `describe`, and gets it wrong often enough that practitioners crop images instead (jarvis-onshape-mcp ships `crop_image`; Claude Code saves the original of each picture so the agent can crop it with Bash). A crop loses resolution; a camera framed on the detail does not. `look` already fits named views to the parts (`frame`), and the viewport has `fitCamera` for a box (`app/src/renderer/viewport/views.ts:72`).

#### Proposal

`look` takes `focus`: a ref (`lid/F12`, `lid/E3`, `lid`), a mark (`M4`), or a box `{min, max}` in mm, with `margin` (default 30 % of the box). With `view` a standard name (`front`, `iso`) the camera looks from that side at the focus; with no `view`, from the direction of the user's camera. The caption names the focus and its box, and says when the focus is hidden behind other parts from that side (the window knows from a pick at the centre), so that the agent can pass `parts` or a section. `show` takes the same `focus`, to show the person.

#### Plan

1. `mcp/schemas.ts` `lookInput`, `showInput`: `focus`, `margin`.
2. `mcp/viewTools.ts`: resolve the focus to a box in main (`describe` for a face or an edge, the scene for a part, the mark's anchor), refused with the refs there are when it names none; `LookRequest.focus`.
3. `renderer/state/agent.ts` `picture`: `fitCamera` to the box from the asked direction; the occlusion line.

Ships alone.

#### Done when

- `tools.test.ts`: a focus on a face reaches the window as its box; an unknown ref is refused naming the way out.
- An e2e capture (`app/e2e`, hidden window) of `look {focus: "M1", view: "front"}` on a fixture shows the mark filling the picture.
- README Tools table names `focus`.

#### Constraints

- Images for the agent: long edge at most 2000 px (root `CLAUDE.md`); unchanged.
- Coordinates in the layout's frame; a part torno spread for display is framed where it is shown, and the caption says so, as `describe` does (`movedForDisplay`).


## Task 17: Export STEP, STL and 3MF, each checked before it takes its name (#48)

Issue: https://github.com/luisg0nc/torno/issues/48.

Torno makes a part and gives no way to take it out. The one export is a self-contained HTML viewer
(`app/src/main/export/html.ts`; `htmlPath` adds `.html` to whatever was chosen, `app/src/main/export/save.ts:28-30`).
No code in `app/src` or `kernel/src` writes STEP, STL or 3MF (grep for `export_step`, `export_stl`, `Mesher`,
`3mf`, `STEPControl`: none outside tests that touch scans). The README says so plainly: "There is no tool that
exports, imports or aligns a scan, or writes a file: those are yours" (`README.md:555`). A person who wants to
print has to ask the agent to write an export script and run it, which the `torno-model` skill tells it not to do
for the model, and which no check covers. Every competitor in torno's family writes these files: text-to-cad
(STEP, STL, 3MF, GLB, DXF), agentcad, Amagine3D ([landscape report](https://github.com/luisg0nc/torno/issues/42#issuecomment-6329178217) section 5, rank 3). The CADAM thread's
top technical complaint was "no STEP".

The research adds a warning: "preview and export are not the same thing, so verify the exported file
independently" (ModelRift, [practitioners report](https://github.com/luisg0nc/torno/issues/42#issuecomment-6329178570) 1.1 and implication 15). The mesh torno draws is not one
to print: ocp-tessellate meshes at a deviation relative to the part's box (`tess.DEVIATION = 0.1`,
`tess._quality`), so a 200 mm part's holes are visibly faceted.

#### Proposal

The export sheet gains a format: HTML (as now), STEP, STL, 3MF.

- **STEP**: one file of a layout (the assembly by default), each part a named, coloured child. Exact B-rep.
- **3MF**: one file of the `print` layout, each part a named object, in millimetres, placed as the layout places
  it (spread as torno spread it, said in the sheet). This is the file a slicer takes as a plate.
- **STL**: one file of one part (the sheet picks it). Millimetres, as STL has no unit.

The file is made by the live worker of the last good build, which holds the shapes: a new query `export`
(`format`, `layout`, `parts`, `tolerance`) that answers with the bytes in the reply's blob (the supervisor already
passes a query's blob on, `kernel/src/torno_kernel/supervisor.py:491`). The kernel never writes a file. A mesh
format is meshed for the file, not taken from the screen: a tolerance in mm (0.01 by default, with an angular one)
said in the sheet with the triangle count it gave.

Main writes it as it writes the HTML (`writeExport`: `<path>.<random>.tmp`, synced, renamed). Before the rename,
the worker reads the temporary file back and checks it: a second query `export_check` given that path.

- STEP: read again, the same parts by name, the same solid count, each volume within 1e-6 of the B-rep's, the same
  boxes.
- STL and 3MF: per object, closed after welding (`checks.open_edges`), no degenerate triangles, enclosed volume
  positive (outward normals) and within the chord loss the tolerance allows of the B-rep volume, told in percent.

A file that fails is not renamed into place, and the sheet says why. The sheet then says what was checked
("3MF, 2 objects, 184,220 triangles, closed, volume within 0.04 % of the model"), in torno's words: checked,
not printed.

#### Plan

1. Kernel: `export.py` with the three writers (build123d's `export_step`, its `Mesher` for 3MF and STL; lib3mf is
   already in the environment as a build123d dependency) into bytes, and `export_check`. Tests in
   `kernel/tests/test_export.py`. Ships alone, behind no UI.
2. Main: `export/save.ts` takes the format's extension (`htmlPath` becomes per format); `ipc.ts` `export:save`
   asks the worker, writes, has the temporary file checked, renames. A longer query budget for an export than the
   30 s a query has (`kernel/CLAUDE.md`, "A query has 30 s").
3. Window: the format in `ui/ExportSheet.tsx` (UX track), with the layout or part and the tolerance.
4. README "Export": the formats and the check; the "Not yet verified" list gains "a 3MF opened in a slicer".

#### Done when

- `kernel/tests/test_export.py`: each format round-trips on a fixture; a file cut short fails its check.
- `app/src/main/export/save.test.ts`: a failed check leaves no file under the chosen name and no `.tmp`.
- `e2e/export.spec.ts`: a 3MF and a STEP written to a path given by `__tornoMain.pickSave`, checked, hidden window.

#### Constraints

- Root `CLAUDE.md`: an export writes one file, to the path the person chose, whole or not at all; the path never
  comes from the window or an agent, and no agent has a tool for it. All three hold: the kernel returns bytes,
  main writes, the agent is not given an export tool.
- "Never writes inside a user workspace": unchanged; the file is the one exception that already exists.
- The worker reads one file given by path, as the scan queries do (`kernel/CLAUDE.md`, Scans: "given paths and
  never looks for a file").

#### To decide

- STL of a whole layout as one mesh? Recommend no: one part per STL, and 3MF for a plate.
- "Open in the system's app" after a 3MF is saved (Electron `shell.openPath`)? Recommend yes, behind a tick that is
  off by default: it is the whole of a slicer hand-off torno should do (see #58 on slicers).
- DXF or SVG of a saved section, for laser-cut parts? Recommend later, as a fourth format of the same machinery.


## Task 18: Say why a fillet or chamfer failed (which edges, the largest radius that works), and let the agent try one on the last build (#49)

Issue: https://github.com/luisg0nc/torno/issues/49. Ruling: name edges in `local` coordinates by default, and by ref only where an edge of the last good build matches exactly.

The second most reported failure: a fillet or chamfer that fails with a message that names neither the edge nor
the reason ([practitioners report](https://github.com/luisg0nc/torno/issues/42#issuecomment-6329178570) 1.2). In build123d 0.13 every fillet failure is "Failed creating a fillet
with radius of 6.0, try a smaller value or use max_fillet()" (`build123d/topology/three_d.py:371`); OCC's own are
`BRep_API: command not done` or `StdFail_NotDone`. The agent gets that and the end of the traceback
(`app/src/main/context.ts`, the failed build line). Then it guesses: it lowers the radius, often for every edge, or
wraps the fillet in `try` (which the flowful skill forbids). The causes are checkable: a radius larger than the
shortest adjacent edge, adjacent fillets that overlap, a batch that fails where each edge passes alone.

A probe, a 20 mm square plate with a 12 mm pocket (4 mm walls), all eight vertical edges at R6:

- the batch fails with the message above;
- each edge alone at R6 works;
- four pairs fail: the inner corners, two by two (two R6 fillets need more than the 12 mm side between them);
- build123d's own `max_fillet(edges)` raises `RuntimeError: Failed to find the max value within 0.01 in 10`: its
  search starts at twice the box diagonal;
- a bisection over (0, 6] finds the largest radius that works for the eight to 0.001 mm; the whole diagnosis took
  0.27 s.

So the facts the agent needs can be found, cheaply, by trying. They have to reach the agent in two places: with the
failed build, and as a trial it can ask for before it edits again.

#### Proposal

**The diagnosis, in the failing worker.** When a build fails inside build123d's `fillet` or `chamfer`, the failing
worker (which is about to exit) looks in the traceback for the frame of `Solid.fillet` / `Solid.chamfer` and takes
its `self`, `radius` (or lengths) and `edge_list` from the frame's locals. Within a budget (5 s, said when it runs
out) it:

1. tries each edge alone at the radius;
2. if all pass alone, finds the pairs that fail (adjacent edges first, by shared faces);
3. bisects the largest radius that works for the whole set, and for each edge that fails alone;
4. describes each failing edge in the kernel's words (line, 12 mm, along Z, between a plane and a cylinder), with
   its ends in the frame of the shape being filleted, named `local`.

**With the build.** The build error gains a `diagnosis`: the operation, the edges, the radius asked, the largest
that works, and what failed in a bisected batch, such as `fillet R6 of 8 edges: each works alone; 4 pairs of
adjacent edges fail (local edges 4-5, 4-6, 5-7, 6-7: two R6 need more than their 12 mm side); the 8 together work
up to R5.99`. `scene` gives it under `build.error`, the `PostToolUse` context of the edit says it under the error
line (`buildContextFor`), so that the agent sees it without a call, and the error sheet shows it. Nothing is
retried in the model: the agent decides.

**A trial.** A read tool `try_fillet {part, edges: ["lid/E3", ...], radius, kind: "fillet" | "chamfer"}` asks the
live worker to fillet those edges of the last good build and throw the result away: does it work, the largest
radius that does (bisected, within the 30 s), which edges fail alone. It changes nothing.

**Booleans** (`StdFail_NotDone`, or an empty result) are a later step: the same frame search on `BRepAlgoAPI_*`,
and OCC's `BOPAlgo_ArgumentAnalyzer` on the two arguments (coincident faces, small edges, self-interference).

#### Plan

1. Kernel: `diagnose.py`, called from `worker._build`'s failure path before the error frame is written. Tests in
   `kernel/tests/test_diagnose.py` on the plate above, a chamfer case and a case past the budget. Ships with 2.
2. Main: `BuildError.diagnosis` in `shared/build.ts`; `context.ts` (`buildContextFor`) tells it after the message;
   `viewTools.ts` `sceneTool` gives it under `build.error`; the error sheet shows it (`ui/BuildErrorSheet.tsx`).
3. `try_fillet`: a query in `kernel/src/torno_kernel/queries.py`, the tool in `mcp/readTools.ts` and `TOOLS`. Ships
   alone, after or before 1 and 2.
4. The `build123d` skill: on a fillet failure, read the diagnosis, then `try_fillet` before editing again. Its
   "Fillets and chamfers" section can then shrink.
5. Booleans, as a follow-up issue once step 1 is used.

#### Done when

- `test_diagnose.py` reproduces the probe: each edge alone works, the four pairs, the bisected radius. A kernel test
  on a plate whose R3 fillets do not fit in a 4 mm wall: the diagnosis names the edges and a radius that works, and
  `try_fillet` agrees.
- `context.test.ts`: the diagnosis fits under the error within the limits the failed line keeps.
- README "Objects and builds" says what a failed fillet tells; the README Tools table lists `try_fillet`
  (`readme.test.ts`).

#### Constraints

- `kernel/CLAUDE.md`: workers never fork, and the supervisor never builds. The diagnosis runs in the worker whose
  build failed, before it exits; no new process. The trial runs in the live worker and leaves its shapes as they
  were.
- Every build has a timeout: the diagnosis counts against it, with its own budget inside.
- Coordinates crossing a process boundary are in the object frame unless named `local` (root `CLAUDE.md`). The shape
  being filleted in a failed build is an intermediate one with no place in the scene: its coordinates are `local`.
- Refs are of the last good build, which is not the failed source: any reply that gives refs says so.

#### To decide

- Should the diagnosis name edges by ref of the last good build (`lid/E12`) where it can tell? Recommendation: by
  default no ref for the intermediate shape, only `local` descriptions; a ref only where an edge matches one of the
  last good build exactly, said as of that build. `try_fillet` works on the last good build, so its refs are real.

#### Research

- [practitioners report](https://github.com/luisg0nc/torno/issues/42#issuecomment-6329178570) 1.2 and item 5 (ModelRift, nurb, jmwright's CadQuery skill, flowful).


## Task 19: Show the axes and a scale in the view, as the agent's pictures have them (#71)

Issue: https://github.com/luisg0nc/torno/issues/71.

The person's viewport has no axis triad, no view cube and no scale. The pictures the agent gets have an axis triad
bottom left and a scale bar bottom right, or the note `perspective, no scale bar` (`renderer/viewport/overlay.ts:46`
`drawOverlay`; its one caller is `renderer/viewport/picture.ts:432`). Compare `ui-main-light.png`, where nothing on
screen says which way X or Y runs, with the picture in `ui-view-board-light.png`, which has the triad bottom left.
The grid is the only cue, and its spacing changes with the size of the parts (`viewport/views.ts:139` `gridStep`:
a power of ten or five times one) and is never said. In a front view of a box (`ui-views-light.png`) there is no
cue at all.

This matters more in torno than in a modeller. The agent and the person talk in the object frame: the agent writes
"the +X wall", `y = 20`, "normal +Z". The practitioners' research lists "got axes backwards" and parts "lying on
their side" among the most common agent failures ([practitioners report](https://github.com/luisg0nc/torno/issues/42#issuecomment-6329178570) 1.5, the XDA test and TrueDuality's
report). The person is the one who catches that, and today has to orbit and guess which way is +Y. Every CAD tool
named in the brief (Onshape, Fusion, Shapr3D, Plasticity) has a triad or a view cube on screen at all times.

#### Proposal

Draw on screen what the agent's picture has, in the same places, so that the person and the agent see the same
frame:

- The triad bottom left, with the same code (`drawTriad` in `overlay.ts`, `--axis-x`, `-y`, `-z`), drawn by
  `OverlayPass` (`viewport/overlayPass.ts`) with every frame, on the canvas it already draws the labels on.
- Bottom right: in orthographic, the scale bar (`drawScaleBar`, `scaleBarLength`); in perspective, the grid's
  step in words, `grid 5 mm`, in the monospace face. The grid lies on the ground in the object frame, so its step is
  a true length in any projection. The picture's note `perspective, no scale bar` could then say the grid step too.

No view cube for now: torno's bar of views already does the cube's work in words. Clicking an end of the triad to
look along that axis is the one piece of the cube worth having later (below).

#### Plan

1. `viewport/overlay.ts`: export `drawTriad` and `drawScaleBar` (or one `drawFrameCues(ctx, o)`), sized by a unit
   for the screen (`overlayUnit` is for a 1280 px picture; the screen wants a fixed size, about 32 px arms).
2. `viewport/overlayPass.ts`: draw them after the labels, from the camera's right and up vectors and, in ortho,
   mm per pixel (`Viewport` has `pointerAt`/`project`; the picture code works it out already in `picture.ts`).
3. `viewport/ground.ts` / `Viewport.rebuildGround`: keep the step `groundOf` used, for the text.
4. Move `.measure-choice` (`styles/tools.css:56`, bottom left while Measure is in hand) to clear the triad, or put the
   triad above it while Measure is in hand.
5. Ships alone. A later step: the triad's ends as targets (`X` looks along X), hit-tested in `PointerRouter` before
   the tool, as the gizmo already is.

#### Done when

- `overlay.test.ts` covers the triad for a camera looking along each axis and the step text for a perspective camera.
- `themes.spec.ts`: the captures `main`, `section` and `views` show the triad in both themes, and `views` (ortho
  front) shows the scale bar.
- README, "The viewport": one sentence on the triad and the scale.

#### Constraints

- Axes are in `--axis-*`, never a mark colour (`renderer/CLAUDE.md`, Light and dark; `contrast.test.ts`).
- No per-frame state in React: the overlay canvas only.
- Numbers in the monospace face, through `shared/format.ts`.
- A picture for the agent stays as it is: it already has both.

#### To decide

- Triad bottom left as in the pictures, or bottom right where nothing floats? I recommend bottom left: the person's
  screen and the agent's picture then read the same way, and the measure strip moves up by its height.
- Click an axis end to look along it? Recommended as a second step; it is the part of a view cube people use.


## Task 20: A session that needs you is invisible unless its object is open and the session pane is shown (#69)

Issue: https://github.com/luisg0nc/torno/issues/69. Ruling: the dot of a working session is `--muted`; a session that needs input uses the accent.

Each object has its own session, and "it keeps running while another object is shown" (README "The agent"). When
the agent asks (a permission, a question, a plan), the session reads "Needs input" in the header of the session
pane, and only for the open object (`ui/SessionPane.tsx:26`, `STATUS_WORD`, `needs_input: 'Needs input'`); the card
takes the focus once (`AskCard.tsx`). These places say nothing:

- The object list has one plain button per object and reads no `sessions` (`ui/ObjectList.tsx:166-179`).
- The dock can be hidden (`renderer/App.tsx:388`, `hidden={!dockOpen}`). Its toggle (`dock-toggle`) is a bare icon
  with no badge (`App.tsx:406-415`).
- The status line has no session item (`ui/BuildStatus.tsx`).
- The window does nothing when it is not focused.

So this happens: you ask Claude Code to rework `bracket`, open `hollow` to mark something, and `bracket`'s session
stops on a permission question. Nothing in the window tells you until you go back to `bracket` or open the page of
objects, whose card says "Session needs you" (`ui/cards.ts:73`, `:84`). The same happens with the dock hidden for a
larger view. A turn left waiting on a permission card is the most common way an agent session stalls, and lost time
every session. Claude Code's TUI rings the terminal bell and posts a system notification for exactly this.

#### Proposal

The status of every session, where the eye already is:

- **Object list**: a 6 px dot after the name, using the status line's dot (`.status-dot`), and the page of objects'
  chip logic. Still, no animation: `--warn` with the word "needs you" for `needs_input`, and a quieter dot while
  working (see To decide for its colour). Nothing is shown for idle or exited. The row's title and `aria-label` say
  it ("bracket, session needs you").
- **Dock toggle**, when the dock is hidden: the same dot on the icon while the hidden session works or needs input,
  with the status in its title and `aria-label` ("Show session: Claude Code needs input").
- **Status line**: when any session of the workspace needs input, a button "`bracket` needs you". It opens that
  object and shows the dock. If it is the open object, it focuses the waiting card. With several, it goes to the
  first such session, in list order.
- **The window**, when unfocused and a session moves to `needs_input`: `BrowserWindow.flashFrame(true)` on Linux
  and `app.dock.bounce('informational')` on macOS, once per ask. No system notification by default.

#### Plan

Each step ships alone; step 1 first.

1. `ui/ObjectList.tsx`: read `s.sessions[o.id]?.status`, and draw the dot and the label. `styles/panels.css` gets
   `.object-row .status-dot`.
2. `renderer/App.tsx`: the dock toggle reads `store.sessions[objectId].status` and gets the dot when collapsed.
3. `ui/BuildStatus.tsx`: the "needs you" button.
4. `main/index.ts`: on a session status `needs_input` with the window unfocused, flash or bounce once.

#### Done when

- `e2e/agents.spec.ts`: the stand-in posts a `Notification` for object A while B is open. The row of A has the dot,
  and the status line button opens A. It passes with the dock hidden as well.
- `e2e/chatask.spec.ts`: with the dock hidden, an `ask` of the stand-in puts the dot on the toggle; with another
  object shown, on the list row; the dots go when it is answered.
- A unit test of the flash rule (needs input, window unfocused, once per ask).
- `e2e/themes.spec.ts` `main` has a second object whose session needs input, so the dot is captured in both
  themes.
- `styles/styles.test.ts` passes.
- README "The agent" says where a waiting session shows.

#### Constraints

- No endless animation (`styles/styles.test.ts`): the dot is still.
- `--warn` is no mark colour; it is the dark theme's ochre, not amber. Hooks stay the one source of status (root
  `CLAUDE.md`, "What crosses processes").
- Tests never open a visible window: the flash is checked by a unit test of the rule, not by looking.

#### To decide

- The working dot: `--accent` or `--muted`? Recommend `--muted`, so that only the dot that needs you draws the eye.
- A system notification (Electron `Notification`) when the window is not focused, as an option? Recommend no in v1:
  flash and bounce are enough, need no permission, and a notification touches the person's system, so it should be
  asked for.


## Task 21: The build error sheet offers only Copy: say Claude Code is told, and hand it over (#70)

Issue: https://github.com/luisg0nc/torno/issues/70.

A failed build is the most common event of a vibeCAD session. `ui-error-light.png` shows the sheet:

- "bracket did not build", a code word `exception` in monospace, the message, the traceback.
- One action, Copy (`ui/BuildErrorSheet.tsx:199-229`).

Three things are missing or misleading:

1. **It does not say what happens next.** The next prompt's context carries the error and the end of the traceback
   (`main/context.ts:393-401`). The PostToolUse hook tells the agent after its own edit. The sheet says neither,
   and the composer's "Goes with your next prompt:" line lists marks only (`ui/chat/Composer.tsx:45-70`). So the
   person copies the traceback and pastes it into the chat. The agent then gets it twice.
2. **The status line pushes Rebuild.** After a failure it becomes the primary button (`ui/BuildStatus.tsx:105`,
   `data-primary` when `status === 'failed'`). Rebuilding unchanged sources gives the same exception. Rebuild helps
   after a `crash`, `timeout` or `cancelled`, or a build let go for memory, not after an `exception` in the model.
3. **`exception` is a kernel word**, set apart like a value.

#### Proposal

- The lead says who is told: "Claude Code is told this with your next prompt." If the session ran the edit:
  "Claude Code was told after its edit."
- A primary button **"Ask Claude Code to fix it"** puts `Fix the build of bracket: see the error.` into the
  composer through `insertIntoComposer` (`ui/chat/Composer.tsx:36`). It does not send, and it shows the dock. With
  no live chat it reads "Start a session to fix it" and starts one. Copy stays as a quiet button.
- The kind is said in words, in the muted face: "Python error in the model", "The build took too long (timeout)",
  "The build process stopped (crash)".
- Rebuild is primary only for `crash`, `timeout`, `cancelled` and a build let go. After an `exception` it stays
  quiet.
- The composer's "Goes with your next prompt:" line gets a "build failed" chip (U4 owns that line, so this part
  is coordinated with U4).

#### Plan

1. `ui/BuildErrorSheet.tsx`: the lead, the kind's words (`kindWords(kind)` in `shared/build.ts`, tested), and the
   button. `BuildErrorSheet.test.ts` covers the words.
2. `ui/BuildStatus.tsx:105`: `data-primary` by kind.
3. `e2e/loop.spec.ts`: a failing model, then "Ask Claude Code to fix it" with the stand-in. The composer holds the
   text, and nothing is sent.

#### Done when

- The tests above pass. `e2e/themes.spec.ts` `error` is captured again in both themes.
- README "Objects and builds" says what the sheet offers.

#### Constraints

- The person stays in charge: the button fills the box and never sends.
- Every key from `shared/keys.ts`. The sheet keeps `sheet.close`.


## Task 22: Before a drawing is sent, show what the ink lies over; and preview "Attach view" (#77)

Issue: https://github.com/luisg0nc/torno/issues/77.

"Draw on view" works out at Done which faces, cut faces and scans each stroke lies over (`ui/drawing/make.ts`
`finishDrawing`, `under`), and main tells the agent `stroke 1 … lid/F12 (plane, normal +Z …)`. The person never sees
it. The chip above the box says only "Your drawing on the view goes with your next prompt"
(`ui/chat/Composer.tsx:200`), and once sent the prompt shows the picture while the caption is dropped
(`main/sessions/transcript.ts:146`, "A text that comes right before a picture … only names that picture"). So a ring
drawn round a wall but picked as the face behind it, or a drawing made while the camera moved ("not worked out"),
goes to the agent unchecked. agentcad's pattern is the reverse: "press a key, click, confirm the inferred part and
revision" ([landscape report](https://github.com/luisg0nc/torno/issues/42#issuecomment-6329178217) §6). Torno already has the data and the live chips to do it.

"Attach view" is a toggle with no preview (`Composer.tsx:254`, `aria-pressed`): the person cannot see what picture
will go until it is sent. And the board's title is "Draw on the view" (`ui/drawing/ViewBoard.tsx:15`) while the
button is "Draw on view".

#### Proposal

- The drawing chip lists what the ink lies over, as live chips (hover lights them in the view, as everywhere):
  `Over tub/F3, tub/F1, the cut face of lid · stroke 2 over no part`. When it was not worked out (the view moved), it
  says so in `--warn` with "Draw again". When the model has been built again since, it says the refs are of `r2`.
- The sent prompt shows the same line under its picture, as part of "torno added" (a `drawing` field on the user
  item, data from the window's `ViewDrawing.under`, not the caption text).
- "Attach view" pressed shows a thumbnail chip beside the drawing chip (the same `picture({ view: 'current' })` the
  send would take, made when pressed, with "Remove"), so the two read as one row of what goes with the prompt.
- The board is titled "Draw on view", as its button.

#### Plan

1. `Composer.tsx`: the drawing chip draws `drawn.drawing.under` (refs per stroke, cut faces, scans) with `RefChip`.
2. `shared/chat.ts` user item: `drawing?: { under: …; revision: number }`; `transcript.userSent` takes it from the
   send (main has `ViewDrawing` there), never from the caption text.
3. `Composer.tsx`: the attach chip; `ViewBoard.tsx` title.

#### Done when

- `e2e/chatask.spec.ts` (draw on view): after Done, the chip names a face of the part drawn across; hovering it lights
  it; after send the prompt shows the line; a drawing made while the camera moved says it was not worked out.
- The `view-board` capture gains a second shot with the chip.

#### Constraints

- No coordinate is told or shown: refs and the kernel's lines only (draw-on-view spec, decision 4).
- The drawing is kept nowhere on disk; the line on the user item is text in the log, which is allowed (refs only).


## Task 23: Left column: give the marks the room, let the other sections fold, and make Objects a switcher (#73)

Issue: https://github.com/luisg0nc/torno/issues/73. Ruling: Objects folds to a switcher by default; update the rule in `app/src/renderer/CLAUDE.md`.

The left column is 248 px wide (`--left-w`, `styles/tokens.css`) and stacks Objects, Layers, Scans and Marks. Each
section above Marks has a cap of its own in `styles/panels.css`: Objects `max-height: 38%` (lines 9-14), Layers
`34%` (line 25), Scans `32%` (line 32). Marks takes what is left, with a floor of `96px` (line 40). The caps add up
to 104%. Nothing in the column folds and nothing can be resized: no section title has `aria-expanded`, and the only
splitter in the window is the session dock's.

In `ui-main-light.png` the Objects section runs from y 56 to y 360: "All objects", eight names in a scroller with
its own bar, and "New object". Layers, Scans and Marks share what is left. With 15 objects and a scan, Marks is left
with about 300 px. In `ui-scans-light.png`, with one scan and its detail open, Marks is two rows high and scrolls,
while the list of objects above it holds nine names that nobody needs while working on `hollow`. The list also
scrolls on its own, so the open object can sit out of sight in its own section (`ui-folders-light.png` shows the
list scrolled to `gauge … hollow`). A muted row (an object that cannot be built, `two` in `ui-page-light.png`)
gives its reason only as a tooltip (`ObjectList.tsx:173`).

While a person works with the agent, Marks is the section they read most, after every reply: what is still to
send, what the agent resolved, which check fails. It should be the section that grows. Objects is switched a few
times an hour, through the page (`W`), the list, a card or the folder menu. Layers and Scans are used now and then.

What works and should stay: one narrow column with hairline dividers and no frames; Objects giving way first
(`panels.css` line 10); a scan's row on one line (#21); the column giving the objects all the room when nothing is
open (`panels.css` line 18, `.left:not(:has(> .layers, > .scans))`).

#### Proposal

- **Objects as a switcher.** While an object is open and the page is not up, and the workspace has more than one
  object, the Objects section starts folded to one row:

  ```
  hollow                     ⌄     All objects  W
  ```

  The name of the open object, in ink. A click or Enter opens a menu of every object (the same rows as today, with
  the session dot of #69), with "New object" at its foot. A row that cannot be built shows its reason as a
  second muted line in the menu, not only as a tooltip. "All objects" with its key, as today. Unfolding the section
  shows the list as today. With no object open, or the page of objects up, the list is shown whole as now.
- **Sections fold.** Each section title above Marks (Objects, Layers, Scans) is a fold button with `aria-expanded`.
  When a section is folded, its title row (28 px) says what matters, in mono where it is a number: `Objects 9`,
  `Layers 12 · 3 hidden`, `Scans 1 · unaligned`.
- **Marks gets the room.** Marks never folds. It keeps room for at least five rows (about 170 px): the caps of the
  sections above give way before it does.
- **A splitter** (`role="separator"`, arrow keys move it) above the Marks title gives Marks more height. A double
  click puts the shares back.
- Later, and separately: the column's width can be dragged like the dock, 248 to 400 px, so that notes are cut less.
- What is folded, and where the splitter is, is a preference of the window. It is kept in the window's own storage
  (or main's userData), never in the workspace.

#### Plan

1. `ui/ObjectList.tsx`: an `ObjectSwitcher` with `role="button"`, `aria-haspopup="menu"` and the menu keys of
   `ui/FolderMenu.tsx` (`menu.next`, `menu.previous`, `menu.ends`, `menu.close`), used when
   `page === 'object' && objectId !== null`. `styles/panels.css`: `.objects` drops its `max-height` in the switcher
   form. Ships alone, and frees most of the room.
2. `ui/SectionTitle.tsx` (new): a title that folds, used by `ui/ObjectList.tsx`, `ui/Layers.tsx` and
   `ui/ScansPanel.tsx`. The folded sections go in `state/store.ts`, kept per window (localStorage wrapped in
   try/catch, or main's userData). Ships alone.
3. `styles/panels.css`: a folded section is its title only; Marks gets `min-height` for five rows, and the caps above
   make way for it.
4. `ui/ColumnSplit.tsx` (new): the splitter. The drag sets a CSS variable on the column, as the dock's drag does,
   and nothing goes through React per move. Ships after 3.
5. Optional, its own issue: a resizable column width (`--left-w`).

#### Done when

- `e2e/show.spec.ts` still holds the object list giving way. With 15 objects and one open, the Marks section starts
  above y 160, and the switcher's menu opens another object by the keys alone.
- A new case in `e2e/marks.spec.ts`: with one scan's detail open and Objects folded, at least five mark rows are in
  view at 1440 × 900.
- `e2e/focus.spec.ts`: folding a section with the pointer gives the keys back to the view.
- `e2e/themes.spec.ts` `main`, `folders` and `scans` are captured again; `scans` shows the five rows.
- README: "The window" says that the sections fold; "Objects and builds" describes the switcher.

#### Constraints

- No per-frame state in React: the splitter drag writes a CSS variable.
- Keys come from `shared/keys.ts` only (`keys.test.ts`). The switcher needs no new key. Recommend none for folding;
  if one is wanted it is a row of `shared/keys.ts` first.
- No row of the list is current on the New object page (`renderer/CLAUDE.md`, A new object). The switcher then reads
  "New object", pressed.
- Never write in the workspace: this is how the person likes the window, not part of the object.

#### To decide

- Fold Objects by default when an object is open? Recommendation: yes, when the workspace has more than one object.
  A lone object is shown by itself already.
- Should the full list, folded, open as a menu or unfold in place ("Show all objects")? Recommendation: both, as
  above: the row's name opens the menu, which costs no column height and matches the folder menu next to it; the
  title's fold shows the list in place for those who want it.


## Task 24: A mark's row and its chip in the view should point at each other (#74)

Issue: https://github.com/luisg0nc/torno/issues/74. Ruling: a click on a mark's chip wins over the tool in hand.

The row of a mark and the mark in 3D are linked one way only, and that way moves the camera.

- Hovering a row changes its background (`styles/marks.css` line 30) and nothing in the view: `ui/MarkRow.tsx` has
  no pointer-enter handler. Yet a chip of the same mark in the chat lights the faces it is on when hovered
  (`ui/chat/refs.ts` line 35, `ui/chat/RefChip.tsx` line 27 through `peek`). A mention of `M3` in the chat does
  more than M3's own row.
- Clicking anywhere on a row moves the camera to the view the mark was placed from (`MarkRow.tsx` line 159,
  `actions.focusMark` in `state/store.ts` line 642, `Viewport.focusMark` in `viewport/Viewport.ts` line 405), every
  time, also when the person only wanted to open a dimension's fields. A view the person had set up is thrown away
  to read a tolerance.
- The chips in the view (`M1`, `M3 40 mm ✗`) cannot be pointed at. They are drawn on a canvas over the 3D view whose
  CSS lets the pointer through (`renderer/styles/layout.css:113`, `.mark-labels { pointer-events: none }`), a
  mark's 3D objects are never picked (`markObjects.ts`, `object.raycast = () => {}`), and the Select tool picks only
  faces and edges (`tools/selectTool.ts`). In `ui-main-light.png` the person sees `M1` on the right wall and must
  find `M1` in the left column to read "too thin here", or to open it. With 10 or 15 marks on the part this is a
  search every time, by reading numbers. Only the status line's `1 dimension fails` brings a row into view
  (`goToRow`, `ui/BuildStatus.tsx` line 19).
- A failing dimension's chip says `40 mm ✗` and nothing more (`viewport/marks/labels.ts` `labelValue`). The row says
  the same. What it should be (`42`) and by how much it misses are one click away, in the panel.
  `shared/dimension.ts` already has `offBy` (`2 under`).

The mark is the vocabulary the person and the agent share. Pointing at it in either place should find it in the
other at once. Every annotation tool the landscape report names (text-to-cad's annotations, agentcad's spatial
comments, [landscape report](https://github.com/luisg0nc/torno/issues/42#issuecomment-6329178217) §1 and §6) opens a note from the annotation itself.

#### Proposal

1. **Row hover lights the mark.** Hovering a row draws its chip ringed more lightly than the active one, and the
   faces it is on are lit by `peek`, as the chat's chip does. One call on enter and one on leave; nothing per frame.
2. **Row click selects; the camera moves only when needed.** Clicking a row makes the mark the active one (ring,
   row opened). The camera moves only when the mark is not in view (`Viewport.markLabel(id).visible`). "Go to its
   view", the reticle at the end of the row (`MarkRow.tsx` line 273), always goes to the view it was placed from, as
   now.
3. **Chip hover shows the note.** Over a chip the cursor becomes a pointer, the chip is drawn active (its outline,
   as the active row's is), the row gets its hover background, and the pointer's readout shows the note on one
   line, cut to its width: `M1 too thin here`. For an agent's mark, its note; for a dimension,
   `M3 40 mm, expected 42 ± 0.1, 2 under`.
4. **Chip click focuses the row.** Clicking a chip makes the mark active (`actions.setActiveMark`), so its row opens
   with the note whole and is scrolled into view (`goToRow`); for a mark of the person's that is not sent, the note
   card beside the mark opens to edit it (`actions.openNote`, the `NotePopover` a new mark gets today). No camera
   move: the person is already looking at it. A click on a chip is taken before the face under it, and the tool is
   not handed it. A drag that starts on a chip still turns the camera.
5. **A failing chip says by how much**: `40 mm ✗ 2 under`, in the fail colour, numbers in the monospace face. The
   same text is in a picture for the agent (it reads the chip too), so `look` gains the gap in numbers.

Hit-testing is of the chip boxes the overlay pass already works out every frame (`labels(...)` returns `Placed`
with `box`; `OverlayPass.markBox`, `Viewport.markBox` at line 416): keep the last ones, and test the pointer
against them before the tool is handed the event.

Keep: the active row's scribed line in `--accent` (`marks.css` line 37), the ring on the active chip, and "Go to its
view".

#### Plan

1. `ui/MarkRow.tsx`: pointer enter and leave call `actions.hoverMark(id | null)`. `ui/ViewportPane.tsx` passes that
   to a new `Viewport.setHoverMark(id)`, which `viewport/marks/MarkLayer.ts` draws as it draws `setActive`, lighter.
   Ships alone.
2. `state/store.ts`: split `focusMark` into `selectMark` (active only) and the camera move. The row's click calls
   the camera move only when the mark is out of view. README "Marks" says "Clicking a row goes to the view the mark
   was placed from", and that sentence changes. Ships alone.
3. `viewport/overlayPass.ts`: keep the `Placed[]` of the last frame; `markAt(x, y): string | null` from the chip
   boxes. `viewport/pointer.ts` / `ui/ViewportPane.tsx` / `tools/selectTool.ts`: before `routePointer`, a move over
   a chip sets the cursor, the readout and the row's hover, and a click on one makes the mark active, calls
   `goToRow` and opens the note card where it applies. Ships alone after 2.
4. `viewport/marks/labels.ts` and `overlay.ts` `drawLabels`: a failing value carries `offBy`. Ships alone.

#### Done when

- Unit tests of `markAt` against placed boxes, and of the failing chip's text.
- `e2e/marks.spec.ts`: hovering M2's row sets the viewport's hovered mark (a `__tornoTest` read); clicking the row of
  a mark in view leaves the camera where it was; hovering `M1`'s chip reads `too thin here`; clicking M3's chip
  (`__tornoTest.markScreen('M3')`) makes M3 the active row (`aria-current`) in view and opens its note; a click on a
  chip with the Pin tool in hand leaves no pin.
- `e2e/focus.spec.ts` still passes: after a click on a row or a chip, the next letter is the view's.
- `themes.spec.ts` `main`: `M3 40 mm ✗ 2 under` in both themes.
- README "Marks" updated; `readme.test.ts` passes.

#### Constraints

- A picture for the agent draws every mark alike, with no active mark and no hover (`app/src/renderer/CLAUDE.md`,
  Marks).
- No per-frame state in React: the hit test reads what the overlay pass already keeps.
- The hover light is not an agent highlight: no agent line, no locked tools, as `peek` already is.
- Numbers shown go through `shared/format.ts`.

#### To decide

- Should a row click move the camera at all when the mark is in view? Recommendation: no. The reticle is there for
  that.
- Should a click on a chip win over the tool in hand (Pin, Arrow, Draw), or only with Select? Recommendation: over
  any tool. A chip covers the part under it, so a click there is almost never meant as a pin under the chip.
- A way to hide the marks in the view (all, open only, none) for a clean look at the part, as many marks gather? It
  belongs with the Marks panel's heading (U3), not the view bar.


## Task 25: First screen: say what is missing before anything fails (Claude Code, uv, the kernel environment) (#68)

Issue: https://github.com/luisg0nc/torno/issues/68. Ruling: `PATH` lookup always; `claude --version` and `claude auth status` only outside tests, 3 s each; the stand-in answers both.

A newcomer needs Node 22.12, pnpm 10, uv, Python 3.11 or 3.12 and a logged-in `claude` on `PATH` before torno does
anything (README:24-43, "Requirements"). The kernel environment is made by uv the first time it is needed. The
window checks none of this up front. Each is found missing only when it is first used:

- No `claude`: found only when a session is started (`app/src/main/sessions/manager.ts:284`: "cannot start the
  agent: 'claude' was not found on PATH"; README:1209-1213), after the object is open. On the New object page that
  check comes after the folder is made: the object is opened with its first prompt held (README "Making a new
  object"). So a newcomer does the most careful step first (name, description, photos, doodle) and then learns that
  nothing can run.
- No `uv`: the first build fails with "kernel stopped" and `could not run uv: spawn uv ENOENT` in its tail
  (`app/src/main/kernel/client.ts:233-235`, `:295`). A kernel that never started "is reported by the first build"
  (`renderer/App.tsx:49`).
- The first build of a workspace without `pyproject.toml` makes torno's own environment with uv: here it is 878 MB
  (`kernel/.venv`), fetched from the network. The status line only says `Building 14 s`, seconds counting
  (`ui/BuildStatus.tsx:111`); the README mentions it once, in passing ("longer the very first time",
  README:162-164). Offline, that build fails, while the first screen says torno writes only into `.torno` and the
  README says it uploads nothing.
- A workspace with a `pyproject.toml` and no `.venv` fails every build with "run `uv sync`" (`client.ts:358-359`),
  again only once a build is tried.

The first screen (`ui/Welcome.tsx:80-131`) says what torno is and offers "Open folder" and the example, and knows
none of this. `ui-welcome-*.png` and `ui-empty-*.png` say nothing about readiness. The only trace of the kernel is
`build123d 0.13.0` at the far right of the status line, once it is up.

#### Proposal

The first screen and the empty workspace get one quiet block, "Ready to work", with a line for each check. The same
lines are in a sheet from the folder menu ("Check what torno needs").

- **Claude Code**: `found at /usr/local/bin/claude` (with its version where it is asked, see To decide) in ink with
  the `--ok` dot, or "Not found on PATH. Install Claude Code and log in, then reopen torno" in `--fail`, with the
  `PATH` torno has and the README anchor named.
- **Kernel**: `build123d 0.13.0, Python 3.12` once `workspace.versions()` answers. If torno's Python environment is
  not made yet: "Not made yet: about 900 MB is fetched the first time, so the first run needs the network", with
  "Make it now", which runs uv for torno's own kernel project (never a workspace's) and shows uv's progress lines.
  While it is being made: "Preparing torno's Python environment (the first time takes a minute or two)". If it
  fails, the reason from main.
- **uv**: shown when missing ("not found on PATH: install it from docs.astral.sh/uv"); otherwise its version is
  folded into the kernel line.
- For a workspace with a `pyproject.toml`: whether `.venv` is there, before the first build.

When everything is ready the block folds to one line ("Claude Code and build123d 0.13.0 are ready") and stays out
of the way. The New object page shows the Claude Code line above Create when it is not found, so the person knows
the object will be made but not started.

While the environment is being made by a first build, the status line says "Making torno's Python environment,
first time only" in place of `Building N s`.

#### Plan

1. Main: `main/ready.ts`, behind `agents.ready()` / a `ready` channel in `shared/bridge.ts`. It finds `claude`
   with the same `findCommand` the manager uses (`main/sessions/choice.ts:69`) and `uv`, on the `PATH` torno uses
   (after `applyLoginPath`), answering `{ command, path | null }`; it says whether `kernel-env` / `kernel/.venv`
   exists, and whether a workspace with a `pyproject.toml` has its `.venv`. Any `--version` call runs with a
   timeout (see To decide). Ships alone.
2. Main: the kernel's start state (`starting`, `ready` with versions, `failed` with message) as an event, beside
   `workspace.versions()`.
3. Renderer: `ui/Readiness.tsx`, used by `ui/Welcome.tsx` (under the tagline), by the empty state of
   `ui/ShowPage.tsx`, by `ui/onboard/NewObject.tsx` (above Create, only when something is missing) and by the
   folder menu's sheet. Ships after 1.
4. "Make it now": `uv sync` with `--frozen` for the packaged app (`kernelRun` in `main/paths.ts`), on torno's own
   kernel project only, progress streamed.
5. `builds.ts` / `ui/BuildStatus.tsx`: the first-time line when the kernel has not said it is ready and no
   environment existed at start.

#### Done when

- Vitest for `ready.ts` with a fake `PATH`: none found, both found, one that hangs past the timeout.
- `e2e/welcome.spec.ts`: with `TORNO_AGENT_CMD` pointing at a file that does not exist, the first screen says
  "Not found on PATH"; with the stand-in it says "found". With a `PATH` without `uv` (under `TORNO_TEST=1`) it says
  uv is missing.
- `e2e/themes.spec.ts` gets a `welcome-first` state (no recent folders; today only the returning state is
  captured) that shows the block in both themes, with something missing and with all found.
- README "Requirements" and "Troubleshooting" say the first screen checks these and name the block.

#### Constraints

- Never run a real agent CLI from tests: tests set `TORNO_AGENT_CMD` to the stand-in. If torno runs
  `claude --version`, the stand-in must answer `--version`; `TORNO_TEST=1` skips any `auth status` call.
- Nothing of the person's Claude Code configuration is read (`app/src/main/CLAUDE.md`, Agents).
- Never `uv sync` in a workspace (root `CLAUDE.md`, Global Constraints). "Make it now" is for torno's own project
  only, and the workspace lines report and change nothing.
- Sentence case, numbers and versions in the monospace face.

#### To decide

- How much of the CLI to run. A `PATH` lookup runs nothing. `claude --version` tells the version (the README's
  list of silent failures includes "starts and leaves at once because it is signed out or too old"), and
  `claude auth status` (JSON with `authMethod`, [Claude Code report](https://github.com/luisg0nc/torno/issues/42#issuecomment-6329179151)) tells "signed out" before the
  first prompt; both run the person's CLI. Recommendation: the lookup always; `--version` and `auth status` once at
  start, outside tests only, each with a timeout of 3 s and nothing written.
- Whether to say on the first screen that the first run needs the network. Recommendation: yes, one line; "no
  network" is true of torno itself, not of uv making its environment.


## Task 26: The empty workspace leads with the manual route and a uv lesson (#78)

Issue: https://github.com/luisg0nc/torno/issues/78. Follows #68: the readiness block shares the space.

`ui-empty-light.png` is what a newcomer sees right after "Open folder" on an empty folder, which the first screen
says "is fine". The centre column says, in order (`ui/ShowPage.tsx:220-236`):

1. "No objects in torno-e2e-themes-bare-rv1sjt yet".
2. "Make a folder with a Python model in it, for example `part/part.py`, and it appears here": the manual route,
   first.
3. "New object", the button that does it for them.
4. Four lines on `pyproject.toml`, `uv init`, `uv add build123d` and `uv sync`, for a person who has no model yet.

Around it, the left column repeats "Objects" and "New object", and the 520 px session pane says only "Open an
object to work on it with the agent." The example, the best way to learn, is not offered here at all, only on the
first screen and in the folder menu.

#### Proposal

Rewrite the empty state as one short column, in this order:

- **"Make your first object"**, then one line: "Say what it is, add photos or a sketch, and Claude Code writes
  the model."
- **New object** (primary). Under it, "or open the example to look around" (quiet, when `hasExample`).
- A fold, **"Already have build123d models?"**. Inside it: the folder rule (`part/part.py`) and the
  `pyproject.toml` note, unchanged.
- The session pane in this state says what will happen there: "Claude Code works here, one session per object.
  Make or open an object to start."

Add one line on scope, from what practitioners report: "Works best for printed parts and small assemblies.
Organic shapes are hard." ([practitioners report](https://github.com/luisg0nc/torno/issues/42#issuecomment-6329178570) item 13, Boettger:
https://dominic-boettger.com/blog/3d-printed-case-with-claude-code-openscad/).

#### Plan

1. `ui/ShowPage.tsx` empty state and `styles/cards.css` `.show-empty`.
2. `ui/SessionPane.tsx`: the copy when no object is open.
3. `e2e/themes.spec.ts` `empty` captured again. `e2e/welcome.spec.ts` checks that the example link is there when
   `hasExample` is true.

#### Done when

- The captures show New object as the first action in both themes.
- README "Making a new object" names the empty state as a way in.

#### Constraints

- The `pyproject.toml` note stays: it is true and needed (`renderer/CLAUDE.md`, The first screen). It moves into
  the fold.
- torno runs no `uv` command there. The note names commands for the person to run.


## Task 27: Learn the tools and the pointer without the README: what each tool does, what it waits for, how the view turns (#72)

Issue: https://github.com/luisg0nc/torno/issues/72. Follows #78.

The palette is nine icons with a 9 px letter each (`renderer/styles/tools.css:176` `.tool-key { font-size: 9px }`,
a crop of `ui-main-light.png`). A tooltip is the native `title`, which comes after about a second, and says the name
and the key only: `Pin (P)`, `Draw (D)`, `Region of a scan (B)` (`ui/ToolPalette.tsx:125`). What each tool does is
written already, for the sheet of keys (`shared/keys.ts:34` to `42`, `does`: "Arrow: drag from a point", "Draw: a
stroke on the surface, or on a locked view"), and is not shown at the palette. Once a tool is in hand nothing says
what it waits for: Pin, Arrow, Draw, Shape and Measure all show the same crosshair (`tools/*.ts`
`cursor: 'crosshair'`) and, over the part, the same ref readout. Region of a scan and Align scan are offered with no
scan in the object, as live as the rest (`ui-main-light.png`); only a click says "no scan".

The pointer itself is explained only in the README's "Five minutes with torno": "Drag to turn, drag with the right
button to pan, scroll to zoom". No text in the window says it (a search of `ui/`, `viewport/`, `tools/` finds none),
and the sheet of keys has keys only. A newcomer who opens the example and drags with the right button has no way to
learn that the view pans. `W` bringing the page of objects shows only as a `kbd` on the "All objects" row. Two
things the window already says well, and should keep: the empty Marks section says a mark goes with your next
prompt, and the Scans section says a scan can be dropped on the view.

Someone who never read the README cannot tell Draw from Shape from Region by their icons, or know that Arrow wants a
drag and not a click. Fusion and Shapr3D answer this with a rich tooltip at once and a line telling the next step.
text-to-cad chose a visible mode over a hidden gesture for the same reason ([landscape report](https://github.com/luisg0nc/torno/issues/42#issuecomment-6329178217) §6, box select
as a menu mode).

#### Proposal

- **The tooltip** is torno's own (a small panel beside the button, at once on hover, on focus too): the name, the
  key cap, and `does`. For a scan tool with no scan: "Import a scan first" and the button drawn quieter (not
  disabled: the key and the click still say why).
- **The step line.** While a tool other than Select is in hand, one quiet line at the bottom of the view (where the
  selection bar goes) says what it waits for next and how to stop, without a key of a tool: `Pin: click the part,
  then write a note`; `Arrow: press on the part and drag to where it should go`; `Measure: click the first end`,
  then `…the second end`. It goes when the tool is put down. A setting to hide it is not needed if it is one line.
- **The pointer in the sheet of keys.** The sheet gets a first group, "Pointer": drag turns, right drag pans, scroll
  zooms, a double click measures something round with Measure. It is drawn as the other groups are. Its rows are not
  keys and are not in `KEYS`.
- **A one-time pointer hint.** The first time a workspace's first object is drawn in this install, the same line at
  the foot of the view says: "Drag to turn · right drag to pan · scroll to zoom · `?` for every key". It goes at the
  first camera move, and is remembered in the window's `localStorage` (a convenience only: if storage fails, it
  shows again). A tool's step line takes its place while a tool is in hand.
- The key letters at 11 px.

#### Plan

1. `shared/keys.ts`: `next` sentences per tool beside `does` (one table, as now). `shared/pointer.ts`: a small table
   of the pointer's rows, which `readme.test.ts` can hold as it holds the keys.
2. `ui/ToolPalette.tsx`: `ToolTip` component (no `title`), and the scan tools' quiet state from the store's scans.
   Ships alone with 1 and 5.
3. `ui/ToolHint.tsx`: the line at the foot of the view, `aria-live="polite"`, no animation; the tools tell it their
   step through the store once per step (never per move). `ui/ViewportPane.tsx` shows the one-time pointer hint in
   it. Ships alone after 1.
4. `ui/KeySheet.tsx`: the Pointer group from `shared/pointer.ts`. Ships alone.
5. `styles/tools.css`: the key size; the tip and the line on the tokens.

#### Done when

- `keys.test.ts` still passes: no key written out in a text, every key from `hint(id)`.
- `e2e/tools.spec.ts`: hovering each tool shows its `does` within 200 ms; with Measure in hand the line changes after
  the first click; with no scan the Region tip says "Import a scan first"; the pointer hint is there on first open
  and gone after a drag.
- `themes.spec.ts`: a capture `tools` with a tip open and a step line showing, and a `keys` state (the sheet of keys
  has no capture today), both themes.
- README "Five minutes with torno" says the window shows the pointer controls in the sheet of keys.

#### Constraints

- A tool's key is shown only on its button, its tooltip and the sheet of keys (`renderer/CLAUDE.md`, Marks; #19):
  the step line names no tool key. `keys.test.ts` fails for a key written out in a text: the pointer hint names `?`
  through `hint('keys')`.
- Sentence case; no all-caps labels.
- Nothing is written under a workspace for this.


## Task 28: Show the model's Params in the window, read only (#52)

Issue: https://github.com/luisg0nc/torno/issues/52.

The kernel reads the model's `Params` at every build: name, type as written, default, whether it is a literal,
and the comment of the field (`kernel/src/torno_kernel/loader.py:121-162`). `scene` gives them to the agent
(`app/src/main/mcp/viewTools.ts:103`, issue #8). The window never shows them: no file under `app/src/renderer`
reads `params`. The `torno-model` skill makes `Params` "the one source of sizes" (every size, clearance and count
is a field), so the list of fields is the model's own summary of what can change, with the agent's comments, and
the person cannot see it without opening the file.

#### Proposal

A "Parameters" section in the left column, under the layers: one row per field, the name, the value in the
monospace face with its unit as the comment gives it, and the comment on hover or below. Read only. A field whose
default is not a literal says so ("worked out in the model"). A click on a row copies `Params.wall` into the
prompt as a chip, so the person can say "make this 2.4". Nothing is written.

#### Plan

1. `ui/ParamsPanel.tsx`, from the scene the window already has (`Scene.params`). No main or kernel change.
2. The chip: the same path a ref chip takes into the prompt.

#### Done when

- A renderer unit test of the rows from a scene with literal, non-literal and documented fields.
- `e2e/groups.spec.ts` or a new `params.spec.ts` shows the section for a fixture with `Params`, hidden window.
- README "The window" names the section.

#### Constraints

- Sentence case; every number in the monospace face; tokens from `styles/tokens.css`.
- Torno never writes the model.


## Task 29: Show which workspace instructions Claude Code also reads, and which wins (#50)

Issue: https://github.com/luisg0nc/torno/issues/50.

Claude Code started in `~/objects/<object>/` also reads `CLAUDE.md` files from that folder and every folder above
it, and the person's own `~/.claude/CLAUDE.md`. Torno looks above the object only for settings files
(`.mcp.json`, `.claude/settings.json`, `.claude/settings.local.json`; `app/src/main/trust.ts:13`), never for
instructions, and its prompt says nothing of them (`main/prompt.ts` has no mention of `CLAUDE.md`).

The person's real workspace shows why it matters. `~/objects/CLAUDE.md` (7 KB) was written for the tool before torno
(a viewer of its own). It tells the agent: "After every build read `out/viewer/report.json` and LOOK at the pictures with the Read
tool before telling the user anything about the shape", "Never say 'the viewer should show': check the report", and to
export through `main()` with `common.build.build`. Torno writes none of `out/viewer/`, and torno never runs `main()`.
So every torno session in that workspace is told two ways to see the build, one of them stale. The same file also
holds what torno should want the agent to follow (ask for caliper numbers first, blockouts first, append to
`../LESSONS.md`), so the answer is not to hide it.

#### Proposal

- The session pane names the instruction files Claude Code will read for this object ("Claude Code also reads
  `~/objects/CLAUDE.md`, 7 KB"), each openable, beside where it asks "Start the chat anyway?" for settings. Shown
  once per object, not a question.
- The system prompt says which wins for seeing and measuring: "What torno's tools say of the build is current. A
  `CLAUDE.md` that names another viewer, report or export step is about another way of working: follow its advice on
  how to model, not on how to see the build."
- The "torno added" line of the first prompt names the files, so the person can see what the agent was given.

#### Plan

1. `main/trust.ts` (or a sibling `memory.ts`): the `CLAUDE.md` files from the object up to `/`, and
   `~/.claude/CLAUDE.md`, with sizes. Read only. Tests with a temporary tree.
2. `ui/SessionPane.tsx` line, and the first prompt's "torno added".
3. `main/prompt.ts` sentence (agent track to word it; `prompt.test.ts` keeps the length limits of main's `CLAUDE.md`).

#### Done when

- Vitest for the finder; an e2e capture of the pane with a workspace `CLAUDE.md`; a README line in "What Claude Code
  is given". A by-hand line in "Not yet verified": the real CLI in `~/objects` no longer reads `out/viewer/report.json`.

#### Constraints

- Torno reads and changes nothing of Claude Code's settings (README:421-422). Naming a file is reading its path and
  size, not its text; showing its text is done only when the person opens it.
- Never write in the workspace: torno does not edit `~/objects/CLAUDE.md`; it may say "this file names `out/viewer/`,
  which torno does not write" when the file says so.

#### To decide

- Whether torno should look for `AGENTS.md` too. Recommendation: only with #54, for other CLIs.


## Task 30: Decide how torno drives Claude Code: the CLI on pipes or the Agent SDK, before `--bare` becomes the default (#117)

Issue: https://github.com/luisg0nc/torno/issues/117. Ruling: keep the CLI on pipes behind an `AgentTransport` interface; detect a first turn that fails on authentication and say so, offering the terminal view. No Agent SDK code.

torno's chat is the person's own `claude -p` with stream-json on pipes, under their login (`app/src/main/sessions/claude.ts:18`, `stream.ts`). Two things put that at risk:

- **`--bare`.** The CLI reference says `--bare` (which never reads the OAuth token or the keychain) "will become the default for -p in a future release". No opt-out is documented. Under it the chat would start, find no credentials, and fail on its first turn; the person would see "Claude Code stopped" or an auth error in a turn, while the terminal view (no `-p`) kept working. Whether `--bare` also drops `--plugin-dir`, `--settings` hooks or `--agents` is not documented.
- **The Agent SDK's auth policy.** "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods." Whether a desktop app that runs the person's own installed CLI, under their own login, falls under it is not documented. The documented advice for hosts in other languages is to run the CLI as a subprocess, which is what torno does.

The protocol torno speaks is also the SDK's private one: `initialize`, `interrupt`, `set_model`, `can_use_tool` and `command_lifecycle` are what the SDK uses, but the raw control protocol "for a custom host" is not documented. Each CLI release can move it.

#### Proposal

A decision issue with a short spike. What to weigh:

| | CLI on pipes (now) | Agent SDK (TS) |
|---|---|---|
| Auth | the person's own CLI and login | the policy says API keys unless approved |
| Protocol | undocumented, moves with the CLI | typed, versioned, documented |
| CLI version | the person's | bundled with the SDK, or `pathToClaudeCodeExecutable` |
| MCP | HTTP on loopback with a secret | in-process server: no port, no secret |
| Hooks | HTTP hooks | callbacks |
| Extras | | `rewindFiles`, `getContextUsage`, `canUseTool` without the stdio prompt tool |

Recommendation: keep the CLI on pipes, the closest to "your own Claude Code", and do three things now.

1. **Ask Anthropic** whether driving the person's installed CLI under their login is allowed for torno, and whether `-p` will keep a way to use the login (an opt-out of `--bare`). Record the answer here.
2. **Put the transport behind an interface.** `AgentAdapter` (`sessions/adapter.ts`) says how to launch; the stream (`ClaudeStream`) and what `Sessions` asks of it (`prompt`, `control`, `answer`, events) become an `AgentTransport`, so an SDK transport can be added without touching the transcript.
3. **Fail well under `--bare`.** When a chat's first turn ends in an authentication error, or `init` says no credentials, the pane says "Claude Code's headless mode does not use your login any more" and offers the terminal view for that object (`agent.json` `view`), which runs the person's CLI as they would.

#### Plan

1. The question to Anthropic, and the answer here.
2. `sessions/transport.ts`: the interface; `stream.ts` its one implementation. No change of behaviour; `stream.test.ts` and `manager.itest.ts` pass as they are.
3. `sessions/transcript.ts`: the auth failure note and the offer; the stand-in learns `FAKE_AGENT_AUTH_ERROR`.
4. Only if the answer to 1 allows it, or the CLI route closes: a spike of an SDK transport behind the interface, with the in-process MCP server.

#### Done when

- This issue holds the decision and the answer to step 1.
- The interface is in, with no change in the tests.
- The auth failure under the stand-in shows the note and the offer.

#### Constraints

- No test runs `claude` or the SDK against a real account.
- torno has no network and no telemetry; an SDK transport must not add either (the SDK talks to the API as the CLI does, and nothing else).

#### Research

- [Claude Code report](https://github.com/luisg0nc/torno/issues/42#issuecomment-6329179151) section 4 (the SDK, the policy quote, `--bare`), section 3 (auth precedence).

## Task 31: Kernel test: a worker that watches its parent fails under load (#134)

Issue: https://github.com/luisg0nc/torno/issues/134. Added during the run: the flake cost a re-run in most tasks. Its cause was
seen in a failure on 2026-10-22: `kernel/tests/test_supervisor.py` `gone_or_zombie` calls `stat_of(pid)` twice, and when the
process vanishes between the two calls the second returns `None` and `.startswith` raises
`AttributeError: 'NoneType' object has no attribute 'startswith'` (line ~1751).

#### Proposal

Read the process's state once in `gone_or_zombie` (a vanished process is gone; a zombie is dead all the same), and look for
any other helper of the test that reads a process's state twice. Do not weaken what the test proves: a worker leaves when its
supervisor is killed. If the fixed 5 s wait is also too short on a loaded machine, wait for the event with a bound that holds
under load.

#### Done when

- The test passes 20 times in a row inside the full kernel suite run three at once
  (`for i in 1 2 3; do (cd kernel && uv run pytest -q) & done; wait`, a few rounds), or as many rounds as fit in 20 minutes.
- `cd kernel && uv run pytest -q` passes.

## Task 32: e2e: session.spec.ts fails now and then under load (#137)

Issue: https://github.com/luisg0nc/torno/issues/137. Added during the run: `app/e2e/session.spec.ts:143` ("the status follows the
hooks the agent posts") failed in most full e2e runs on 2026-10-22 and sometimes alone (once in three), and `:165` once; the
file is serial, so a failure leaves the 11 tests after it not run.

#### Proposal

Find what the test waits on (the terminal text `typeLine` writes and reads back, the status the hooks set, `expect.poll` and
`toHaveText` timeouts, the stand-in's `hook` command posting to torno) and wait for the event it is about, with a bound that
holds under load. If the flake is in the app (a status set out of order when hooks arrive close together), fix the app and
say so. Do not weaken what the test proves.

#### Done when

- `pnpm -C app exec playwright test e2e/session.spec.ts --repeat-each 20` passes (after `pnpm build`).
- The spec passes in two full e2e runs in a row.

## Task 33: Stop hook: do not hold the agent back for a build it did not cause (#138)

Issue: https://github.com/luisg0nc/torno/issues/138. Added during the run: found by Task 32 (#137), whose flaky test was the
Stop hook holding a turn for the object's cold first build, which the agent never caused.

#### The rule

Since #110 the Stop hook's "the build failed" and "a build was not looked at" reasons look at any build that ended during the
turn. Hold for those two only when the build is of sources the turn changed: a build begun after the turn's first change of a
source (an `Edit`, `Write` or `MultiEdit` of a `.py` in the object, or a Bash that rewrote one, as #110 already detects). A
build the turn did not cause (the first build of an object just opened; a save the person made in their own editor) is told as
today in the digest and the context, and never holds the Stop. The dimension rule and the hard-defect rule stay as they are,
judged against what the turn began with.

#### Done when

- `manager.itest.ts`: a build that began before the turn's first edit, or in a turn with no edit, ends in the turn (ok or
  failed) and the Stop is not held; one caused by the turn's edit is held as now.
- `app/src/main/CLAUDE.md` ("The build after an edit, and the Stop of a turn") says the rule.
