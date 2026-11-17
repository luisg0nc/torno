---
paths:
  - "app/src/main/board/**"
  - "app/src/main/mcp/boardTools.ts"
  - "app/src/shared/board.ts"
  - "app/src/shared/board.test.ts"
  - "app/src/renderer/state/board.ts"
  - "app/src/renderer/state/board.test.ts"
  - "app/src/renderer/state/boardPictures.ts"
  - "app/src/renderer/state/boardPictures.test.ts"
  - "app/src/renderer/ui/projectBoard/**"
  - "app/src/renderer/ui/chat/boardLine.ts"
  - "app/src/renderer/ui/chat/boardLine.test.ts"
  - "app/src/renderer/styles/board.css"
  - "app/src/renderer/styles/tracings.css"
  - "app/src/renderer/state/tracings.ts"
  - "app/src/renderer/state/tracings.test.ts"
  - "app/src/renderer/ui/tracings/**"
  - "app/e2e/board.spec.ts"
---

# The board: storage, who owns what, and the text form

Written with the board (piece 2 of #173; the spec is `docs/superpowers/specs/2026-11-16-board-design.md`). Paths as in the other rules.

## Storage

- A project's board is `<object>/.torno/board/board.json`, `{ next, cards, arrows }`, and it **travels in git**, with
  `scene.json`, `marks.json`, `scans.json`, `profile.json` and `agent.json`. A card has `id`, `kind`, `x`, `y`, `w`, `h` (board
  units, 1 unit = 1 CSS px at 100 %), `by`, `frame?`, and by its kind `source` (`brief`, a `reference/` path, `M<n>`,
  `S<n>`, `h<n>`, a view's name, `params`, `checks`), `layout`, `text`, `name`, `picture`, `caption`, `camera`,
  `hidden`, `copy` (a build card's copy of what it shows). An arrow has `id`, `from`, `to`, `label?`, `by`. Ids are
  `C<n>` from one count for cards and arrows, per project, given by main, never reused.
  The ink-pad card is a **Doodle** in everything a person or Claude reads (the palette, the card's face, the key row, the board text,
  the tool descriptions); its stored `kind` stays `sketch`, as its key id `board.sketch`, so that "sketch" can mean the 3D one.
- A `size` card (`shared/size.ts`) holds `size: { what, value, unit, source, note? }`: `value` as typed, never parsed into the file
  (`parseSize` reads the numbers whenever they are told), `unit` `mm` or `°`, `source` one of `measured`, `from a manual or datasheet`,
  `a guess` for the person or `from Claude` for the agent alone (`checkSize`, which every door goes through, the file's
  `sanitiseCard` too: a size card without a whole size is dropped). Caps: `what` 200, `value` 60, `note` 300 on one line,
  40 sizes in a draft. Said as `C7 · size · by the person: battery tray 186 × 128 mm (measured)` and the numbers in full on the next line.
- The window makes and edits sizes: the palette's Size tool (`M`, `board.size`, in hand until one card is made) and a click on the ground open the form of `SizeEditor.tsx` (what it measures, the value as typed in the monospace face, `mm` or `°`, one of the person's three sources, a note: `maxLength` from the caps); Enter or Done keeps it when `checkSize` takes it and otherwise says what is missing, Esc and leaving the form keep a whole size and make nothing of a half-written one. A double click edits a size card of the person's (`opens.ts`; the agent's is left alone), and Ctrl+Z takes each back (`undo.ts` sends the size before as an `edit` with `size`). The card shows value and unit large, then what it measures, then the source and note.
- The card of a 3D sketch (a mark card whose mark is a sketch) shows its name, take (`shared/sketchText.ts`), comment, status and the picture of the sketch's own `picture` (`k-<12 hex>.png` in `.torno/notes/`, read through `notes.picture` as a view note's is, never `board/pictures/`); a sketch with no picture, or whose file is not on this computer, shows "picture not on this computer". A double click on the person's sketch card opens it in Draw (`{ does: 'sketching' }`); on Claude's it goes to the model. The board text of it is `describeMark`'s line, as a note's is.
- `<object>/.torno/board/pictures/` holds the picture and doodle files (`p-<12 hex>.png|jpg`) with a `.gitignore` of `*` of
  its own, written by whoever makes the folder (`pictures.ts`, as `views/` and `scans/` do). A picture may show the real
  world, so **pictures do not travel**: a board cloned without them shows a "picture not on this computer" placeholder
  and sends no picture. A file is not deleted with its card, so that undo brings the card back whole; **only files torno itself dropped are ever
  swept, never "whatever the board does not name"** (a branch switch brings a board that names other pictures, and the
  pictures are not in git): `BoardStore` lists a picture in `board/pictures/dropped.json` (`main/dropped.ts`, written by
  `board/dropped.ts` `dropPictures`, inside `changeWith`, once the board is written) when a change lets go of it (a card
  taken off, a doodle drawn on again). The files on that list are swept once for each project in a run, when it is first
  opened (`PictureSweep`, from `onObjectOpened`), before the window has any undo of it: the window forgets its undo stacks
  and cameras when a workspace is opened or left. A listed file goes only if no card names it now and nothing taken off the
  board in this run does, it is a plain file, and it was changed more than a minute ago; it then comes off the list, as does
  a name a card holds again or a file that is gone. An unlisted file is never deleted. The sweep is made in the board's turn.
  A board that could not be read whole is not swept that run, and on every run the pictures named in a `board.json.corrupt-*` or
  `board.json.dropped-*` file beside it are kept (read capped and never through a link, and stay listed): pictures are ignored by git and that
  file is the one place that still says which they are.
- `<object>/.torno/board/told.json` (ignored through `ensureIgnored`) holds what revision of each card the agent was told. It
  is never tracked, so the tracked file carries no counters. It is written only once a prompt that carried the board line
  has been delivered (the delivery point of `sentMarkIds`), so a prompt that fails to go leaves the cards new. The one other
  writer is `BoardStore.markAllTold`, for the first prompt of a new project (`objects:onboard`, just before the prompt
  goes): it keeps the hashes `boardLine` itself computes for every card and arrow, so that prompt's line says none is new.
- Everything of the board is written under `<object>/.torno/board/`, through `ownTorno(dir, 'board')` and
  `writeOwn` first: a link or a file in the place of a folder is refused and nothing is written where it leads. The board
  adds no write exception to `workspace-writes`.
- **Nothing watches `board.json`.** Before every write main compares the file on disk with the text it last read or wrote; when
  they differ (a git pull) it takes the disk's board as the base, makes the change on top of it, and tells the window. A pull
  is seen at the next change, not at once. A file that is not a plain file, cannot be read, or holds cards that are not whole is
  kept aside or left, and `board:problem` says so to the window (a notice with Dismiss, as `marks:problem`). A card of main's own
  whose source is gone goes at the next reconcile; a pinned card never does.

## Who may change what

- **Main is the only writer** (`board/store.ts`, as `marks/store.ts`): one change at a time per project, written atomically
  before it is told. The window (`board:*`, `PersonChange`) and the agent's tools (`add_card`, `AgentChange`) go through it.
- `restore` (the window's undo of a removal) takes ids only: main keeps the cards and arrows it took off in this run, the last
  200 per project, as they were, and puts back what the ids name. Nothing of a card comes from the window.
- `id`, `by` and `hidden` are main's. They are never taken from the window or from a tool's arguments: a card the window adds is
  the person's whatever it says, and the agent's is the agent's. The window may send positions, sizes, text, names, frames and
  arrows of the person's cards, pictures (checked as images, at most 2000 px and 3.75 MB, as `checkedImage` does; the window
  scales a larger one down first, `prepareImage`), and the name of a new drawing for a doodle of its own.
- A card is the person's, the agent's or torno's (`by`). **The agent never moves, edits, hides or removes a card of the
  person's or of torno's own**, whatever `add_card` is given; the answer names the owner and the file is untouched. It may
  put a card in a frame of the person's (that changes the new card, not the frame), and when the frame has no free spot the
  card goes just below it, outside: a frame of the person's is never grown or moved. Claude's cards are never new to Claude.
- A card that appeared by itself (the brief, the files of `reference/`, marks, scans) has a place when main gives it one (a free
  spot, the first time the board is read after it appears), and removing it only hides it (`hidden: true`): the mark, scan or
  photo is untouched, and "Hidden cards" brings it back. When the thing itself is gone, so is its card. Pinned cards are the
  person's choice and stay when their source is missing (a build card says "build not on this computer").
- **A round of a review is a frame of torno's own** (`kind: 'frame'`, `by: 'torno'`, `source: 'R1'`, `reconcile` with `Found.rounds`, which `follow.ts` makes from the rounds and marks of `marks.json`, `foundRounds`). It is made with the round's first item, in a free spot, `CARD_SIZE.round` (three mark cards across, two down; made for the items it has at once), and named `Review of h41 · 3 − · 2 +` (`reviewName`), renamed as the counts change; the name is main's, never the person's or the agent's. A mark card goes into its round's frame only when it is **placed for the first time** (the frame grows by a row when it is full and nothing is in the way, else the card is placed outside it) or when its `frame` is the frame of the round the item was **carried** from (`from`; it moves to a free spot of the new frame). A card in any other frame, the person's included, and one the person took out, stays where it is. Removing the frame hides it as any card of main's own; it stays hidden while the round has items, takes no new card, and goes when the round has none. The agent's `add_card` may name it (by name or by id; a hidden one is not there) and the frame is not changed. A mark card says its intent in its chip (`− M8`, `+ M8`), that it is `in review, not sent` while held, and `OK in h42` or `Still wrong` once judged (`faces.ts`, `Facts.rounds`).
- The files of `reference/` that have a card are the pictures `create.ts` names and the plain files ending `.step`, `.stp` or
  `.pdf` (`listBoardReferences`; `listReferences` stays the chat's own list of pictures). A STEP or PDF card shows its name and
  kind, is said to the agent as `reference/608zz.step (a bought part's STEP)` or `(a PDF: read it with your own tools)` with its
  caption, and a double click shows it in its folder (`board:open`). A text card whose text holds an `http` or `https` address
  shows it as a link (without the sentence's own punctuation at its end, `.,;:!?`, and without a `)` that closes no `(` of the address): `board:openLink(objectId, cardId)` reads the card in main, takes `firstLink` of its text and has the system open
  it (`deps.openExternal`, a stand-in under test); no address comes from the window, and nothing else is opened.
- Pinning is asked of main by name and checked there: a build must be one the history keeps (it is starred, so never pruned,
  and its thumb is copied into `pictures/`; removing the card leaves the star), a view must be among the saved views (the
  card keeps its layout), the Params and the checks are on a board once each. A local build with the card's id and
  another `sources` hash is not the same build.
- The board is never edited from outside `board.json`'s own owners: `brief.md` is shown read-only and opened in the person's
  editor (`board:open`, main's own path, never the window's).

## The text form

- There is **one text form** of a board, `board/text.ts` (`boardText`), shared by what goes with a prompt and what the `board` tool
  answers: the frames by name, then their cards in reading order (left to right, top to bottom; tops within half a card's
  height are one row), each by id with what it says (a text card's text, a mark's ref and note, a view note's card by the note's line, `describeMark`: its comment, how many labels and references, the build its picture is of, a build's id and line, the
  Params' values, and so on), then the arrows (`C3 → C7: like this`). Hidden cards are left out.
- **Every prompt** carries one line (`boardLine`, in `contextFor`, inside `CONTEXT_LIMIT`): how many cards there are, how many are
  new, frames by name, and "Read it with `board`". It never carries the board. A card is new when it was added or what it
  says changed (a text, a caption, a name, an arrow's word, the content of a pinned card's source), not when it was moved,
  resized or put in a frame (`saysHash`). A reference card is told with its caption after its file name, a photo or doodle as a STEP or a PDF (`referenceText`), and the card shows it. The window shows it under the prompt as "board: 12 cards, 2 new".
- **An attachment** goes with the prompt the person sends, not in the context (`attach.ts`, read at the moment of sending, so an
  edit made since goes too; a card removed meanwhile is left out and named). Pictures go as images after the text: at most
  6, each at most 1280 px on the long edge (main scales them, `scalePicture`); past 6 they are named and left for the tool.
  A photo of `reference/` goes as a picture too (it counts among the 6). A picture is checked as an image once scaled (a PNG
  stays a PNG, anything else goes as a JPEG), and one that fails is named, not sent. The text is at most 12 000 characters
  with the head and the notes, and past that it ends with the sentence that says to read the rest with `board`.
  The ids sent are card ids only (never an arrow's); the line under the prompt says what went ("board: Latch, 3 cards, 1
  arrow").
- A mark's card for a view note shows the picture with the ink (`notes.picture(…, 'ink')` through `useNotePicture`, not the board's `pictures/`: it is of this computer, "picture not on this computer" otherwise) and its comment and status (`faces.ts` `markFace`); the card appears by itself as any mark's does (`follow.ts`), and is never news to the agent, as no mark card is.
- `C<n>` is a ref like `M<n>` (`refsIn`): the chat shows it as a chip (`RefChip`), and a click shows the board with that card
  selected. One the board does not have, or has hidden, is only text.

## The window

- The board is page elements in a layer moved by a CSS transform set directly on the element; **no per-frame state in React**:
  panning and zooming never draw the cards again (`__tornoBoardRenders` counts it under test). The 3D view stays mounted and
  stops drawing while the board is shown.
- What a double click on a card does is `ui/projectBoard/opens.ts`, a table held by its test: the brief opens in the person's
  editor, a photo opens large, a mark, scan, build, view and the Params go to the model (a view note's card opens its sheet instead: `doubleClickOf(card, mark)`, `carryOut`'s `note`, which shows the model first), a doodle opens the ink pad on its
  drawing, a text edits and a frame renames (the person's only). The "Pin to board" buttons ask main (`pinToBoard`), which
  decides.

## The third view: Tracing (`ui/tracings/`, `state/tracings.ts`)

- The main area's switch is **Board | Model | Tracing**: `Shown` is `'board' | 'model' | 'tracing'`, remembered per project as the
  other two are. `board.swap` (`Ctrl+Tab`) goes board, model, tracing, board (`swapped`), and passes over Tracing in a project with
  none (`hasTracing`); a project left on a tracing that its first read finds gone opens on the model, the choice kept. Whatever is
  not the model covers it: the 3D view stays mounted, stops drawing (`boardShown` is "not the model") and the review and set keys
  are not heard. `viewKey` stops the view's keys in the tracing as in the board.
- `state/tracings.ts` (`useTracings`) holds what main last said of `tracings.json`, which tracing is open, the kernel's outline of each
  one asked for (`tracings:outline`, `tracings:changed`) and `building`; it tells main which tracing is shown (`tracings:shown`, from
  the open one while the view is on a tracing). **Everything the window changes goes through main** (`tracingActions`: `make`,
  `rename`, `setParts`, `remove` with `undoRemove` by `restore`); a refusal is said in main's words (`refused`). A tracing on a face
  waits for one flat face in the selection (`facePicked`) with the model shown, and main refuses a curved one.
- The sheet is `ui/tracings/Sheet.ts`, a plain class like the board's camera: a transform set directly on the SVG layer, in
  millimetres of the plane from its origin, `y` down the screen (what `tracingSvg(…, { forScreen: true })` draws); `1:1` is one CSS
  millimetre for a millimetre (`PX_PER_MM`). **No per-frame state in React**: pan, zoom, the pointer readout, the scale bar and the zoom
  text are written on elements, and the layer counts its renders under test (`__tornoTracingRenders`). Lines are
  `vector-effect: non-scaling-stroke` in `styles/tracings.css`; the drawing's colours are tokens only.
- The sheet's mm grid is not in the drawing: `Grid` (`TracingView.tsx`) is an SVG of two tilings and the `u = 0`, `v = 0` lines over the
  whole stage, painted in pixels by `gridPaint.ts` from where the sheet stands (1 mm from 3 px a millimetre, 10 mm, 100 mm when far out),
  so it covers what is seen however the sheet is moved; `tracingSvg`'s `grid` option is for a file and the view does not pass it.
- Layers are `LayerRows` in the panel: colour, name, shape count, `by Claude`, an eye for any layer, Remove and the ring "trace into" on
  the person's own only (`Layer.by`). `tracingActions`: `addLayer` (never replaces: the window checks the name is free, case apart, and
  main refuses one that is another's), `hideLayer`, `removeLayer` (the window refuses Claude's) with `undoRemoveLayer` (`{ restore: id }`: the store keeps the
  last 20 layers removed in this run, whole, and puts one back with the number it had, which offsets name; refused when the name was taken meanwhile), `addShape`. A finished shape is one `tracings:layer` `{ edit, shapes: [...own, new] }`;
  shapes and layer changes are **queued** so that each is built on the layer as the one before left it. `traceTarget` is the layer
  traced into: the one ringed when it is the person's and there, else their last, never Claude's.
- The layers' colours are the `--layer-*` tokens (`shared/tracings.ts` `LAYER_COLOURS`): the window draws a layer by its class
  (`tr-layer-<colour>` sets `color`, shapes use `currentColor`); a file takes `LAYER_INKS`, which `contrast.test.ts` holds to the light
  tokens. None is red or green.
- The tools: `Palette.tsx` (Select, Trace live; Pin, Ink, Measure, Should be here wait), `tool` and `trace` in the store, keys of scope
  `tracing`. **Trace** is `traceTool.ts` (a class, no DOM: `click`, `end`, `back`, `cancel`, `text`, `elements` for the draft) and
  `snap.ts` (`snapAt`: 10 px, `Ctrl` is none, corners then centres then plain then projected vertices at the same place). What is under
  way is drawn on `.tr-draft`, written on the element from the pointer, never state; only a label's field is React state. With Trace a
  left press that moves under 4 px is a click, a longer one pans. A free click is kept to 1e-4 mm, a snapped one in full.
