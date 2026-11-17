# 3D sketches (#169, second half; piece 4 of #173)

View notes (PR #198) made "Draw on view" keep a picture with ink. This piece does the same for drawing in space: a
**3D sketch** is one mark holding many strokes in millimetres in the project's frame, drawn on faces, on planes and
between snapped points, with a name, a comment and a word on how literally to take it. Draw makes sketches from now on.

The design canvas holds the mockups `Sketch-A`, `Sketch-B` and `Sketch-C` (row 5). Luis chose **B with C's keys and
pointer hint**.

## Why

Some ideas are routes and outlines in space: a breather hose over the block, the edge a bracket should follow, where a
boss goes on a face. A picture of the view flattens them, and today's Draw tool leaves each stroke as a mark of its own,
on a surface or on the plane of a locked view, with no snapping. Claude gets loose strokes and has to guess which belong
together and how exact they are. A sketch gathers them under one name, says how exact they are, and gives Claude the
points in millimetres, with the ones that snapped told as exact.

## Goals

- **A sketch is a mark**, `M<n>` of a new kind `sketch`: a name, a comment (`note`), strokes, and `take`: `exact`,
  `rough` (the default) or `flow`. A flow sketch may carry a diameter and is then drawn as a translucent tube.
  `take` and the diameter are per sketch.
- It has everything marks have: draft → sent → resolved, "To review", `resolve_mark`, reopened when edited after it
  was sent, a card on the board that appears by itself, undo of a delete.
- **Drawing on:** a part's surface (painted), the plane of a face, a main plane (XY, XZ, YZ), or a plane through a
  picked point at a typed offset. One sketch can hold strokes on several planes and on surfaces.
- **Pens:** freehand, straight line, and point to point (a polyline of clicks). Snapping to vertices, edges and hole
  centres, from exact data the kernel sends with each build. **X-ray** lets strokes be drawn and seen inside parts.
- **The look (Sketch-B + C):** the active plane is drawn in the view as a grid sheet with a handle to drag its offset
  (or type it); a view cube in the corner picks a main plane; a sketch panel holds the name, `take`, the diameter,
  strokes listed by plane, and the comment. Keys switch everything, and a hint at the pointer says what it snapped to
  and the length of the segment being drawn, which can be typed.
- **Shown in 3D** with the marks, in the author's colour (the person's red, Claude's green), hidden when marks are
  hidden; and on the board as its mark card with a picture of it.
- **Claude** gets each stroke's points in mm, its plane, what it touches, and which points snapped (exact) versus
  freehand; it can read sketches again with `marks`, and make sketches of its own with a new `add_sketch` tool.
- Strokes on faces are checked against each build as marks are and the sketch says when they drifted; plane strokes are
  not checked.

## Non-goals (later)

- Grouping strokes with parts and faces into named groups (#171).
- Want / don't want intents (#172), which will reuse these strokes.
- Editing a single point of a stroke after it is drawn (strokes are erased and drawn again).
- Strokes that follow faces after a rebuild (Luis chose: drawn where drawn, checked, flagged).
- Snapping to a sketch's own earlier points or to a grid. (Snapping to points of the sketch is cheap and may be added
  by the builder if it falls out of the snapping code; it is not required.)
- Several pictures or Retake for view notes (the other leftovers of #169).

## Anti-goals

- A sketch never changes the model.
- Nothing about where a point is is told to Claude as exact unless it is the kernel's number: a snapped vertex or hole
  centre, or a point on a snapped edge's exact curve. Freehand and mesh-picked points are told as approximate.
- No per-frame state in React: drawing, snapping and the hint move by refs and the overlay, as the tools do today.
- No second way to draw in 3D: the one-stroke Draw goes away (old stroke marks still show and are sent).
- No control-room look, per spec section 10 and `styles/tokens.css`.

## Constraints

- `<object>/.torno/marks.json` has one writer, main (`main/marks/store.ts`), one change at a time, written atomically.
  `MAIN_ONLY_KEYS` are never taken from the window or a tool. Ids are main's.
- Coordinates crossing a process boundary are in the object frame of the mark's layout. Millimetres, Z up.
- Every number told to the agent is the kernel's and says whether it is exact (`exactness-app`).
- The kernel supervisor only imports; workers tessellate. Kernel stdout carries frames only.
- Images for the agent: long edge at most 2000 px, default 1280 (the card picture is drawn at 1280).
- Tests never open a visible window and never run the real `claude`.

## Approaches

### What a sketch is

- **A new mark kind that replaces Draw (chosen by Luis).** Marks already have the lifecycle, the check against new
  builds, "To review", `resolve_mark` and a board card. A sketch adds its strokes and planes. The same move view notes
  made.
- *A new mark kind beside the one-stroke Draw.* Two ways to draw in 3D. Rejected.
- *A board card, not a mark.* Rebuilds the lifecycle and tools, and is off the marks list. Rejected.

### Where snap targets come from

- **The kernel sends them with each build (chosen by Luis).** The tessellation gains, per part, its B-rep vertices and
  each circular edge's exact centre, axis and radius. The window snaps locally with no round trip, and a snapped point
  is the kernel's exact number.
- *Ask the kernel on hover.* No change to the build data, but a query per pointer move; laggy on the 780-part engine.
- *Work them out in the window.* Fit circles to the drawn edge segments; centres are approximate and can't be told as
  exact.

### The look

- **Sketch-B with Sketch-C's keys and hint (chosen by Luis).** The plane as a handle in the view, a view cube, a sketch
  panel; plus keys for everything and a hint at the pointer.
- *Sketch-A, a bar at the bottom.* Everything in one wide bar.
- *Sketch-C alone.* Keyboard first, little on screen; hard to discover.

## Design

### The mark

`SketchMark extends MarkBase { kind: 'sketch' }` in `shared/marks.ts`:

- `name`: one line, at most 80 characters; "Sketch" plus its id when the person leaves it empty.
- `take`: `'exact' | 'rough' | 'flow'`, default `'rough'`.
- `diameter?`: mm, only of a flow sketch, greater than 0 and at most 500.
- `planes`: `SketchPlane[]`, each `{ id: number, origin, x, y, label, from }`: an orthonormal frame in the object frame
  (normal = x × y), its label as today's (`XZ at y = 40.0 (u = +X, v = +Z)`), and `from`: how it was made —
  `{ kind: 'main', axis: 'XY'|'XZ'|'YZ', offset }`, `{ kind: 'face', ref, offset }` (a planar face; its ref at the
  build drawn on), `{ kind: 'point', point, normal, offset }` (through a picked point, its normal one of the main axes
  or the face normal there), or `{ kind: 'view', … }` for a locked standard view, as today. `id`s count within the
  sketch.
- `strokes`: `SketchStroke[]`, at most 200 per sketch, each with at most 400 points (`MAX_STROKE_POINTS`, as today),
  and at most 20 000 points in all:
  - `on`: `{ plane: id }` with `points2d: [u, v][]` in mm along the plane's axes, or `'surface'` with
    `points: Vec3[]` on the parts.
  - `pen`: `'free' | 'line' | 'points'` (a straight line is two points; point to point is a polyline).
  - `snaps?`: `{ i, to }[]`: which points snapped and to what: `{ vertex: 'block/V12' }`, `{ edge: 'block/E40' }`
    (a point on the edge's exact curve), `{ centre: 'block/E14', radius }` (a circular edge's centre). The point
    stored is then the kernel's exact one.
  - `xray?: true` when it was drawn with x-ray on (so the picture of it shows hidden strokes).
  - `revision`: the build this stroke was drawn on. Its snaps and what it touches are of that build, and told "of
    build N". A sketch reopened after later builds keeps each old stroke's revision; only new strokes are of the new
    build. Face planes carry their own `revision` the same way. (My call.)
  - `touches?`: parts and faces the stroke lies on or crosses, as main worked them out when the stroke was written
    (see "What Claude gets"). Main's key, never taken from the window.
- `anchor?`: the first point of the first stroke that lies on a face (`anchorFromHit` as today); a sketch drawn only on
  planes in empty space has none.

Vertex refs (`V<i>`) are new: the kernel's index into the part's vertices in the order it sends them. They are used
only in `snaps` and in what Claude is told; `describe` and `measure` are not extended to take them in this piece (my
call; the point itself is given beside the ref). The chat's ref pattern (`REF` in `shared/chat.ts`) learns `V<i>` so
`block/V88` shows as a chip; clicking it lights the point.

The old `StrokeMark` stays in the union so existing `marks.json` files still read, draw and are told as today. The
window no longer makes one.

### Snap data from the kernel

`PartMesh` gains two buffers, from the worker's tessellation, part-local like the rest:

- `points`: float32 xyz of the part's B-rep vertices, in kernel vertex order (`V<i>`).
- `circles`: float32, 7 per circular edge (`edge index, cx, cy, cz, ax, ay, az`) and a `radii` float32 per circle, or
  one 8-wide buffer (the builder's choice), for every edge whose curve is a circle or a full arc.

Both are cheap next to the mesh. A part with too many vertices to snap to usefully (say over 50 000) still sends them;
the window's snapping is spatially indexed (a grid or a BVH per part, built once per build, off the frame loop).

### Drawing a sketch

- **Starting:** Draw (`D`, the existing `draw` row of `shared/keys.ts`, its text updated) starts a new sketch. The
  mark is made on the first stroke (main gives the id then), so starting and leaving without drawing writes nothing. "Edit" on a sketch (marks list, board card double-click, the
  panel above the composer) reopens it in the same mode.
- **The sketch panel** (floats over the view at the left, as the rail's panels do): the chip and "draft"/"sent"; the
  name; `take` as a segmented control, and the diameter field when flow; "Planes and strokes": one row per plane and
  one "On surfaces" row, each with its stroke count, the active one highlighted, clicking a row makes its plane active,
  hovering lights its strokes; "+ New plane: pick a face or a point"; the comment; Undo and Done. Esc leaves (as Done).
- **The plane in the view:** a translucent grid sheet sized to the visible parts, its label beside it, and a handle on
  its normal: dragging moves it along the normal, and the offset shows in mm; the field in the hint takes a typed value.
  The plane is drawn with depth test off at low opacity so it reads through parts.
- **The view cube** (top right): clicking XY, XZ or YZ makes that main plane active through the current plane's origin
  (or the visible parts' centre for the first).
- **Keys** (a new scope `sketch` in `shared/keys.ts`, bound only while sketching, not while a text field has focus).
  **The view keys keep working while sketching** (Luis's decision): fit, the standard views `1`–`4`, explode, section,
  ortho. Sketch keys may shadow the single-letter keys that switch mark tools (no other tool is picked while
  sketching). Proposed: `B` freehand, `L` line, `P` point to point, `Shift+E` erase, `Shift+1`/`Shift+2`/`Shift+3`
  XY/XZ/YZ (the existing `Shift+1` row is checked and moved if it clashes), `G` plane of the face under the pointer,
  `Tab` focuses the offset field, `U` surface, `Shift+X` x-ray, `R` cycles exact/rough/flow, **`Ctrl` held turns
  snapping off** (`Alt` raises the menu bar on Linux), `Enter` finishes a point-to-point line, `Ctrl+Z` undoes the last
  stroke, `Esc` leaves. The builder may change a letter where `keys.test.ts` finds a clash, keeping the rule. The rows
  go into the manual's key table as all keys do (`readme.test.ts`).
- **Pens:** freehand samples every 3 px and is simplified on release as today (RDP 0.2 mm, at most 400 points); line is
  press–drag–release (or click, click); point to point adds a point per click, `Enter` or a double click ends it,
  `Backspace` drops the last point.
- **Snapping** (on by default; `Ctrl` held disables): within 10 px on screen, to a vertex first, then a hole centre, then
  the nearest point on an edge. **Exact edge snaps are only of straight and circular edges** (a line from its two
  vertices, a circle from `circles`), whose points main can recompute. On any other curve (B-spline, ellipse) the point
  snaps to the drawn polyline and is recorded as `{ edge, approx: true }`, told as "on block/E40, approximate". (My
  call.) Of a hole centre, the circle and its centre cross are drawn. On a plane, a snap target is
  projected onto the plane along its normal; the stored point is the projection, and `snaps` says what it was snapped to
  and that it was projected (`projected: true`), so Claude is told "the centre of block/E14, projected onto the plane".
  On a surface stroke, a snap replaces the picked point by the exact one.
- **The pointer hint:** a small box beside the pointer (overlay, not React) with what it would snap to (`vertex
  block/V88`, `hole centre head/E14 ⌀16`) and, while drawing a line or a point-to-point segment, its length in mm and
  its angle in the plane. Typing a number while drawing a segment sets its length along the current direction; `Enter`
  fixes it.
- **Erase** removes the stroke under the pointer (one undo step).
- **X-ray** draws the parts translucent (as the section or isolate tools do with their own look) so strokes inside can
  be placed and seen; picking for surface strokes goes through to the face nearest along the ray under x-ray
  (the first hit), and plane strokes are unaffected. The sketch remembers per stroke that it was drawn in x-ray, and the
  sketch's 3D display draws hidden parts of its strokes dashed.
- **Undo** inside the sketch undoes stroke adds and erases in this editing session, as one list; the window-wide undo
  of marks still undoes deleting the whole sketch.

Each change while sketching (a stroke added or erased, the name, `take`, the diameter, the comment) is sent to main as
one edit of the sketch (`marks:sketch`, below); main checks and writes it. A sent sketch that is edited is a draft again
(`sentBefore`, as other marks).

**A sketch open for editing is held back from prompts** until Done (or Esc), as a view note the prompt waits on is
today: a prompt sent meanwhile goes without it and the line under the prompt says "M7 is being sketched, not sent".
(My call.)

### Showing a sketch

- In 3D, every sketch's strokes are drawn as lines in its author's colour, 2.5 px, with the points that snapped as
  small dots; a flow sketch with a diameter as a translucent tube along the strokes (three.js `TubeGeometry` along a
  polyline curve, the author's colour at about 25 % opacity) plus the centre line. Strokes hidden behind parts are
  dashed when the sketch was drawn in x-ray, and hidden otherwise. A sketch's chip sits at its anchor, or at its first
  point.
- Hovering a sketch in the marks list or its card lights its strokes; clicking brings its camera back and selects it.
- In the marks list a sketch shows its name, `take` (and diameter), the stroke count and plane count.
- **On the board** its mark card shows the name, `take`, the comment and a picture of the sketch from its camera. The
  picture works as a view note's does (my call): the **window** draws it (the view from the sketch's camera, strokes
  included, as `look` draws) when Done is pressed, sends it to main, and main names it (`k-<12 hex>.png`) in
  `.torno/notes/`, git-ignored, with the sketch's `picture` field holding the name (a main-only key; marks.json carries
  the name, never the bytes). A replaced picture is listed in `notes/dropped.json` and swept by the existing sweep. A
  sketch Claude makes while its project is not on show has no picture until the window next shows that project, which
  draws the missing ones; until then, and on a computer without the file, the card shows the placeholder. The
  `board` rule's line that a mark card's picture is not in `board/pictures/` holds.
- In Claude's `look` pictures, sketches are drawn as the window draws them (as marks are today), so Claude "sees them in
  its pictures".

### What Claude gets

In the prompt (a draft sketch goes with the next prompt as marks do) and from `marks`:

- The mark's line: `M7 sketch "Breather hose route", flow ⌀19 mm, 3 strokes on 2 planes and the surface, from build h41`
  plus the comment, and whether the model was built again since, as for other marks.
- Per plane: its label and how it was made (`plane through block/F31 offset 12 mm`, `XZ at y = 40`).
- Per stroke: its pen, its plane or "on the surface", its length, what it touches (parts and faces it lies on or crosses,
  from main's checks), and its points in mm, **rounded to 0.1 mm** when freehand and given in full when snapped, with
  each snapped point said: `p0 = (12.000, 40.000, 31.500) exact: centre of head/E14 (r 8), projected onto the plane`.
  A stroke of many points is given as its simplified polyline; past 2 000 points in one prompt the rest are summarised
  ("… 3 more strokes, 812 points: read them with `marks`").
- How to take it, said once as an instruction: exact = "follow these points to the millimetre", rough = "the shape and
  place matter, not the exact points", flow = "a route: follow its path loosely, keep the diameter clear" (the
  wording is the builder's).
- What the parts and faces a stroke touches (`touches`): worked out by main **once, when the stroke is written**,
  against the build the stroke is of, never taken from the window, and told "of build N". A surface stroke touches the
  faces under its samples; a plane stroke touches a part when one of its samples lies within the part's tolerance of a
  face (a kernel `nearest` query on up to 8 samples per stroke, as surface strokes are checked today). The builder may
  restrict this to the stroke's ends and snaps if the query is too slow. (My call.)
- **Text only, no pictures with the prompt** (my call): Claude gets the data above and the sketch's camera with how to
  `look` from it. The 6-picture cap of a prompt is untouched by sketches. `marks` lists sketches in full; it gains no
  new argument.

### Checking against builds

- `markAnchors` returns the sketch's anchor, and `strokeSamples` returns up to 8 samples per surface stroke (up to 8
  strokes, the first and last kept), as for surface strokes today. The sketch is `drifted` when any sampled point is past
  tolerance, `orphaned` when its anchor's part is gone.
- Snapped refs (`V`, `E`) are frozen as of the build drawn on, and told "of build N".
- Plane strokes are not checked; `translated` moves plane origins and surface points by the spread offset as today.

### Claude's tool: `add_sketch`

A new `TOOLS` entry (`CHANGES_VIEW_OR_MARKS`; `mcp-tools` rule, the manual and `readme.test.ts` follow):

- Arguments: `name`, `note?`, `take?`, `diameter?`, `layout?`, and `strokes`: each `{ points: [[x,y,z], …] }` in mm
  in the object frame, or `{ plane: { origin, normal } | { main: 'XZ', offset } | { face: 'block/F31', offset },
  points2d }`, at most 50 strokes and 2 000 points. Optionally `sketch: "M9"` to replace a sketch of Claude's own, or
  `remove: true` with it.
- Main checks it as any mark: refs exist on the last build, points are finite and within reach of the layout's parts
  (within, say, 10 times the scene's diagonal), caps hold. Claude's sketch is `author: 'agent'`, drawn green, and
  appears as a card. It refuses any change to a sketch of the person's.
- Claude's own sketches are not new to Claude and are not sent back to it with prompts (as its marks today).
- `add_mark` refuses `kind: 'sketch'` and `kind: 'stroke'`.
- The agent prompt (`agent-prompt` rule) gains a sentence: a sketch says how literally to take it; follow `take`; use
  `add_sketch` to show a route or an outline to the person.

### Storage and IPC

- The sketch is in `marks.json` with the other marks. Its one file is its card's picture, `k-<12 hex>.png` in
  `.torno/notes/` (git-ignored), named in its `picture` field and listed in `notes/dropped.json` when replaced (see
  "Showing a sketch").
- `marks:sketch` (window → main): `{ objectId, id?, layout, revision, camera, name, note, take, diameter?, planes,
  strokes, anchor? }`. Without `id` it makes the sketch (on the first stroke), with `id` it replaces those fields of the
  person's sketch. Main checks every number is finite, planes are orthonormal (re-orthonormalising within 1e-6 and
  refusing worse), and the caps. **Snaps are checked only on strokes that are new or changed in this edit** (compared
  with the stored sketch), against the build they name, which must be the last build: their refs must exist there and
  the snapped point must be the kernel's (main recomputes it from that build's snap data and refuses one more than
  0.01 mm off; an `approx` edge snap is checked only for its ref). Unchanged strokes keep what main stored for them,
  whatever the window sends. `MAIN_ONLY_KEYS`, `touches` and `picture` are never taken from the window; the picture
  comes through its own call (`marks:sketchPicture`, bytes checked as `checkedImage` does).

### "Sketch" means one thing: the board's card becomes "Doodle"

The board's flat ink-pad card (`kind: 'sketch'` in `shared/board.ts`) is called **Doodle** in everything a person or
Claude reads (Luis's decision): the palette's tool and its key row (`board.sketch`, label and text), the card's kind
line, the board's text form told to Claude, the `add_card` and `board` tool descriptions, the manual. This matches the
new-project page's Doodle, which uses the same ink pad. Identifiers, the `kind` stored in `board.json` and file names
keep `sketch`, as "object" stays in code. The board palette key may change from `S` to `D` if that's free in the
`board` scope (the builder checks). "Sketch" then always means the 3D mark.

### The old Draw

- `drawTool.ts` becomes the sketch tool (rename as fits, e.g. `sketchTool.ts`). The one-stroke path and its
  "Draw: press on the part and drag to leave a stroke" text go.
- Existing `stroke` marks: shown, listed, sent, checked and resolved as today; they can be edited (their note) and
  deleted, but not drawn into. No migration of the file.

## Builder's calls (what's left to you)

- The look of the panel, the plane grid, the handle and the view cube, within the tokens and the Sketch-B mockup.
- The snap data's exact buffer layout and the spatial index.
- How the tube is built and how dashed hidden strokes are drawn.
- How the board card's picture is drawn (main renders it as `look` does) and when it is redrawn.
- Rounding and summarising of points in what Claude is told, within "0.1 mm freehand, full when snapped".
- Test layout, following the existing draw, marks, board and kernel tests; an e2e spec drives a sketch with two planes,
  a snap to a hole centre and a flow diameter in the hidden window, and the stand-in agent checks the prompt text.
