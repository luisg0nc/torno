---
paths:
  - "app/src/renderer/ui/chat/**"
  - "app/src/renderer/state/agent.ts"
  - "app/src/renderer/state/agent.test.ts"
  - "app/src/renderer/state/seeAgain.ts"
  - "app/src/renderer/viewport/highlight.ts"
  - "app/src/renderer/viewport/highlight.test.ts"
---

# Chat: ref chips, keys of the chat, tool cards, folds and tasks

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Agents (`app/src/renderer`)

- Refs are chips (`RefChip`, `refs.ts` `refInfo`): hover lights the ref through `peek` in `state/agent.ts`, which
  is not an agent highlight (no agent line, no locked tools) and is drawn in the accent on a layer of its own
  (`point` in `viewport/highlight.ts`, `Viewport.setPointed`), never in a mark's colour, whoever made the mark it is
  of; what the agent points at keeps its own layer and colour meanwhile; click focuses a mark or selects a face or edge (the
  chip of the build on show, once the build after it has failed, opens the sheet of that failure; an older build
  is an inert chip), and
  a click with the pointer gives the keys back to the view (`giveKeysBack`), as every action on the view does. A
  ref that names nothing now is an inert span with the reason as its title. A ref in prose that names nothing the
  object has is not a chip at all (`RefInfo.plain`: a mark it has not, `M3` the screw; a build above the current or
  `r0`; a part the build has in no layout); a part in another layout, or a face it lacks, is an inert chip with
  its reason. Code is never searched for refs. Numbers in the person's prompt and in a card's questions and
  options are set in the monospace face like the rest.
- **`T1` is a chip** (`REF` in `shared/chat.ts` takes `T` and a number from 1, so `T0`, `T01` and `ST1` are none): `refInfo` is live for a tracing in `RefState.tracings` (`state/tracings.ts`), its title `T1: Front of the block, XZ at y = 0.0`, and a click opens it in the Tracing view (`tracingActions.open`, `boardActions.show('tracing')`); one the project does not have is only text in prose, an inert chip with the reason elsewhere.
- **A named set is a chip** (`#deck`, `part/#deck`): `refsIn(text, slugs)` takes the names the project has (`useSetSlugs`, any case, longest
  first; `markdown.tsx`, `RefText.tsx` and `ToolCard.tsx` pass them), and without names a `#` and a letter, so that `#171`, `# Plan` and
  `C#deck` are never one. `refInfo` of a set lights every member through `peek` (strokes too) and `select` is its faces, edges and
  parts; a name no set has is plain text, and a set of another layout, or with its parts switched off, an inert chip with the reason.
  "Make it a tag" is a chip in the box beside the board's (`ui/chat/SetTagChip.tsx`, `Make #deck a tag`, in the monospace face, with
  Remove): its text goes after the person's with the next send (`prompt + "\n\n" + text`) and is given back when the send fails;
  nothing is sent by itself (`state/setTag.ts`).
- Keys of the chat are rows of `shared/keys.ts` in the scopes `composer` and `picture`: `chat.send` Enter,
  `chat.newline` Shift+Enter, `chat.command` Up/Down and `chat.complete` Tab (while `/` commands are offered),
  `chat.close` Esc (a picture shown large; the focus returns to its thumbnail), `chat.stop` Ctrl+C (composer, only while the session
  works and nothing in the box is selected: with a selection it is a copy) and `chat.allow` Enter (scope `ask`: on the card itself
  in focus, not its buttons or its field, where Enter refuses; not on a question) and `ask.option` 1 to 9 (scope `ask`, heard on the block at the foot, never in a field: torno's own question takes 1 to 3; on
  a question of `AskUserQuestion` the key picks or toggles that option of the question in view, and the
  option shows its key cap, `aria-keyshortcuts`). The questions of `AskUserQuestion` come **one at a time** (`Questions` in `AskCard.tsx`): a line "1 of 3" with
  the question's header and a dot for each (done in ink, this one in the accent), its options as a compact list of rows (key, label, the description small and
  muted beneath, then one "Other" row), Back and Next (Skip while it has no answer). A single choice is its answer and takes the person to the next question
  (not when it is the only one); a multiple one is toggled and left. After the last a step "Review" reads each question with its answer (a click on one goes
  back to it) and "Send answers" sends; one question alone has no steps and "Submit". Enter in "Other" goes on. While a permission or a plan is open
  (`openAsk` in `Composer`) the box's placeholder is "Answer the card above, or say what to do instead", its primary button
  is "Deny and send" (`chat.answer` with `allow: false` and the text as the message; Enter in the box does the same) and "Queue"
  is the secondary; a question (`AskUserQuestion`) changes nothing in the box. The card is at the foot of the dock, over the box
  (`AskCard` with `where="foot"`, inside `Takeover`; `openRequest` picks it; `ChatPane` draws it), and the transcript holds a line
  ("Claude Code waits for your answer, below", `WaitsBelow`) in its place until it is answered or ended, when the transcript has the card. Escape in the box gives the keys
  back, except while the list of `/` commands is open: it closes the list. The foot's block takes focus once per request, and
  only when the composer is empty and not focused and the focus is in no other field (`Takeover`, `typing.ts`: a parameter, a slider, the terminal). An unsent prompt in a chat that is not over is among what closing
  the window asks about (`closingWhy`'s `unsent`). "Attach view" is sent in order: main waits for the picture
  before taking the next prompt, so one sent meanwhile cannot overtake it.
- **A tool is a chip** (`ui/chat/ToolCard.tsx`, `ToolFold`; spec "The conversation"): 24 px, round, on `--surface`, its line in 12 px
  with the word that carries it in bold ink (`labelParts`: the file of a `Read`, the name of the others, `torno · look` for
  torno's own); a tool of torno's is on `--accent-wash` with its name in `--accent` (`data-torno`), and the one running
  has an accent ring (`data-state='running'`). `ChatItems` puts the tools that follow one another, and the folds of them,
  in one wrapping row (`.chat-tools`, `drawRuns`); one that is open, or has a picture or a build under it, takes the row's
  whole width. Each prompt starts with a head (`PromptHead`, `headKind.ts` `headBuilds`: "Prompt 14", `h40 → h41`, `h40 → failed`
  in `--fail`, `h40 → …` while a build runs for the prompt still going, "no build" once a prompt's turn is over with none, or
  "queued"), from the history's own labels; the person's words are `.chat-you` on `--ink` (a queued one is outlined), with
  their refs as chips, and what went with the prompt is the muted line "with" under it (`Added`).
- **A tool card goes to what it showed** (`ui/chat/ToolCard.tsx`). The chip is a row (`.chat-tool-row`) whose toggle
  (`.chat-tool-line`, `aria-expanded`) covers it, so that the refs of a torno card's label are live chips (a button inside
  a button is no HTML) and the action is a button beside the state. A finished `look`, `section` or `show` has "See in
  view" (`show`: "Show again"): `seeInView` in `state/agent.ts` reads the card's input once more against the window as it is
  now (`replayOf` in `state/seeAgain.ts`, pure: a saved view it names is that view but for what is given beside it; a cut
  given leaves the parts together; an explode under a cut, a layout, scan or saved view the build lacks are refused in the
  tools' words, and a `focus` is not framed again, it being worked out in main) and applies it as the person's own edit
  (`actions.applyLook`, which `applyView` is the saved-view case of: `shownByAgent` cleared, no `activeView`) and then
  moves the camera. A finished `highlight` has "Point again" (`pointAgain`) only for a card that was seen as it
  happened (`noteTool` in the chat's `onItem` keeps the object and build on show then: a ref names whatever that face is
  in the build it was read from), and only while the window shows that build. A refusal is a line under the card.
- **A turn's tool lines fold, and the agent's list is kept in sight** (`ui/chat/fold.ts`, `tasks.ts`, `Tasks.tsx`; drawing
  only: the items, `MAX_ITEMS` and the log are as main made them). `ChatItems` draws `foldRuns` of what it has: a run of
  `FOLD_AT` (3) tools or more that are the agent's own, `done`, with no picture and nothing under them (no build line), and
  not a task tool, which lies before the last `turn` item, is one line (`ToolFold`, `foldLabel`: `Read 3 files, Grep ×2,
  Bash`, opening into the lines); thoughts that are over between its tools are part of it, any other item ends it, and a
  turn still going on folds nothing. A card's `done` is not written (`data-state` has it); the other states keep their word.
  The agent's list is read from the cards (`tasksNow`, `listsAt`): `TodoWrite` is the list whole, `TaskCreate` adds one
  (numbered as its result says, else in order) and `TaskUpdate` changes or removes one; a call that did not end `done` writes
  nothing. `TasksBar` is one line above the box (`taskLine`: `2 of 4`, a bar for each task, the one under way in the accent, and what is being done) while the session works and a task is left; `TasksCard` is the list as it stood at a
  `TodoWrite`, or under the last of a run of task tools. Which of the two the real CLI uses is for a hand check.
