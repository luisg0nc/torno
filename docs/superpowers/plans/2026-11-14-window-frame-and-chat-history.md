# The rail and history in the chat: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the left column with a rail of docked panels, and make the chat the project's history: builds
labelled by the prompt that caused them, a strip under each turn with Compare and Go back, editor saves between
turns, and a "Prompts only" view across every conversation.

**Architecture:** Main labels every history entry with its cause and prompt when it keeps it (`main/history.ts`,
fed by `Sessions.causeOf`), keeps failed builds as light entries, and gains Go back (`main/goback.ts`) and a rebuild
of old copies for Compare. The window reads one source for all of it, the history entries (`useHistory`), and joins
them to chat turns by prompt id. The rail is layout only: the panels' components are kept and re-hosted.

**Tech Stack:** Electron, TypeScript, React, three.js, vitest, Playwright (hidden window), Python kernel (uv).

**Spec:** `docs/superpowers/specs/2026-11-14-window-frame-and-chat-history-design.md`

**Branch:** `work/window-frame` (the spec is committed there).

## Global Constraints

- Everything written stays under `<object>/.torno/` except Go back, which writes and deletes `.py` files of its own
  project's folder only (never `common/`, never another project).
- History fields `cause`, `turn`, `failed`, `wentBackTo`, `undone` are main's only: never taken from the window or a tool.
- UI text in sentence case; every number and ref (`h41`, `M3`, `prompt 14`) in the monospace face; colours from
  `app/src/renderer/styles/tokens.css`. No control-room look.
- No per-frame state in React.
- Tests never open a visible window (`TORNO_TEST=1`), never run `claude` (stand-in `node app/test/fake-agent.mjs`);
  read `app/e2e/CLAUDE.md` before any e2e run. In Claude's shell: from `app/`,
  `export PATH="$PWD/node_modules/.bin:$PATH" XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-1 DISPLAY=:0`.
- Do not bind `Tab` or `Ctrl+Tab` (piece 2 takes `Ctrl+Tab`).
- Keep `data-region="left"` on the rail and its place in the F6 cycle.
- Commits carry no Claude attribution (Luis's rule wins over the repo CLAUDE.md line).
- Before each commit: the focused tests; before the last task's commit, all four suites (`pnpm test`,
  `pnpm test:kernel`, `(cd kernel && uv run pytest -q)`, `pnpm test:e2e`) and `pnpm -C app typecheck`.

## Review Focus

1. A save in the editor while Claude is mid-turn but before Claude's first edit: must be `person`, not the turn's.
2. Go back while a build is running, or with a file changed since the target build: confirmation lists it; nothing
   half-written if a write fails midway (each file atomic; the set applied in an order where a failure leaves the
   project buildable and says which files were done).
3. A history index written by an older torno (no `cause`, no `failed`): every reader (window, `history` tool, `diff`,
   ghost) still works and shows it as unknown.
4. A project with dozens of conversations and thousands of chat lines: opening it and Prompts only stay quick
   (reading only user items, capped).
5. Compare of an old build whose copy imports a `common/` file that has since changed: the rebuild uses the copied
   `common/` file, not today's.

Each is pinned by a test in the task that owns it (marked **RF1** to **RF5**).

---

### Task 1: History entries carry cause, prompt and failure

**Files:**
- Modify: `app/src/shared/history.ts` (types, `parseEntry`-style reading if present, else add `readEntry`)
- Test: `app/src/shared/history.test.ts` (create if absent)

**Interfaces:**
- Produces:
  ```ts
  export type BuildCause = 'agent' | 'person' | 'params' | 'goback' | 'unknown'
  export interface BuildTurn { conversation?: string; prompt: string; text?: string }
  // added to HistoryEntry:
  cause?: BuildCause           // absent = 'unknown'
  turn?: BuildTurn
  failed?: true                // a build that failed: no scene.json, thumb or copies
  error?: string               // first line of the failure, failed entries only
  wentBackTo?: string          // cause 'goback': the id it restored
  undone?: true                // undone by a later Go back
  export function causeOf(e: HistoryEntry): BuildCause
  export function drawable(e: HistoryEntry): boolean   // !e.failed
  ```

- [ ] **Step 1: Failing tests** `causeOf` of an entry without `cause` is `'unknown'`; `drawable` is false for
  `failed: true`; an index of the old shape (fixture copied from `main/history.test.ts`) reads with every entry
  `unknown` (**RF3**).
- [ ] **Step 2: Run** `pnpm -C app exec vitest run src/shared/history.test.ts`, expect FAIL.
- [ ] **Step 3: Implement** the types and the two functions.
- [ ] **Step 4: Run** again, PASS; `pnpm -C app typecheck` clean.
- [ ] **Step 5: Commit** "History entries can say what caused a build, its prompt, and that it failed".

### Task 2: Main decides the cause of each build and keeps failed ones

**Files:**
- Modify: `app/src/main/sessions/manager.ts` (`causeOf`), `app/src/main/history.ts` (`keep` takes a cause;
  `keepFailed`; `pruned` takes failed first), `app/src/main/ipc.ts:282-285` (pass cause; on a `build` event with
  `status: 'failed'` call `keepFailed`), `app/src/main/builds.ts` (`start` records `reason` on the entry: `'watch' |
  'params' | 'rebuild' | 'goback' | 'open'`, carried on the `scene` and `build` events as `reason`)
- Test: `app/src/main/history.test.ts`, `app/src/main/sessions/manager.itest.ts` (or a new
  `manager.cause.test.ts` with the manager's existing fakes)

**Interfaces:**
- Consumes: Task 1 types.
- Produces:
  ```ts
  // Sessions
  causeOf(objectId: string, startedMs: number): { cause: 'agent' | 'person'; turn?: BuildTurn }
  // History
  keep(obj, made, scene, cause: { cause: BuildCause; turn?: BuildTurn; wentBackTo?: string }): Promise<HistoryEntry | null>
  keepFailed(obj, at: { run: string; revision: number; sources: string }, error: string, cause: {...same}): Promise<HistoryEntry | null>
  // Builds
  type BuildReason = 'watch' | 'params' | 'rebuild' | 'goback' | 'open'
  rebuild(objectId: string, reason?: BuildReason, wentBackTo?: string): boolean   // default 'rebuild'
  ```
- Rule for `causeOf`: a session of the object has a turn running and its `TurnState.changedAt` is set and
  `startedMs >= changedAt` → `agent`, with `turn = { conversation: session.conversationId, prompt: <id of the
  turn's user item, the uuid passed to transcript.userSent>, text: <first 200 chars of the prompt> }`; in a terminal
  session (no chat) `prompt` is a main-made id `t-<conversation>-<n>` counted per `UserPromptSubmit`. Otherwise
  `person`. `reason` from Builds wins over it: `params` → `params`, `goback` → `goback`.
- A failed build's `sources` is `sourcesHash` of the files as `BuildLog` hashes them; when it equals the newest
  entry's and the newest is failed with the same error, nothing new is kept.

- [ ] **Step 1: Failing tests**:
  - `causeOf` returns `person` for a build started during a turn before its first edit's `PreToolUse` (**RF1**),
    `agent` with the prompt id for one started after it, `person` with no turn running.
  - `keep` with `{cause:'agent', turn}` writes both into `index.json`.
  - `keepFailed` writes an entry with `failed: true`, `error`, no folder; `pruned` of 100 loose + 1 failed drops
    the failed one before any build.
- [ ] **Step 2: Run** `pnpm -C app exec vitest run src/main/history.test.ts` (and the manager test), expect FAIL.
- [ ] **Step 3: Implement** as above.
- [ ] **Step 4: Run** PASS; also `pnpm -C app exec vitest run src/main` to catch callers of `keep`.
- [ ] **Step 5: Commit** "Each kept build says what caused it and under which prompt; failed builds are kept too".

### Task 3: The `history` tool and the window's list tell cause, prompt and failure

**Files:**
- Modify: `app/src/main/mcp/readTools.ts` (the `history` tool's text and data), `app/src/main/ipc.ts:1120-1148`
  (`history:list` returns the new fields; `history:ghost`, `thumbnail`, `diff` skip `failed`)
- Test: the existing tests of `readTools` for `history` and `diff`

**Interfaces:**
- Consumes: Task 1 `causeOf`, `drawable`.
- Produces: the tool's line per entry gains `· by Claude (prompt "<text>")`, `· your edit`, `· params`,
  `· went back to h40`, `· failed: <error>`, `· undone`; data gains the fields as stored.

- [ ] **Step 1: Failing tests**: a failed entry is listed with its error and refused by `diff` with a sentence
  naming it; an old entry lists without a cause word (**RF3**).
- [ ] **Step 2: Run** the readTools test file, FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** PASS; `app/src/readme.test.ts` still passes (tool names unchanged).
- [ ] **Step 5: Commit** "The history tool tells who caused each build and which failed".

### Task 4: Go back, in main

**Files:**
- Create: `app/src/main/goback.ts`, `app/src/main/goback.test.ts`
- Modify: `app/src/main/ipc.ts` (`history:goBackPlan`, `history:goBack`), `app/src/shared/bridge.ts`,
  `app/src/preload/index.ts`, `app/src/main/context.ts` (the pending notice in the next prompt's context),
  `app/src/main/sessions/manager.ts` (`undoTurn` becomes the fallback path only), `CLAUDE.md` (Global Constraints:
  the rule on writing, rewritten), `app/src/main/CLAUDE.md` (a "Go back" section)
- Test: `goback.test.ts`, a `context.test.ts` case

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces:
  ```ts
  export interface GoBackPlan {
    to: string                       // the entry restored
    write: string[]                  // own-folder files, workspace-relative
    remove: string[]                 // own-folder .py not in the copy, first seen in an entry after `to`
    leftAlone: string[]              // common/ and other projects' files that differ now
    changedSince: string[]           // files the person changed since the newest entry
    params: boolean                  // .torno/params.json differs from the entry's params
    undone: string[]                 // ids of entries after `to`
    prompts: BuildTurn[]             // their distinct turns
    fallback?: 'undo'                // no usable copy: today's Undo prompt instead
  }
  export function planGoBack(obj: ObjectInfo, to: string): Promise<GoBackPlan | { refused: string }>
  export function applyGoBack(obj: ObjectInfo, plan: GoBackPlan, deps: { history: History; builds: Builds }): Promise<{ done: string[]; failed?: { file: string; why: string } }>
  // pending notice
  // .torno/goback.json: { to, undone: string[], prompts: BuildTurn[], at }
  export function takeGoBackNotice(dir: string): Promise<string | null>   // the text for the next prompt; removes the file
  ```
- The target of "before prompt P": the newest drawable entry before P's first entry; none → the build current when
  P was sent (its `TurnState.before`), else refused with a sentence.
- Writes: each file via `writeFileAtomic`; removes after all writes; `params.json` through `paramsfile.ts` (main its
  only writer); entries after `to` get `undone: true` (one index write); the next build starts with reason `goback`
  and is kept with `wentBackTo: to`.
- Refused while a session of the object is `working` or `needs_input`, or a build is running.
- Notice text (exact): `The person went back to build <to>: the model files are as they were then, and prompts <list>
  are undone. You keep what you learnt from them; do not try them again unless asked.`

- [ ] **Step 1: Failing tests** in `goback.test.ts` with a temp workspace and a history fixture:
  - plan lists `write` for own files, `leftAlone` for a changed `common/x.py`, `remove` for an own `new.py` first
    seen after `to`, `changedSince` for a file edited after the newest entry.
  - plan with `files: []` on the target gives `fallback: 'undo'`.
  - apply writes the bytes of the copy, removes `new.py`, leaves `common/x.py` untouched, marks later entries
    `undone`, writes `goback.json`.
  - apply where the second write fails (a read-only file) returns `done` with the first and `failed` with the
    second, and leaves no `.tmp` beside either (**RF2**).
  - `takeGoBackNotice` returns the exact text once, then null.
- [ ] **Step 2: Run** `pnpm -C app exec vitest run src/main/goback.test.ts`, FAIL.
- [ ] **Step 3: Implement**; wire IPC and the context line; rewrite the CLAUDE.md rule (Global Constraints first
  bullet: add "Four: Go back (`main/goback.ts`) writes and removes `.py` files of its own project's folder, from the
  copies in `.torno/history/`, after the person confirms; never `common/` or another project.").
- [ ] **Step 4: Run** the file and `src/main/context.test.ts`, PASS.
- [ ] **Step 5: Commit** "Go back restores a project's files from its history, and tells Claude what was undone".

### Task 5: Compare any kept build (rebuild an old copy)

**Files:**
- Modify: `kernel/src/torno_kernel/supervisor.py` and the trial worker (a trial with `"mesh": true` answers with
  the same scene and blob frames as a build, then is thrown away), `app/src/main/kernel/client.ts` (`trial` opts
  `mesh?: true` → `TrialResult` gains `scene?`, `blob?`), `app/src/main/ipc.ts:1138` (`history:ghost` falls back to
  the rebuild)
- Create: `app/src/main/oldbuild.ts` (lays the copy out and asks the trial)
- Test: `kernel/tests/test_trial_mesh.py`, `app/src/main/oldbuild.itest.ts` (real kernel)

**Interfaces:**
- Produces: `rebuildKept(obj: ObjectInfo, entry: HistoryEntry, deps: { kernel; userData: string }): Promise<{ scene: Scene; blob: Uint8Array } | { refused: string }>`
- The copy is laid out under `<userData>/compare/<random>/` at its workspace-relative paths, so the model's
  imports of `common/` and other projects resolve to the copied files; it runs with the workspace's environment as
  a build of that workspace does; the folder is removed when the answer comes, and swept at start.
- Read `kernel/CLAUDE.md` (workers, timeouts) first; the trial's timeout is the build timeout.

- [ ] **Step 1: Failing tests**: pytest that a trial with `mesh` on a fixture model returns a scene with its parts
  and a non-empty blob; itest that `rebuildKept` of an entry whose `common/fillets.py` has since changed draws the
  old size (**RF5**); refused with a sentence for a failed entry.
- [ ] **Step 2: Run** `(cd kernel && uv run pytest -q tests/test_trial_mesh.py)` and
  `pnpm -C app exec vitest run --mode kernel src/main/oldbuild.itest.ts`, FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** PASS; `pnpm test:kernel` green.
- [ ] **Step 5: Commit** "An older kept build can be rebuilt from its copy to compare it".

### Task 6: The rail and its docked panels

**Files:**
- Create: `app/src/renderer/ui/Rail.tsx`, `app/src/renderer/ui/PanelHost.tsx`, `app/src/renderer/styles/rail.css`
- Modify: `app/src/renderer/App.tsx:450-485` (the `aside.left` becomes the rail and the panel host),
  `app/src/renderer/state/column.ts` (new shape), `app/src/renderer/state/store.ts:200-207, 703-716`,
  `app/src/renderer/ui/ParamsPanel.tsx` (holds `ChecksPanel` and `PrintProfile` as sections), `styles/panels.css`,
  `styles/layout.css:91,214-216`, `styles/status.css:152`, `styles/sheets.css:93` (offsets now
  `--rail-w + --panel-w`); remove `ColumnSplit.tsx`
- Test: `app/src/renderer/state/column.test.ts`, `store.test.ts:1435-1448`, e2e specs listed below

**Interfaces:**
- Produces:
  ```ts
  export type RailPanel = 'projects' | 'layers' | 'params' | 'scans' | 'marks'
  export interface ColumnPrefs { open: RailPanel | null; width: number }   // localStorage 'torno.column'
  export const COLUMN_DEFAULT: ColumnPrefs = { open: 'marks', width: 248 }
  actions.openPanel(p: RailPanel | null): void       // same panel again → null
  actions.setPanelWidth(px: number): void
  ```
- Rail: 56 px (`--rail-w`), `aside[data-region="left"]` with `aria-label="Panels"`; buttons with `aria-pressed`,
  label word under each icon (Projects, Layers, Params, Scans, Marks); badge text: Layers hidden count, Scans
  unaligned count, Marks to-review count, Params failing checks count (from the same selectors the folded titles
  use today). The workspace header moves into the Projects panel's top. The panel is the next sibling, width
  `--panel-w`, with `LeftEdge` as its resizer. Opening a project page that is not `object` keeps Projects and Marks
  only (as today's `page` rules).
- Reading an old `torno.column` value (`{folded, marks, width}`) gives `{ open: 'marks', width }`.
- e2e: specs that use `.left > section`, `.section-fold`, `.layers`/`.params`/`.checks`/`.scans`/`.objects`
  (checks, params, groups, show, themes, export, focus, boot) open the panel through the rail first; a helper
  `openPanel(page, name)` in `app/e2e/helpers` does it. `boot.spec.ts:189,208` assert the new stored shape.

- [ ] **Step 1: Failing tests**: `column.test.ts` reads the old shape as above and clamps width; `store.test.ts`
  `openPanel('layers')` twice gives `null`.
- [ ] **Step 2: Run** `pnpm -C app exec vitest run src/renderer/state`, FAIL.
- [ ] **Step 3: Implement** rail, host, CSS, Params sections.
- [ ] **Step 4: Run** unit PASS; build, then `playwright test e2e/focus.spec.ts e2e/boot.spec.ts e2e/checks.spec.ts
  e2e/params.spec.ts e2e/groups.spec.ts e2e/show.spec.ts e2e/themes.spec.ts e2e/export.spec.ts`, PASS after moving
  their selectors.
- [ ] **Step 5: Commit** "A rail of panels replaces the left column".

### Task 7: Compare mode in the view

**Files:**
- Create: `app/src/renderer/ui/CompareBar.tsx`
- Modify: `app/src/renderer/state/store.ts` (`compare` state), `app/src/renderer/viewport/Viewport.ts:344-355`
  (`setEarlier` used for Overlay/Before; Side by side as a second camera drawn into the left half with the scissor
  test, same scene objects, the earlier group visible only there), `app/src/renderer/ui/BuildStatus.tsx` (status
  text while comparing)
- Test: `app/src/renderer/state/store.test.ts`, `app/e2e/history.spec.ts` (rewritten for the chat)

**Interfaces:**
- Consumes: `history:ghost` (Task 5 fallback).
- Produces:
  ```ts
  type CompareMode = 'before' | 'overlay' | 'after' | 'side'
  interface CompareState { from: string; to: string; mode: CompareMode; prompt?: number }
  actions.compare(from: string, to: string, prompt?: number): void
  actions.compareMode(m: CompareMode): void
  actions.endCompare(): void
  ```
- Copy (exact): bar buttons `Before`, `Overlay`, `After`, `Side by side`, `Back to the live build`; status line
  `comparing prompt <n> · <from> → <to>`; while the old build rebuilds, `Building <from> to compare…`.
- Boxes: "What changed" from the `to` entry's `line`; "Checks and marks" from both entries' `dimensions` and
  `failing`.
- Esc ends compare (add the row to `shared/keys.ts`, scope viewport, before the other Esc rows).

- [ ] **Step 1: Failing tests**: store compare/endCompare; e2e: compare from a chat turn shows the bar and the
  status text, Back returns to live, a live build landing meanwhile does not end it.
- [ ] **Step 2: Run** the store test, FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** PASS; `TORNO_README=write pnpm -C app exec vitest run src/readme.test.ts` for the key row.
- [ ] **Step 5: Commit** "Compare a build of the history with the one before it, over the model".

### Task 8: History under each turn and between turns

**Files:**
- Create: `app/src/renderer/ui/chat/TurnBuilds.tsx`, `app/src/renderer/ui/chat/SaveLine.tsx`,
  `app/src/renderer/ui/chat/historyJoin.ts`, `historyJoin.test.ts`
- Modify: `app/src/renderer/ui/chat/TurnEnd.tsx` (strip and buttons; "Undo" becomes "Go back to before this
  prompt"), `app/src/renderer/ui/chat/Items.tsx` (save lines and the gone-back fold between turns)
- Test: `historyJoin.test.ts`, `app/e2e/chat.spec.ts` cases

**Interfaces:**
- Consumes: Task 1 types, `useHistory()` entries, Task 4 IPC, Task 7 `actions.compare`.
- Produces:
  ```ts
  export interface JoinedTurn { promptId: string; number: number; entries: HistoryEntry[]; from?: HistoryEntry }
  export function joinTurns(items: readonly ChatItem[], entries: readonly HistoryEntry[], numbering: Map<string, number>): Map<string /*turn item id*/, JoinedTurn>
  export function savesBetween(entries: readonly HistoryEntry[], afterAt: string, beforeAt: string): HistoryEntry[]  // cause person|params, folded when consecutive
  ```
- A turn's prompt id is the `user` item before it (its `id`). `from` is the newest drawable entry before the
  turn's first entry.
- Copy (exact): `You saved <files> in your editor · <id>`; several: `You saved <n> times in your editor · <first>
  to <last>`; params: `You tried <names> · <id>`; fold: `Prompts <a> to <b> · you went back from these` with
  `Show`; buttons `Compare`, `See changes`, `Go back to before this prompt`, `Star`.
- Go back opens a `Confirm` listing `write`, `remove`, `leftAlone` ("left as they are"), `changedSince`, params,
  and the prompts undone; fallback plans say `Claude will be asked to put the files back instead.`

- [ ] **Step 1: Failing tests**: `joinTurns` maps entries with `turn.prompt` to their turn, ignores `unknown`
  ones; `savesBetween` folds three consecutive person entries; e2e with the stand-in agent: a turn that edits shows
  two thumbnails and the buttons; a save made between turns shows a save line (**RF1** end to end).
- [ ] **Step 2: Run** `pnpm -C app exec vitest run src/renderer/ui/chat/historyJoin.test.ts`, FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** PASS; build; `playwright test e2e/chat.spec.ts`, PASS.
- [ ] **Step 5: Commit** "The chat shows each prompt's builds, and your own saves between them".

### Task 9: Prompts only, across conversations

**Files:**
- Create: `app/src/main/sessions/prompts.ts` (`listPrompts`), `prompts.test.ts`,
  `app/src/renderer/ui/chat/PromptsOnly.tsx`
- Modify: `app/src/main/ipc.ts` (`chat:prompts`), `shared/bridge.ts`, `preload/index.ts`,
  `app/src/renderer/ui/chat/ChatPane.tsx` (the `Chat | Prompts only` toggle; "Earlier conversations" above the
  current one), `app/src/renderer/ui/SessionPane.tsx` (terminal view: Prompts only as a pane over the session
  area), `app/src/renderer/ui/BuildStatus.tsx:115,182,243` (History opens Prompts only); delete
  `app/src/renderer/ui/HistorySheet.tsx` and its styles
- Test: `prompts.test.ts`, `app/e2e/history.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface PromptRow { conversation: string; id: string; number: number; text: string; at: number }
  export function listPrompts(dir: string, opts?: { most?: number }): Promise<PromptRow[]>  // oldest first, numbered from 1 across the project
  ```
- Reads each `.torno/chat/*.jsonl`, keeps only `user` items with `state: 'sent'`, ordered by `at`; terminal prompts
  come from history entries' `turn` with `t-` ids. `most` defaults to 2000 rows; a log is read from its tail
  (`READ_TAIL_BYTES`) as `readLog` does. If opening 50 conversations of 2000 lines takes more than 200 ms in the test,
  add an index `.torno/chat/prompts.json` appended when a prompt is sent (the builder's call in the spec) (**RF4**).
- Row copy: number, last thumbnail, text cut to one line, `<from> → <to>`, result word (`passes`, `<n> failed on the
  way`, `starred`, `gone back from`), relative time from `chat/ago.ts`. Filters `Starred`, `Hide gone back`. Click =
  compare; double-click = Chat view scrolled to the prompt.

- [ ] **Step 1: Failing tests**: `listPrompts` over two conversation files numbers across both by time; skips
  `not-sent`; the timing case for **RF4** with 50 generated logs.
- [ ] **Step 2: Run** `pnpm -C app exec vitest run src/main/sessions/prompts.test.ts`, FAIL.
- [ ] **Step 3: Implement**; remove HistorySheet.
- [ ] **Step 4: Run** PASS; build; `playwright test e2e/history.spec.ts e2e/chat.spec.ts`, PASS.
- [ ] **Step 5: Commit** "Prompts only: the project's history as one row per prompt, across conversations".

### Task 10: The manual, and the whole branch green

**Files:**
- Modify: `docs/manual.md` (intro "three columns", "The window." 414-423, "History of builds" 372-383, "See
  changes" 727, "Undo" 743 → "Go back", Keys table, Files torno writes: `goback.json`, `<userData>/compare/`,
  "Not yet verified on a visible screen": the rail, Compare side by side, Prompts only), `README.md` only if it
  links a heading that moved

- [ ] **Step 1: Run** `pnpm -C app exec vitest run src/readme.test.ts`; fix every failure it names.
- [ ] **Step 2: Run** all four suites and typecheck (Global Constraints), all PASS.
- [ ] **Step 3: Commit** "The manual says the rail, history in the chat, Compare and Go back".
