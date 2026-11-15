---
paths:
  - "app/src/main/ready.ts"
  - "app/src/main/ready.test.ts"
  - "app/src/main/readiness.ts"
  - "app/src/main/readiness.test.ts"
  - "app/src/shared/ready.ts"
  - "app/src/renderer/ui/Readiness.tsx"
  - "app/src/renderer/ui/readyLines.ts"
  - "app/src/renderer/ui/readyLines.test.ts"
  - "app/src/renderer/ui/EmptyWorkspace.tsx"
  - "app/src/renderer/ui/EmptyWorkspace.test.ts"
  - "app/src/renderer/styles/ready.css"
  - "app/e2e/welcome.spec.ts"
---

# What torno needs: the readiness check and "Make it now"

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## The first screen (`app/src/main`)

- **What torno needs** (`main/ready.ts`, `main/readiness.ts` `ReadyKeeper`, `shared/ready.ts` `Ready`; the channels `ready:check`,
  `ready:make`, `ready:changed`) is found before anything fails, for the first screen, the empty workspace, the page of a
  new object and the sheet of the folder menu. `checkTools` looks for the agent's command (`AgentAdapter.probe`: with
  `TORNO_AGENT_CMD`, the stand-in's) and for `uv` on `process.env.PATH` (the login shell's, on a Mac or Linux, after
  `applyLoginPath`) with the `findCommand` a session uses, and runs nothing for it. Outside tests (`askCli`, false under
  `TORNO_TEST=1`) it also asks the CLI `--version` and `auth status`, once per run and again only for "Check again" (`get(true)`), each
  within `ASK_MS` (3 s, then the process is killed: a runner that never answers is given up on as well), nothing
  written, standard input closed; and `uv --version`. The runner is an argument (`Runner`) so a test runs the
  stand-in, which answers both (`FAKE_AGENT_VERSION`, `FAKE_AGENT_AUTH`). The version rule is Task 5's (`outside`,
  `TESTED_CLAUDE`: quiet inside the tested minor); the account is read from the JSON's `loggedIn` and `authMethod` only
  (`signed-out` on `loggedIn: false` or `none`; any other shape is not known, and the email is never kept); a CLI that
  does not answer is `silent`. Whether the Python environment is made is whether `pyvenv.cfg` and a `site-packages/build123d`
  are there (`ownEnvironmentMade`: a folder uv began and did not finish is not made): torno's (`ownEnvironment()` in
  `paths.ts`: `kernel-env` under `userData` packaged, `kernel/.venv` otherwise), or, for a workspace with a
  `pyproject.toml`, its `.venv`, which is only reported (`environmentOf`). The kernel of the open workspace is
  `none`/`starting`/`ready` (versions)/`failed` (its reason, 600 characters at most), set by `ReadyKeeper.opened` and
  `closed` from `openWorkspace` and `closeWorkspace`, and by what the kernel tells of every start (`KernelClient.onState`:
  `starting` when it is started again, after one exit or by the build that follows a stop for good, `ready` when it answers,
  `failed` when it stops for good), so a kernel that failed and was mended by a rebuild is not said to have failed any
  longer; a kernel of a workspace that was left no longer speaks (`epoch`). The CLI and uv are asked with `agentEnv(process.env)`
  (`sessions/agentEnv.ts`), the environment a session gets: without a parent Claude Code session's variables, nor an
  outer torno's session.
  `ReadyKeeper.makeNow` ("Make it now") runs `environmentCommand` (`uv sync --project <kernel dir>`, `--frozen` and
  `UV_PROJECT_ENVIRONMENT` when packaged) on torno's own kernel project, never on a workspace: it refuses a folder
  with its own project, no `uv`, and a kernel that is starting (it makes the environment itself); it tells uv's lines as
  `changed`. The window is told the whole `Ready` at each change; the window sends nothing that is run or written.

## The first screen (`app/src/renderer`)

- **What torno needs** is one block, "Ready to work" (`ui/Readiness.tsx`; its words are `ui/readyLines.ts`, pure and held by
  `readyLines.test.ts`; its state is `store.ready`, asked of main once and told on each change, `useReadyFeed`). A line each
  for Claude Code, uv (only when missing), a folder's own environment (only with a `pyproject.toml`) and the kernel; a dot
  in `--ok`, `--warn` or `--fail` (a wait is `--muted`), the label in the muted face, versions, paths and commands in
  the monospace face, and a note in the muted face under it. When every line is ready it folds to one quiet line ("Claude
  Code and build123d 0.13.0 are ready") that a click opens; a kernel that is only starting, its environment there, does
  not keep it open. Nothing is claimed until main has said. It is under the tagline of the first screen, in the empty
  workspace below "New project" and the example, on the page of a new object above Create in the `missing` form (only the lines that
  say something is amiss, none when none does, and for Claude Code a failure adds that the object will be made but the agent
  cannot start in it), and in the sheet of the folder menu ("Check what torno needs", a dialog over the window asked afresh,
  with "Check again"). "Make it now" is on the kernel's line when torno's own environment is not made, no workspace's kernel is
  starting and uv is there, and "Try again" when it failed. The status line says "Making torno's Python environment, first
  time only" in place of `Building N s` while the kernel is starting over an environment that was not made.
- A workspace with no object leads with making one (`ui/EmptyWorkspace.tsx`, in `ui/ShowPage.tsx`): "Make your first
  project" and a line on what it takes, "New project" (primary), under it "or open the example to look around" (only
  where `hasExample`), the readiness block, a line on scope (printed parts and small assemblies), and a fold,
  "Already have build123d models?", closed, which holds the folder rule (`part/part.py`) and, for a folder without a
  `pyproject.toml`, that its models are built with torno's own build123d. torno runs no `uv` command there: the note
  names them for the person to run. The session pane in that state says that Claude Code works there, one session per object.
