---
paths:
  - "app/src/test/pngFixtures.ts"
  - "app/e2e/**"
  - "app/test/**"
  - "app/evals/**"
  - "app/src/**/*.itest.ts"
  - "app/src/main/ready.ts"
  - "app/src/main/ready.test.ts"
  - "app/src/evals*.test.ts"
---

# The stand-in agent, the specs that use it, and never the real CLI

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## The chat and the stand-in agent (`app/e2e`)

A chat session is tested with `app/test/fake-agent.mjs` in its stream mode, which it enters when started with
`--input-format stream-json`: it speaks Claude Code's protocol on its pipes and prints nothing else. Its header
lists everything it does; in short, a prompt's text is a script of one command per line: `say`, `tool <name>
<json>` (a name beginning `mcp__torno__` calls torno's MCP server for real), `ask <name> <json>` (a permission
request, answered by the window), `slow <s>`, `work <s>` (a tool that takes that long), `rate <percent>`, `images`,
`garbage`, `retry`, `deny` and `argv`; `/noop` and `/compact` are what the CLI does for them. As the real CLI does (seen 2026-10-15), a prompt that
comes while a tool runs is folded into the running turn (its hook, no `init`, one result), and an interrupt while a
request waits sends `control_cancel_request` first. An interrupt keeps the prompts queued behind the turn (it lists their
uuids in `still_queued`) and runs them afterwards together, one `init`; every prompt torno writes has a `uuid`, and the
stand-in says `command_lifecycle` `queued`/`started`/`completed` for it, as the real CLI does. A queued prompt is
therefore never "Not sent" after a Stop. Every `init` has what the CLI says of itself as the recordings have it (`plugins`
with torno's when `--plugin-dir` was given, `skills` of the person's only, `apiKeySource` `none`,
`claude_code_version` 2.1.300), and `FAKE_AGENT_INIT=<json>` replaces fields of it or adds `mcp_servers` with
`mcp_server_errors` or `plugin_errors` (`e2e/account.spec.ts`), and the commands `retry <attempt> [<s>]` (`api_retry`), `deny <tool> <json>` (a permission
denial in the turn's `result`) and `argv` play the rest. `write <file> <content>` plays a `Write`: its `PreToolUse` and
`PostToolUse` carry `tool_use_id` and `tool_input` (`file_path`, absolute, and `content`), the file is really written
between them (`file` from the folder it runs in, a `\n` in the content a new line), and the answer of the `PostToolUse`
is said as a `system`/`hook_response`; `edit <file> <old> <new>` plays an `Edit` the same way (`old_string`,
`new_string`; the words are bare or JSON strings, `edit part.py "W = 2" "W = 3"`), replacing `old` by `new` in the
file between the hooks. A `Stop` torno answers with `decision: block` is not the end of the turn: the
stand-in says the reason as a `hook_response` of the `Stop` and posts it again with `stop_hook_active`, as the CLI does. `FAKE_AGENT_FAIL=<text>` makes it write that to stderr and exit 1
at once; `FAKE_AGENT_INIT_ERROR=<text>` makes it answer `initialize` with that error; `FAKE_AGENT_AUTH_ERROR=<text>` makes its first
turn one that could not authenticate (after the hook and the `init`, an assistant message of `<synthetic>` whose text is
<text>, marked `error: "authentication_failed"`, a `StopFailure` posted in place of the `Stop`, and a `result` with
`is_error: true`), the next turns running as ever, or, with `FAKE_AGENT_AUTH_EXIT=1`, exits 1 after that `result` (`e2e/login.spec.ts`; the shape is the Agent SDK's, not yet seen from a
real CLI). Its permission suggestions are the three kinds the real CLI sends, so a test
proves that only the session rule is passed on. Specs that drive a terminal call `inTerminal` (`e2e/terminal.ts`),
which writes `view: 'terminal'` into their temporary copy's `.torno/agent.json`. Give the run a HOME of its own
when a spec checks that nothing is written to the person's settings.

Two fixtures were recorded from the real CLI and scrubbed: `app/test/fixtures/claude-stream.jsonl` (Claude Code
2.1.300: a turn, tool use, hooks) and `claude-stream-asks.jsonl` (2.1.301: a permission, a question and
`/compact`). Every line of both parses as JSON. Never run the real `claude` to record or check; that is done by hand (`docs/manual.md`, last section).

## Making a new object (`app/e2e`)

- `e2e/onboard.spec.ts` drives the page (draft, name errors, Esc and the discard questions, photos, the board, a
  scan, a referred object, Create, and a launch whose agent is not found); `e2e/objects-create.spec.ts` drives
  `objects:create` through the bridge (files written, the kernel builds the placeholder, refusals). The agent is
  the stand-in: the first prompt arrives as one prompt with its pictures, and the test reads their natural widths
  in the chat (a 3000 px photo must arrive at 1280). Never the real `claude`.
- Photos are made by the test: `src/test/pngFixtures.ts` builds a real PNG of any size by hand (a gradient, no
  library), written to a temporary folder and handed over by `__tornoMain.pickPhotos`. A WebP is made by the window
  itself from a canvas. A scan is made with `src/test/scanFixtures.ts`.
- The board is drawn with `page.mouse` (real pointer events on the hidden window); its Ctrl+Z and Esc with
  `page.keyboard`. No screenshots: the strokes are read from the store and the PNG from the prompt's pictures.
- A drop with a real path cannot be made in a test: a `File` made in the page has no path (`webUtils` gives
  none), so the drop is tested only for its refusals (no path, not a picture, a picture over 25 MB, not read). The
  code a real drop takes is the dialog's, from `takePhotos` on. Photos go through the dialog hook.
- `themes.spec.ts` has the states `onboard` and `onboard-board` for `TORNO_SHOTS`, and `view-board` for the chat's
  "Draw on view" (`e2e/chatask.spec.ts` drives it: a point of the canvas over a part is found with `pickAt` and the
  same fraction of the board is drawn on; "Done" makes a draft view note, which the next `say` carries, and the words of the note are read from what the stand-in says back, line by line).
- `e2e/review.spec.ts` makes a round on the `gauge` fixture: "Review this build" (`R1` on `h1`), `-` for don't want and a face picked with Select and "Note", the bar's Want and a 3D sketch, a plain view note drawn on the board (it is no waiting note above the box), a prompt sent meanwhile that carries none of them (the text under "Show text" says `R1 is in review, not sent (3 marks).`), Send review and the chip in the composer, then a prompt whose script has the stand-in `resolve_mark` both items (the review line and the items are read from "Show text" too: the script never sees them). A rebuild needs a change of a `.py` file (the history goes by the Python files: `variant.txt` alone makes no new build), and then the round's panel says OK to one item and Still wrong to the other and the board is read for two round frames, the Still wrong card in the second (`board.json`, `source: 'R1'`).
- `e2e/sketch.spec.ts` draws a 3D sketch on the `gauge` fixture (a line on XZ begun on the Ø8 hole's centre, a freehand stroke on the plane of the top face with `N`, Flow ⌀19, Done) with `page.mouse` and reads the marks file, the Marks list, the board's card and the pens strip. The next prompt is `say received` and its text is read from the chat's "with" line (`.chat-added`) after "Show text": the stand-in's script never sees what the hook adds. The panel stands over the left of the view, so the points the spec aims at are on the right of the plate; a press under it is not the canvas's, and `N` finds no face.
- `e2e/tracings.spec.ts` is the way through a tracing on the `bracket` fixture, not a repeat of the specs of its pieces (`lineup`, `tracing-marks`, `tracing-measures`, `tracing-3d`, `export`): a tracing on the base's top face (found with `geometry.describe`, made through the bridge), a photo the spec writes with `pngFixtures` and hands over with `__tornoMain.pickPhotos`, a line-up by two corners of the cut (read from `outline`'s `snaps`, clicked with `__tornoLineup.client`, each tracing-side click checked to carry a `snap`), `tool mcp__torno__add_layer {…}` said to the stand-in (the row says `by Claude`), a Should be here drag of that layer's circle (`__tornoTracingSheet` says where a point of the plane is), a prompt whose "Show text" holds `offset` and `on T1`, Show in 3D (`__tornoTest.tracings()` and the caption of `look`), and an SVG written through `pickSave` (millimetres, no path of the machine, no photo unless ticked). The app is given a HOME of its own. A picture of the tracing that is read from a `blob:` address must go through an `<img>`: the window's policy refuses `fetch` of one, and only this spec shows it in a real window.

## Light and dark (`app/e2e`)

- `e2e/themes.spec.ts` starts torno once in each theme, holds the tokens the
  window computes to the same ratios, and writes pictures of the parts and
  one of the window to `app/e2e/.results/themes/`. With `TORNO_SHOTS=<dir>`
  it also captures the window in every state worth looking at
  (`<dir>/ui-<state>-<theme>.png`), one launch each. After a change of a token or of a rule that
  colours something, look at them.

## The page of objects (`app/e2e`)

- Tests: `__tornoMain.opened()` (the objects opened in this run: empty while only the page was looked at),
  `window.__tornoTest.timeThumbnail(count, given?)`. `TORNO_SHOTS=<dir>` has `e2e/show.spec.ts` write
  captures of the page, one launch each.
- A spec opens a panel as a person does, through the rail: `openPanel(page, 'Layers')` of `e2e/helpers.ts` (Projects,
  Layers, Params, Scans, Marks; one that is open stays as it is), `closePanel`, `railButton`. The marks are open at first (and
  Projects where no project is open), so what a spec reads in another panel (a layer row, a scan row, Parameters,
  Checks, the list of projects, the folder menu, "All projects") is read after opening it. A spec opens a project
  through `openListed(page, name)` of `e2e/objects.ts`: the row in the Projects panel, which it opens and then puts the
  panel that was open back; `newFromList` is "New project" alike; `switcher(page)` is the rail's Projects button, which
  carries a session's sign. Never a row by its name alone outside the Projects panel.

## Never run a real agent CLI from tests (root `CLAUDE.md`)

Tests set `TORNO_AGENT_CMD` to the stand-in, `node app/test/fake-agent.mjs`,
which prints its arguments and posts hooks on request. No test runs `claude`:
a real CLI spends the person's subscription, depends on their login and
settings, and asks questions in folders it has not seen. Checking torno against a real CLI is done by hand, once per change that
needs it (the manual's last section lists what is still to be checked). The one thing torno itself asks of the CLI before a session is
`claude --version` and `claude auth status`, for what the first screen says is ready (`main/ready.ts`): once, outside tests
only, each within 3 s. Under `TORNO_TEST=1` the command is only looked for on `PATH`; the stand-in answers both for the
test of that check, which is given its runner.

The one exception is the evals, `app/evals/` (`pnpm -C app eval`): a harness the person runs by hand, that drives the
built app hidden with the real `claude` and spends their subscription. It is no test: no suite and no glob picks it up
(vitest excludes `evals/**`, Playwright ignores it), and it refuses to start unless `TORNO_EVAL=1` is set, when `CI`
is set, and until the person, told the model and the budget, types `spend my subscription` (`evals/guard.mjs`, held by
`src/evals.test.ts`). No agent and no test runs it with the real CLI; an agent may smoke-test it only with the
stand-in (`TORNO_EVAL_AGENT="node app/test/fake-agent.mjs"`), which the guard still asks for.
