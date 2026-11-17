# Tracings: true-scale 2D of the model over a photo (#174; piece 4 of #173)

A **tracing** is the model laid flat in one plane, at true scale, on a millimetre grid: the exact outline the kernel
cuts on a face, a main plane or a section plane, redrawn after every build, with a photo underneath that the person
lines up by two or four points. Claude adds named, coloured layers in the tracing's millimetres ("trace the front of the
block"); the person reviews on it with pins, ink and measures, and drags a layer's shape to where the photo has it
("should be here"). The issue calls these "sheets"; Luis named them **tracings**, because "sheet" already means torno's
overlay panels (the export sheet, the scan sheet). Refs are `T1`, `T2`, …, given by main, never reused (Luis's decision).

The design canvas holds the mockups `Drawing-A`, `Drawing-B` and `Drawing-C` (row 7). Luis chose **all three, as one
flow**: A is the tracing view, B is lining up the photo, C is the tools and the "should be here" drag. **All of the
issue goes in this one PR, built in three phases** (Luis's decision): 1) the tracing, its outline, layers, Claude's
tools, the board card and the export; 2) the photo and lining it up; 3) review on a tracing (pins, ink, measures,
offsets, Show in 3D, the prompt lines). Each phase ends with every suite green.

Builds on 3D sketches (PR #200: its snap data, its sketch mark, its `planes.ts`) and on reviews (#172: want / don't
want on every mark).

## Why

Tracing a part from a photo happens outside torno today: a script per view writes an SVG, the photo's scale goes in a
comment, and nobody sees the two together or can point at a spot without opening files by hand. A true-scale tracing
over the photo it was traced from shows at a glance where the model is wrong, and gives the person and Claude one place
to say so in millimetres. Part of it exists: exporting a section already writes a true-scale SVG or PDF from the exact
geometry, with a title block and a scale bar (`main/export/sectionSvg.ts`). A tracing is that, shown in the window,
kept, and worked on.

## Goals

- **A tracing** (`T<n>`) on a planar face, a main plane (XY, XZ, YZ at an offset) or the section plane on screen, of one
  layout, at true scale. Its outline is the kernel's exact cut (`section`), redrawn after every successful build. It
  has a name and a title block naming the project, build, plane and axes.
- **A third view**: the main area's switch is **Board | Model | Tracing** (Luis's decision), `Ctrl+Tab` cycles them. A
  tracing is also a card on the board, which appears by itself.
- **Claude makes tracings and adds layers**: named, coloured layers of polylines, circles and labels in the tracing's
  mm. Claude reads tracings, their layers, their photo's line-up and the marks on them.
- **A photo underneath**, lined up by 2 points (scale, angle, place) or 4 (straightened, for a photo taken at an
  angle), faded, hidden or swapped. Its scale and angle are kept and told to Claude, always as not exact.
- **Review on the tracing**: pins, ink and measures, in mm, on the tracing or the photo. **They are marks** in the
  tracing's plane (Luis's decision): their coordinates turned into mm in the object frame, so they go draft → sent →
  resolved, show in 3D, and carry want / don't want like every mark.
- **"Should be here"**: a new mark kind, **`offset`** (Luis's decision). The person drags a layer's shape to where the
  photo has it; it is told as `head bolt 3: 1.8 mm left, 0.6 mm up on T1`, and shows in 3D as an arrow.
- **Show in 3D**: the tracing, its layers and its photo in the model view, translucent, in their plane.
- **Export** of a tracing as a true-scale SVG or PDF, from the export sheet.

## Non-goals (later)

- Edges beyond the plane (a projected view with hidden lines removed). A tracing shows the cut only (Luis's decision;
  a follow-up issue tracks the projected view).
- Several photos under one tracing, or a photo lined up to a curved surface.
- A tracing that compares two builds (the outline of h40 faint under h41). The board's build cards and Compare do that.
- Dimensions in the tracing kept to a value (`expected ± tolerance` on a tracing measure). A dimension mark of the
  model keeps doing that, and the export draws those that lie in the plane, as today.

## Anti-goals

- A tracing never changes the model, and nothing on it does: a layer, an offset, a line-up.
- No outline from the mesh. The outline is the kernel's, from the B-rep, or there is none ("build to see it").
- Nothing from a photo is ever told as exact: not its scale, not a point clicked on it, not an offset, not a measure on it.
- Photos never travel in git, and are never deleted but through `dropped.json`.
- Claude never lines up, swaps, fades or removes a photo, and never changes or removes a tracing of the person's (it may
  add layers to one).
- No second store of marks: marks on a tracing are in `marks.json` with the rest.
- No per-frame state in React: panning, zooming, dragging and the pointer readout move by refs and transforms.
- No control-room look, per spec section 10 and `styles/tokens.css`. UI text in sentence case, numbers and refs in the
  monospace face.

## Constraints

- **The kernel never writes a file.** The supervisor only imports; workers cut. Kernel stdout carries frames only.
- **Every number told to Claude is the kernel's and says whether it is exact** (`exactness-app`). An outline's points
  are within the deflection the kernel says. A photo's alignment is never exact.
- **Photos stay local**: under a folder that ignores itself for git, swept only through its own `dropped.json`
  (`main/dropped.ts`), as `board/pictures/` and `notes/` are.
- **The plane, the layers, the marks and the line-up travel in git**, with one writer (main), one change at a time,
  written atomically (`writeFileAtomic`) before it is told. `T<n>` and layer ids are main's, never reused.
- **Never write inside the workspace but under `<object>/.torno/`.** Tracings add no write exception to `workspace-writes`;
  a saved export goes through `askWhere` and `writeExport` as every export does.
- Coordinates crossing a process boundary are in the object frame of the tracing's layout, mm, Z up; a tracing's own
  `[u, v]` are named so (`uv`), and the frame that turns them into the object frame is stored with the tracing.
- Images for Claude: long edge at most 2000 px, default 1280 (`checkedImage`). A photo the person keeps for a tracing is
  not for Claude and may be larger (as the person's own picture, `MAX_PICTURE_EDGE`); what is sent of it is scaled down.
- Numbers shown go through `shared/format.ts`; numbers stored and returned as data are in full.
- Tests never open a visible window (`show: false` under `TORNO_TEST=1`, no `page.screenshot()`, no clipboard) and never
  run the real `claude` (the stand-in agent, `TORNO_AGENT_CMD`).

## Approaches

### Where tracings are kept

- **One file, `<object>/.torno/tracings.json`, beside `marks.json` (recommended).** `{ next, tracings }`, one writer
  (`main/tracings/store.ts`, made as `marks/store.ts` and `board/store.ts` are), one atomic write per change, one place
  for the `T<n>` count. The local files (photos and their straightened copies) live in
  `<object>/.torno/tracings/photos/`, which ignores itself. A git pull is handled as the board does: before every write
  main compares the file with what it last read or wrote and builds on the disk's version. Layers make the file bigger
  than `marks.json`, but within caps (below) it stays a few hundred kB at worst.
- *One file per tracing, `.torno/tracings/T1.json`.* Git merges two people's edits to different tracings more easily,
  and a large tracing is rewritten alone. But the count of ids needs a file of its own, a removal and its undo span two
  files, and the photos folder must sit beside tracked files with its own ignore. More moving parts for a merge benefit a
  one-person tool rarely needs.
- *Tracings as a mark kind in `marks.json`.* One store, but a tracing is a place to work, not a request: it is never
  "resolved", its marks would be marks inside a mark, and `T<n>` (Luis's decision) would come from the `M<n>` count.

### How the tracing view is drawn

- **SVG in the page, the photo as an `<image>` under it (recommended).** The outline, the grid, the layers and the
  marks are SVG elements in a layer whose transform is set directly on the element for pan and zoom, as the board's
  layer is: nothing is drawn again by React while panning. SVG gives crisp lines and text at any zoom, hit-testing of
  layer shapes for the drag, and is the same picture the export writes: one pure function, `tracingSvg`, makes the
  tracing's elements for the view, the export, the card and Claude's picture. The photo is shown **straightened**: once
  lined up, the window warps it once into the tracing's mm (a plain image placed by a rectangle), so SVG never needs a
  perspective transform (my call; see "The photo").
- *A 2D canvas.* Fast for very large outlines, but every pan redraws, text and hairlines blur at odd zooms, hit-testing
  is by hand, and the export would be a second tracing of the same thing.
- *three.js in the 3D viewport, with an orthographic camera locked to the plane.* Show in 3D would come nearly free,
  but the tracing view would share the viewport's state (section, explode, marks layer), a mm grid and a title block are
  awkward there, and the board's rule (the 3D view stops tracing while another view is shown) would break.

## Design

### The tracing

`Tracing` in `shared/tracings.ts` (the new code is `tracings`, plural, so it stays apart from the view note's ink in
`shared/tracing.ts`, `sessions/tracing.ts` and `ui/tracing/`, which keep their names; my call):

- `id`: `T<n>`, main's. `by`: `'person' | 'agent'`, main's. `name`: one line, at most 80 characters ("Tracing T3" when
  empty). `layout`. `createdAt`. `revision`: the build it was made on (dropped on load as revisions restart per run, as
  `checkedRevision` is), and `build`: that build's history id and `sources` hash, as a round keeps them.
- `plane`: `{ origin, x, y, label, from }`, an orthonormal frame in the object frame (normal = x × y), the label as
  `planes.ts` makes them (`XZ at y = 40 (u = +X, v = +Z)`). `from`:
  - `{ kind: 'main', axis, offset }`: `mainPlaneFrame`.
  - `{ kind: 'face', ref, tag?, revision }`: a planar face, its axes from `axesOfNormal`. After each build main
    finds the face again (its tag first, else the planar face of that part parallel to the plane and nearest its origin
    within the part's tolerance, through `nearest`) and **moves the plane along its normal** to it; `x` and `y` never
    change, so the photo, the layers and the marks keep their `uv` (my call). A face that is gone or no longer parallel
    leaves the plane where it was and the tracing says `block/F31 is not in this plane any more` (told to Claude too).
  - `{ kind: 'section', origin, normal }`: the section plane on screen when it was made, frozen; its axes are the
    kernel's (`section`'s `x` and `y`), so the tracing matches today's section export.
- `parts?`: the parts drawn, by name; absent means every part of the layout. The window offers the parts switched on.
- `layers`: `Layer[]` (below). `photo?`: `TracingPhoto` (below).
- Caps (my call): 50 tracings per project, 20 layers per tracing, 500 shapes per layer, 20 000 points per tracing.

`tracings.json` is `{ next: number, tracings: Tracing[] }`. Main reads it with `readTracings`, which drops what is not
whole and keeps the file aside (`tracings.json.corrupt-*`) as the board does, and says so through `tracings:problem`.

### The outline

- Main asks the kernel `section` of the tracing's plane and parts, of the last good build, within `SECTION_DEFLECTION`
  (0.01 mm), in full, as the section export does. It is never stored: it is of a build, and is kept in memory by
  `(objectId, tracing, revision)`, the last two builds per tracing.
- **Redrawn after every build**: after a successful build of the tracing's layout, main cuts again each tracing that is
  shown (the tracing view, a visible board card, Show in 3D) and tells the window (`tracings:outline`); others are cut
  when next asked (my call: a project with 30 tracings does not cut 30 planes per build). While a build runs or has
  failed, the tracing shows the last good outline and says of which build, as the status line does.
- **The kernel's `section` gains snap points** when asked (`snaps: true`; the `section` MCP tool does not ask and its
  answer is unchanged): per loop, `corners` (the ends of each cut edge, `[u, v]`, from the B-rep intersection) and
  `circles` (each cut edge that is a circle: centre `[u, v]` and radius). They are exact, as the loops' areas are. The
  3D sketches' snap data adds the part's vertices and hole centres that lie within 0.01 mm of the plane (a face
  tracing's own corners); one further away is offered too, drawn fainter and recorded `projected` (as a sketch does).
- An outline drawn: closed loops filled in the paper tone with the ink line, holes cut out, open loops (a surface) as
  lines; each part's name at its largest loop, in the muted ink; the parts in the layout's colours only as a thin tab
  beside the name (my call: the tracing reads as a tracing, not a render).

### Layers

`Layer { id: number /* within the tracing, main's */; name; colour; by: 'person' | 'agent'; hidden?: true; shapes; revision }`:

**Both the person and Claude make layers** (Luis's decision). The person adds a layer from the layers panel and traces
into it with a **Trace** tool (polyline, circle, label, snapping to the outline's exact corners and hole centres; points
on the photo are free); each edits and removes only their own layers (Claude's through `add_layer`, the person's through
`tracings:layer`, main-checked as `add_layer` is). Either's shapes can be dragged with "should be here".


- `name`: at most 60 characters on one line ("water jacket", "head bolts"); unique within the tracing.
- `colour`: one of eight named layer colours (`blue`, `teal`, `violet`, `ochre`, `plum`, `slate`, `sky`, `olive`), new
  tokens `--layer-*` in `styles/tokens.css` with light and dark values. Red and green are not among them: they are the
  person's and Claude's (my call).
- `shapes`: `{ name?, kind: 'polyline', points: [u, v][], closed? } | { name?, kind: 'circle', centre, radius } |
  { kind: 'label', at, text }`. A shape's `name` ("head bolt 3") is how an offset names it; one without a name is
  "shape 4 of head bolts".
- `hidden` is the person's toggle (it travels), on any layer. The person may hide any layer and remove their own; Claude
  changes or removes only its own.
  A layer that is replaced keeps its id, so offsets on it still name it, and says "changed since" to an offset made
  before (the offset keeps its own copy of the shape, below).

### The photo

`TracingPhoto`:

- `file`: `p-<12 hex>.jpg|png` in `.torno/tracings/photos/` (git-ignored, its own `.gitignore` of `*`, written by
  whoever makes the folder). `sha256` of the bytes and `width`, `height`: on a computer where the file is missing or
  is another file, the tracing says "photo not on this computer", and its line-up is still told.
- `caption?`: the person's words for it. `from?`: `reference/photo-2.jpg` when it was taken from the project's
  references (a copy is kept, so a reference edited later does not move the line-up).
- `pairs`: `{ photo: [x, y] /* px of the kept file */, uv: [u, v], snap?: { corner | centre | vertex: ref } }[]`, 2 to 8.
- `method`: `'similar'` (from 2 points or more: scale, angle, place) or `'straight'` (from 4 or more: a homography).
- What main works out from the pairs, never taken from the window (`MAIN_ONLY` of a tracing): `transform` (a 3 × 3
  matrix from photo px to `uv` mm), `scale` (px per mm at the tracing's centre), `angle` (degrees the photo was turned),
  `fit` (the root mean square of the residuals in mm, only when there are more pairs than the method needs; else
  none, said "no spare point to check it"), `straightened?` (the name of the warped copy, below).
- `fade` (0 to 1, default 0.5) and `hidden?: true`: the person's, and they travel (my call: a tracing opened on
  another computer looks the same).
- **Kept size**: the window decodes the photo (EXIF turn applied, as `prepareImage` does), scales it to at most
  4000 px on the long edge and sends PNG or JPEG bytes; main checks them with `checkedPhoto` (as `checkedPicture` does:
  a PNG or JPEG by its header, at most 4000 px and 25 MB) and names the file. 4000 px, not 2000: the line-up is only as
  good as the clicks, and the photo is not for Claude (my call). What goes to Claude is scaled to 1280 (2000 at most).
- **Straightened copy** (my call): after a line-up the window warps the photo through `transform` into the tracing's
  mm, at the photo's own px per mm and at most 4000 px, in a worker (inverse mapping, bilinear), and sends it; main
  checks it and keeps it as `s-<12 hex>.jpg|png` beside the photo. The view, the card, Show in 3D, Claude's picture and
  the export all place that one image by a rectangle in mm. On a computer without it but with the photo, the window
  makes it again.
- **Swap**: choosing another photo keeps the tracing-side points of the pairs and asks only for the photo's clicks;
  the old file and its straightened copy are listed in `dropped.json`. **Remove photo** lists them too.
- **The sweep**: `.torno/tracings/photos/dropped.json` through `main/dropped.ts`, swept once per project per run when
  it is first opened, as `PictureSweep` does: a listed file goes only if no tracing names it, nothing removed in this
  run (whose undo could bring it back) does, it is a plain file and older than a minute. An unlisted file is never
  deleted.

The maths is pure, in `shared/lineup.ts`, beside `shared/align.ts` (whose `fitPairs` is 3D and rigid): a similarity by
least squares from 2 points or more; a homography by the direct linear transform from 4 or more, refused when three of
the photo's points are nearly in a line (`ALMOST_IN_LINE`'s words) or the fit folds the plane. With exactly 2 or 4
points the fit passes through them and has no residual to report.

### The tracing view (Drawing-A)

- The main area's switch is **Board | Model | Tracing**. `Shown` (`state/board.ts`) becomes `'board' | 'model' |
  'tracing'`; the row `board.swap` (`Ctrl+Tab`) cycles the three, skipping Tracing in a project with none, and its text
  in `shared/keys.ts` and the manual's key table changes (`readme.test.ts`). The 3D view stays mounted and stops tracing
  while a tracing is shown, as for the board.
- The head of the view: the tracing's picker (`T1 Front of the block`, then the others, then **New tracing**), its
  plane label, and its build (`h41`, "of build h41; building…" while one runs).
- **The sheet of paper**: the outline at its true scale on a mm grid (1 mm lines faint, 10 mm stronger, the 0 lines
  of `u` and `v` in the axis colours), the photo straightened underneath at its fade, Claude's layers over it, the
  marks on top. Zoom is shown as a ratio, `1:1` being one CSS millimetre per mm (my call: screens do not say their real
  pixel size), with **Fit** and **1:1**; a scale bar sits bottom left. A title block, bottom right, as the export's:
  project, build and source, plane and axes, scale, the photo's line-up.
- **The panel** (right, as the rail's panels): "Model outline" with `exact` beside it and its parts; "Layers", each a
  row with its colour, name, shape count, by Claude, a show/hide toggle and Remove; "Photo": its thumbnail, scale
  (`4.73 px/mm`), angle (`2.1°`), method and fit (`4 points, straightened, fit 0.4 mm` or `no spare point to check
  it`), always with "not exact", a fade slider and Hide; then **Line up again**, **Swap photo**, **Show in 3D** and
  **Export**.
- **New tracing**: on a main plane (XY, XZ, YZ, an offset typed), on the section on screen (also from the Section bar:
  "Make a tracing of this cut"), or on a face (the view goes to the model, a planar face is picked, and the tracing
  opens). A face that is not planar is refused in words.

### Lining up the photo (Drawing-B)

- **Add photo** (the panel, or dropping a picture on the view) takes a picture from a drop, the photo dialog
  (`pickPhotos`, under test `__tornoMain.pickPhotos`), or the project's `reference/` photos.
- The view splits: the photo on the left, the tracing on the right, each with its own pan and zoom. The person clicks
  the same spots in order, photo then tracing, numbered `1`, `2`, … in the same colour on both sides. A click can be
  moved by dragging its marker, and `Backspace` takes the last one away.
- **Tracing points snap** to exact corners and hole centres (above) within 10 px, `Ctrl` held to not snap (as in a
  sketch); the pointer hint says what it snapped to (`corner of the cut`, `hole centre head/E14 ⌀16`).
- A switch **Straighten (4 points)**, off by default; on, it needs 4 pairs and fits a homography.
- **The bar** shows, live, `scale 4.73 px/mm · angle 2.1° · fit 0.4 mm (5 points)`, and the photo is shown faded over
  the tracing in a small preview as soon as the method has its points. **Done** sends the pairs and the method
  (`tracings:lineUp`); main fits them itself and keeps the result. **Cancel** leaves the line-up as it was.
- A sentence under the bar says what a line-up is worth: "True only in the tracing's plane: what stands nearer the
  camera looks bigger."

### Tools on a tracing (Drawing-C)

A palette on the view's left edge, with keys in a new scope `tracing` of `shared/keys.ts` (letters the builder picks,
checked by `keys.test.ts`, in the manual's table): **Select**, **Pin**, **Ink**, **Trace** (into the person's layer
chosen in the panel; see Layers), **Measure**, **Should be here**, **Show in 3D**. A pointer readout at the bottom gives `u, v` in mm and, over the photo, says "on the photo, ≈".

Every mark made here carries `tracing: 'T1'` (a new optional key of `MarkBase`, checked by main: the tracing exists, is
of the mark's layout, and every point the mark holds lies in its plane within 1e-6 mm), and the reviews' intent bar
applies as with any tool.

- **Pin**: a `pin` mark at the clicked point, in the object frame. On the outline (within the part's tolerance of a
  face) its anchor is `anchorFor` that point, with ref and descriptor as any pin; elsewhere (inside the cut, on the
  photo) it is a point in empty space (`Anchor` without `part`), as the anchor type already allows. Its note is typed
  in place.
- **Ink**: a `sketch` mark with one plane, `from: { kind: 'tracing', tracing: 'T1' }`, whose frame is the tracing's,
  and plane strokes in `points2d` (the tracing's `uv` are the plane's). Freehand, line and point to point, with the
  sketch's snapping to the tracing's points; `take` rough by default. So ink on a tracing is a sketch, told and shown
  as one (my call: one way to draw).
- **Measure**: a `span` mark (see "Builder's questions, settled") between two points in the plane, with `on: 'tracing' |
  'photo'` per end (main's to judge):
  - both ends snapped to the kernel's points (a corner, a hole centre, a vertex in the plane) give an **exact** value,
    worked out by main from those kernel numbers and measured again after every build from the same refs (a corner by
    its cut edge's ref, a centre by its edge's ref);
  - any end on the photo or not snapped gives `≈ 41.8 mm`, said "on the photo, lined up with fit 0.4 mm" or
    "freehand", never exact, and not measured again.
- **Should be here** (below).
- **Show in 3D** toggles the tracing in the model view (below).
- **Select** selects a mark or a layer shape; Delete removes the person's marks (undo as for any mark).

### "Should be here": the `offset` mark

`OffsetMark extends MarkBase { kind: 'offset'; tracing; layer; shape; was; by; from; to }`:

- `layer` (its id and name), `shape` (its index and name), `was`: a copy of the shape as it was when dragged (so the
  mark still says what moved after Claude replaces the layer), `by: [du, dv]` in mm along the tracing's axes, and
  `from`, `to`: the shape's reference point (a circle's centre, a polyline's centroid) before and after, in the object
  frame.
- Dragging a layer shape with the tool shows the shape ghosted where it was, the moved copy in the person's colour, and
  a readout at the pointer, `1.8 mm left, 0.6 mm up`; `Shift` keeps the drag to one axis, arrow keys nudge it 0.1 mm.
  Releasing makes the mark (one per drag; dragging the same shape again changes the draft's `by`).
- Told as `M12 · offset · head bolt 3: 1.8 mm left, 0.6 mm up on T1 (≈, from the photo)`, then the move in the object
  frame (`(−1.8, 0, +0.6) mm in X, Y, Z`), the layer, and the photo's line-up. "Left" and "up" are along `−u` and `+v`
  as the tracing is shown; the plane label says what they are.
- Never exact; never checked against a build (it is about a layer, not the model): `anchorState` stays `ok`, and the
  mark says "layer changed since" when the layer's revision is newer than the mark's.
- In 3D an arrow from `from` to `to` in the author's colour, its chip at `to`. On the board, its mark card.

### Show in 3D

- A tracing shown in 3D (a toggle per tracing, kept in `scene.json` as `tracingsShown`, view state, never sent as a
  change) is drawn in its plane: the straightened photo as a textured quad at its fade times 0.6, the outline as lines
  in the ink colour, the layers as lines in their colours, all with depth writing off so parts show through. It is
  sized to the outline's bounds and the photo's rectangle, plus a margin.
- It is not cut by the section, as marks are not; it is hidden with "Marks hidden" only if the person hides tracings
  too (a row in the layers panel, "Tracings", with each shown tracing; my call).
- `look` pictures draw it when it is shown, so Claude sees it.
- Marks on a tracing show in 3D as their kinds do (a pin, a sketch, a dimension line, an offset arrow), shown or not
  with the marks, whether the tracing is shown in 3D or not.

### On the board

- A new card kind, `tracing` (`CardKind`, `AUTO_KINDS`), `source: 'T1'`: it appears by itself when a tracing is made,
  hiding it only hides it, and it goes when the tracing goes, as a mark's card.
- Its face is drawn live by the window from `tracingSvg` (the outline of the last build main has, the straightened
  photo when it is on this computer, the layers), with the name, the plane and the counts (`3 layers · 5 marks`); no
  file is written for it (my call). With no build of this run it shows the name and "build to see the outline".
- A double click opens it in the Tracing view. The board text says `C9 · tracing T1 "Front of the block": XZ at y = 0,
  3 layers, photo lined up (4.73 px/mm, ≈)`. A card is new to Claude when the tracing's name, plane, layers or line-up
  changed, not its fade.
- The chat's ref pattern (`REF` in `shared/chat.ts`) learns `T<n>`: a chip whose click opens that tracing.

### What Claude gets

- **In every prompt**, one line when the project has tracings, inside `CONTEXT_LIMIT`: `tracings: T1, T2 (1 changed
  since you were told: T1's photo was lined up again). Read them with tracings.` What Claude was told of each tracing is
  kept in `.torno/tracings/told.json` (git-ignored, written once the prompt is delivered, as the board's `told.json`).
- **Marks on a tracing** go as drafts go, each line saying `on T1`, with the photo's line-up when the mark is on the
  photo or is an offset.
- **`tracings`** (new, read-only): the list, or one tracing by id: its plane and how it was made (`plane of block/F31,
  followed 0.3 mm along its normal since h40`), the build its outline is of, the outline per part (area, loops, bounds,
  and the points thinned as the `section` tool tells them, with the deflection), the layers with every shape in mm,
  the photo (`lined up by 4 points, straightened: 4.73 px/mm at the centre, turned 2.1°, fit 0.4 mm; not exact, and true
  only in the tracing's plane`, or that it is not on this computer), and the marks on it by id. With `picture: true` it
  sends a picture of the tracing (the window draws it from `tracingSvg`, with the photo and a 10 mm grid, at 1280 px or
  `size` up to 2000, checked by `checkedImage`) with what maps it to mm (`1 px = 0.212 mm; u = 0 at x = 140, v = 0 at
  y = 860, v up`), so Claude can trace in mm from what it sees. The photo goes to Claude only in that picture, which
  Claude asks for (my call).
- **`add_tracing`**: a tracing of Claude's own on a main plane (`{ main: 'XZ', offset }`), a face (`{ face:
  'block/F31' }`, planar, of the last build) or a plane (`{ origin, normal }`), with a `name` and `layout?`;
  `tracing: 'T3'` with `remove: true` removes one of Claude's own. A tracing of the person's is refused by name of its
  owner.
- **`add_layer`**: on any tracing (the person's too), `{ tracing, name, colour, shapes }` makes or replaces (by name)
  a layer of Claude's; `remove: true` removes it. Caps hold; every number finite and within 10 diagonals of the
  tracing's outline. A layer is told back with its id.
- Both new tools are in `TOOLS` with a title, annotations (`tracings` `readOnlyHint: true`), a line in
  `SERVER_INSTRUCTIONS` (under its 4,096 characters), and the manual (`readme.test.ts`); none is loaded upfront.
- The agent prompt (`agent-prompt` rule) gains a sentence: a tracing is the model flat in a plane over a photo; to trace
  the photo, look at it with `tracings picture: true` and add layers in mm; a photo's numbers are never exact.

### Export

- The export sheet's reader "A tracing of a section" becomes **"A tracing"** (`ofView` still): the section on screen, as
  today, or one of the project's tracings (a list of `T<n>`). For a tracing it offers "Layers" (on), "Marks on it"
  (off, as marks are in an HTML export) and "The photo" (off by default: it may show the real world, said as the scan
  warning is).
- `sectionSvg` is generalised to `tracingSvg(cut, info, extras)` (pure, `main/export/tracingSvg.ts`, the section export
  calling it with no extras): in millimetres as today (width, height and viewBox in mm), the outline, the dimension marks
  in the plane as today, the layers in their colours with a legend, the tracing's marks, and the straightened photo as
  an embedded `data:` image placed by its rectangle in mm. The title block adds the tracing's ref, name and plane, and
  the photo's line-up when it is in. A PDF is `pdfOfSvg` as today (its hidden window allows the `data:` URL alone).
- `export:saveTracing(objectId, tracingId, 'svg' | 'pdf', { layers, marks, photo })`: main makes it of the last good
  build (`NEW_BUILD` when one lands meanwhile), asks where (`askWhere`, opening in `.torno/exports/`, default name
  `<project>-T1-r<revision>.svg`) and writes it through `writeExport`. The window sends ids and ticks, never a path or
  bytes (the straightened photo is read by main from its folder).

### Storage and IPC

- `tracings.json` travels in git with `marks.json` and `board.json`; `.torno/tracings/` (photos, straightened copies,
  `dropped.json`, `told.json`) does not. Everything is written under `.torno/` through `ownTorno` and `writeOwn`: a
  link or a file in the place of a folder is refused.
- `TracingStore` (`main/tracings/store.ts`) is the one writer: `make`, `edit` (name, parts), `remove` and `restore`
  (by id; the last 20 removed per project kept in memory, whole, as the board keeps cards), `setPhoto`, `lineUp`,
  `setLook` (fade, hidden), `setStraightened`, `agentTracing`, `agentLayer`, `hideLayer`, `removeLayer`. `id`, `by`,
  layer ids, `transform`, `scale`, `angle`, `fit`, `file`, `sha256` and `straightened` are never taken from the window
  or a tool.
- IPC (window → main, in `shared/bridge.ts`): `tracings:list(objectId)`, `tracings:make`, `tracings:edit`,
  `tracings:remove`, `tracings:restore`, `tracings:photo(objectId, id, bytes, from?)`, `tracings:lineUp(objectId, id,
  pairs, method)` (snaps checked against the last build's snap points, a snapped point replaced by the kernel's, one
  more than 0.01 mm off refused), `tracings:look(objectId, id, { fade, hidden })`, `tracings:straightened(objectId, id,
  bytes)` (accepted only for the photo and transform it was made from, named by their hash), `tracings:outline(objectId,
  id)`, `tracings:photoBytes(objectId, id, 'photo' | 'straightened')`, `marks:offset(...)` (through `MarkStore`, as
  `marks:sketch`), and `export:saveTracing`. Main → window: `tracings:changed`, `tracings:outline`, `tracings:problem`.
- A removed tracing's marks stay (they are in the object frame) and say `on T1 (removed)`; restoring the tracing joins
  them again.

## Builder's questions, settled (my calls)

- **Marks on a face tracing whose plane moves.** A mark placed on a tracing keeps `tracing: 'T1'` and its points in
  the tracing's `uv` beside its object-frame points; when a build moves the tracing's plane along its normal, main
  moves those marks with it (one rewrite in the turn of the marks, as the `arranged` shift does), so they stay in the
  plane. The in-plane check is made on placing and after each such move.
- **A measure on a tracing is a new mark kind, `span`**, not a dimension: two ends in the plane, each `snapped` to a
  kernel point of this build or `free` (on the outline or on the photo). Its value is main's: exact only when both ends
  are snapped, worked out from the kernel's numbers of the build it was placed on and said "exact on build N"; else
  `≈`, with how (on the photo, fit 0.4 mm; or freehand). It has no `expected` and no verdict, and is not re-measured;
  after a build it says "measured on build N". The `dimensions` rule is untouched.
- **Snap refs on a cut.** The kernel's `section` gains, per loop, its corners and the centres of its circular arcs as
  points, and for an arc that lies on a circular model edge in the plane that edge's ref. Corners carry no stable ref
  (a cut corner is no model vertex): they are snapped by point, exact for that build. A `span` keeps its points, not
  refs, so a rebuild never silently re-targets it.
- **`SERVER_INSTRUCTIONS`** is near its 4 096-character cap: the three new tools share one line, and the builder may
  shorten existing lines to fit, keeping their meaning; `schemas.test.ts` holds the cap.
- **Base**: the branch stacks on `work/reviews` after its final review. An `offset` and a `span` carry no review
  intent (they are about a layer or a measure, not the model): `markIntent` is null for them, and the intent bar does
  not apply to the Should be here and Measure tools.
- **Spread layouts**: a tracing is always cut unspread, in the object frame (`Part.arranged` is not applied); a tracing
  of a layout shown spread says so in its panel.
- **Axes**: main gives the kernel's `section` the tracing's own `x`/`y` (the query gains optional axes), so every point
  comes back in the tracing's `uv`; `mainPlaneFrame` is the one rule for main planes.
- Smaller: `.torno/tracings/told.json` goes through `ensureIgnored`; tracings use `by: 'person' | 'agent'`, marks keep
  `author`; ink on a tracing is a sketch and its card picture is drawn by the window from the tracing view (the SVG
  rendered to 1280 px), not from the 3D view.

## Builder's calls

- The look of the tracing view, the panel, the split line-up view, the palette and the drag readout, within the tokens
  and the mockups Drawing-A, B and C.
- The keys of the `tracing` scope, and whether Show in 3D has one.
- The warp's code (worker, WebGL or 2D) and the straightened copy's px per mm, within 4000 px.
- How a polyline's reference point is taken for an offset (centroid of its points or of its area).
- Rounding of the points Claude is told of layers and outlines, within "the kernel's in full for data, thinned as
  `section` for text".
- Test layout: `lineup.test.ts` (similarity and homography against known transforms, refusals, fit); store tests
  (ids never reused, one writer, caps, main-only keys, pull merge, the sweep only of listed files); kernel tests of
  `section` with `snaps: true` (a box's corners, a hole's centre, exact); `tracingSvg` tests (one unit one mm, no path of
  this machine, the photo only when ticked); describe tests for the prompt line, the `tracings` text and the offset
  line; an e2e spec in the hidden window that makes a tracing on a face, adds a fixture photo, lines it up by 2
  snapped points, has the stand-in agent add a layer with `add_layer`, drags a shape with Should be here, checks the
  stand-in's next prompt carries the offset, shows the tracing in 3D, and exports an SVG through `__tornoMain.pickSave`.
