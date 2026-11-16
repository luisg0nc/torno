# A new project starts as a board (piece 3 of #173)

Piece 3 of the board redesign. Piece 1 (PR #181) gave the window its rail and the history in the chat; piece 2 (PR #182)
gave each project a board. This piece changes how a project begins: "New project" opens a page of slots shaped like the
board, the person fills it, and **Start** makes the project, lays what they gave out on its board, and asks Claude.

The design canvas holds the mockup `New A` (Luis's pick over `New B`).

## Why

The board is to be the centre of working with Claude in torno. A project should begin the way it goes on: what the
person brings (a description, photos, sketches, sizes, rules, files) is the first content of the board, not a form
that disappears after Create. The sizes the person already knows should reach Claude as given, so the first round of
questions (#111) asks only for what is missing.

## Goals

- "New project" opens a page of slots, laid out as in `New A`: the brief at the top, photos beside it, and a row of
  tiles to add the rest. Every slot that exists today stays: description, photos, sketches (doodles), bought parts
  (STEP), scans, other projects.
- Three new slots:
  - **Sizes I know**: each row a size with what it measures, its value and where it came from (measured, from a
    manual or a datasheet, a guess).
  - **Rules**: free text such as printer, material, minimum wall.
  - **Links and PDFs**: a link is a line of text with a URL and an optional note; a PDF is a file, copied into
    `reference/`.
- A sketch can be drawn over one of the draft's photos, as well as on the grid.
- The right pane keeps showing the first prompt as main writes it, updated as the slots fill.
- **Start** makes the project, writes its board with the person's cards grouped in frames, opens the project, and
  sends the first prompt. "Make it without starting Claude" does all but the last.
- Sizes become a card kind of every board: the person adds a size card on any project's board, and Claude can add
  one with `add_card` (a size it measured or assumed).

## Non-goals

- Fetching a link: torno never reads the web. Claude may, with its own tools, if the person asks.
- Reading a PDF's text in torno: the PDF is named to Claude by its file; Claude reads it with its own tools.
- Units other than millimetres and degrees on a size.
- A free canvas on the new-project page (Luis picked the page of slots over the real board, option B).
- Keeping a draft on disk between runs.

## Anti-goals

- Nothing is written in the workspace until Start (or "make it without starting Claude"), as today.
- The project folder is whole or not there, as today: the board file is made inside the hidden folder before the
  rename.
- Claude never changes the person's size cards (piece 2's ownership rule holds for the new kind).
- The first prompt must not grow without bound: sizes, rules and links are capped like notes are today.

## Constraints

- The workspace-write rule (`.claude/rules/workspace-writes.md`, first exception): `objects/create.ts` writes one new
  folder through `.<name>.torno-new-<random>` and a rename. The board file and its `.gitignore` files are written there
  too; nothing else changes about how the folder is made.
- Main is the only writer of `board.json`, and ids `C<n>` are main's (piece 2). The board written at create is
  written by main in `create.ts` from the draft the window sends, checked as every other part of the request is.
- Images for the agent: long edge at most 2000 px, default 1280; at most 6 pictures in the first prompt
  (`MOST_IMAGES`), as today.
- A PDF is copied like a STEP file: a plain file only (`readRegular`, no link, folder or pipe), signature `%PDF-`
  checked, at most 25 MB, named `reference/<safe name>.pdf` (the `stepFiles` rule for names), at most 6 per project.
- UI text is sentence case; numbers and refs in the monospace face; tokens only (`styles/onboard.css`).
- Tests never open a visible window and never run the real `claude`.

## Approaches

- **Reuse the draft and the create path, and give create a board (chosen).** The draft stays in the window
  (`state/onboard.ts`) and is sent whole at Start, as today; `create.ts` also writes `.torno/board/board.json` in the
  hidden folder. Nothing touches disk early, and the folder stays whole or absent.
- *Keep the draft as a hidden folder on disk from the first card.* Survives a restart, but breaks "nothing is written
  until you start" and needs a second sweep. Rejected.
- *Make the project first and fill its real board.* The board code would be reused directly, but an empty project
  would exist before Start, which the mockup's "nothing is written until you start" rules out. Rejected.

## Design

### The page

`ui/onboard/NewObject.tsx` is rebuilt as the page of slots of `New A`, on today's draft store. Top: the name field
and Discard. Then "What are we making?" with the description (the brief card) and the photo cards with their notes.
Then a row of tiles, each opening its slot: Sketch it, Bought parts, Scans, Other projects, Sizes I know, Links and
PDFs, Rules. A filled slot shows its cards in the page; an empty one stays a tile. Files can be dropped anywhere on the
page and an image pasted; `S` opens a sketch (a row of `shared/keys.ts` in the `newobject` scope, so the sheet of
keys and the manual list it). Right pane: `DraftPane` as today, and below it the
model and effort choice, **Start: make the project and ask Claude**, and "or make it without starting Claude".

### Sizes

A size is `{ what, value, unit, source }`:
- `what`: up to 200 characters ("battery tray").
- `value`: the text the person typed, kept as typed and also parsed: one number, `a × b` or `a × b × c`, with an
  optional `Ø` or `R` in front. A value that does not parse is kept as text and said as such.
- `unit`: `mm` (default) or `°`.
- `source`: one of `measured`, `from a manual or datasheet`, `a guess`, `from Claude` (the last only on Claude's
  cards), with an optional short note ("from the manual").

At most 40 sizes in a draft. On the board a size is a card of a new kind `size`, made by the person (`MADE_KINDS`) or
by Claude (`add_card` with `kind: "size"`). Its card shows the value in the monospace face, the unit, what it measures
and the source. The board text says it as `C7 · size · by the person: battery tray 186 × 128 mm (measured)`; the
`board` tool returns the parsed numbers in full. Claude's own size cards read "from Claude"; Claude cannot edit or
remove the person's.

### Rules and links

- Rules is one text, at most 4000 characters. At Start it becomes a text card named "Rules" in its own frame.
- A link is a URL (`http` or `https` only, at most 2000 characters) with an optional note. At Start each becomes a
  text card holding the URL and the note, in the frame "Links". torno never opens it; the card shows it as text, and
  opening it in the person's browser is a click (`shell.openExternal`, from main, `http`/`https` only).
- A PDF is a reference file. On the board it is a card that appears by itself, as photos are (`reference` kind; the
  existing "shown in its folder" action opens it). It is named in the brief and the first prompt by its path.

### Sketch over a photo

The ink pad (`ui/ink/InkPad.tsx`) takes an optional background picture: one of the draft's photos, scaled to fit the
1200 × 800 sheet, drawn under the ink. Done gives back the strokes and a PNG of the photo with the ink on it; that PNG
is the doodle, written to `reference/doodle-<n>.png` as today, and its caption says which photo it is drawn over.
Reopening it keeps the photo under it. With no photo chosen it is today's grid doodle.

### Start

1. The window sends the whole draft to `objects:create`, now with sizes, rules and links (checked by main as the rest
   are: caps, one-line notes, URL scheme, PDF paths offered by its dialog or dropped with a path).
2. `create.ts` writes the folder as today, plus the PDFs into `reference/`, and `.torno/board/board.json` with its
   `.gitignore` files (as piece 2's store writes them). The board holds:
   - a frame "Brief" with the brief card;
   - a frame "Photos" with the reference cards of the photos, and "Sketches" with the doodles;
   - a frame "Sizes" with a size card per size, by the person;
   - frames "Rules" and "Links" with their text cards;
   - frames "Bought parts" and "PDFs" with their reference cards;
   - scans and other projects are not cards here: the scans become cards by themselves once imported (piece 2), and
     another project is named in the brief and the prompt as today.
   The reference, brief and scan cards are main's own (`by: torno`), exactly as piece 2 would make them on first open,
   so opening the project changes nothing; the frames and the size, rules and link cards are the person's. Frames are
   laid out left to right in that order, wrapping, with the placement rules of piece 2.
3. The project opens. Its board is shown first, since it has cards (piece 2's rule).
4. "Start" then calls `objects:onboard` as today. "Make it without starting Claude" stops after 3.

### The first prompt

`onboardPrompt` gains three parts, in this order after the references: "Sizes the person gave" (one line each, with
the source), "Rules" (the text), "Links" (one per line, "torno does not open links; read one only if it helps"). The
numbered steps change: step 1 lists the sizes that decide fit or function and says which the person gave; step 2 asks
only for those with no source. The same rule goes in the `torno-model` skill's "Before the first model". The board's
context line of piece 2 is sent with this prompt too, so Claude knows these are now cards. The whole text stays within
the prompt caps; sizes and links beyond what fits are counted and named as on the board ("and 3 more sizes, on the
board").

### Where each thing lives after Start (Luis: board only)

`brief.md` stays as today: `# name`, the description, `## References`. Sizes, rules and links are not written into it;
they live on the board only (`board.json`, in git) and are said in the first prompt. Later prompts carry the board
line, and the `board` tool reads them. `OnboardDraft` and `PromptInput` gain `sizes`, `rules` and `links` for the
first prompt and its preview.

### Builder's questions, settled (my calls)

- **The first prompt and the board line.** The prompt text says the sizes, rules and links in full. Create seeds
  `told.json` with every card it wrote, so the board line sent with the first prompt counts them as cards, not new
  ("Board: 9 cards"), and nothing is said twice.
- **Notes on photo, doodle, STEP and PDF cards.** At create, main sets each reference card's `caption` to the note the
  person wrote. This is main writing its own card, which piece 2 allows (only `by` and `hidden` are never taken from
  the window). Doodles stay `reference` cards (files in `reference/`), as today, not `sketch` cards.
- **A sketch over a photo** keeps its strokes and its photo only while it is a draft. After Start it is a file in
  `reference/`, the same as a doodle today. Its brief line and card caption say "drawn over reference/photo-2.jpg".
- **Frames and later cards.** The cards create writes keep their `frame`, and reconcile leaves them there. Scans are
  imported after create and placed by piece 2's rules, outside the frames. Hiding works the same as for any card of
  main's own.
- **The size card in the file.** `Card` gains `size?: { what, value, unit, source, note? }`, set only on `kind: size`.
  The numbers are parsed from `value` by one shared function whenever they are told (`shared/size.ts`), and never
  stored twice. This is an added kind and field, so no version bump is needed: an older torno drops what it doesn't
  know, as piece 2's sanitiser does. The person edits a size card in place (`PersonChange` edit gains `size`, with undo
  like the rest). `add_card` gains an optional `size` argument; with it the card is a size card and `source` is
  `from Claude`.
- **Caps.** At most 40 sizes, each `what` up to 200 characters and `value` up to 60; rules up to 4000 characters; at
  most 20 links, each URL up to 2000 characters and a one-line note up to 300; at most 6 PDFs. All of it goes in the
  first prompt; within these caps it stays well under the description's 20 000 characters, so nothing is cut there.
- **Opening a link.** A new IPC, `board:openLink(objectId, cardId)`. Main reads that card from its own store, takes
  the first `http` or `https` URL in its text, and opens it with `shell.openExternal`. The window never sends a URL.
  It works for any text card holding a URL, not only those made at Start.
- **Keys.** `S` opens a sketch (a row `new.sketch` in the `newobject` scope; not heard in a field). Paste an image
  anywhere on the page with Ctrl+V. `N` is dropped: a page of slots has no "focused card" to note. The manual's key
  table is rewritten (`TORNO_README=write`).
- **PDFs: the dialog and drops.** These reuse the STEP path. `objects:pickPdf` is a dialog whose paths go into
  `Offered`, and a dropped PDF gets its path from `objects.pathOf`. Main copies it through `readRegular` and checks
  `%PDF-`. Its name comes from the same rule as `stepFiles`, generalised to take the ending.

### Leaving and discarding

As today: the draft lives in the window, is dropped when the workspace changes, and leaving the page with something in
it asks first. The closing question counts it.

## What the builder decides

- The look of the page within the tokens and the mockup, and the tile icons.
- The frame sizes and gaps at Start, within piece 2's placement rules.
- How the size value field parses as you type, as long as the stored text is what was typed.
- Where the size kind's code lives (a `shared/size.ts` beside `shared/board.ts` is fine).
- Test layout, following the existing `onboard`, `create` and `board` tests.
