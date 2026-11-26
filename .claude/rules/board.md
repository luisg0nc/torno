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
  - "app/src/shared/brief.ts"
  - "app/src/shared/brief.test.ts"
  - "app/src/renderer/ui/brief/**"
  - "app/src/renderer/ui/chat/boardLine.ts"
  - "app/src/renderer/ui/chat/boardLine.test.ts"
  - "app/src/renderer/styles/brief.css"
  - "app/e2e/brief.spec.ts"
---

# The brief: the board file, who owns what, the text form and the page

Written with the board (piece 2 of #173; the spec is `docs/superpowers/specs/2026-11-16-board-design.md`) and changed by #261: the canvas became the **Brief page**
(direction A of #250). The file is still the board's, `board.json`, and `board` and `add_card` still read and change it; a person reads it as the brief.
Paths as in the other rules.

## Storage

- A project's board is `<object>/.torno/board/board.json`, `{ tidied?, next, cards, arrows }`, and it **travels in git**, with
  `scene.json`, `marks.json`, `scans.json`, `profile.json` and `agent.json`. A card has `id`, `kind`, `x`, `y`, `w`, `h` (board
  units, 1 unit = 1 CSS px at 100 %), `by`, `frame?`, and by its kind `source` (`brief`, a `reference/` path, `M<n>`,
  `S<n>`, `h<n>`, a view's name, `params`, `checks`), `layout`, `text`, `name`, `picture`, `caption`, `camera`,
  `hidden`, `copy` (a build card's copy of what it shows). An arrow has `id`, `from`, `to`, `label?`, `by`. Ids are
  `C<n>` from one count for cards and arrows, per project, given by main, never reused.
- **When and in which prompt (#336).** A card has `at` (ISO, made or last changed: `applyPerson` stamps an add and an edit that changes
  something, `applyAgent` an add and an edit of its words), `turn` (`CardTurn`, `{ prompt, conversation? }`: a build's turn without its words,
  which stay in the chat log that does not travel) on the agent's cards, from `Sessions.turnNow` (the turn under way once its
  `UserPromptSubmit` was answered; none between turns) passed by `index.ts` to `BoardStore.agent(objectId, change, turn)`, and `was`
  (`CardWas[]`, oldest first, the last `MAX_WAS`): what an agent's card said before each edit that changed its words, with that version's
  `turn` and `at`. All three are main's: `applyPerson` builds a card from named fields, `applyAgent` takes none from `AgentChange`, and
  `sanitiseCard` keeps only whole ones (`turnOf`, `timeOf`, `wasOf` in `file.ts`). The clock is `deps.now` (tests). `board` says an
  agent's card's prompt after its author (`by you, prompt 11`, `promptOf` in `text.ts`) from `deps.board.prompts` (`listPrompts`, by
  prompt id); a prompt whose log is not on this computer is not numbered.
- The ink-pad card is a **Doodle** in everything a person or Claude reads (the palette, the card's face, the key row, the board text,
  the tool descriptions); its stored `kind` stays `sketch`, as its key id `board.sketch`, so that "sketch" can mean the 3D one.
- A `size` card (`shared/size.ts`) holds `size: { what, value, unit, source, note? }`: `value` as typed, never parsed into the file
  (`parseSize` reads the numbers whenever they are told), `unit` `mm` or `°`, `source` one of `measured`, `from a manual or datasheet`,
  `a guess` for the person or `from Claude` for the agent alone (`checkSize`, which every door goes through, the file's
  `sanitiseCard` too: a size card without a whole size is dropped). Caps: `what` 200, `value` 60, `note` 300 on one line,
  40 sizes in a draft. Said as `C7 · size · by the person: battery tray 186 × 128 mm (measured)` and the numbers in full on the next line.
- The page makes and edits sizes in the ledger (`ui/brief/SizeForm.tsx`: what it measures, the value as typed in the monospace face, `mm` or `°`, one of the person's three sources, a note, `maxLength` from the caps). Enter or Add keeps it when `checkSize` takes it and otherwise says what is missing; Esc and Cancel leave it as it was. A size of the person's has Edit and Remove; Claude's is never editable by the person, only removable.
- The cards of a mark, a scan, a tracing, a build, a view, the Params and the checks, a frame's outline and an arrow are still in the file (the old copies of #248, and what was pinned before #256), and **the page draws none of them**: nothing is lost from an existing board, and nothing is told of them to the person. `board` still tells Claude the cards that are visible, arrows included.
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
- `<object>/.torno/board/seen.json` (#340, ignored through `ensureIgnored`, never tracked) is `Seen`, `{ at, cards }`: a hash (`seenHash`, FNV of the
  kind, words, caption, picture, size without its tie, and `by`) of each card of the agent's when the person last had the Brief on screen.
  Main writes it (`BoardStore.markSeen`, `board:markSeen`, from its own board, never ids or hashes from the window) and reads it (`seen`,
  `board:seen`, null when there is none or it cannot be read). The page reads it once when it mounts (it is mounted only while the Brief is
  shown, keyed by the project); with none it marks the board seen at once, so a project's first Brief has nothing new; it marks it seen again when
  it unmounts (leaving the Brief or the project) and on "Mark as seen". New is `freshCards`: an agent card absent from it or with another hash.
  The page shows them in the accent: the sticky `.brief-band` (`promptsSaid`), `data-fresh` on their nodes (filled accent node, "new" pill) and
  cards (a wash), and folds the nodes with nothing new into `.brief-fold` ("Seen before: …", Show them).
- Everything of the board is written under `<object>/.torno/board/`, through `ownTorno(dir, 'board')` and
  `writeOwn` first: a link or a file in the place of a folder is refused and nothing is written where it leads. The board
  adds no write exception to `workspace-writes`.
- **While a project is open, `watchBrief` (`board/watch.ts`, started by `onObjectOpened`, stopped by `onWorkspaceClosed`) watches
  three things and nothing else** (its walk goes into no other folder): `reference/`, `brief.md` and `.torno/board/board.json`, one
  report per burst (300 ms). A change of the first two runs `followBoard`; a change of `board.json` runs `BoardStore.refresh`
  first. Before every write, and on every `refresh`, main compares the file on disk with the text it last read or wrote
  (`takeDisk`); when they differ (a git pull) it takes the disk's board, and the window is told, by a change of nobody's. Main's
  own write compares equal and says nothing, so the watch does not loop. A file that is not a plain file, cannot be read, or holds cards that are not whole is
  kept aside or left, and `board:problem` says so to the window (a notice with Dismiss, as `marks:problem`; `aside: true` when a copy
  is kept). The copy kept aside (`asides`, the name main made, never one from the window) is dealt with by `board:useAside`, which
  needs it to read whole (`readBoardFile` drops none), and **loses nothing unasked**: when the board holds cards that are not
  `by: 'torno'` and `replace` is not true it changes nothing and answers `{ made }`, which the notice turns into "Replace them with the copy?"
  (Replace / Keep this one); replaced, the board becomes the copy (ids on above both), the copy is deleted and the window told. `board:undoAside`
  ("Brief put back. Undo", ten seconds) writes the board as it was and the copy back under its name, and is refused once the brief has changed
  since (`putBack`, in memory, one per project), and `board:letGoAside`, which deletes it (a link is never followed or deleted through): the pictures it named are then
  no longer kept, and the sweep of a later run takes the ones that are listed. Dismiss leaves the copy. A card of main's own
  whose source is gone goes at the next reconcile; a pinned card never does.

## Who may change what

- **Main is the only writer** (`board/store.ts`, as `marks/store.ts`): one change at a time per project, written atomically
  before it is told. The window (`board:*`, `PersonChange`) and the agent's tools (`add_card`, `AgentChange`) go through it.
- `restore` (the window's undo of a removal) takes ids only: main keeps the cards and arrows it took off in this run, the last
  200 per project, as they were, and puts back what the ids name. Nothing of a card comes from the window.
- `id`, `by` and `hidden` are main's. They are never taken from the window or from a tool's arguments: a card the window adds is
  the person's whatever it says, and the agent's is the agent's. The page sends the text of notes and rules, sizes, and pictures (checked as images, at most 2000 px and 3.75 MB, as `checkedImage` does; the window
  scales a larger one down first, `prepareImage`). It sends no place, size, frame or arrow: a new card goes below the lowest card (`placeBelow`), and a rule goes in the frame named Rules, which `addRule` makes when there is none.
- **Make it yours (#339).** `PersonChange` `{ op: 'adopt', id }`: a `text` or `size` card of the agent's becomes `by: 'person'` with
  `from: { by: 'agent', turn?, at?, since }` (the turn and time it was written, and when it was made the person's), `turn` taken off, `at` now; `was` stays. Anything else is refused.
  `from` is main's and only on the person's cards (`sanitiseCard`); a size made the person's keeps `from Claude` as its source (the file reads
  it with `checkSize(…, 'agent')` when `from` says so) until the person's edit, which must name one of their sources. `saysHash` counts `from`, so
  the adoption is news once; `board` says `by the person (it was yours, prompt 13: theirs now, not yours to change)`. On the page, "Make it yours"
  (`adoptCard`) points away and opens the card's form in place in the spine (`TextForm` / `SizeForm` with `note`; the size form shows
  `from Claude` as a disabled choice that must be changed); the card keeps its node (`turnOfCard` reads `from.turn`) with the red edge.
- A card is the person's, the agent's or torno's (`by`). **The agent never moves, edits, hides or removes a card of the
  person's or of torno's own**, whatever `add_card` is given; the answer names the owner and the file is untouched. It may
  put a card in a frame of the person's (that changes the new card, not the frame), and when the frame has no free spot the
  card goes just below it, outside: a frame of the person's is never grown or moved. Claude's cards are never new to Claude.
- **Only the brief and the files of `reference/` appear by themselves** (`AUTO_KINDS` still names `mark`, `scan` and `tracing` for the old cards below, #248): `reconcile` (`board/sources.ts`, `Found`: `brief`,
  `references`, and the ids of marks, scans and tracings) gives each a place when main gives it one (a free spot, the first time the board is
  read after it appears), and removing it only hides it (`hidden: true`): the photo is untouched, and the page lists it under "Put away" with Show (`unhide`). When the
  thing itself is gone, so is its card. **A mark, a scan, a tracing and a review round get no card and no frame, ever**: placing a mark,
  importing a scan, making a tracing or starting a review adds nothing, and the board line does not change with them. Pinned cards are the
  person's choice and stay when their source is missing (a build card says "build not on this computer").
- **The old copies** (#248): a board written before that holds `by: 'torno'` cards of kind `mark`, `scan` and `tracing`, and frames whose `source` is
  a round (`ROUND_SOURCE`, `R1`). The first `reconcile` that finds any, when the file has no `tidied`, hides them once and sets `tidied: true`
  (the file's only flag, kept by `readBoardFile`; a board with none is left as it is and no file is written): a round's frame, and a copy that has no
  `frame` or is in a frame of torno's own, are hidden; **a copy in a frame the person made stays** (that is all "placed" can mean: a move that did not
  frame it leaves no trace). Nothing is removed (no card of an existing board is lost) and it is never done again, so a card brought back from
  "Hidden cards" stays. A copy still goes when its mark, scan or tracing does (hidden or not), and the person's and the agent's cards of those kinds are never touched.
  A round's frame is not removed with its round any more: it stays hidden. The pinned build, Params and checks cards are not part of this and are
  still pinned from their buttons.
- The files of `reference/` that have a card are the pictures `create.ts` names and the plain files ending `.step`, `.stp` or
  `.pdf` (`listBoardReferences`; `listReferences` stays the chat's own list of pictures). A STEP or PDF card shows its name and
  kind, is said to the agent as `reference/608zz.step (a bought part's STEP)` or `(a PDF: read it with your own tools)` with its
  caption, and a double click shows it in its folder (`board:open`). A text card whose text holds an `http` or `https` address
  shows it as a link (without the sentence's own punctuation at its end, `.,;:!?`, and without a `)` that closes no `(` of the address): `board:openLink(objectId, cardId)` reads the card in main, takes `firstLink` of its text and has the system open
  it (`deps.openExternal`, a stand-in under test); no address comes from the window, and nothing else is opened.
- Pinning is asked of main by name and checked there (the window only asks for a view now, #256): a build must be one the history keeps (it is starred, so never pruned,
  and its thumb is copied into `pictures/`; removing the card leaves the star), a view must be among the saved views (the
  card keeps its layout), the Params and the checks are on a board once each. A local build with the card's id and
  another `sources` hash is not the same build.
- **`brief.md` is the person's alone (#337).** Claude writes the brief as cards: the system prompt (`prompt.ts`, one line on the board, held to the
  budget of `turncost.test.ts`), the torno-model skill ("Writing down the brief") and `add_card`'s description say so, one card per topic
  beginning with its name, its own card of a topic changed (`card`, `text`) rather than another added. `refusalOf` (`sessions/reach.ts`) refuses `Write`, `Edit`, `MultiEdit` of `<project>/brief.md`
  (real paths) with `BRIEF_REFUSAL`, which names `add_card`; `opts.brief` lets the one turn of #341 through.
- **Old briefs (#341, Luis's pick: automatic).** `claudeSections` (`shared/brief.ts`) finds the sections Claude wrote into `brief.md` before:
  level-two headings that begin Answers, Changes, Decisions, Assumptions, Settled or Clarifications and then a bracketed date (`CLAUDES_HEADING`:
  how Claude wrote them; the person's own `## Assumptions` without a date is theirs and is never asked to be moved); `briefWords` leaves
  them out of the person's words, and the page shows them in `.brief-old` under "Claude wrote these into brief.md before". `boardLine`
  keeps `told['brief.md']`, a hash of the file's text, whenever it has such sections, and while that differs from what was told gives `move`
  (`briefMoveText`: put them into cards with `add_card`, one per topic, then take them out of `brief.md`, in this turn only); `index.ts`
  passes it to `contextFor` as `briefMove`, after the brief, in `BRIEF_MOVE_LIMIT`, and the context says `briefMove: true`. Kept with
  the rest of `told.json` once the prompt is delivered, so it is asked once for a text of the file. The manager sets `turn.briefOpen`
  for that turn, and the `PreToolUse` refusal lets an `Edit`/`Write` of `brief.md` through while it is set (`refusalOf(…, { brief })`);
  the next `UserPromptSubmit` begins a turn without it.
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
  resized or put in a frame (`saysHash`). A reference card is told with its caption after its file name, a photo or doodle as a STEP or a PDF (`referenceText`), and the card shows it. The window shows it under the prompt as "brief: 12 cards, 2 new".
- **The brief** is a part of the board's text form that goes to every new conversation (`briefOf`, `agent-prompt`): the size cards and the text
  cards of the frame named Rules, in a line after the board's. Its hash is kept in `told.json` under `brief`, as the cards' are.
- **An attachment** goes with the prompt the person sends, not in the context (`attach.ts`, read at the moment of sending, so an
  edit made since goes too; a card removed meanwhile is left out and named). Pictures go as images after the text: at most
  6, each at most 1280 px on the long edge (main scales them, `scalePicture`); past 6 they are named and left for the tool.
  A photo of `reference/` goes as a picture too (it counts among the 6). A picture is checked as an image once scaled (a PNG
  stays a PNG, anything else goes as a JPEG), and one that fails is named, not sent. The text is at most 12 000 characters
  with the head and the notes, and past that it ends with the sentence that says to read the rest with `board`.
  The ids sent are card ids only (never an arrow's); the line under the prompt says what went ("board: Latch, 3 cards, 1
  arrow").
- A mark's card for a view note shows the picture with the ink (`notes.picture(…, 'ink')` through `useNotePicture`, not the board's `pictures/`: it is of this computer, "picture not on this computer" otherwise) and its comment and status (`faces.ts` `markFace`); an old one of torno's own is told as any mark card is, and is never news to the agent (no new one is made, #248; `noteCardSize` went with them).
- `C<n>` is a ref like `M<n>` (`refsIn`): the chat shows it as a chip (`RefChip`), and a click shows the board with that card
  selected. One the board does not have, or has hidden, is only text.

## The page

- **Sections** (`shared/brief.ts` `briefSections`, from the visible cards in reading order), in two voices (#338, direction C of #331; the look is the mockup `design/mockups/brief-2/c-voices.html`): *In your words* (`aria-label`, `.brief-yours`: the `brief` card's `brief.md` read through `board:brief`, set by `ui/brief/BriefWords.tsx` from `briefWords`, which leaves out the `# name` line and `## References`; parsed by the chat's `parseMarkdown`, drawn by its own hand with numbers in Martian Mono only when they stand alone (`ESP32` stays whole); an address is `.brief-weblink` with `linkLabel`'s label and host, opened by `board:openLink(objectId, briefCardId, nth)`, `nth` its place among `linksIn` of the file, which main reads again: no address goes from the window; `firstLink` drops the markdown that closes round an address (`**`, `_`, `|`, `>`, a backtick) so both read the same address, and one the page cannot find among them is shown as plain words, never opened as another), the *pictures* not by Claude as tiles beside it, the *references* (STEP and PDF) as lines with "Show in folder", the person's notes (`Your notes`, `NoteRow`: "Added on this page" with `at`) and "Add a note"; *What Claude wrote down* (`ui/brief/Spine.tsx`, `briefSpine`: Claude's cards, `claudeWrote` (by the agent, or `from` it), of kinds text, size, picture and sketch, in the node of `turnOfCard`, each `was` struck in the node of its own turn with the number of the prompt that changed it; the nodes by time, the one with no prompt first; the prompts from `chat:prompts` (`usePrompts`, asked again when a card names another prompt)); the *sizes* ledger and the *rules* (text cards in the frame named Rules, any case, the one `briefOf` reads), each row with `Hand` (`handOf`: "You", "Claude, prompt 13", "Yours, from prompt 13"). What main made and the person put away (the brief, a photo) is listed under "Put away" with Show.
- **The spine**: a node is "Prompt N", its time (`whenSaid`), "In the chat", and `.brief-asked` ("You:" and the prompt's words, two lines, the red edge); a card is `.brief-cn`, the green edge (red once `by: 'person'`), its topic in bold when its text starts with one (`topicOf`). A click on it, or on its id (`.brief-cn-id`, a button with `aria-expanded`: the keyboard's way, so the spine reads no key of its own), points at it (one at a time; the node gets `data-open` and its quote is shown whole): "It replaced …", **Show prompt N in the chat** (`actions.showPrompt(id, conversation)`, the store's `promptShown`: the dock opens, Prompts only is put away, and `ChatPane` reads the conversation in if it is an earlier one, scrolls to `.chat-group[data-id]` and sets `data-shown` for four seconds; `StartChat` does the same in the last conversation it shows; each acts only on a `seq` newer than the one there was when it mounted, so a pane started later does not do an old ask again), and Remove. A terminal's prompt (`t-…`) has no chat to show. Red and green are edges and dots only, never the colour of words; the accent is for what is new (#340).
- **The ledger row** is the value large in the monospace face (`sizeValue`: the numbers read from it, as typed when it has none), what it measures, where it came from (`sizeSource`: "from a datasheet", the note after) and a column "Against the build on show". A size nothing checks, and every rule, reads **"nothing checks this"** on a dashed ground with an empty gauge: a gap, not a failure. A rule reads "a judgement: no measure says it". The head says `7 sizes, 7 not checked`.
- **Who may change what on it:** Edit and Remove show when a row is pointed at or has the keyboard; the person edits only their own cards (a size in its form, a note or rule in a field: Enter keeps, Shift+Enter is a new line, Esc leaves), Claude's keep the green edge and are only removable (on the spine, by pointing at them). A removal says "Removed … Undo" for ten seconds (`restore`). "Add" makes a size, rule, note or picture; a picture is chosen or dropped on the page, scaled by the window first. There is no doodle tool, no frame, no arrow, no selection, no drag, no zoom and no undo of edits any more.
- **Send with the next prompt** puts the whole brief with it (`attachAll`); a chosen set is gone with the selection. `Ctrl+Z` and the tool keys went with the canvas.
- A ref `C7` in the chat shows the brief with that card lit and scrolled to (`boardActions.reveal`).
- What a card's double click did is gone (`opens.ts`): the brief and a STEP or PDF have their own buttons.

## Ties: a size checked by a dimension (#262)

- `size.tie` (`SizeTie`: `{ mark: 'M9', tolerance }`, in the size's unit) is on the size card in `board.json`, main's alone: `checkSize` builds a fresh fact so a window's or a tool's `size` carries none, `sanitiseCard` keeps a whole one, and a person's edit of the size keeps it. The dimension holds what the size sets: `expected`, `tolerance` and `expectedFrom` (`C7`, `MAIN_ONLY_KEYS`, kept only with an expectation). `main/board/ties.ts` (`Ties`) is the one writer of both: `tie` writes the card, then `reconcile` makes the marks say what the cards say; `untie`; `reconcile` is idempotent (run after a person's edit, removal or restore, after the agent removes a card, and when the window reads the board, so a pull is seen). A dimension whose size is gone, untied or tied elsewhere gives up its expectation; a size edited so that no dimension can hold to it (`tieRefusal`: not one number, another unit, `Ø` or `R` against another kind, resolved) is untied; a tie to a dimension that is not there is left and read as gone.
- `MarkStore.update` refuses `expected` and `tolerance` on a dimension that has `expectedFrom`, unless the call is the tie's (`brief`); the Marks row shows them as "from the brief" and not as fields. One dimension holds one size (a second is refused naming the first). The agent ties only dimensions of its own (`author: 'agent'`) and unties only those; the person any.
- The tolerance comes from the source (`shared/ties.ts` `TOLERANCE_OF_SOURCE`: measured 0.5, datasheet 0.2, guess 2, Claude's 0.5) and is a field while tying. The page reads a tied size with `tieReading` (the dimension's `shownDimension` on the build on show: holds, fails, not measured, or gone) and the same `Gauge`; the head is `sizesTold`. `would hold` is `wouldSay`. The saying to the agent: `saySize` adds `M9 checks it, ± 0.5`, `describeMark` adds `from the brief C7`. The chip says `brief 96.5` (`briefChip`, `labelValue`). `board:tie` (`window.torno.board.tie`) is the window's door; `add_card` `tie` / `untie` the agent's.

## Tying by measuring (#264)

- "Measure it on the part" (the tie panel) is `tyingActions.begin` (`renderer/state/tying.ts`, `tyingStore`: `{ objectId, cardId, tolerance }`, window only, nothing is written): it shows the model, puts Measure in hand, clears the held measurement and turns the route card's head (`ui/card/TyingHead.tsx`, `Head` in `App`) into "Tying 28.6 mm" with the tolerance field (the source's, `tieToleranceFor`) and Cancel. The Measure tag's button reads "Keep and tie to the size" while tying and Enter does the same: both are `keepHeldAndTie`, which refuses before keeping a measurement the size cannot hold to (`heldRefusal`, `tieRefusal` against the held kind) and otherwise keeps (`keepHeld`) and asks main to tie (`board:tie`, all the rules of Ties stand). A click on a dimension's chip while tying ties to it (`open` of the chips in `ViewportPane`).
- It ends with no change on Esc (the tool's own Esc, which lets go of a held measurement, comes first), Cancel, going to another of the three, another project, or the size's removal (`boardStore` subscription); on a tie or Esc/Cancel the brief is shown again, and the Measure tool put down. A refusal of main stays in the head and tying goes on.

## What holds: checks and marks on the page (#277)

- Under the Sizes the page has a **Checks** block (`ui/brief/Held.tsx` `ChecksBlock`, `data-section="checks"`, the body `ui/card/Checks.tsx`, see `checks-and-profile`) and, after the notes, a **Marks** block (`MarksBlock`, `data-section="marks"`, the body `ui/MarksPanel.tsx`: Review this build, the rounds, the groups of marks; see `marks-window`). They are views of what the window already holds (`scene.checks`, `marks`), never cards of the board and never in `board.json`; `checksSaid` and `marksSaid` word their heads. They are held to 760 px (`.brief-held`).
- **Going to a row shows the page** (`goToRow(id, show = true)` of `ui/BuildStatus.tsx`): the mark is made active, and the Brief is shown (`boardActions.show('brief')`) with its row in `.check-row[data-check-mark]` or `.mark-row` scrolled to once drawn. A click on a mark's chip in the view (`ViewportPane` `open`) is `goToRow(id, false)`: the mark becomes the active one and the view stays as it is. The count of marks on a part in Parts shows the page too.

## The switch: Model | Brief | Usage | Tracing | a part

`usage` is a `Shown` too (#371, rule `usage`): the Usage page, always in the switch after Brief, kept per project as the others are,
covering the view as the brief does; `Ctrl+Tab` passes it over (`swapped('usage')` is the model).

`Shown` is `'model' | 'brief' | 'scans' | 'tracing' | 'part'`, remembered per project (a stored `'board'` reads as `'brief'`). `board.swap` (`Ctrl+Tab`) goes model, brief, scans, tracing, part, model (`swapped(shown, { scans, tracing, part })`), and passes over Scans, Tracing and the part in a project with none (#278, #352). The part is a part of the parts shelf opened in the view (`store.shelfOpen`, `boardActions.openPart` and `closePart`; the page `ui/shelf/PartPage.tsx`, the rule `shelf`): its tab is the id in mono with a `×` (`.pboard-part`), there while `shelfOpen` is set and drawn after Tracing; `inModel('part')` is false, so the 3D view is covered and the band, tying, review and set keys are not heard, as for the brief. The id is kept per project beside `shown` (`torno.board.part`, `partRead`, `partWrite`) and a `part` kept with no id opens on the model. The switch (`ui/brief/BoardSwitch.tsx`) draws Scans while `store.scans` is not empty and Tracing while the project has a tracing, and either while it is the view shown; its `+` (`.pboard-add`, a `PopMenu`) holds Import scan… (`pickScan` of `ui/scanDrop.ts`; off while one is read) and New tracing… (`startNewTracing`). A scan imported while the model is shown shows Scans (`importScan`); the last scan gone leaves it (`leaveScans`, from `connectBoard`), as the last tracing leaves Tracing (`leaveTracing`). A project opens on the model until its board has a card of the person's or the agent's, then on the brief. Whatever is not the model covers it: the 3D view stays mounted, stops drawing (`boardShown` is `!inModel(shown)`: Scans is the 3D view with its panel beside it (`ui/ScansPanel.tsx` `ScansSide`, which `RouteCard` puts in the bench's place while Scans is shown), so it counts as the model, and so do bands, tying and the review and set keys) and the review and set keys are not heard. The Tracing view is in `tracings.md`; the brief draws no tracing, so `shownIds` tells main only the open tracing while Tracing is shown and those shown in 3D. A saved view has no "Pin to board" any more (the brief draws no view); main still takes the pin, and cards already pinned stay in the file.
