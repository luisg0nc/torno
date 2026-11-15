---
paths:
  - "app/src/main/instructions.ts"
  - "app/src/main/instructions.test.ts"
  - "app/src/main/trust.ts"
  - "app/src/main/trust.test.ts"
  - "app/src/shared/instructions.ts"
  - "app/src/shared/instructions.test.ts"
  - "app/src/shared/agents.ts"
  - "app/src/shared/agents.test.ts"
  - "app/e2e/instructions.spec.ts"
  - "app/e2e/chattrust.spec.ts"
---

# The instruction files Claude Code reads, and trust

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## What crosses processes (root `CLAUDE.md`)

- The instruction files Claude Code reads on its own for an object (`CLAUDE.md` and the rest, in the object's folder, above
  it, and the person's own) are listed by path and size and never read (`app/src/main/instructions.ts`): the session pane
  shows them, and the first prompt of a session names them and says that what torno's tools say of the build is
  current. torno reads none of Claude Code's settings and changes nothing of its configuration.

## Agents (`app/src/main`)

- **The instruction files Claude Code reads** (`src/main/instructions.ts` `findInstructions`, the types and words in
  `shared/instructions.ts`; paths and sizes only: **no file's text is ever read**, not for the pane and not for the
  agent). What Claude Code loads at launch by default, as its documentation says ("How Claude remembers your project"),
  in its load order: the organisation's `CLAUDE.md` (`/etc/claude-code/` on Linux, `/Library/Application
  Support/ClaudeCode/` on macOS: `managedPath`), the person's `~/.claude/CLAUDE.md` and `~/.claude/rules/`, then from `/`
  down to the object's folder, in each `CLAUDE.md`, `.claude/CLAUDE.md`, `.claude/rules/` (one entry: the folder, the
  `.md` files under it and their size) and `CLAUDE.local.md`; the person's own `~/.claude` is one entry though the way up
  passes through their home. `AGENTS.md` and `.claude/AGENTS.md` (Claude Code 2.1.277 or later) are listed in each of those
  folders only when none of `CLAUDE.md`, `.claude/CLAUDE.md` and `CLAUDE.local.md` is in the object's folder or above it
  (the person's file, the organisation's and rules do not count; a link counts, as it may be loaded). `@path` imports, a
  subfolder's files (loaded on demand) and the settings that leave files out are not followed, and the pane says these
  are what Claude Code reads by default. A link is `lstat`ed and listed by its own path, with no size, never followed
  (a link to a network path can hang a stat; `trust.ts` does the same), `.claude` being one included; the rules walk follows
  none, stops at `MOST_RULE_ENTRIES` entries and `MOST_RULE_DEPTH` levels (the counts are then "at least") and passes
  over a folder it cannot read; the whole lookup is given `DEADLINE_MS` (3 s for the pane, `HOOK_DEADLINE_MS`, 1 s, on the way to a prompt's hook, which has 5 s in all) and finds nothing past it. A `.claude/rules/` entry is an upper bound ("up to N files": a rule with `paths:` loads only for matching files, which is in its text). `home` and the managed
  path are parameters of the finder, with `top` (default `/`, where the way up stops) so that a test is never read by a
  `CLAUDE.md` of the machine above its temporary folder. `InstructionList` keeps, for each object, the list the
  pane last asked for (`session:instructions`); a row is shown in its folder by its index into that list
  (`session:revealInstruction`: an object of the open workspace, a row of the list kept for it, which is dropped when the workspace is left; `shell.showItemInFolder`, never opened, never run, never a path from the window; under
  `TORNO_TEST=1` the path goes into `__tornoMain.revealedFiles` and no file manager is started). The first prompt of
  every session, resumed or not (`first` of `contextFor`'s opts, `Session.firstPrompt`), and the first prompt of another
  conversation (`fresh`, after `/clear`, when the CLI loads the files again: `tellsInstructions`), ends with `instructionsLine`:
  the files Claude Code loads by default with their sizes (six at most, each path cut to `MOST_PATH_CHARS`, the line at most
  `INSTRUCTIONS_LIMIT` characters, so the room it keeps never leaves the status a negative limit) and "What torno's tools say of the build is current: a file that names
  another viewer, report or export step is about another way of working, so take its advice on how to model, not on how
  to see the build", nothing when there are none; its room is kept before the marks are listed and, with the selection's
  and the scans', before the status is fitted, so the cut at `CONTEXT_LIMIT` never takes it. The same rule is one line
  in the `torno-model` skill (the system prompt has no room for it). The context item carries how many files it named
  (`instructions`, `PromptContext`), which the chat draws as "N instruction files" in the "torno added" line. Nothing is written or remembered of it: there is no
  "seen" state.
- **Trust (`src/main/trust.ts`).** Headless (`-p`) Claude Code skips its workspace-trust question. Before a chat
  starts, `Trust.pending` looks for `.mcp.json`, `.claude/settings.json` and `.claude/settings.local.json` in the
  object folder and each parent up to, not including, the person's home (a link is reported by its own path, not
  followed); with any there and the folder's real path not in `trusted.json` (beside the config file, written
  atomically, never in a workspace; in memory only when there is no config file) the start is refused with
  `trustQuestion`. `session:trust` records it. The terminal view is never asked: it has the CLI's own question.

## Agents (`app/src/renderer`)

- **The instruction files Claude Code reads** are one quiet line under the view's row in `SessionPane`
  (`.session-reads`, `role="note"`, shown for both views and with no session, not while a new object is being made;
  `session.instructions`, asked again when a session starts): "Claude Code also reads, by default" and, for each file, its name
  (`shared/instructions.ts` `named`, the home folder as `~`, a rules folder with its slash; a button that shows it in its
  folder by `session.revealInstruction` with the row's index, never a path) and what it weighs (`weighed`: sizes through
  `shared/format.ts` `bytes`, `a link, not followed`, `up to 3 files, 2.1 KB` for a rules folder: at most that many load), in the monospace face; its title says what the list
  is (`READS_TITLE`: by default, paths and sizes only, never read or changed). It is no question and nothing of it is stored:
  there is no "seen" state, and it is there each time the pane is of an object that has some (`e2e/instructions.spec.ts`; the
  capture `instructions` of `themes.spec.ts`).
- The chat is refused, with a question, for a folder that has Claude Code settings of its own and has not been let
  (`SessionPane`: `trusting`; main's refusal is `trustQuestion` of `shared/agents.ts`): "Start the chat" asks main
  to remember the folder and starts again, "Use the terminal" chooses that view and starts it.
