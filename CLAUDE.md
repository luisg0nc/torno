# torno

A desktop workbench for making CAD parts with an AI coding agent. `README.md`
says what it does and how to run it; the design is
`docs/superpowers/specs/2026-10-08-torno-design.md`.

- `app/`: the Electron app (pnpm, TypeScript, electron-vite). `src/main` is the
  shell, the kernel client, the sessions, the HTTP server with the MCP tools and
  the hooks, the marks (`src/main/marks`) and the scans (`src/main/scans`). `src/renderer` is the UI, the
  three.js viewport (`viewport/`) and the tools that point at it (`tools/`).
  `src/shared` holds the types both sides use; `shared/bridge.ts` is everything
  the renderer may ask of main. `src/export` is the page an export writes: its
  style and its viewer, which `app/scripts/build-viewer.mjs` bundles into
  `out/viewer/viewer.js` as part of `pnpm build`.
- `kernel/`: the Python package `torno_kernel` (uv). It loads build123d models
  and tessellates them, in forked workers, and imports scans, in a process of
  its own (`python -m torno_kernel.scans`).
- `scripts/torno`: the launcher. It rebuilds the app when what a source (or
  `app/scripts`, the build's configuration, the lock) holds is other than the
  hash in `app/out/.built`, which it writes only after a build that succeeded,
  of the sources as they were when it began; or when `out/viewer/viewer.js` is
  missing. Times are not looked at.
  `--print-command` and `--print-desktop` print and start nothing;
  `--install-desktop` and `--uninstall-desktop` write and remove one file,
  `torno.desktop` under the person's data folder, the only thing the script
  writes outside the repository; `TORNO_OZONE` (`wayland` or `x11`) is the one
  way a platform is passed to Electron (`src/launcher.test.ts`). On macOS (Darwin) the stamp is hashed with
  `sha256sum` or else `shasum -a 256` (the same text, so the same hash; neither on the PATH is an error before any
  build), `TORNO_OZONE` is checked as ever but then ignored with a line on stderr (none under `TORNO_TEST=1`), and
  the three desktop options write nothing and exit 2.
  The icon is `scripts/torno.svg` (a bench vise holding a part; `torno-16.svg` is its drawing for 16 px); the
  window's `app/resources/icon.png` is made from it with `resvg -w 512 -h 512`, and `ui/Logo.tsx` draws both
  in the window. `src/launcher.test.ts` holds the three to one drawing: change the SVG, render the PNG again.

## Tests

Run from the repository root.

```sh
pnpm test                          # app unit tests: app/src/**/*.test.ts (vitest)
pnpm test:kernel                   # app against the real kernel and a stand-in agent: app/src/**/*.itest.ts (vitest)
(cd kernel && uv run pytest -q)    # the kernel alone (pytest)
pnpm test:e2e                      # builds the app, then drives it in a hidden window: app/e2e/*.spec.ts (Playwright)
pnpm -C app typecheck
```

One file: `pnpm -C app exec vitest run src/main/context.test.ts`,
`pnpm -C app exec vitest run --mode kernel src/main/sessions/manager.itest.ts`,
`pnpm -C app exec playwright test e2e/loop.spec.ts` (after `pnpm build`).

While iterating run the focused test; run all four suites before a commit.

`app/src/readme.test.ts` holds `README.md` to the code: its table of keys is
`cheatSheet()` (`TORNO_README=write pnpm -C app exec vitest run
src/readme.test.ts` writes it anew after a key changes), the tools it names as
`mcp__torno__<name>` are exactly `TOOLS`, its headings are in their order, and
what was never seen on a visible screen is one section.

## Global Constraints

- Never write inside a user workspace except under `<object>/.torno/`. Two exceptions. One: making a new object (`main/objects/create.ts`, the "Create" of the onboarding) writes ONE new folder `<workspace>/<name>/` with torno's template model, `brief.md` and `reference/`, made in a hidden `.<name>.torno-new-<random>` beside it and renamed into place as the last step, so it is whole or not there; it never writes into or replaces a folder that exists (compared without regard to case; the one case is an empty folder of the name, which a crash between the claim and the rename leaves and which is renamed onto, failing should anything be put in it meanwhile), never follows a link, and reads the files it copies as plain files only, size-capped. The only other thing it removes is the hidden `.<name>.torno-new-<12 hex>` folders, real folders more than ten minutes old, swept when a workspace is opened. It writes nothing else in the workspace: the scans are imported and the chat started after, under `.torno/`. The other: an export writes one file, to the path the person chose in the save dialog (`main/export/save.ts`), whole or not at all: through `<path>.<random>.tmp` beside it, which is gone when the write ends; no folder is made for it; the path never comes from the window or from an agent, and no agent has a tool for it. Never run `uv sync` there: always `uv run --no-sync`, and only when `<workspace>/.venv` exists: without it uv would create one, so no kernel is started and builds fail saying to run `uv sync`.
- The kernel supervisor only imports. It never loads a model, builds, tessellates or answers a query. Workers never fork.
- Kernel stdout carries protocol frames only. Model output goes to a captured buffer.
- Units are millimetres, Z up. Coordinates crossing a process boundary are in the object frame unless named `local`.
- Renderer: `contextIsolation: true`, `nodeIntegration: false`, `backgroundThrottling: false`. No per-frame state in React.
- HTTP server binds `127.0.0.1` only, on an OS-assigned port. Every address it hands to an agent has the run's
  secret after the prefix (`/mcp/<secret>/<object id>`, `/hooks/<secret>/<session id>/<event>`: 32 random bytes
  as base64url, made in `startHttp` and kept nowhere), compared in constant time; without it the answer is 404.
  An address is made only by `HttpRouter.url`. The secret reaches an agent only in what it is started with
  (argv, settings, env); it is never logged (`HttpRouter.redact` for whatever is logged of an address or of an
  agent's arguments) and never written to `state.md`, `.torno/chat/` or any other file. Should a
  file under `.torno/` ever have to hold an address for a running session, it is one git passes over
  (`ensureIgnored`) and is written anew at each start. The test hook `__tornoMain.mcpUrlFor(id)` gives the
  whole address, secret and all; the stand-in agent reads its hook addresses from its `--settings`.
- Images for the agent: long edge at most 2000 px, default 1280.
- Do not copy nerv's look: no black/red/amber, no condensed uppercase labels, no corner-tick frames. Follow spec section 10 and the tokens in Task 4.
- UI text is sentence case. Every number and ref is set in the monospace face.
- Tests must not open a visible window: `show: false` when `TORNO_TEST=1`.
- Commit after every task with a message describing the change, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

("The tokens in Task 4" are `app/src/renderer/styles/tokens.css`.)

## What crosses processes

What main, the window, the kernel and an agent must all hold to. The detail of each area is in its own file
(below).

- A mark is a pin, a pick, an arrow, a stroke, a shape, a dimension or a region
  of a scan, with a note (`app/src/shared/marks.ts`). Ids are `M1`, `M2`, … per object, never reused,
  given by main only.
- Main is the only writer of `<object>/.torno/marks.json`
  (`src/main/marks/store.ts`): one change at a time per object, written
  atomically before it is told. The renderer and the MCP tools go through it.
- Coordinates and refs of a mark are in the object frame of the mark's layout.
  A ref is `<part>`, `<part>/F<i>`, `<part>/E<i>` or `M<n>`; to the kernel it
  is sent with the layout in front (`assembly:lid/F12`).
- What only main says of a mark (`MAIN_ONLY_KEYS` in `shared/marks.ts`:
  `resolvedBy`, `acknowledged`, `sentBefore`, `reopened`, `checkedRevision`) is never
  taken from the window or from a tool's arguments. A mark the agent resolved
  is under "To review" until the person acknowledges it, one at a time or all at once (`marks.acknowledge`,
  one write).
- A group of parts is the model's (`groups(p)`, read by the worker that loads the model, `Scene.groups`): one
  level, a part in one group at most, across layouts by part name. A group name is not a ref (no `/`, not `M<n>`,
  not a part's name: the loader refuses those). Wherever a tool takes part names a group's name stands for its parts
  in the layout (`shared/groups.ts` `partsNamed`, in main before a request and in the window alike). torno never
  writes the model: the only thing it keeps of groups is which are folded (`folded` in `scene.json`).
- Lengths are millimetres, angles degrees, areas mm², volumes mm³, masses
  grams. Numbers shown go through `shared/format.ts` (four significant
  digits at most); numbers stored and returned as data are in full.
- Every number told to the agent is the kernel's, from the B-rep, and says whether it is exact, with two
  exceptions. One is the box of a part that is not exact: it is widened to hold the mesh the part is drawn with, and
  it is the mesh's alone when the kernel's took a build more than a second (`tess.BOX_SECONDS`), `bboxExact:
  false` either way. The mesh
  drives only the estimate read out at the pointer while a measurement is
  pending (`≈`), which the kernel's value replaces. What is taken from a scan
  is the other, and is never said to be exact (see Scans).

- Claude Code is the one agent torno runs. It is shown as a chat by default (`view` in `.torno/agent.json`). The
  chat is the CLI's own headless mode (`-p --input-format stream-json --output-format stream-json`) on pipes,
  under the person's own login, never run by a test. Hooks stay the one source of status and of the marks sent;
  the stream adds only that a request waiting for the person is `needs_input`. `.torno/chat/` holds text only:
  no address, no secret, no picture data; a reference picture is recorded by its path in `reference/` and shown from
  that file again. A permission answer never writes the person's settings: "Allow for
  this session" sends only `addRules` suggestions, rewritten to `destination: "session"`.
- A drawing on the view ("Draw on view" in the chat) goes with one prompt as a picture: the agent's own picture of
  the view with the person's ink on it, after a caption main writes from data the window sends and main checks
  (`shared/drawing.ts`, `main/sessions/drawing.ts`). It names what the ink lies over by ref, with the kernel's line,
  and never a coordinate (the hit points are of the mesh). It is kept nowhere: not under `.torno/`, not in the log.

## Where the detail is

Each area has a `CLAUDE.md` of its own, with the rules of that folder under the headings they have always had
(Marks, Section, Explode, Views, The first screen, Light and dark, The page of objects, Scans, Exactness,
Export, Kernel invariants, Agents). Read the one of the folder before working in it; a feature that crosses
folders has a part in each.

- `app/src/main/CLAUDE.md`: checking the marks against a build, dimensions, the MCP tools, `state.md`, what the
  agent is told and shown, the saved views as main keeps them, `.torno` and its `.gitignore`, the scans and
  their regions, the cards of the page of objects, saving an export, the agents and their sessions.
- `app/src/renderer/CLAUDE.md`: the tools and the keys, the mark colours, drawing a section and an explode,
  the strip of views, the first screen, light and dark, the page of objects, scans in the window.
- `app/src/shared/CLAUDE.md`: the view state both sides hold (section, explode, saved views), what a thumbnail
  is, the transform of a scan, and the numbers told as 0.
- `kernel/CLAUDE.md`: the kernel invariants (supervisor, workers, timeouts, frames), where areas, volumes and
  boxes are measured and what that costs, the import of a scan and the scan queries.
- `app/src/export/CLAUDE.md`: the exported page: what is in a file, its budget, its policy, its viewer.
- `app/e2e/CLAUDE.md`: testing the app in a hidden window. Read it before any launch of Electron: every
  launch sets `TORNO_TEST=1`, never `--ozone-platform=headless`, never `page.screenshot()`, never the clipboard.

## Never run a real agent CLI from tests

Tests set `TORNO_AGENT_CMD` to the stand-in, `node app/test/fake-agent.mjs`,
which prints its arguments and posts hooks on request. No test runs `claude`:
a real CLI spends the person's subscription, depends on their login and
settings, and asks questions in folders it has not seen. Checking torno against a real CLI is done by hand, once per change that
needs it (the README lists what is still to be checked).
