# torno

A desktop workbench for making CAD parts with an AI coding agent. `README.md`
introduces it and says how to run it; `docs/manual.md` says everything it does; the design is
`docs/superpowers/specs/2026-10-08-torno-design.md`.

- `app/`: the Electron app (pnpm, TypeScript, electron-vite). `src/main` is the
  shell, the kernel client, the sessions, the HTTP server with the MCP tools and
  the hooks, the marks (`src/main/marks`) and the scans (`src/main/scans`). `src/renderer` is the UI, the
  three.js viewport (`viewport/`) and the tools that point at it (`tools/`).
  `src/shared` holds the types both sides use; `shared/bridge.ts` is everything
  the renderer may ask of main. `src/export` is the page an export writes: its
  style and its viewer, which `app/scripts/build-viewer.mjs` bundles into
  `out/viewer/viewer.js` as part of `pnpm build`.
- A **project** is what the code and these files call an *object*: a folder of the workspace with one model in it
  (`ObjectInfo`, `objectId`). Everything a person or the agent reads says "project" (the window, the manual, the
  README, the prompts, the tool descriptions, the skills); identifiers, IPC channels, environment variables, file
  names and the keys of files on disk keep `object`. A 3MF's "object", a JSON object and build123d's objects are not it.
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
  way a platform is passed to Electron (`src/launcher.test.ts`). The stamp is hashed with `sha256sum`, or else
  `shasum -a 256`, which a Mac has (the same text, so the same hash; neither on the PATH is an error before any
  build). On macOS (Darwin) `TORNO_OZONE` is checked as ever but then ignored with a line on stderr (none under
  `TORNO_TEST=1`), and the three desktop options write nothing and exit 2.
  The icon is `scripts/torno.svg` (a bench vise holding a part; `torno-16.svg` is its drawing for 16 px); the
  window's `app/resources/icon.png` is made from it with `resvg -w 512 -h 512`, and `ui/Logo.tsx` draws both
  in the window. `src/launcher.test.ts` holds the three to one drawing: change the SVG, render the PNG again.

- The packaged app (`app/electron-builder.yml`; `pnpm dist:mac` makes `torno.app`, `pnpm dist:linux` an AppImage and a tar.gz,
  `pnpm pack:check` the same files as a Linux folder, for checking): the asar holds `out/**` and the dependencies of main
  and preload (renderer-only ones are `devDependencies`, bundled by Vite), node-pty unpacked; `Resources/` holds
  `kernel` (`pyproject.toml`, `uv.lock`, `src/`), `agent-plugin`, `icon.png` and `example` (the project it opens). It
  never writes inside its bundle: the kernel and the import process run with `--frozen` and
  `UV_PROJECT_ENVIRONMENT=<userData>/kernel-env` (`kernelRun` in `main/paths.ts`, `kernelEnv` in
  `main/kernel/client.ts`; not for a workspace with a `pyproject.toml`, whose `.venv` is its own). Signed ad hoc, not
  notarized. `app/e2e/packaged.spec.ts` runs against it when `TORNO_PACKAGED` names the executable.

- The site, torno.luisg.me (`.github/workflows/pages.yml` deploys `site/`): the landing page at `/`
  (`site/index.html`, `site/assets/`; its fonts and pictures copied in by `app/scripts/build-site.mjs`, never kept in
  `site/`; nothing loaded from another host, `src/site.test.ts`) and the manual at
  `/manual/` (`app/scripts/build-manual.mjs`).

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

`app/src/readme.test.ts` holds `docs/manual.md` to the code: its table of keys is
`cheatSheet()` (`TORNO_README=write pnpm -C app exec vitest run
src/readme.test.ts` writes it anew after a key changes), the tools it names as
`mcp__torno__<name>` are exactly `TOOLS`, its headings are in their order, and
what was never seen on a visible screen is one section. `README.md` is the short introduction for a
newcomer, held only to keep `Requirements` and `Run` (the window and the launcher send readers there) and to link
to headings the manual has; the reference goes in the manual.

## Global Constraints

- Never write inside a user workspace except under `<object>/.torno/`. Four exceptions. One: making a new object (`main/objects/create.ts`, the "Create" of the onboarding) writes ONE new folder `<workspace>/<name>/` with torno's template model, `brief.md` and `reference/`, made in a hidden `.<name>.torno-new-<random>` beside it and renamed into place as the last step, so it is whole or not there; it never writes into or replaces a folder that exists (compared without regard to case; the one case is an empty folder of the name, which a crash between the claim and the rename leaves and which is renamed onto, failing should anything be put in it meanwhile), never follows a link, and reads the files it copies as plain files only, size-capped. The only other thing it removes is the hidden `.<name>.torno-new-<12 hex>` folders, real folders more than ten minutes old, swept when a workspace is opened. It writes nothing else in the workspace: the scans are imported and the chat started after, under `.torno/`. Two: an export (an HTML page, a file of the model, a picture of the view, a drawing of its section as SVG or PDF) writes one file, to the path the person chose in the save dialog (`main/export/save.ts`), whole or not at all: through `<path>.<random>.tmp` beside it, which is gone when the write ends (a STEP, STL or 3MF is read back from it by the kernel's worker and checked first, and one that fails is never named); no folder is made for it; the path never comes from the window or from an agent, and no agent has a tool for it. Three: "Keep this as a folder" on the example (`keepExample` in `main/example.ts`, `workspace:keepExample`) writes ONE new folder at the path the person chose in the save dialog, which is not in a workspace but beside any folder they name: all of it is written in a hidden `.<name>.torno-new-<random>` beside it and renamed into place as the last step, so it is whole or not there; it never writes into or replaces a folder or file of that name (compared without regard to case), never follows a link (a link or anything not a plain file or folder is left out; each file is read through a handle opened without following one), is size-capped, and keeps only a copy that torno made and whose marker names it (the path of the copy is main's, never the window's). The path never comes from the window or from an agent, and no agent has a tool for it. Four: Go back (`main/goback.ts`) writes and removes `.py` files of its own project's folder, from the copies in `.torno/history/`, after the person confirms; never `common/` or another project. It writes each file whole or not at all, only files main works out itself (what the window sends is only what the person confirmed, compared with what main would do), never through a link, never a hidden path; it removes only a `.py` of that folder that no build up to the one restored held and a later build did, and it puts back the person's tried Params (`.torno/params.json`, through `paramsfile.ts`). No agent has a tool for it. The kernel never writes a file: it gives the bytes. Never run `uv sync` there: always `uv run --no-sync`, and only when `<workspace>/.venv` exists: without it uv would create one, so no kernel is started and builds fail saying to run `uv sync`. torno's own kernel project is not a workspace: "Make it now" on the first screen runs `uv sync` there (`main/readiness.ts`), and nowhere else.
- The kernel supervisor only imports. It never loads a model, builds, tessellates or answers a query. Workers never fork.
- Kernel stdout carries protocol frames only. Model output goes to a captured buffer.
- Units are millimetres, Z up. Coordinates crossing a process boundary are in the object frame unless named `local`.
- Renderer: `contextIsolation: true`, `nodeIntegration: false`, `backgroundThrottling: false`. No per-frame state in React.
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
- Images for the agent: long edge at most 2000 px, default 1280. A picture of the view the person saves for themselves (the "A picture" reader of the export sheet, `export:savePicture`) is not for the agent and is not held to that: its long edge is at most 4000 px (`MAX_PICTURE_EDGE`), asked only by the window itself (`ImageRequest.person`, never a field of an agent's `look`), and kept nowhere but at the path the person chose.
- No control-room look: no black/red/amber, no condensed uppercase labels, no corner-tick frames. Follow spec section 10 and the tokens in Task 4.
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
  A ref is `<part>`, `<part>/F<i>`, `<part>/E<i>`, `<part>/@<tag>` or `M<n>`; to the kernel it
  is sent with the layout in front (`assembly:lid/F12`). A tag is a name the model gives a face or an edge
  (`tags(p, parts)`, read by the loader beside `groups(p)`; `shared/tags.ts`); `@` keeps it apart from the other
  forms, a tag name has no `/` and does not start with `@`, and a tag may name several faces and edges. A mark never
  stores a tag as its `ref`: its anchor keeps the face's or edge's own ref and the tag beside it (`Anchor.tag`),
  which only main sets (`withTag`, on placing and on every check) and which a check follows before the
  nearest-point rule.
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
- The model's `Params` can be tried without editing the model: the person's overrides are `<object>/.torno/params.json`
  (main the only writer; the file always wins: an override is dropped when the file's default of its field changes),
  every build of the object carries them, and the agent is told so with every prompt; the agent's `try_params` builds
  a throwaway copy in a trial worker and keeps nothing. torno never writes the model for this: a value is baked in by the
  agent editing it (`app/src/main/CLAUDE.md`, Params the person tries; `kernel/CLAUDE.md`).
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

- The instruction files Claude Code reads on its own for an object (`CLAUDE.md` and the rest, in the object's folder, above
  it, and the person's own) are listed by path and size and never read (`app/src/main/instructions.ts`): the session pane
  shows them, and the first prompt of a session names them and says that what torno's tools say of the build is
  current. torno reads none of Claude Code's settings and changes nothing of its configuration.
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
- A drawing on the view ("Draw on view" in the chat) goes with one prompt as a picture: the agent's own picture of
  the view with the person's ink on it, after a caption main writes from data the window sends and main checks
  (`shared/drawing.ts`, `main/sessions/drawing.ts`). It names what the ink lies over by ref, with the kernel's line,
  and never a coordinate (the hit points are of the mesh). The picture is kept nowhere: not under `.torno/`, not in the log. What the ink lies over (the refs and the counts, `DrawnOver`,
  never a coordinate or a pixel) is text on the prompt's item, shown to the person before the drawing goes and under
  it after, and the transcript and the chat's log may hold it (the caption's text, refs and descriptors, the camera, is of that kind: text, never the picture).

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
