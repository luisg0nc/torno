# torno

A desktop workbench for making CAD parts with an AI coding agent. `README.md`
introduces it and says how to run it; `docs/manual.md` says everything it does; the design is
`docs/superpowers/specs/2026-10-08-torno-design.md`.

- `app/`: the Electron app (pnpm, TypeScript, electron-vite). `src/main` is the
  shell, the kernel client, the sessions, the HTTP server with the MCP tools and
  the hooks, the marks (`src/main/marks`), the scans (`src/main/scans`), the page of objects (`show/`) and what
  makes an export (`export/`). `src/renderer` is the UI (`ui/`), the three.js viewport (`viewport/`), the tools
  that point at it (`tools/`), the store (`state/`) and the stylesheets (`styles/`).
  `src/shared` holds the types and the pure rules both sides use, so that each is one rule and neither side has a
  copy of its own; `shared/bridge.ts` is everything the renderer may ask of main. `src/export` is the page an
  export writes: its style and its viewer, which `app/scripts/build-viewer.mjs` bundles into
  `out/viewer/viewer.js` as part of `pnpm build`.
- A **project** is what the code and these files call an *object*: a folder of the workspace with one model in it
  (`ObjectInfo`, `objectId`). Everything a person or the agent reads says "project" (the window, the manual, the
  README, the prompts, the tool descriptions, the skills); identifiers, IPC channels, environment variables, file
  names and the keys of files on disk keep `object`. A 3MF's "object", a JSON object and build123d's objects are not it.
- `kernel/`: the Python package `torno_kernel` (uv). It loads build123d models
  and tessellates them, in forked workers, answers what is asked of the last build, and imports scans, in a process
  of its own (`python -m torno_kernel.scans`).
- `scripts/torno` is the launcher, `app/electron-builder.yml` the packaged app, `site/` the site (torno.luisg.me).

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

While iterating run the focused test; run all four suites before a commit. `app/src/readme.test.ts` holds
`docs/manual.md` to the code. `bash .claude/hooks/guard-bash.test.sh` holds the Bash guard (below).

## Global invariants

- Never write inside a user workspace except under `<object>/.torno/`; a shelf part's folder `common/parts/<id>/` counts as a project for torno's own files (its `.torno/`, the checked dates).
  Five exceptions: making a new object (its folder, with its photos, doodles, STEP files and PDFs copied into `reference/`
  and its board, `.torno/board/board.json`), an export the person saves, "Keep this as a folder" on the example (each one new folder or file, whole or not there), and Go
  back, which writes and removes `.py` files of its own project's folder after the person confirms (`goback`), and, when the person sends an "add a part" request, the files they dropped,
  copied into `common/parts/<id>/` (plain files, size-capped, whole or not there, never over a file or through a link).
  The kernel never writes a file. Never run `uv sync` there: always `uv run --no-sync`, and only when
  `<workspace>/.venv` exists (`workspace-writes`).
- The kernel supervisor only imports. It never loads a model, builds, tessellates or answers a query. Workers never fork.
- Kernel stdout carries protocol frames only. Model output goes to a captured buffer.
- Units are millimetres, Z up. Coordinates crossing a process boundary are in the object frame unless named `local`.
- Renderer: `contextIsolation: true`, `nodeIntegration: false`, `backgroundThrottling: false`. No per-frame state in React.
- The HTTP server binds `127.0.0.1` only. Every request carries the session's token in `X-Torno-Session`; the token
  is never in an argument, a file or a log. The second door is one Unix socket, never a TCP port (`agent-launch-and-tokens`).
- Images for the agent: long edge at most 2000 px, default 1280 (`export-saving` for the person's own picture).
- Main is the only writer of `.torno/marks.json`, `scans.json`, `sets.json`, `tracings.json` and `params.json`; ids `M<n>`, `S<n>`, `N<n>`, `T<n>` and a sketch's stroke ids `k<n>` are main's,
  never reused (`marks-store`, `scans-store`, `sets`, `tracings`, `params`). torno never writes the model but through Go back (`goback`).
- Lengths are millimetres, angles degrees, areas mm², volumes mm³, masses
  grams. Numbers shown go through `shared/format.ts` (four significant
  digits at most); numbers stored and returned as data are in full.
- Every number told to the agent is the kernel's, from the B-rep, and says whether it is exact. Nothing from a scan
  is ever said to be exact (`exactness-app`, `kernel-measures`, `scans-regions`).
- Claude Code is the one agent torno runs; hooks are the one source of status (`sessions`). torno reads none of
  Claude Code's settings and changes nothing of its configuration; the instruction files are listed, never read
  (`instruction-files`).
- No control-room look: no black/red/amber, no condensed uppercase labels, no corner-tick frames. Follow spec section 10
  and `app/src/renderer/styles/tokens.css`. The dyed blue field (`--dye`) is only for screens with no model on them.
- UI text is sentence case, in Instrument Sans. Every number, ref, file name and key is in Martian Mono (`num`: 0.86 em
  with 0.12 em of margin in a line of text). Both faces are bundled; nothing is fetched.
- Radii come from the four tokens (`--radius-inline`, `-control`, `-float`, `-sheet`) or are round. The one shadow is
  `--float-shadow`. One accent; a leader is always the accent, and only the tool in hand and one pointed-at ref draw
  leaders.
- Tests must not open a visible window: `show: false` when `TORNO_TEST=1`. Every launch of Electron sets
  `TORNO_TEST=1`, never `--ozone-platform=headless`, never `page.screenshot()`, never the clipboard (`e2e-hidden-window`).

## Never run a real agent CLI from tests

Tests set `TORNO_AGENT_CMD` to the stand-in, `node app/test/fake-agent.mjs`. No test runs `claude`: it spends the
person's subscription and depends on their login and settings. A check against the real CLI is done by hand. The
evals (`pnpm -C app eval`) are no test; an agent runs them only with `TORNO_EVAL_AGENT="node app/test/fake-agent.mjs"`
(`e2e-stand-in-agent`). `.claude/settings.json` runs `.claude/hooks/guard-bash.sh` before every Bash command. It refuses `uv sync`, the real
`claude` (`claude --version` aside), the evals without the stand-in, and `killall`, `pkill` of a bare program name
or of a whole user, and `kill -1`.

## Commits

Commit after every task with a message describing the change, ending with the Co-Authored-By trailer the harness
gives. A change to what torno does changes the manual and the rule that says it in the same commit.

Branches: work merges into `dev` (pull requests use `--base dev`); `main` is the last release, and the site and
the manual deploy from it. A release is one pull request from `dev` to `main` with the version bump, then the `v*` tag.

## Rules by area

The detail is in `.claude/rules/*.md`, moved as written from the folder `CLAUDE.md` files that held it. Claude Code
loads a rule when a file its `paths:` names is read or edited; read one by hand before work its globs miss. Each
heading names the folder its text came from. Paths are as written there: from `app/` (`src/main/...`), short under
`app/src/` (`main/`, `shared/`, `export/`) and under `app/src/renderer/` (`ui/`, `viewport/`, `tools/`, `state/`,
`styles/`); in the kernel's text, from `kernel/` (`tests/`, `scripts/`) and `kernel/src/torno_kernel/`.

- Kernel: `kernel-supervisor` (every kernel file), `kernel-trial-export`, `kernel-diagnose`, `kernel-model-contract`
  (Params, groups, tags, checks, references, `uses`), `kernel-measures`, `kernel-features`, `kernel-scans`.
- Tests: `e2e-hidden-window` (every Electron launch), `e2e-stand-in-agent` (the stand-in, the specs, the evals).
- Marks and the model: `marks-store`, `dimensions`, `marks-window`, `keys`, `params`, `checks-and-profile`,
  `left-column` (layers, groups, references), `sets` (named sets), `tracings` (the store, the photo and its line-up, the outline, the view), `builds-history`, `board`, `goback`, `exactness-app`.
- The view: `section`, `explode`, `saved-views`, `viewport-overlay`, `leaders`, `styles-themes`.
- The agent: `mcp-tools`, `mcp-read-tools`, `build-digest`, `stop-hook`, `agent-prompt`, `instruction-files`, `asks`,
  `agent-launch-and-tokens`, `sessions`, `chat-transcript`, `chat-log-and-undo`, `session-pane`, `chat-pane`,
  `chat-cards-and-refs`, `drawing-on-view`.
- Scans: `scans-store`, `scans-regions`, `scans-window`. Screens: `first-screen`, `readiness`, `page-of-objects`,
  `new-object-create`, `new-object-onboard`, `new-object-page`.
- Files and shipping: `workspace-writes`, `export-page`, `export-saving`, `launcher-and-packaging`.
