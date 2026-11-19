---
paths:
  - "app/src/shared/tracings*.ts"
  - "app/src/shared/lineup*.ts"
  - "app/src/main/tracings/**"
  - "app/src/main/mcp/tracingTools.ts"
  - "app/src/renderer/state/tracings*.ts"
  - "app/src/renderer/ui/tracings/**"
  - "app/src/renderer/ui/card/Tracings.tsx"
  - "app/src/renderer/ui/TracingRows.tsx"
  - "app/src/renderer/viewport/tracings*.ts"
  - "app/src/renderer/styles/tracings.css"
  - "app/e2e/tracings.spec.ts"
---

# Tracings: the store, the file, the photo, the outline, the view

A **tracing** is one plane of the model laid flat at true scale (`T1`, `T2`, …), with the person's photo under it and layers of shapes over it, kept in
`<project>/.torno/tracings.json` (the spec is `docs/superpowers/specs/2026-11-17-tracings-design.md`). Paths as in the other rules. The pieces that touch
other stores are in their rules: marks on a tracing, `span` and `offset` (`marks-store`), the card (`board`), the tools and the sentence Claude is told
(`mcp-tools`, `agent-prompt`), the file an export writes (`export-saving`), the keys (`keys`), the colours (`styles-themes`), the 3D view (`viewport-overlay`).

## The store and the file (`main/tracings/store.ts`, `file.ts`, `shared/tracings.ts`)

- `tracings.json` is `{ next, tracings }`; it **travels in git** with the marks. `TracingStore` is the one writer: one change at a time for a project,
  written atomically through `writeOwn` before it is told, no write when the text is unchanged. Before each change it compares the disk's text with what it
  last read or wrote and takes the disk's file as its base (a pull or a checkout), keeping `next` at least its own so a number it gave is never given again.
  An unreadable file is copied aside (`tracings.json.corrupt-<stamp>`) and a new list made (`problem` says so, the window's `tracings:problem`); a file with parts left out
  is copied aside as `.dropped-<stamp>` and rewritten whole; a link or folder in its place is not read.
- **Ids are main's**: `T<n>` and a layer's number come from `next` and `nextLayer`, count above every id the file has ever named (kept or not), and are never
  reused, so a mark that says `on T1` never lands on another tracing. A removed tracing is kept in memory (the last 20) for `restore`, which puts it back with its id.
- **Main-only keys**: `TRACING_MAIN_ONLY` (`id`, `by`, `nextLayer`, `lost`) and `PHOTO_MAIN_ONLY` (`file`, `sha256`, `width`, `height`, `transform`, `scale`, `angle`,
  `fit`, `straightened`) are said by main alone. What the window or an agent sends is read for its own keys only and the rest is dropped, never an error and never kept;
  a tracing's `revision` is this run's and is not written. Main works every number out itself (the outline, the line-up, a span's value, a mark's `uv`).
- Caps, applied on read and on every change: 50 tracings, 20 layers a tracing, 500 shapes a layer, 20,000 points a tracing; names to 80 and a label's text to 200.
  A layer's name is free in its tracing (case apart); a make by a name that is there replaces that layer if it is the maker's own, and is refused by the owner's name if not.
- Owners: each edits and removes only its own layers (`by`: `person` or `agent`); the person may hide any layer and remove any tracing, Claude only its own (`agentRemove`,
  `agentLayer`), and not one that holds the person's photo or a layer of theirs (`T3 holds the person's photo and the layer "bolts"`). The window's doors (`tracings:*`, `main/tracings/ipc.ts`) and Claude's tools use the same store, and the `agent*` handlers add the owner's check.

## The outline and the face that is followed (`outline.ts`, `planes.ts`)

- The outline is **the kernel's own cut of the plane** (`section` with the plane's `axes` and `snaps: true`) of the last good build, in the tracing's layout, unspread,
  of the parts it names: exact where the kernel says so (`exactness-app`; areas `≈` when it could not hold them to the B-rep). Nothing is cut in the window. `Outlines` caches
  per project and tracing (the two newest builds, keyed also by layout, plane and parts), cuts the same thing once, and drops what it found when a newer build landed meanwhile.
  `snaps` are the cut's corners and circle centres (the kernel's, exact) and the model's vertices in the plane (`planeSnaps`: plain within 0.01 mm, `projected` beyond; at most 5000, nearest first).
- After every build `recut` first moves the face tracings, then cuts the shown ones again. A **face tracing** (`from.kind: 'face'`) is laid on a flat face the person or Claude
  names (`describe` for its type and normal, `selectors` for a point *on* the face as the origin: `describe`'s centre of a holed face is in the hole), and follows it along its normal
  after each build: a tagged face by `nearest` of its tag, an untagged one by the kernel's `refind` (type `PLANE`, within the part's tolerance, normal within 10 degrees, the face in place wins).
  Only the origin moves along the normal; the ref and its revision are kept current (`movePlane`). A face it cannot find again within that is **lost** (`lost`, said in words, the origin kept),
  never moved to the nearest face; a `nearest` that failed is not a loss. A section tracing is frozen where it was cut; a main plane has an offset.
- When the plane moves, the marks on it move with it by the same distance in one change (`marks-store` `followTracing`), and `healMarks` runs when a project opens and after each outline
  so that a crash between the two writes leaves nothing off its plane.

## The photo (`photos.ts`, `dropped.ts`, `sweep.ts`, `shared/lineup.ts`)

- A photo is a PNG or JPEG of at most 25 MB and 4000 px (`checkedPhoto`, read from its header, nothing decoded), kept as `<project>/.torno/tracings/photos/p-<12 hex>.png|jpg` and, once lined up,
  its straightened copy as `s-<12 hex>…`: names main gives, never the window's (`isPhotoName`; `readPhoto` serves nothing else, and not through a link). The folder has a `.gitignore` of `*`:
  a photo may show the real world and **does not travel**, while the line-up (in `tracings.json`) does. `tracings:photoBytes` serves the photo only when its hash is the one the tracing names (the straightened copy has no hash: it is made again whenever the line-up is not the one it was made for).
- **Whether the photo is here is looked for, never assumed**: `photoHere(dir, photo)` (`photos.ts`) is what `tracings` (the tool) passes to `tracingText` and `tracingData` as `photoHere`, so Claude is
  told `the photo is not on this computer; <line-up>` of a file that is not in the folder; the window's `here` is the same question through `photoBytes`.
- The line-up is **worked out by main** from the pairs (`fitSimilar` for 2 to 8 pairs, `fitStraight` for 4 to 8; the window's own fit is only a preview) and refused in words when the points are on top of each
  other, almost in a line, would fold the photo or mirror it (a photo of the far side of the plane is not supported). A clicked point that is snapped is checked against the outline's snaps and
  replaced by the kernel's point. The photo is turned the way the camera held it and scaled before it is kept (`preparePhoto.ts`).
- **Never exact**: a line-up's scale, angle and fit are told by `lineupSaid` and end `not exact, and true only in the tracing's plane` (what is nearer the camera looks bigger). Nothing taken from a
  photo is exact (`exactness-app`): a span with an end on the photo is `≈`, an offset says `from the photo` only when a photo is lined up.
- **The sweep drops only what torno dropped**: a removed photo, a swapped one or a replaced copy is listed in `photos/dropped.json` (dated), and `PhotoSweep` (on opening a project) deletes a listed file
  only 30 days after, as no branch names it any more (the photos are shared by branches and git holds none). A file nothing lists is never touched. See `workspace-writes`.

## The view (`ui/tracings/`, `state/tracings.ts`)

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
- **The panel is in the column** (`ui/card/Tracings.tsx` `TracingsSide`, a `ViewPanel` that `RouteCard` puts in the bench's place while the Tracing view shows and the project has a tracing): `TracingView` does not mount it. `TracingsBody` holds the form of New tracing (opened by the button in the panel's head, or by `startNewTracing` from the switch's `+`, which also shows the view; a project with no tracing has the form in the view itself), and `TracingRows` (`ui/TracingRows.tsx`): one row for each tracing (`T1`, its name or its plane, the reference its photo came from or the photo's file, and the eye of Show in 3D, `setTracingShown`), the line of its line-up (`tracingLine`) under the open or shown one, and the open tracing's `TracingPanel` under its row while `board.shown` is `tracing`. A project with no tracing has no panel and no Tracing tab: the `+` of the switch makes the first. The panel is `.tr-panel` in flow (no float); its headings are `h3` and `h4` under the panel's `h2`.
- Layers are `LayerRows` in the panel: colour, name, shape count, `by Claude`, an eye for any layer, Remove and the ring "trace into" on
  the person's own only (`Layer.by`). `tracingActions`: `addLayer` (never replaces: the window checks the name is free, case apart, and
  main refuses one that is another's), `hideLayer`, `removeLayer` (the window refuses Claude's) with `undoRemoveLayer` (`{ restore: id }`: the store keeps the
  last 20 layers removed in this run, whole, and puts one back with the number it had, which offsets name; refused when the name was taken meanwhile), `addShape`. A finished shape is one `tracings:layer` `{ edit, shapes: [...own, new] }`;
  shapes and layer changes are **queued** so that each is built on the layer as the one before left it. `traceTarget` is the layer
  traced into: the one ringed when it is the person's and there, else their last, never Claude's.
- **The photo** (`ui/tracings/`, `state/tracings.ts`): Add photo is a drop on the sheet, `tracingActions.choosePhoto` (`objects.pickPhotos` and `readPhoto`) or `addReference` (a `reference/` card of an image, `board.reference`); `preparePhoto.ts` decodes with the EXIF turn applied and scales to at most 4000 px (a PNG stays a PNG unless over 24 MB), main checks and names it (`tracings:photo`). `LineUp.tsx` covers the view (`state.lining`, scope `lineup` in `shared/keys.ts`: `S`, `Backspace`, `Enter`, `Esc`): two `LineupPane`s (a `Sheet` each; the photo's y down in its pixels, the tracing with **`v` up whatever way the plane's axes point**, because `shared/lineup.ts` takes a photo's y down to `v` up, and `tracingSvg`'s `vUp` draws it so), clicks held by `LineupTool` (no DOM: pairs in photo-then-tracing order, a swapped photo keeps the tracing side and asks only for the photo's, 2 pairs or 4 with Straighten), snaps through `snapAt` (a vertex only projected is not offered; a snap goes to main as `corner` by place, `centre` by edge or place, `vertex` by ref). Markers, bar, preview (the photo as a `matrix3d` of the live fit, faded, in the tracing's layer) and Done are written on the elements, never React state; Done is `tracings:lineUp`, which main fits again. The straightened copy is `warpPixels` (`warpCore.ts`: inverse mapping, bilinear, top row at the greatest `v`, clear where the photo does not cover) run in `warp.worker.ts` through `warp.ts`, at the photo's own px/mm and at most 4000 px, placed by `photoRect` (`shared/lineup.ts`) in mm; `tracingActions.sync(id)` reads the pictures (object URLs in `state.photos` by file name, revoked when no tracing names the file) and remakes the copy when this computer has the photo and not the copy (`tracings:straightened` names the photo and `transformKey`), once at a time for a tracing. `photoDrawn` is the one place the view, the card (`TracingPicture`, `sync(id, false)`: no read of the photo itself) and the export get the photo from. A hidden photo is drawn nowhere but the export when ticked. In a sheet whose `v` runs down, `tracingSvg` turns the photo about its middle so its top row stays at the greatest `v`.
- **Fit frames the outline and what is drawn on it**: `tracingSvg(…, { forScreen: true, frameOutline: true })` (the sheet and the board card pass it) makes the box Fit frames from the cut, the layers, the dimensions and the marks, **not the photo**: a photo lined up from far away can be many times the part and Fit would show a speck (the photo frames it only when there is nothing else, and a file and Claude's picture still hold the whole photo). `Sheet.fit(avoid?)` can be given the right and bottom edges of what floats over the stage's top left, and then fits into the room right of it or below it, whichever allows the larger zoom; the tracing's panel no longer floats there (it is in the card), so the view passes none. **Export** on the panel opens the sheet on that tracing (`actions.exportSheet(of, tracing)`, `exportTracing`: the SVG kind with its drawing chosen).
- The layers' colours are the `--layer-*` tokens (`shared/tracings.ts` `LAYER_COLOURS`): the window draws a layer by its class
  (`tr-layer-<colour>` sets `color`, shapes use `currentColor`); a file takes `LAYER_INKS`, which `contrast.test.ts` holds to the light
  tokens. None is red or green.
- The tools: `Palette.tsx` (the reed's look: round buttons in pills, the tool in hand an accent circle growing its name, key and choices, `tracingPillOf`: Trace's Line, Circle and Label, Ink's pens; Select, Pin, Ink, Measure and Should be here, and a Show in 3D switch that is no tool), `tool` and `trace` in the store, keys of scope
  `tracing` (`shared/keys.ts`: `tracing.pin`, `tracing.ink`, `tracing.measure`, `tracing.offset`, `tracing.nudge`, …; the photo's line-up has the scope `lineup`). Pin, Ink, Measure and Should be here are in `pinTool.ts`, `inkTool.ts`, `measureTool.ts` and `offsetTool.ts` (classes with no DOM, as Trace is); the marks they make are placed, checked and valued by main (`main/tracings/marks.ts`, `measures.ts`, `spans.ts`). Show in 3D is `state/tracingsIn3d.ts` and `viewport/tracings.ts`: its picture is decoded through an `<img>`, because the window's policy refuses `fetch` of a `blob:` address. **Trace** is `traceTool.ts` (a class, no DOM: `click`, `end`, `back`, `cancel`, `text`, `elements` for the draft) and
  **Measure's and Should be here's words are tags** with leaders (`TracingView`, `Tag` with `subjectClient`, in window pixels from `Sheet.toScreen`, placed again by `tagsMoved` of `ui/view/useTagAt.ts` whenever the pointer or the sheet moves; no button, they take no pointer): `tracing-measure` at the middle of the line so far (the number large with `≈` unless both ends are snapped, `MeasureTool.reading`, and how it was taken) while the second end is chosen, `tracing-offset` tied to the ghost (`OffsetTool.ghostAt`, the shape's reference point where it was) with the words of `readout()` while a shape is in hand, after its release too. Their words are set on their elements as the pointer moves (`showTags`); React only says whether each is there. There is no "Tell Claude" button: the mark is a draft and goes with the next prompt. `.tr-pointer-hint` keeps only what the pointer snapped to.
  `snap.ts` (`snapAt`: 10 px, `Ctrl` is none, corners then centres then plain then projected vertices at the same place). What is under
  way is drawn on `.tr-draft`, written on the element from the pointer, never state; only a label's field is React state. With Trace a
  left press that moves under 4 px is a click, a longer one pans. A free click is kept to 1e-4 mm, a snapped one in full.
