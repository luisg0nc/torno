## What and why

<!-- A few lines. Link the issue: Closes #n -->

## How it was checked

- [ ] `pnpm test`
- [ ] `pnpm test:kernel`
- [ ] `(cd kernel && uv run pytest -q)`
- [ ] `pnpm test:e2e` (needs a desktop; say if you could not run it)
- [ ] `pnpm -C app typecheck`
- [ ] Tried by hand with a real `claude`, if the change touches the agent (sessions, prompts, tools, hooks). No test runs the real CLI.

## Docs

- [ ] `docs/manual.md` changed if behaviour did (`app/src/readme.test.ts` holds it to the code; `TORNO_README=write pnpm -C app exec vitest run src/readme.test.ts` rewrites the keys)
- [ ] The rule in `.claude/rules/` (or the root `CLAUDE.md`) changed if a rule did

## Pictures

<!-- For anything visible, a capture from a hidden window (see .claude/rules/e2e-hidden-window.md; never page.screenshot() on Electron). Light and dark if colours changed. -->

## Two rules to check

- [ ] Nothing is written in a workspace outside `<project>/.torno/`
- [ ] No test runs a real agent CLI
