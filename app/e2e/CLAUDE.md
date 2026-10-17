# torno: the app in a hidden window (`app/e2e`)

The Playwright specs, which start the built app. The rules here bind every launch of Electron, by a test, a
script or a check, whoever makes it.

What binds every part of torno is in the `CLAUDE.md` at the root of the repository: read that first.

## Testing the app in a hidden window

The person is working on this desktop. No test, script or check may put a
window on it.

- Every Electron launch sets `TORNO_TEST=1`. Main then creates the window with
  `show: false` and never shows it, and exposes the test hooks.
- Under `TORNO_TEST=1` Electron's own profile (`userData`, `sessionData`, `crashDumps`: its caches, storage and
  crash dumps) is a folder of the run, `<tmp>/torno-test-<pid>-…` (`src/main/testProfile.ts`), set
  before `ready` and removed once the process has gone; one a killed run left is cleared away by the next. Nothing
  of a test is written under `~/.config/torno` (`e2e/quit.spec.ts` holds it to that). A check that launches
  Electron without that variable must give it a `--user-data-dir` of its own.
- Never pass `--ozone-platform=headless`: Electron segfaults with it here.
  `scripts/torno` never passes a platform when `TORNO_TEST=1`, and refuses
  `headless` whoever asks (`TORNO_OZONE` is `wayland` or `x11`, or unset; on
  macOS it is never passed at all).
- No test and no check runs `scripts/torno --install-desktop` or
  `--uninstall-desktop` with the person's own `HOME` or `XDG_DATA_HOME`:
  `src/launcher.test.ts` gives the script a temporary one of each. The entry
  is tested by `--print-desktop`, which writes nothing.
- `page.screenshot()` never returns on a hidden window. Do not call it.
  `webContents.capturePage()` delivers one image per launch and hangs on the
  second call.
- Pictures of the parts come only from `window.__tornoTest.look(request)`, the
  same code the `look` tool uses; it renders to a target and does not wait for
  a frame.
- A CSS animation that never ends grew the hidden window's memory by about
  3 MB a second for as long as it ran (146 MB to 2.5 GB in half an hour of
  the sweep). There is none any more, and `styles/styles.test.ts` fails for
  one. Nothing that is ready waits on `requestIdleCallback` or a frame
  either (`state/thumbs.ts`): a window nobody looks at is given frames late.
- State is read through hooks, not pixels: `window.__tornoTest.state()` and
  `.camera()`, `.pickAt(fx, fy)` for what a point of the canvas is on and
  `.project(point)` for where a point of the object is drawn (both in fractions
  of the canvas, to aim `page.mouse` with), `.markScreen(id)` for where a
  mark's label is, `.timePicks(count)` for what a pick costs and
  `.timeFrames(count)` a frame, `.scans()` for the scans as the viewport has
  them (`loaded`, `ready`, where each stands), `.pickScanAt(fx, fy)`,
  `.projectScan(id, local)` and `.timeScanPicks(count)` as the same for
  scans, `.regions()` for what is tinted,
  `window.__tornoTerm.text()` for what the terminal shows (`.ground()` for the colour of its inset), and
  `globalThis.__tornoMain` in main (`app.evaluate`) for the MCP address, the
  mark store (to leave the marks an agent would), the scan store (`scans`),
  `marksChecks(objectId)`
  (started and finished counts: equal when no check of the marks is under way)
  and `letGo(objectId)`, which has an object's status say that the kernel let
  its build go to make room: no test's kernel is short of memory.
- `page.mouse` and `page.keyboard` work on the hidden window: marks are placed
  in tests with real pointer events through the tools.
- A test works on a temporary copy of `kernel/tests/fixtures/ws`, never on
  the fixtures themselves and never on a real workspace.
- Do not touch the clipboard.
- Never click "Open folder" unless main runs with `TORNO_TEST=1`: only then is
  the folder dialog replaced by `globalThis.__tornoMain.pickFolder` (the folder
  to answer with, or null), and `picks` counts the times it was asked. The
  same holds for "Import scan…": `pickFile` and `filePicks`, and for "Add photos…" of a new object: `pickPhotos` (a list of paths) and `photoPicks`. Main's `objects:readPhoto` serves only paths its dialog (or this hook) gave, so a test sets `pickPhotos`, clicks the button, and the paths are offered; a test that asks for another path gets the refusal.
- `TORNO_TEST=1` also skips the single-instance lock, so test launches can run
  side by side.

## The chat and the stand-in agent

A chat session is tested with `app/test/fake-agent.mjs` in its stream mode, which it enters when started with
`--input-format stream-json`: it speaks Claude Code's protocol on its pipes and prints nothing else. Its header
lists everything it does; in short, a prompt's text is a script of one command per line: `say`, `tool <name>
<json>` (a name beginning `mcp__torno__` calls torno's MCP server for real), `ask <name> <json>` (a permission
request, answered by the window), `slow <s>`, `work <s>` (a tool that takes that long), `rate <percent>`, `images` and
`garbage`; `/noop` and `/compact` are what the CLI does for them. As the real CLI does (seen 2026-10-15), a prompt that
comes while a tool runs is folded into the running turn (its hook, no `init`, one result), and an interrupt while a
request waits sends `control_cancel_request` first. An interrupt keeps the prompts queued behind the turn (it lists their
uuids in `still_queued`) and runs them afterwards together, one `init`; every prompt torno writes has a `uuid`, and the
stand-in says `command_lifecycle` `queued`/`started`/`completed` for it, as the real CLI does. A queued prompt is
therefore never "Not sent" after a Stop. `FAKE_AGENT_FAIL=<text>` makes it write that to stderr and exit 1
at once; `FAKE_AGENT_INIT_ERROR=<text>` makes it answer `initialize` with that error. Its permission suggestions are the three kinds the real CLI sends, so a test
proves that only the session rule is passed on. Specs that drive a terminal call `inTerminal` (`e2e/terminal.ts`),
which writes `view: 'terminal'` into their temporary copy's `.torno/agent.json`. Give the run a HOME of its own
when a spec checks that nothing is written to the person's settings.

Two fixtures were recorded from the real CLI and scrubbed: `app/test/fixtures/claude-stream.jsonl` (Claude Code
2.1.300: a turn, tool use, hooks) and `claude-stream-asks.jsonl` (2.1.301: a permission, a question and
`/compact`). Every line of both parses as JSON. Never run the real `claude` to record or check; that is done by hand (README, last section).

## Making a new object

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
  same fraction of the board is drawn on; the caption is read from what the stand-in says back, line by line).

## Light and dark

- `e2e/themes.spec.ts` starts torno once in each theme, holds the tokens the
  window computes to the same ratios, and writes pictures of the parts and
  one of the window to `app/e2e/.results/themes/`. With `TORNO_SHOTS=<dir>`
  it also captures the window in every state worth looking at
  (`<dir>/ui-<state>-<theme>.png`), one launch each. After a change of a token or of a rule that
  colours something, look at them.

## The page of objects

- Tests: `__tornoMain.opened()` (the objects opened in this run: empty while only the page was looked at),
  `window.__tornoTest.timeThumbnail(count, given?)`. `TORNO_SHOTS=<dir>` has `e2e/show.spec.ts` write
  captures of the page, one launch each.
