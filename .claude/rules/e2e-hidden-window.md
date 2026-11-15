---
paths:
  - "app/e2e/**"
  - "app/playwright.config.ts"
  - "app/src/main/testProfile.ts"
  - "app/src/main/testProfile.test.ts"
  - "app/evals/**"
  - "scripts/torno"
  - "app/src/launcher.test.ts"
---

# Testing the app in a hidden window: every launch of Electron

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## About this folder (`app/e2e`)

The Playwright specs, which start the built app. The rules here bind every launch of Electron, by a test, a
script or a check, whoever makes it.

## Testing the app in a hidden window (`app/e2e`)

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
  mark's label is, `.chipAt(fx, fy)` for the mark whose chip is drawn at a point (a press there is the chip's,
  whatever tool is in hand), `.hoveredMark()` for the one whose chip is ringed as pointed at and
  `.highlighted()` for the refs each layer of highlights is drawn for (`point` in the accent, `agent` in its colour), `.timePicks(count)` for what a pick costs and
  `.timeFrames(count)` a frame, `.scans()` for the scans as the viewport has
  them (`loaded`, `ready`, where each stands), `.pickScanAt(fx, fy)`,
  `.projectScan(id, local)` and `.timeScanPicks(count)` as the same for
  scans, `.regions()` for what is tinted,
  `window.__tornoTerm.text()` for what the terminal shows (`.ground()` for the colour of its inset), and
  `globalThis.__tornoMain` in main (`app.evaluate`) for an object's MCP address and a token that opens it
  (`mcpFor(id)`: send the token in the `X-Torno-Session` header, or every request is 404), the
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
- The save dialog of an export is answered by `__tornoMain.pickSave` (the path to write, or null; `savePicks`,
  `saveOffered`), the question before a replace by `replace` (`replaceAsked`), and a 3MF asked to be opened once
  saved is never opened: its path goes into `openedFiles`. No test opens a slicer or a CAD program. A row of the session
  pane's instruction files is never shown in a file manager: its path goes into `revealedFiles`
  (`e2e/instructions.spec.ts`, which gives the app a HOME of its own so that the person's `~/.claude/CLAUDE.md` is never
  listed, and asserts only the files it made: a machine may have an organisation's `/etc/claude-code/CLAUDE.md`).
- What torno needs (the first screen's "Ready to work") is found under `TORNO_TEST=1` by looking on the `PATH` alone: `claude`
  is never run, so there is no version and no account to see (`welcome.spec.ts`). A test that points `TORNO_AGENT_CMD` at a
  file that is not there sees "Not found on PATH"; one that takes `uv` off the `PATH` gives the app a folder of links to every
  other command (`pathWithout`), never a `PATH` of `node` alone: Electron does not start on that.
- `TORNO_TEST=1` also skips the single-instance lock, so test launches can run
  side by side.
