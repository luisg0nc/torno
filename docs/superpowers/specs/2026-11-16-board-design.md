# The board (piece 2 of #173)

Piece 2 of the board redesign. Piece 1 (PR #181) gave the window its rail and moved the project's history into the
chat. This piece adds the board: a canvas of cards that takes the 3D view's place, where everything the project knows
is laid out, framed and put in order, so the board becomes the brief Claude works through.

The design canvas holds the mockups `Main` and `C-swap`.

## Why

Luis wants the board to become the centre of how a person works with Claude in torno. Photos, notes, marks, scans,
builds and Claude's own plans should sit in one place and relate to each other, instead of being spread over panels,
the chat and files. A person points Claude at a frame ("work through Latch") rather than re-explaining it. A heavy user
(the 780-part engine model behind #165 to #178) needs this most: a list of marks stops working at that size.

## Goals

- Each project has a board. **Board** and **Model** swap in the main area, by a switch and by `Ctrl+Tab`.
- Things the project already has appear as cards by themselves: `brief.md`, the files in `reference/`, marks and
  scans. New ones land in a free spot.
- Builds, saved views, the Params and the checks become cards when the person pins them.
- The person makes text cards, picture cards (dropped or pasted), sketch cards, named frames, and arrows between cards
  with an optional word on them. Cards and frames can be moved and resized.
- Each prompt carries one line about the board. What the person selects or frames and attaches goes with the prompt
  in full.
- Claude reads the board and adds its own cards through tools. It never moves, edits or removes the person's cards.
- The layout, frames, arrows and text travel in git. Pictures stay local.

## Non-goals (later pieces or issues)

- View notes and 3D sketches (#169), red and green reviews (#172), named groups (#171), sheets (#174): piece 4.
- A new project that starts as a board (piece 3).
- Editing `brief.md` from the board (Luis chose read-only, option A; it can be added later).
- More than one person on a board at once.

## Anti-goals

- The board must not flood Claude. Without an attachment a prompt carries one line, never the board.
- Emptying the board never loses work. Removing a card that appeared by itself only hides it.
- Claude never rearranges the person's board.
- No whiteboard-app sprawl: no per-card colours, fonts or freehand ink on the board itself (ink lives in sketch
  cards).
- Nothing is written in the workspace outside `<object>/.torno/`. This piece adds no write exception.
- No per-frame state in React: panning and zooming never re-render cards.

## Approaches

- **A. Our own board in the page (chosen by Luis).** Cards are page elements in a layer moved by a CSS transform set
  directly on the element; arrows are an SVG layer in the same space; minimap and box selection are ours. Most code,
  but it follows torno's look and rules and adds no library.
- B. React Flow. Pan, zoom, minimap, edges and selection built in, but its look must be overridden everywhere, frames
  fit its model of nodes and edges poorly, and its viewport store has to be checked against the per-frame rule.
- C. A drawn canvas (2D or three.js). Fastest with thousands of cards, but text editing, text selection and
  accessibility would be rebuilt by hand for boards that hold tens or hundreds.

## What is on the board

Every board item has an id `C<n>`, per project, given by main only, never reused (as marks have `M<n>`).

| Card | Comes from | How it appears | What it shows | Double-click |
|---|---|---|---|---|
| Brief | `<project>/brief.md` | by itself | the file's text, read-only, scrolls | opens the file in the person's editor (`shell.openPath`) |
| Reference | each file of `reference/` (`listReferences`) | by itself | a photo or doodle as a picture; a STEP or other file by name and size | a photo opens large; a file is shown in its folder |
| Mark | each mark `M<n>` | by itself | its chip, kind, anchor ref, note, status (sent, resolved, fails) | goes to Model and selects the mark |
| Scan | each scan `S<n>` | by itself | name, point count, aligned or not, shown or hidden | goes to Model with the scan shown |
| Build | a history entry `h<n>` | pinned from the build strip under a prompt | the build's thumb, id, line, who caused it | goes to Model and opens Compare with the live build |
| View | a saved view | pinned from the views strip | the view's name and note | goes to Model with that view |
| Params | the project's Params | pinned from the Params panel | live: each Param, its value, and tried overrides marked as tried | opens the Params panel |
| Checks | the model's checks and pinned dimensions | pinned from the Checks panel | live: each check passing or failing | opens the Checks panel |
| Text | the person or Claude | made on the board | plain text with refs (`M3`, `h41`, `C7`) shown as chips | edits (the person's cards only) |
| Picture | the person (dropped, pasted, chosen) or Claude (a picture of the view) | made on the board | the picture and an optional caption | opens large; Claude's carries its camera, so double-click goes to Model with it |
| Sketch | the person, drawn with the ink pad (the existing `ui/board/Board.tsx`) | made on the board | the drawing | opens the ink pad again |
| Frame | the person or Claude | made on the board | a named outline holding the cards inside it | renames |
| Arrow | the person or Claude | drawn from one card or frame to another | a line with an optional word | edits the word |

- A card that appeared by itself is shown only once it has a place. Main gives each new one a free spot (to the right
  of the last row of cards, then wrapping) the first time the board is read after it appears, and stores that place.
- Removing such a card hides it (`hidden: true`); the thing itself (the mark, the scan, the photo) is untouched. A
  "Hidden cards" list on the board brings one back. When the thing itself is gone (a mark deleted, a photo removed), its
  card goes too.
- Pinning a build stars it in the history, so it is never pruned. Removing the card leaves the star.
- A pinned card is the person's choice, so main never removes it because its source is missing (only cards that
  appeared by themselves go with their source). A build card keeps a copy of what it shows (id, line, cause, the
  build's `sources` hash) and its thumb in `pictures/`. On another computer, or after the history lost it, the card
  shows that copy with "build not on this computer", and double-click does nothing. A local `h41` whose `sources` hash
  differs from the card's is not the same build. A view card whose view is gone says so the same way. (My call.)
- Pinning the Params or the checks twice is refused: each exists once on a board.
- A card is the person's or Claude's (`by`). Claude's cards have the agent's green edge (as in the mockups).

## The window

```
┌ rail ┬ [Board | Model]  Ctrl+Tab ───────────────────┬─ chat ──────────┐
│      │  ┌ Latch ─────────────────────┐              │                 │
│      │  │ M1 pin · lid/F12  M3 ✕ 2.8 │ ──like this→ │ [Latch · 3 · 1] │
│      │  └────────────────────────────┘              │  Message …      │
│      │  brief.md   bay.jpg   S3 scan   Claude·plan  │                 │
│      │ V N F A I S                        [minimap] │                 │
└──────┴──────────────────────────────────────────────┴─────────────────┘
```

- The switch sits at the top left of the main area. `Ctrl+Tab` toggles it (a row of `shared/keys.ts`, scope
  `window`, not bound while a text field has focus). The window remembers the last choice per project (window
  storage). A project opens on Model until its board has a card of the person's or Claude's.
- The 3D view stays mounted while the board is shown, so nothing is rebuilt on the swap; it stops drawing while hidden.
  The rail, the chat and the status line are the same in both.
- **Moving around:** wheel or two-finger scroll pans, `Ctrl`+wheel and pinch zoom around the pointer (10 % to 400 %),
  middle or right drag pans, `Space`+drag pans. A key fits the whole board. A minimap in a corner shows the board and
  the visible part; clicking or dragging in it moves there.
- **Tools** (a small palette, each a row of `shared/keys.ts` in a new scope `board`): Select `V`, Text `N`, Frame
  `F`, Arrow `A`, Picture `I`, Sketch `S`. With Select, left drag on empty space draws a selection box; clicking a card
  selects it, Shift adds. Dragging a frame moves the cards inside it. A card dropped inside a frame belongs to it.
- Delete removes the selected cards of the person's or Claude's, and hides the ones that appeared by themselves. Ctrl+Z
  undoes the last board changes made in this window (move, resize, delete, hide, edit), up to 50.
- Pictures can be dropped onto the board or pasted (the window reads the dropped file; no clipboard in tests).
- **Attaching:** with cards or frames selected, "Send with the next prompt" (and a key) puts a chip in the composer,
  "Latch · 3 cards · 1 arrow", which can be removed. "Send the whole board" does the same for every card.
- The line under each prompt in the chat says what went: "board: 12 cards, 2 new", plus the attachment if any.

## What Claude gets

- **Every prompt** (in `contextFor`, inside `CONTEXT_LIMIT`): one line, "Board: 12 cards (2 new: C14 a photo, C15
  text), frames Latch, Snorkel. Read it with `board`." A card is new when it was added, or when what it says changed: a text, caption, name,
  picture or arrow word, or the content of its source for a pinned card (a build card's copy, the Params' values, the
  checks' results). Moving, resizing or putting it in another frame does not make it new. Mark cards follow the marks'
  own news (the context already lists new marks), so they are not counted twice. Claude's own cards are never new to
  Claude. Main keeps a hash of what each card says in `told.json`, so the tracked file carries no counters. (My call.)
  A card is new until a prompt that carried the line has been
  delivered (the same delivery point as `sentMarkIds`, so a prompt that fails to go does not use it up). Main keeps
  which revision of each card was told in an ignored file, so it survives a restart.
- **An attachment** goes as part of the prompt the person sends (like a drawing), not in the context: the frames by
  name, then their cards in reading order, each by id with its content (a text card's text, a mark's ref and note, a
  build's id and line, the Params' values, and so on), then the arrows ("C3 → C7: like this"). Reading order is left
  to right, top to bottom: cards whose tops are within half a card's height of each other count as one row. Pictures
  (photos, sketches, Claude's pictures, build thumbs) go as images after the text, at most 6, each at most 1280 px on
  its long edge (the window scales them before sending, since main does not resize); past 6, they are named and left
  for the tool. The text is capped at 12 000 characters; past that it ends with a sentence saying to read the rest
  with `board`.
- **Tools** (two new `TOOLS` entries; the manual and `src/readme.test.ts` follow):
  - `board` (read-only, `READ_ONLY`): the whole board, or one frame by name or id, in the same text form as an
    attachment, with `pictures: true` to also get up to 6 pictures. Hidden cards are left out.
  - `add_card` (`CHANGES_VIEW_OR_MARKS`): Claude adds a text card or a picture of the view (taking `look`'s
    camera arguments, drawn as `look` draws, at most 1280 px), optionally inside a named frame (made when it does not
    exist, Claude's), optionally with an arrow from or to an existing card and a word. It may also replace the text of,
    or remove, a card of its own (`card: "C9"`). It refuses any change to a card of the person's. Claude's new cards
    land in a free spot inside the frame it named, or next to the board's last row, never over a card. Claude may put
    a card in a frame of the person's (that changes the new card, not the frame). When the frame has no free spot, the
    card goes just below the frame, outside it and not in it, and the tool's answer says so: the person's frame is
    never grown or moved. (My call.)
- The agent prompt (`agent-prompt` rule) gains a sentence: the board is the person's brief; attached frames say what to
  work on; add a plan or a picture as a card when it helps the person follow.

## Storage

- `<object>/.torno/board/board.json`, tracked in git (it joins `scene.json`, `marks.json`, `scans.json`,
  `profile.json` and `agent.json` among what travels): `{ next, cards, arrows }`. Each card has `id`, `kind`, `x`, `y`,
  `w`, `h` (board units, 1 unit = 1 CSS px at 100 %), `by`, `frame?` (the id of the frame it is in), and per kind its
  `source` (`brief`, a `reference/` path, `M<n>`, `S<n>`, `h<n>`, a view name, `params`, `checks`), `text`, `name`,
  `picture` (a file name in `pictures/`), `caption`, `camera`, `hidden`. Arrows have `id`, `from`, `to`, `label?`, `by`.
- `<object>/.torno/board/pictures/` holds the picture and sketch files, with a `.gitignore` of `*` of its own, written
  by whoever makes the folder (as `views/` and `scans/` do). A board cloned without its pictures shows a "picture not
  on this computer" placeholder in their place.
- `<object>/.torno/board/told.json` (ignored through `ensureIgnored`): what revision of each card Claude was told.
- **Main is the only writer** (`main/board/store.ts`, as `main/marks/store.ts`): one change at a time per project,
  written atomically (`writeOwn`) before it is told; the window and the tools go through it. Ids, `by` and `hidden` are
  main's and never taken from the window or a tool's arguments. The window may only send positions, sizes, text,
  names, frames and arrows of the person's cards, and pictures (checked as images, at most 2000 px and 3.75 MB, as
  `checkedImage` does).
- Nothing watches `board.json`. Before every write main compares the file on disk with what it last read or wrote; when
  they differ (a git pull) it takes the disk's board as the base, makes the change on top of it and tells the window. A
  pull is therefore seen at the next change, not at once. A file that cannot be read, or holds cards that are not whole,
  is kept aside, and the window says so (a notice with Dismiss, as it does for the marks file).
- A picture file is not deleted with its card, so undo brings it back whole: main sweeps the files of `pictures/` that
  no card names once for each project in a run, when it is first opened, before the window has anything of it to undo
  (the window forgets its undo when a workspace is opened or left). A file made in the last minute is left alone, and so
  is one that a card removed in this run names, or that a `board.json.corrupt-*` / `board.json.dropped-*` file kept aside
  names (a board that could not be read whole is not swept that run).
  Undo restores through main by id only: main keeps the last 200 cards and arrows removed in this run as they were, so
  a card comes back whole, with its author, and nothing of what the window says of it is taken. The person's cards
  cannot have been changed by Claude meanwhile, and a Claude card brought back is Claude's again. (My call.)

## Layouts and attachments

- One board per project holds the cards of every layout. A mark, view or build card names its layout, and
  double-click switches to it. (My call.)
- The chip in the composer holds the ids of what was attached; what each says is read when the prompt is sent, so an
  edit made after attaching goes too. A card removed meanwhile is left out and the chip says so. (My call.)

## Refs

`C<n>` becomes a ref like `M<n>`: the chat shows it as a chip (`RefChip`), the person and Claude can write it in
text, and clicking it in the chat shows the board with that card selected.

## Where it lives in the code

My calls, for the builder to refine:

- The window: `app/src/renderer/ui/projectBoard/` (the board, its cards, palette, minimap, arrows) and
  `state/board.ts`. The existing `ui/board/Board.tsx` is the ink pad; rename it (`ui/ink/InkPad.tsx`) so "board" means
  one thing in the code.
- Main: `app/src/main/board/` (store, file, the placing of new cards, the text form shared by the attachment and the
  tool). Shared types in `app/src/shared/board.ts`.
- A rule `.claude/rules/board.md` for these rules; `workspace-writes` gains `board/board.json` among what travels.
- The manual gets a Board section; what was never seen on a screen goes in its last section.

## Left to the builder

- The exact look of each card and the palette, within `tokens.css` and the mockups; the card sizes.
- The free-spot placement beyond "never over a card, near where it belongs".
- How many cards the minimap draws before it draws boxes only.
- Which key fits the board and which attaches the selection, so long as `keyClashes` passes.
- How the 3D view pauses while hidden.

## Tests that matter most (Review Focus seeds)

- A project with 200 marks opens a board of 200 auto cards without stalling, and panning renders no React work.
- A mark deleted while the board is open takes its card with it; a hidden card's mark that is reopened stays hidden.
- `add_card` cannot change, move or remove a card of the person's, whatever arguments it sends.
- An attachment of a frame with 10 pictures sends 6 and names the rest; one over 12 000 characters is cut with the
  sentence.
- A `board.json` from git whose pictures are missing draws placeholders and sends no picture.
- A prompt that fails to deliver leaves the new cards new.
