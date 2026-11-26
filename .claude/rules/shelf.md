---
paths:
  - "app/src/main/shelf/**"
  - "app/src/shared/shelf.ts"
  - "kernel/src/torno_kernel/shelf.py"
  - "kernel/tests/test_shelf.py"
  - "app/src/renderer/state/shelf.ts"
  - "app/src/renderer/state/shelfFind.ts"
  - "app/src/renderer/ui/card/ShelfPanel.tsx"
  - "app/src/renderer/styles/card-shelf.css"
  - "app/src/renderer/styles/shelf-page.css"
  - "app/src/renderer/state/partDrawing.ts"
  - "app/src/renderer/state/partDrawing.test.ts"
  - "app/src/renderer/state/partLedger.ts"
  - "app/src/renderer/state/partLedger.test.ts"
  - "app/src/renderer/ui/shelf/**"
  - "app/e2e/shelf.spec.ts"
  - "app/src/renderer/state/placing.ts"
  - "app/src/renderer/state/placing.test.ts"
  - "app/src/renderer/tools/placeTool.ts"
  - "app/src/renderer/tools/placeTool.test.ts"
  - "app/src/renderer/viewport/placeGhost.ts"
  - "app/src/renderer/viewport/placeGhost.test.ts"
  - "app/src/renderer/ui/place/**"
  - "app/src/renderer/ui/shelf/placeRequest.ts"
  - "app/src/renderer/ui/shelfDrops.ts"
  - "app/src/renderer/ui/chat/offerLines.ts"
  - "app/src/renderer/ui/chat/offerLines.test.ts"
  - "app/src/renderer/ui/chat/ShelfOffer.tsx"
  - "app/src/renderer/ui/chat/slipsOf.ts"
  - "app/src/renderer/ui/chat/slipsOf.test.ts"
  - "app/src/renderer/ui/chat/ShelfSlip.tsx"
  - "app/e2e/shelfask.spec.ts"
  - "app/src/main/shelf/add.ts"
  - "app/src/main/shelf/add.test.ts"
  - "app/src/renderer/state/shelfAdd.ts"
  - "app/src/renderer/state/shelfAdd.test.ts"
  - "app/src/renderer/ui/shelf/AddPart.tsx"
  - "app/src/renderer/ui/shelf/addAsk.ts"
  - "app/e2e/shelfadd.spec.ts"
  - "app/src/renderer/ui/chat/sendGuard.ts"
  - "app/src/renderer/ui/chat/sendGuard.test.ts"
---

# The parts shelf: the kernel's read, main's store, the types

The shelf is `common/parts/<id>/part.py` of the workspace, one folder a bought part (the contract is in the rule
`kernel-model-contract`; the plan is `docs/superpowers/plans/2026-11-26-parts-shelf.md`).

- **The kernel reads it, in a worker of its own** (`kernel/src/torno_kernel/shelf.py`, the op `shelf`: rule
  `kernel-supervisor`). Folders that are not a part's id (`isPartId` in `shared/shelf.ts` and `shelf.is_part_id`: one rule in two
  places), links and folders with no plain `part.py` are skipped; at most 60, sorted. Each part is imported alone under a module
  name of its own, with `Params()`, and fails alone: its `error` is the model's traceback from the first frame in `part.py`, and
  `name`, `what` and `params` stay as far as they were read. The name falls back to the id when the docstring is empty.
- **A slow shelf gives what it read.** The worker's deadline is a margin before the supervisor's kill (a tenth of the time, at most 5 s) and no part is started with under 0.5 s left of it; a part
  not reached has `error: "not read: the shelf ran out of time"` and only its id and files (an empty name and sizes). The store treats it as any part with an `error`. A part stuck inside one long call of the
  CAD kernel is not interrupted by the per-part alarm and can still cost the whole read: the op is then a `timeout` and the store keeps the list it had (an empty one on the first open). Rule `kernel-supervisor`.
- **The drawings are the B-rep's** (`section.section`, never a mesh): `body` and `keepout` have `bbox` (`extent.box`) and `side`,
  the section by the XZ plane through the middle of the bbox in Y (x is X, y is Z); `cutout` and `keepout` have `plan`, the section
  by XY at `z = -0.5`; `cutout.size` is `{d}` when the plan is one circle (twice the B-rep circle's radius, from `section`'s
  snaps) else `{w, h}` of its points' box. A cutout that misses `z = -0.5` is an error of the part, not a cutout without a size.
  An outline is `{points: [[x, y], ...], hole?: true}` in mm, closed, at most 400 points (thinned from the section's own 0.05 mm
  deflection) and at most 40 to a drawing. Numbers are the kernel's, in full.
- **The kernel writes nothing, and `ShelfStore` writes nothing**: it (`app/src/main/shelf/store.ts`) reads the kernel's
  answer and each part's `.torno/checked.json` (`{<param>: {value, date}}`; a bad file or entry is ignored). The file is read by one reader, `shelf/checkedFile.ts`
  `readCheckedText`, for the store and for `recordMeasured`: opened without following a link or waiting on a pipe (`O_NOFOLLOW|O_NONBLOCK`, then `fstat` is a plain file), at most 64 KB; a link, a pipe or a larger
  file is refused with a plain reason (`recordMeasured` writes nothing then) or, in the store, is no checks for that part, never blocking the ask. The one file of the
  shelf main writes for #352 is that one, from `shelf/checked.ts` (below); the copy of #355 (below) is in the rule `workspace-writes`.
- **The store asks when the workspace opens and when a file under `common/parts/` changes**, 400 ms after the last change (the
  watch is `watchFolder` on `common/`, filtered to `common/parts`; while `common/` is missing, `watchTop` waits for it, one level
  deep). One ask runs at a time; a change meanwhile has the answer applied and another asked, so the newest state stays. A failed
  ask leaves the last good list and is logged. The watch also keeps `common/parts/<id>/.torno/checked.json` (`keepChecked`, the fourth argument of `watchFolder`; project builds pass none and
  still ignore every `.torno`): a burst of only those files is `checkedChanged()` (merged again, the kernel not asked), so a `git pull` that changes only a part's checks is seen. `list()` and the event `changed` give the whole list; `close()` empties it.
  An answer of a workspace that has been left is dropped (`epoch`).
- **The window gets it through `shelf:list` and `shelf:changed`** (`window.torno.shelf.list()`, `onChanged`), and a new
  conversation is told it through `shelfLine` (`shelf/told.ts`, rule `agent-prompt`). `Scene.shelf` says which parts a project used.
- **The tab is #351** (`ui/card/ShelfPanel.tsx`; the text of it is in the rule `left-column`): the window keeps the shelf in `state/shelf.ts`
  (`connectShelf`: `shelf.list()` and `onChanged`, the newest wins), draws a part from `body.side` and nothing else (`drawingOf`, 1.25 px
  a mm, one scale for all) and says nothing of a part's sizes that `ruleKinds` does not: only a size has a rule, a `checked` entry or a
  `measured` source is checked, and a checked size is no longer assumed in the tab (the block told to Claude counts `assumed` by the
  comment alone, `assumedCount`).

## The part opened (#352): the page, the drawing, the ledger, "I measured it"

- **A fifth `Shown`, `part`** (rule `board`): `boardActions.openPart(id)` (a row's click or Enter in the tab) sets `store.shelfOpen`, shows `part` and keeps the id
  per project (`torno.board.part`, `partRead`, `partWrite`, beside `torno.board.shown`); `closePart()` (the `×` of the switch's tab, or `connectShelf` when
  `partGone`: the part was on the list and is not, or a list with parts lacks it) clears both and shows the model if the page was shown. A page kept with no part
  opens on the model. `PartPage` (`ui/shelf/PartPage.tsx`) is drawn by `App` beside `BriefPage`; the 3D view is covered as for the brief.
- **Buttons.** Place on the model is `placingActions.startOnModel(id)` (the model shown, the place tool in hand; #353, below). Ask Claude about it
  and the measured request go through `ui/shelf/askClaude.ts`: the dock is shown; with no session running `fixRequest` starts one with the text in its box, else
  `insertIntoSession(text, { later: true })`. Never sent. There is no "Open part.py" and the files are not links: no bridge opens a project file in the person's
  editor (`board.open` is `brief.md` and `reference/` only). The files are named.
- **The drawing is `layoutPart(part)`** (`state/partDrawing.ts`, pure; `ui/shelf/PartDrawing.tsx` only draws): a 600 by 360 box, the side section left (the panel a
  `SLAB` = 2 mm slab, z in [-2, 0], in two pieces around the gap, which is the cutout's side outline cut to the slab; the body's `side`; the keep-out's `side`
  dashed; labels `panel` and `keep clear`) and `the cutout, from above` right (a 116 px sheet, the cutout's plan, the keep-out's plan, centre lines). Scale is the
  largest, up to `MAX_SCALE` 16 px a mm, at which the panel, the part with its keep-out and each dimension's line and words fit (bisection); the plan has a scale of
  its own. Dimensions: `cutout` (`Ø d`, or `w × h`; also under the plan), `above` (bbox max z, when > 0), `below` (-min z, when < 0), `width` (bbox x). Every number is
  the kernel's (`format.number`). A dimension's style is `dimStyle`: the one size with `|default - value| < 1e-6` gives `ruleKindOf` (`ck`, `as`, `mo`, `so`), none or
  more than one gives `plain`; a window's `w × h` takes the least sure of the two (`as`, `mo`, `so`, `ck`) and is `plain` when either has no size. A checked size is `ck`
  by the same rule as the tab (`ruleKindOf`, shared with `ruleKinds`), though the drawing is of the file's value, which is not the measured one until Claude changes it.
  A part with an `error` shows the error in mono instead; one with no body "Nothing to draw". Colours are tokens, with `--shelf-panel` and the shelf's metal tones.
- **The ledger** (`state/partLedger.ts` `ledgerOf`, `ui/shelf/PartLedger.tsx`): a row for each `isSize` param; its end is `checked <day>` (`, at <value>` when the measured
  value is not the file's), `from the maker` (a `derived:` size with no check) or `I measured it…`. A size whose comment says `measured` but has no entry still offers
  the button. The edit row takes a number above 0 and under `MOST_MEASURED` (10,000; `measuredValue`, one number in `shared/shelf.ts`); Enter asks, Esc cancels.
- **`shelf:measured`** (`shelf/checked.ts` `recordMeasured`, `window.torno.shelf.measured(id, name, value)`) is the one write: main checks the id (`isPartId`, a part
  on the list), the name (an `isSize` param of that part, never `__proto__` or a text) and the value (finite, > 0, < 10,000), then every folder from `common` down to
  the part is a real folder (not a link), `ownTorno(partDir)` is asked (a link or file in `.torno`'s place is refused with its reason), and `writeOwn(partDir,
  'checked.json', ...)` writes `{ <size>: { value, date } }` whole, merged with the entries there (unknown ones stay), the date the local `YYYY-MM-DD`. A file there that
  is not a JSON object is left as it is and the person told. Writes of one part are in turn (read, merge, write), then `ShelfStore.checkedChanged()` merges again and
  the window is told through `shelf:changed`. Nothing else is written, never `part.py`, and `checked.json` is not in `.torno/.gitignore`: it is the part's record and
  travels with it, as `marks.json` does with a project.

## Placing a part on the model (#353)

- **The place tool** (`tools/placeTool.ts`, `ToolName` `place`, the one tool with no key and no button in the palette, `PaletteTool` being the rest): taken up by
  `placingActions.start(id)` (not `setTool`, which knows only the palette's) from "Place on the model" (`startOnModel`, which also shows the model) or from a drop of a row,
  put down by Esc (the generic step back to Select), Stop (`placingActions.stop`), another tool, a project switch or the part leaving the shelf (`connectPlacing`). While it is
  in hand the view's switch gives way to the band (`BandKind` `place`, priority after `facePick`; `PlaceBar`, `data-band="place"`: `Placing <id> from the shelf, <n> placed`,
  Ask Claude `data-part="place-ask"`, Stop `data-part="place-stop"`; `placeWords`). `state/placing.ts` is the state (`placing`: part, `objectId`, `marks` with each one's face, point and
  normal, and `said`; `tag`; `dragging`) and the pure rules of the words. It is never per frame in React: the ghost goes to the viewport.
- **The ghost** is drawn on the overlay canvas, as the Region brush's ring is (`Viewport.showPlacing`, `OverlayPass.placing`, `viewport/placeGhost.ts`; screen only, in no picture): the cutout's
  `plan` outlines solid and the keep-out's dashed with a 12 % accent fill (holes are not filled), in the face's plane at the hit point. `faceFrame(normal)`: Z is the normal, X is the world X
  taken into the face (the world Y when |n.x| > 0.9), Y is Z across X; the same face always gives the same turn. Each part placed in this go keeps its cutout and a ring 1.6 mm past its farthest
  point (`haloReach`). Only a face with a normal is laid on (`faceHit`); an edge gets no ghost and no mark.
- **A drop** (`ui/shelfDrops.ts`, wired in `ViewportPane`'s `connect`): a row is `draggable` and carries only `application/x-torno-shelf-part` (the id; never `text/plain`, so a drop on the box or a
  field is nothing); its `dragstart` sets `placingStore.dragging` one tick later (the row is `.lifted`; a dragover cannot read what is carried). Over the pane `dragover` picks a face
  (`viewport.pick(..., { edges: false })`) and shows the ghost, taking the drag (`preventDefault`) only on a face with the build current and the parts together; `drop` calls `placeOnFace`.
  Files drops stay `acceptDrops`'s: the two check their own type.
- **A mark** (`placeOnFace`): a user `pin` through `ctx.commit`, `note` `<id> from the shelf`, anchor as the pin tool's (`anchorFromHit`), no note opened; then `placingActions.placed(mark)` and the tag
  (`PlaceTag`, a `Tag` with id `place`, `placeTagWords`: `cuts Ø 7.2` or `cuts w × h` from `cutout.size`, `keeps w × h clear` from `keepout.bbox`; cleared when the pointer moves 8 px on, or leaves the view).
- **The request** (`ui/shelf/placeRequest.ts` `connectPlacingRequest`, started in `connect`; text `placeRequest`): written when a mark is added. In a chat the sentence torno wrote (`said`) is replaced in the
  box by the longer one while the box still holds it exactly (`replaceInComposer`, `replaceRequest`), else the sentence of the new mark alone is inserted at the cursor and becomes `said` (`addToRequest`).
  `on the faces` when the marks' refs differ. With no session `askClaude(whole request)` each time (the last stands); with a terminal session nothing until placing ends, then
  `insertIntoSession(whole request, { later })` once (not after a project switch; `endRequest` in `state/placing.ts` decides). A session asked for at the first mark (there was none) has the request through `fixRequest`, and `said` names its marks: when placing ends in the terminal it became, nothing is typed again for them, a `fixRequest` still waiting is made the whole request, and marks made after it was typed are a sentence of their own. Never sent. The band's Ask Claude is `askNow`: stop, show the dock, focus the box.

## Claude asks before it shelves a part (#354)

- **The ask is the skill's** (`torno-model`: `AskUserQuestion`, header `Shelf`, the question `Put <name> on the parts shelf?` and a line a size `<value> <what> (<source>)`, options
  `Put it on the shelf` and `Not this one`, the folder written only on yes). torno does not enforce it: no hook holds a write to `common/parts/`, and the slip below says what was written either way.
- **The card** (`ui/chat/offerLines.ts` `shelfOffer(question)`, pure; `ShelfOffer.tsx` draws it; `AskCard.tsx` `QuestionView`): a question whose `header` is `shelf` in any case, with at least one size line, is an
  offer: the first line is the title, a run of lines `<value> <what> (<source>)` (`SIZE`: a number, `Ø`/`M` before it, `×` between numbers, a unit after) is one table of value (`.num`), what and source, `tone` from
  `sourceOf` (`assumed` warn, `measured` ok, `listing`, a standard and `derived` quiet, any other plain: muted, as the part ledger's words), every other line is text in its place, a bullet is dropped. A line that
  does not read as a size stays text, so nothing is lost; no size line is no offer and the card is the ordinary one. The options are buttons in a row (the first `button-primary`), the Other field beside them says
  `or answer in your words`; a choice of an offer that is the only question answers at once (no Submit: it appears only when Other has text); the keys 1 to 9 do the same. With several questions the offer's
  buttons pick and go on, as rows do. The part's picture is not in the card: the part is not on the shelf yet. The Other field has a least width of 26 ch, so where it does not fit beside the buttons the row wraps and it takes the width under them (its whole placeholder is readable). Answered, the card in the transcript is the offer again (`Held` in `AskCard.tsx`: the title, the same table, and `Answered: <label>`, the label found in main's `<question>: <answer>` text by `answersIn`, pure), never the raw text box; a declined one (denied) and any question that is not an offer keep the generic view.
- **The slip** (`ui/chat/slipsOf.ts` `shelfSlips(items)`, `ShelfSlip.tsx`, `shared/shelf.ts` `shelfFileOf(path)`): under a `Write`, `Edit` or `MultiEdit` that is `done` and whose `file_path` has the segments
  `common/parts/<id>/<file>` (`isPartId`; relative or absolute, found by segments, not by the workspace root, which the window does not know apart from the project's folder; a path with `..` is none). One slip a part
  in a turn (a `turn` item ends it), under the last such write, naming each file written once. `ChatItems` puts the ids in the set `foldRuns` is given, so a tool with a slip never folds into a run. The slip reads
  `useShelf` for its part: not listed yet (the store asks 400 ms after a change), the head alone; listed, its `PartPicture`, name and `PartLine` (`ui/shelf/PartBits.tsx`, the tab's row pieces, one set for both)
  and "Open it" (`boardActions.openPart`); a part with an `error` says `does not build` in warn. Derived each render, never stored, never in the log.
- **The test** is `e2e/shelfask.spec.ts` with the stand-in: it asks the Shelf question, the test answers, and a `write` of a new part (the stand-in makes the folders) gives the slip and a Shelf tab of 2; a no writes nothing.

## Adding a part by hand (#355)

- **The drop** is the Shelf tab's (`ShelfPanel`: `dragover` of a drag that carries `Files` takes it and shows `.shelf-drop`, the `.drop.on` look of the mockup, over the tab; a row's own drag carries only `SHELF_DRAG_TYPE`, never `Files`, so it is
  none). `takeDrop` (`state/shelfAdd.ts`, pure) holds the files to what main takes: `shelfFileKind` (PDF, PNG, JPEG, WebP, STEP/STP by the ending in any case), `shelfFileCap` (STEP 50 MB, the rest 25 MB, the caps `create` uses), at most `MAX_SHELF_FILES` 8 with those the
  form has, a path (`window.torno.objects.pathOf`), the name each will have (`shelfFileName` = `referenceFiles`' stem rule, so the window names a file as main writes it) not given twice in any case. What is left out is a plain line (`said`): over the form, or, with no form,
  in the tab's foot (`shelfDropSaid`). The tab is there with no part on the shelf (`benchTabs` always ends with `shelf`), saying so and taking the drop, so the first part can be added by hand.
- **The form** (`state/shelfAdd.ts`, `ui/shelf/AddPart.tsx`, `data-add-part`; `shelfAddStore`, one form for the window): the name is `idFromName(first file)` until the person types one (`named`), `idProblem` (`isPartId`, not on the shelf) is its live help, up to `MOST_ADD_SIZES` 20 rows of what, value as
  typed (the page of a new project's `parseSize` is not used: a value is kept as typed, one line, at most 60 characters) and a source `ADD_SOURCES` (`datasheet`, `listing`, `measured`, `a guess` told as `assumed`); the row is the name on a line of its own across the box and, under it, the value, the source and the clear button; a blank row is left out and `sizeIssue` (one box of two empty) holds the button back
  (`canAsk`). Back and Esc (`field.leave`, from anywhere in the form but a list) call `shelfAdd.close()`, which writes nothing. The pictures are `URL.createObjectURL` of the dropped file, revoked when the form goes. A workspace left clears the form and the request (`onWorkspaceSet`).
- **The request** is `addRequest` (pure): `Put the <what> on the shelf as <id>: <value> <what> (<source>), .... Its files are in common/parts/<id>/: <names>. Model it as the torno-model skill says.`; `part` when what is empty, no colon with no sizes.
- **Where the copy is made** (`ui/shelf/addAsk.ts` `askToShelve`): in a chat the request goes through `askClaude` (never sent; no session: `fixRequest`, which holds it as a draft in the box of the session it starts) and `shelfPending` keeps `{ id, paths, text }`; the chat box's send (`Composer.send`; one at a time, `ui/chat/sendGuard.ts`, so Enter twice sends once, and the box is read-only and its buttons held while it runs, so nothing typed meanwhile is lost to the emptied box) asks, as its last step before `chat.send` and after the attach-view check (a message those checks refuse copies nothing; the board and the tag are taken after it, so a refusal has nothing to give back),
  `shelfPending.beforeSend(text)`: nothing waiting, or the message no longer holds `common/parts/<id>/` (the request is forgotten), lets it go; else `window.torno.shelf.addFiles(id, paths)` is awaited (twice at once copies once) and a rejection or any refused file is the box's error line (`refusedLine`) and the
  message is not sent, the text kept; what was refused stays pending (a second send copies only that). The answer to an ask card (`denyAndSend`) is not a send of this. In a terminal session (there is no box) `shelfPending.now` copies at the click and the request is typed after, never if it was refused; a session asked for that turns out to be a
  terminal gets the copy as the request is typed into it (`SessionPane`, `fixRequest`). Never a copy before a send or a click. If `chat.send` itself then fails, the files stay copied and the request is forgotten (kept, a second send would be refused for the files that are there): the text is given back to the box, and sent again it names a folder that already holds them.
- **Main** is `shelf/add.ts` `addFiles(root, id, paths)` (the writes are the fifth exception of `workspace-writes`, which says what it checks and writes). It answers `{ copied, refused: [{ name, why }] }` or rejects the whole request (a bad id or list, no workspace, a link or a file at a level of the way). `openRegular` of `objects/create.ts` is its one reader.
- **The tests** are `main/shelf/add.test.ts` (a temp workspace), `state/shelfAdd.test.ts` and `e2e/shelfadd.spec.ts` (the drop is made with `File`s of a file input given real paths, since a `File` made in the page has no path for `webUtils`; the stand-in agent takes the sent message; the last test empties the shelf and holds `Shelf 0`, its text and a first drop).
