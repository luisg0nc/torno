# The window's new frame, and history in the chat

Piece 1 of the board redesign (epic #173). Mockups: the "torno board redesign" canvas (private claude.ai
artifact), rows 1 (layout C) and 4 (history in the chat).

## Why

Luis named three things wrong with the window today: the left column with many things open at once, the new-project
onboarding, and the history. The redesign puts a board at the centre of working with Claude (pieces 2 and 3). This
piece clears the ground for it and fixes the history, and needs no board:

- The left column stacks seven sections (Projects, Layers, Parameters, Checks, Print profile, Scans, Marks) that
  fight for one strip of height. It goes.
- History today is a sheet off the status line: a strip of builds that says nothing of which prompt made them, so
  it is hard to see how the part got where it is over Claude's turns. The chat already is a list of prompts, and
  already says under each edit what its build did (`BuildLine`) and ends each turn with "See changes" and "Undo"
  (`TurnEnd`). History moves into the chat instead of living beside it.

The order of the redesign, agreed: 1 this frame and chat history, 2 the board, 3 a new project starts as a board, 4
richer cards (#169, #171, #172, #174) one at a time. Each has its own design and plan.

## Goals

- A thin rail on the left replaces the column. Each icon opens one panel beside the rail.
- The chat is the project's history: each prompt's turn ends with its builds before and after, what changed, and
  Compare, See changes, Go back to before this prompt, Star.
- Your own editor saves (and Params you try, if they build) appear as small lines between turns.
- A "Prompts only" view folds the chat to one row per prompt, across every conversation of the project.
- Compare shows any kept build over the current one, not only builds of this run.
- Go back restores the model files itself, and Claude is told what was undone.

## Non-goals

- The board, the Board/Model swap and its key (piece 2). The swap key will be `Ctrl+Tab`, not Tab: bare Tab moves
  keyboard focus and `e2e/focus.spec.ts` holds it there. Piece 1 leaves the key free; it does not bind it.
- The new-project onboarding (piece 3). Its page keeps working as now inside the new frame.
- Rewinding Claude's conversation. On Go back Claude keeps its memory (decided): it is told what was undone, so it
  does not try the dropped attempt again.
- History of files outside what `.torno/history/` copies today (the `.py` files `sourcesHash` covers).

## Anti-goals

- A history that disagrees with the chat: every row and every turn summary reads the same source (the history
  entries, labelled by prompt), never two accounts that can drift.
- Losing anything the column gave: every section keeps its content, folds, counts and keys; only where it lives
  changes.
- Panels that cover the model.

## Decisions

### The rail (1a)

- A rail about 56 px wide, icons with a word under each, where the column was. Five icons: **Projects, Layers,
  Params, Scans, Marks**. Checks and Print profile move into the Params panel as sections of it (they are about the
  same build and are short).
- One panel at a time, docked beside the rail; it pushes the 3D view over, it never floats over it. Clicking the
  open icon closes it; clicking another switches. The panel's width is dragged as the column's is now, and remembered.
- The rail keeps `data-region="left"` and its place in the F6 cycle: 102 lines in 48 e2e specs wait on that
  selector, and the region is still "left". The aria label names the rail.
- What the column's localStorage `torno.column` kept (folded sections, the Marks height, the width) becomes which
  panel is open and the panel's width. A stored value of the old shape is read without error and dropped.
- The Projects panel keeps the workspace header (name, folder menu) at its top.
- Counts the folded titles show today (`Layers 12 · 3 hidden`, `Scans 1 · unaligned`, Marks to review) show as a
  small badge on the rail icon, so a closed panel still says what needs looking at.

### Builds labelled with their cause (2a)

- When main keeps a build in `.torno/history/`, the entry also gets what caused it:
  - `cause`: `agent` (an edit of Claude's: a build started while a chat turn is running and after an
    Edit/Write/MultiEdit or Bash of the agent's, as main already tells from its hooks), `person` (a save in the
    person's editor: a build the watcher started with no agent edit pending), `params` (the person's tried Params
    changed), `goback` (the build after a Go back, with the build it went back to), or `unknown` (an older entry,
    or one main cannot tell).
  - `turn`: `{ conversation, prompt }` when a chat turn was running: the Claude Code conversation id and the id of
    the turn's prompt item in the chat log. Absent otherwise.
- Entries already on disk have neither and read as `unknown`; nothing is migrated.
- **Failed builds get an entry** (my call), so "1 failed on the way" reads from the history like everything else:
  `failed: true`, the error's first line, the cause and turn, no scene, no thumbnail, no source copy. They count
  toward `HISTORY_KEPT` and are pruned first. Nothing that reads entries as builds to draw or diff takes one.
- **Terminal sessions** (my call): hooks still run, so the cause is known; `turn` then carries the prompt's text from
  `UserPromptSubmit` and a prompt id main makes, since there is no chat item. Prompts only also opens from the status
  line's History button as a pane over the session area, so a terminal user keeps history, Compare and Go back.
- **Prompt numbers** count across the project (my call), oldest first, so "prompt 14" means one prompt everywhere.
- These fields are of main's only (as `MAIN_ONLY_KEYS` are of marks): never taken from the window or a tool.

### History in the chat

- **Under each turn**, the turn's account (`TurnEnd`) gains a strip: the build the turn started from, its builds,
  the build it ended on (thumbnails from `.torno/history/h<n>/thumb.png`), a failed build in the strip marked so, the
  checks and marks that flipped, the parts changed. Its buttons: **Compare** (below), **See changes** (as today),
  **Go back to before this prompt**, **Star** (the history's star, on the turn's last build).
- **Between turns**, a build caused by the person is one small line: "You saved `common/fillets.py` in your editor
  · `h39`" (the files from the entry's `files`), and one caused by params says which Params. Several in a row with no
  prompt between fold into one line with a count.
- **Prompts only**: a toggle in the chat's head, `Chat | Prompts only`. One row per prompt: number, last thumbnail,
  the prompt's text cut to a line, its builds (`h36 → h38`), the result in a word (passes, 1 failed on the way,
  starred, gone back from), and when. Editor-save lines show between rows. Filters: Starred, Hide gone back. Click a
  row to Compare it; double-click to open it in the full chat.
- **Across conversations**: Prompts only lists every conversation of the project, newest first, as one thread with a
  quiet line where a conversation began. The chat view shows the current conversation as today, with earlier ones
  readable above it on demand ("Earlier conversations"). Conversations are the files of `.torno/chat/`; no new index
  is kept unless reading them proves too slow (builder's call, see below).
- **Gone back**: prompts whose builds a Go back undid are kept, faded, folded into one row ("Prompts 10 to 12 · you
  went back from these"), openable.
- The history sheet off the status line is retired; the status line's History button opens Prompts only. The
  agent's `history` tool is unchanged except that it also returns each entry's `cause` and `turn`.

### Compare (3a)

- Compare draws a kept build over the current one, using the existing earlier-build drawing (`viewport/earlier.ts`,
  `setEarlier`), with a bar over the view: **Before | Overlay | After | Side by side**, **Pin to board** (hidden until
  piece 2), **Back to the live build**. Floating boxes say what changed (parts) and how checks and dimensions moved,
  from the entries' `dimensions` and `line`.
- A build of this run comes from memory as now. An older one is rebuilt from `h<n>/source` on demand in a throwaway
  worker, as `try_params` builds a trial: nothing kept, nothing written in the workspace. The first Compare of an old
  build waits for one build and says so.
- While comparing, the view says so (top bar and status line: "comparing prompt 14 · h40 → h41"), and live builds
  keep landing underneath; Back to the live build ends it.

### Go back to before this prompt

- Restores the model files of the build the prompt started from (the newest entry before the prompt's first build,
  or the build current when it was sent) from `.torno/history/h<n>/source`. This relaxes "torno never writes the
  model", as decided on #166. Each file is written whole or not at all (as exports are). A file the person changed
  since that build is listed in the confirmation before anything is written.
- **Only this project's own folder is written** (Luis). `h<n>/source` also holds `common/*.py` and files of other
  projects the build imported (`Scene.uses`); those that changed since are listed in the confirmation and left as
  they are, so a Go back never changes another project.
- **Files the undone prompts created are deleted** (Luis), only inside this project's own folder: a `.py` file there
  that is not in the copy and was first seen in a build after it. They are listed in the confirmation. The root
  `CLAUDE.md` rule is rewritten to say both: Go back writes and deletes model files of its own project only.
- **Params too** (my call): the person's tried Params (`.torno/params.json`) are put back as they were for that
  build, so "went back to h40" builds what `h40` was.
- **When the copy is missing** (an entry with `files: []`, over the size caps, or pruned past `HISTORY_KEPT`) (my
  call): Go back falls back to today's Undo, a prompt asking Claude to reverse its edits from the kept turn changes,
  and says so in the confirmation. Neither available: the button is not shown.
- Asks first, naming the files and the prompts it undoes. Refused while Claude is working.
- Claude is told, with its next prompt and as a note in the chat at once: which build the files were put back to,
  which prompts are undone, and that it keeps what it learnt from them. No conversation is rewound. The notice is
  kept on disk under `.torno/` until a prompt carries it (my call), so a restart or a new conversation still gets it.
- The new build that follows is labelled `cause: goback` with the build it went back to, so the history reads
  "went back to h40", and the undone prompts are marked gone back.
- "Undo" on the last turn, which today asks Claude to reverse its edits, becomes Go back on that turn.

## Constraints

- Global rules of `CLAUDE.md` hold, with the one relaxation above (Go back writes model files). Everything else
  written stays under `<object>/.torno/`.
- No per-frame state in React; the rail and panels are layout, the viewport is untouched apart from Compare.
- UI text in sentence case; every number and ref (`h41`, `M3`) in the monospace face. Tokens from
  `styles/tokens.css`.
- `docs/manual.md` is held to the code by `readme.test.ts`: the Keys table, "The window." paragraph, "History of
  builds", "See changes" and "Undo" are rewritten with this.
- Tests never open a visible window and never run `claude`; the stand-in agent drives the chat in e2e.

## Approaches considered

- **Rail panels:** one docked panel at a time (picked: never covers the model, simple keyboard story, closest to
  today's code) vs floating panels you can stack and pin (more flexible, covers the model, more to build and test).
- **Linking builds to prompts:** main labels each build when it keeps it (picked: exact, survives restarts) vs the
  window matching builds to turns by time (no storage change, misfiles a save made during a turn).
- **Compare of old builds:** rebuild old source on demand in a throwaway worker (picked: works for any kept build)
  vs only builds of this run (no new kernel work, older rows have pictures only).
- **Where history lives:** in the chat (picked, Luis's idea: the chat is already per prompt and already says what
  each build did) vs a separate timeline panel (round 2's first draft; duplicated the chat).

## Left to the builder

- How the window reads many conversations for Prompts only (read each log's turns on open, or keep a small index
  under `.torno/chat/`), as long as opening a project stays quick with dozens of conversations.
- The icons (drawn to match `scripts/torno.svg`'s line weight) and the rail's exact widths.
- Where in main the cause is decided (`Builds` knows who started a build; the session knows a turn is running).
- The rebuild of an old build: which worker, how its source tree is laid out outside the workspace, its timeout.
- How the e2e specs that use `.left > section` and `.section-fold` move to the panels.
