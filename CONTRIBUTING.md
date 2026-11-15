# Contributing to torno

Thanks for wanting to help. torno is new, so there's a lot to do, and an issue about something that confused you
is as useful as a pull request.

## Before you start

- **Bugs.** [Open an issue](https://github.com/luisg0nc/torno/issues/new/choose) with the bug form. It asks for
  what a report needs: your platform, the torno commit, the versions the "Ready to work" block shows, what you did
  and what happened, and a small model that shows the problem if you can share one.
- **Ideas and bigger changes.** Open an issue first, so we can agree on the shape of it before you spend time on
  code. torno is deliberately not a modeller (no sketcher, no feature tree, no editing solids by hand). The model is
  the Python file, and changes that keep it that way fit best.
- **Security.** Please don't open a public issue. [SECURITY.md](SECURITY.md) says how to report it privately and
  what torno's security model is. torno runs a local HTTP server for the agent's tools, guarded by a token for
  each session, so anything that gets around that matters.

## Behaving

Be kind and assume good faith. Criticise the code and the idea, never the person. That one line is torno's code of
conduct; it is a small project, and a long document would not add to it.

## Questions

For a question, or to show a part you made with torno, use
[Discussions](https://github.com/luisg0nc/torno/discussions). Issues are for bugs and work.

## Setting up

You need what the [README](README.md#requirements) lists: Node.js 22.12 or later, pnpm 10, uv and, to try sessions
by hand, Claude Code logged in.

```sh
git clone https://github.com/luisg0nc/torno.git
cd torno
pnpm install
pnpm dev                    # the app from the Vite dev server; F5 or Ctrl+R reloads the window
scripts/torno [folder]      # or build and run it as a user would
```

To try changes on real models without touching your own, copy the test models:
`cp -r kernel/tests/fixtures/ws /tmp/torno-dev && scripts/torno /tmp/torno-dev`.

## Where things are

| Folder | What's in it |
|---|---|
| `app/src/main` | Electron's main process: the kernel client, the sessions, the HTTP server with the MCP tools and the hooks, marks, scans, export |
| `app/src/renderer` | The UI (React), the three.js viewport and the tools that point at it |
| `app/src/shared` | Types and pure rules both sides use; `bridge.ts` is everything the window may ask of main |
| `app/src/export` | The self-contained HTML page an export writes, and its viewer |
| `app/e2e` | Playwright specs that drive the built app in a hidden window |
| `kernel/` | The Python package `torno_kernel` (uv): loads build123d models and tessellates them in forked workers, and imports scans |
| `scripts/torno` | The launcher |
| `docs/` | [The manual](docs/manual.md), the [design](docs/superpowers/specs/2026-10-08-torno-design.md), and the plans each feature was built from |

**The root `CLAUDE.md` has the rules for all of torno, and `.claude/rules/` has the rules for each part of the
code**, one file per topic, each naming the files it covers in its `paths:` list. They're written for AI agents
(Claude Code loads a rule when it reads or edits one of those files), but they're the most complete description of
how torno is meant to behave, so read the root one and the rules for the files you're changing before you start. A
change that breaks one of their rules needs a good reason, and should change the rule too.

## The rules that matter most

The `CLAUDE.md` and the rules have the detail. These are the ones a change most often trips over:

- **torno never writes in a person's workspace** except under `<object>/.torno/`. The only exceptions are making
  a new object and the export the person saves.
- **Kernel stdout carries protocol frames only.** Whatever a model prints goes to a captured buffer.
- **Units are millimetres, Z up.** Coordinates that cross a process boundary are in the object frame unless named
  `local`.
- **Every number told to the agent is the kernel's**, measured on the B-rep, and says whether it's exact. Numbers
  from a scan are never exact. Numbers shown go through `shared/format.ts`.
- **The HTTP server binds `127.0.0.1` only**, and every request needs the session's token. The token is never put
  in an argument, a file or a log.
- **UI text is sentence case**, and every number and ref is set in the monospace face. Colours and spacing come
  from `app/src/renderer/styles/tokens.css`.

## Tests

Run from the repository root:

```sh
pnpm test                          # app unit tests: app/src/**/*.test.ts (vitest), a few seconds
pnpm test:kernel                   # the app against the real kernel and a stand-in agent: *.itest.ts
(cd kernel && uv run pytest -q)    # the kernel alone (pytest)
pnpm test:e2e                      # builds the app, then drives it in a hidden window (Playwright)
pnpm -C app typecheck
```

While you work, run just the test you're changing:

```sh
pnpm -C app exec vitest run src/main/context.test.ts
pnpm -C app exec vitest run --mode kernel src/main/sessions/manager.itest.ts
pnpm -C app exec playwright test e2e/loop.spec.ts      # after pnpm build
```

Run all five before you open a pull request. New behaviour needs a test, and a bug fix needs a test that failed
before it.

Two things tests must never do:

- **Run a real `claude`.** It would spend your subscription and depend on your login and settings. Tests set
  `TORNO_AGENT_CMD` to the stand-in, `node app/test/fake-agent.mjs`. Anything that needs the real CLI is checked
  by hand, and the [last section of the manual](docs/manual.md#not-yet-verified-on-a-visible-screen) lists what
  still needs it.
- **Open a visible window.** Every launch of Electron sets `TORNO_TEST=1`, which keeps the window hidden. Never
  pass `--ozone-platform=headless`, and never call `page.screenshot()`, which hangs on a hidden window.
  [`.claude/rules/e2e-hidden-window.md`](.claude/rules/e2e-hidden-window.md) says how to read state and pictures instead.

## Docs

- The [README](README.md) is the short introduction. Keep it short.
- [The manual](docs/manual.md) is the reference, and `app/src/readme.test.ts` holds it to the code. If you add an
  MCP tool or a prompt, name it in the manual. If you change a key or a pointer gesture, regenerate its tables with
  `TORNO_README=write pnpm -C app exec vitest run src/readme.test.ts`.
- When a change alters what torno does, change the manual and the rule that says it in the same commit.

## Commits and pull requests

- One change per commit. The message is a sentence that says what changed, from the person's side when it's a
  behaviour: "Keep Marks within the column when the room shrinks", not "fix layout bug".
- A commit made with an AI agent ends with its `Co-Authored-By:` line.
- The pull request template asks what it changes and why, which tests you ran, what you checked by hand and, for a
  change to the window, a screenshot or a short recording. Tests can't take them, so take them yourself.

## Working with an AI agent

You're welcome to. torno is built that way, and the `CLAUDE.md` and the rules are there so an agent can follow the
rules. You're still responsible for what it writes: read the diff, run the tests, and check by hand what the tests
can't see.

## License

torno is licensed under the [Apache License, Version 2.0](LICENSE). By contributing, you agree that your
contributions are licensed under it too (section 5 of the license).
