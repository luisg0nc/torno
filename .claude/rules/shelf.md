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
---

# The parts shelf: the kernel's read, main's store, the types

The shelf is `common/parts/<id>/part.py` of the workspace, one folder a bought part (the contract is in the rule
`kernel-model-contract`; the plan is `docs/superpowers/plans/2026-11-26-parts-shelf.md`).

- **The kernel reads it, in a worker of its own** (`kernel/src/torno_kernel/shelf.py`, the op `shelf`: rule
  `kernel-supervisor`). Folders that are not a part's id (`isPartId` in `shared/shelf.ts` and `shelf.is_part_id`: one rule in two
  places), links and folders with no plain `part.py` are skipped; at most 60, sorted. Each part is imported alone under a module
  name of its own, with `Params()`, and fails alone: its `error` is the model's traceback from the first frame in `part.py`, and
  `name`, `what` and `params` stay as far as they were read. The name falls back to the id when the docstring is empty.
- **The drawings are the B-rep's** (`section.section`, never a mesh): `body` and `keepout` have `bbox` (`extent.box`) and `side`,
  the section by the XZ plane through the middle of the bbox in Y (x is X, y is Z); `cutout` and `keepout` have `plan`, the section
  by XY at `z = -0.5`; `cutout.size` is `{d}` when the plan is one circle (twice the B-rep circle's radius, from `section`'s
  snaps) else `{w, h}` of its points' box. A cutout that misses `z = -0.5` is an error of the part, not a cutout without a size.
  An outline is `{points: [[x, y], ...], hole?: true}` in mm, closed, at most 400 points (thinned from the section's own 0.05 mm
  deflection) and at most 40 to a drawing. Numbers are the kernel's, in full.
- **The kernel writes nothing, and `ShelfStore` writes nothing**: it (`app/src/main/shelf/store.ts`) reads the kernel's
  answer and each part's `.torno/checked.json` (`{<param>: {value, date}}`; a bad file or entry is ignored). The one file of the
  shelf main writes for #352 is that one, from `shelf/checked.ts` (below); the copy of #355 is in the rule `workspace-writes`.
- **The store asks when the workspace opens and when a file under `common/parts/` changes**, 400 ms after the last change (the
  watch is `watchFolder` on `common/`, filtered to `common/parts`; while `common/` is missing, `watchTop` waits for it, one level
  deep). One ask runs at a time; a change meanwhile has the answer applied and another asked, so the newest state stays. A failed
  ask leaves the last good list and is logged. `list()` and the event `changed` give the whole list; `close()` empties it.
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
  `insertIntoSession(whole request, { later })` once (not after a project switch). Never sent. The band's Ask Claude is `askNow`: stop, show the dock, focus the box.
