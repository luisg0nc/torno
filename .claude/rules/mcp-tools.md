---
paths:
  - "app/src/preload/index.ts"
  - "app/src/shared/bridge.ts"
  - "app/src/main/mcp/**"
  - "app/src/main/refusal.ts"
  - "app/src/main/refusal.test.ts"
  - "app/src/shared/refusal.ts"
  - "app/src/shared/refusal.test.ts"
  - "app/src/main/ipc.ts"
  - "app/src/readme.test.ts"
---

# The MCP tools: the list, their schemas and what they share; refusals; the prompts

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Marks (`app/src/main`)

- The MCP tools (`src/main/mcp/schemas.ts` holds every input schema and
  description, and `TOOLS`; `mcp/tools.ts` registers them and holds what
  every tool shares, with `marks` and `describe`; `scene`, `look`, `show` and
  `save_view` are in `mcp/viewTools.ts`; those that place and resolve marks in
  `mcp/markTools.ts`; those that read the part in `mcp/readTools.ts`; those
  that ask about scans in `mcp/scanTools.ts`): `scene`, `look`, `marks`,
  `describe`, `highlight`, `ask`, `show`, `save_view`, `add_mark`, `add_sketch`, `add_set`, `resolve_mark`,
  `measure`, `section`, `check`, `diff`, `history`, `wait_build`, `board`, `add_card`, `tracings`, `add_tracing`, `add_layer`, `expect`, `try_fillet`, `try_params`, `features`, `scans`, `scan_clash`, `scan_deviation`.
  `board` and `add_card` (`mcp/boardTools.ts`; `ToolDeps.board`, `ToolDeps.scale`, wired in `index.ts`) are the agent's door to the
  board: `board` reads it as `boardText` does (a frame by name or id; `pictures: true` sends up to 6, each scaled to 1280 by
  `deps.scale`); `add_card` makes cards and arrows of the agent's own through `BoardStore.agent` and changes or removes only those (a
  card of the person's or of torno's own is refused by name of its owner, the file untouched). A picture is drawn by `lookTool` (its
  `capture`: not kept as a view) at 1280 px and kept by `savePicture`, with the camera when it is known. `by`, `id`, a place and `hidden`
  are never an argument.
  `tracings`, `add_tracing` and `add_layer` (`mcp/tracingTools.ts`; `ToolDeps.tracings`, the window's own doors `tracingDoors()` of `main/ipc.ts` with the
  `agent*` handlers of `main/tracings/ipc.ts`, and `ToolDeps.tracingPicture`, wired in `index.ts`) are Claude's door to the tracings. `tracings` reads
  (`readOnlyHint`): the list, or one tracing as `tracingData` (`main/tracings/text.ts`: facts, with `text` holding every point of the outline and every
  shape in mm, the outline's points thinned by `pointsFor` as `section` thins them with the deflection said, areas the kernel's and `≈` where it says so,
  the lost-face sentence, the photo's words, which always end `not exact, and true only in the tracing's plane`, and which say `the photo is not on this computer` when `photoHere` (main's look for the file, `tracings/photos.ts`) finds none); `picture: true` has the window draw
  it (`requestTracingPicture`, `view:tracingPicture`, `renderer/ui/tracings/picture.ts` from `tracingSvg`'s elements, 10 mm grid, the layers and, when the tracing has a straightened copy and its photo is not hidden, that photo under them (`TracingPictureRequest.photo`, the window reads the copy itself; the picture says `photo` under the outline, hidden or not drawn); `size` as
  `look`'s, 256 to 2000, default 1280), checks the PNG with `checkedImage` (one that fails is not sent, and the text says so) and says what maps it to mm
  (`1 px = 0.212 mm; u = 0 at x = 140, v = 0 at y = 860, v up`). `add_tracing` lays Claude's tracing through `TracingStore.make(…, 'agent')`: `on` is
  `{ main, offset }`, `{ face }` (planar, of the last build) or `{ origin, normal }` (a frozen plane whose axes are the kernel's `section`), main makes the
  plane and the number, and `tracing` + `remove: true` takes down Claude's own: a tracing of the person's is refused by its owner's name, and so is one of Claude's that holds the person's photo or a layer of theirs, the file
  untouched. `add_layer` makes or replaces (by name, case apart) a layer of Claude's on any tracing, the person's too, through `TracingStore.layer(…,
  'agent')`, holding every number to ten diagonals of the outline (`outlines.cut` bounds; the box of the parts the tracing draws, in its u and v, when the outline cannot be cut), the caps (500 shapes, 20 layers, 20,000 points) and
  refusing a key a shape does not take; a layer replaced keeps its number, a layer of the person's is refused by their name, `remove: true` takes down
  Claude's. `by`, `id`, a layer's number and a plane's frame are never an argument. None of the three is loaded upfront, and they share one line of
  `SERVER_INSTRUCTIONS` (`schemas.test.ts` splits a line's names on `, `).
  `expect` (`mcp/expectTools.ts`, `Expectations`, wired in `index.ts`) is the agent's note on one edit: checks on a
  part's volume, faces, edges or size, a `measure` with `expected`, or `unchanged` parts, taken against the last
  build and held in memory for the next successful build only (never a file, never a mark, never a Stop reason). It is
  settled in `buildContextFor`'s wrapper in `index.ts` and told once as the last line of the edit's answer; `scene`
  keeps the last verdict. Numbers not exact are `≈` and judged within the kernel's doubt; a ref of a part whose
  face (or edge) count changed is told as moved and not measured.
  `diff` compares two of the last two successful builds (`Builds.scenes`; the blob of the older is not kept) or any build kept in the history (#56:
  `from` and `to` take a revision, `r3`, or an id, `h41`; `ToolDeps.history` and `historyScene`, read by `ipc.ts` `historyOf` after the writes that
  just landed, 2 s at most; a revision of this run that is no longer in memory is found there too; given only the last build, the
  default is the newest kept build of other sources; what a kept build had then (`failingChecks`, `defects`, `dimensions`) is told with a
  note that it is as of then); `diff` refuses a failed entry (by id, with a sentence naming it and its error) and never takes one for the build of
  a revision (it carries the revision of the last good build) or as the default to compare with; `history` (`historyTool`) lists the kept builds newest first or gives one with the paths of its
  copies, so that the agent can read them and edit the project's files itself. Its `changed` says after the line what caused the build
  (`· by Claude (prompt "<first 80 characters>")`, `· your edit`, `· params`, `· went back to h40`, `· undone`; nothing for an entry with no `cause`) and a
  failed one is `failed: <error>`; the entry's `cause`, `turn`, `failed`, `error`, `wentBackTo` and `undone` go as stored. `history:ghost`,
  `history:thumbnail` and `history:source` answer null for a failed entry, and `ghosts` never names one.
  Each part is compared by `partDiff` of `shared/diff.ts`, which the window's status line and ghosts use too,
  from what the kernel sent with each, asking it nothing: a number is `exact` only where both builds say so.
  A view note (`NoteMark`) is told by `marks` and `describe` as data without its strokes or the names of its files, with `strokeCount`
  and `text` (`noteText`, `main/notes/text.ts`: its line, the build, the ink, the camera and how to `look` from it, what the ink and each
  label arrow lie over, the comment, `reference <n>: <comment>`); `marks` with `pictures: true` attaches each listed note's inked picture,
  then its references (`notePictures`, `main/notes/pictures.ts`), at most 6 in all and 1280 px, naming the rest. `add_mark` refuses
  `kind: 'note'`; Claude's only act on a note is `resolve_mark`, and no tool edits or deletes one. `resolve_mark` refuses a draft of a held round (`isHeld`, `ToolDeps.rounds`) with `wait until the review is sent`.
  `marks` with `review` (`R1` or `all`) answers with the rounds (`reviewData`, `main/reviews/text.ts`; `ToolDeps.rounds`, wired in `index.ts`) in place
  of the list: each round's build, line and layout, and its items with intent, status, `resolvedNote`, `judged` and a `said` sentence (a don't want item judged OK says
  `removed on purpose; keep it out`); an unknown round is refused, naming the rounds there are. Claude's marks are plain: `add_mark` refuses any intent that is not a
  shape's own (`add`, `remove`, `keep-out`, `reference`) and `add_sketch` any `intent` (`REVIEW_INTENT_REFUSED`).
  A sketch (`SketchMark`) is told by `marks` and `describe` the same way (`sketchData`, `main/sketches/text.ts`): the mark without its strokes and
  its picture, with `strokeCount` and `text`, which has every stroke and point (`sketchText` with no cut).
  `add_sketch` (`mcp/sketchTools.ts`; `ToolDeps.saveSketch`, `removeMark`, wired in `index.ts`) is the agent's own sketch: `strokes` of `points` (object frame, mm) or
  `plane` + `points2d`, at most 50 strokes and 2,000 points, every number finite and within 10 diagonals of the layout's parts. Main makes the planes' frames:
  a main plane's by `mainPlaneFrame` (`shared/planes.ts`, labelled as `viewPlane` does), a face plane's from the kernel's `describe` of that face (it must be
  planar; `axesOfNormal` gives the axes, +X projected, else +Y), a point plane's from its normal. The sketch is `author: 'agent'`, of the last build, with no snaps, and its
  `touches` come from `strokeTouches` through `deps.nearest`. Its `anchor` is `anchorFor` of the first point of its first stroke in space (a kernel `nearest`, with the spread `placedMark` records in `index.ts`), absent when that point is beyond tolerance of every part or there is no such stroke. `sketch: 'M9'` replaces one of the agent's, `remove: true` deletes it through `MarkStore.remove` (undo as for any mark);
  a sketch of the person's is refused for either. `add_mark` refuses `kind: 'sketch'` and `'stroke'`.
  `add_set` (`mcp/setTools.ts`; `ToolDeps.setStore`, `sets`, `setsRefs`, wired in `index.ts`) proposes a named set: `name`, `comment`, `refs`
  (faces, edges, parts, strokes `M7/k3`; a tag, group or set stands for its members, checked by `checkedRefs`) and `layout` (default the one on screen).
  Before anything is written it asks the kernel's `selectors` for each part's faces and edges and refuses when that fails or gives no centre, so no member is
  held at a placeholder point; then `SetStore.make(…, 'agent')` (a proposal, `proposed: true`) and `withSelectors`. A name in use (`#intake is taken (N1)`) or
  a bad name is refused. No tool accepts, edits or removes a set: only the person does, in the window. `scene` lists `sets` (`sets/text.ts`
  `setsListed`, at most 50 members each found and 50 `lostMembers`, `lost`, `stale` for a set whose refs are of an earlier build than the last, per set) and `state.md` has a Named sets section (`setsText`).
  A ref of `#name` or `part/#name` is a named set in every tool that takes a ref (`shared/sets.ts` `splitSetRef`, `expandSet`; `markTools.ts`
  `checkRef`, `checkedRefs`): `highlight`, `ask`, `show`, `look` (`focus`, `mcp/focus.ts`), `describe` (`mcp/setRefs.ts`: members with the kernel's
  descriptors, 20 at most), `measure` and `add_mark`. Lost members are left out and counted in the reply, never silently; a proposal says
  `[proposed by you, not accepted yet]` and can be used meanwhile; a set not refound against the last build is used as it is and says `not refound against r8 yet; its refs are of r7` (`SetsAt.fresh`); a set of another layout or with nothing in the part is refused in words
  (`#deck is of layout assembly`). A tool that needs one face or edge refuses a set of several, naming them, as for a tag; `add_mark` on a set
  is placed on its first ok member and keeps `Anchor.set` (`marks-store`); the tools that take no set (`check`, `section`, `try_fillet`,
  `features`, the scans') say so. `describe` strips `selector.form` before the agent reads it: a form is for torno's own sets.
  `look` and `show` take the name of a saved view as `view`, and `save_view`
  proposes one (Views). `show` changes
  the view for now and is never saved to `scene.json`; it is refused while a
  button is held in the viewport. `marks`, `describe`, `add_mark`, `measure`,
  `section`, `check` and the three scan tools say which
  revision they answer from, and that it is stale while a newer build runs or
  has failed, or while the model's files are newer than the build (`behind`, `NEWER_FILES`).
  **A read right after a save** (`main/freshness.ts`, `Freshness`, `ToolDeps.fresh`, wired in `index.ts`): the watcher reports a save
  300 ms late and the build it starts is queued or running after that, so `registerTools` has every tool in `SETTLES` (those that
  answer from the last build) call `fresh.settle` first. It looks at the disk (`newestSource`: the project's `.py` files, `common/`, the
  files the last build imported, `Scene.uses`) against when the latest build began (`Builds.startedAt`; a time to the millisecond
  below it is not newer), and waits up to `SETTLE_MS` (15 s) for a build that runs, `BEGIN_GRACE_MS` (3 s) for one to begin. What it
  does not get is told, never as current: `behind` says `the model's files are newer than this build` and `scene`'s `build.stale`
  is true with `staleWhy`.
  `wait_build` (`mcp/waitTools.ts`, `ToolDeps.fresh.settle`, `ToolDeps.buildTold`) waits for the running build, or the one a save has
  just started, up to `seconds` (1 to 600, default 60; `Freshness.settle` with the call's abort signal) and answers `status`,
  `revision`, `waited`, `limitReached`, `seconds` of the build, `stale` and a `reading`; with the limit up and the build still
  running (or files newer and no build begun) it says so and leaves the build alone, and the agent calls again. A build that ended
  comes with what an edit's answer tells of it (`buildTold`, `buildContextFor` with the expectation). `scene` gives
  `build.runningSeconds` while a build runs and `build.recentBuilds` (the last five kept: id, seconds, `failed`) from `deps.history`;
  the stage of a build (loading, meshing) is not told, because the kernel does not report one. `scene` counts the unresolved dimensions held to a value
  (`dimensions: {pass, fail, notMeasured}`).
  - What a client reads of a tool before it calls one is beside its description in `TOOLS`: a `title` (sentence
    case), `annotations` and, for the tools loaded upfront, `meta`. Every tool has `openWorldHint: false`; the
    ones that only read have `readOnlyHint: true` (`scene`, `look`, `marks`, `describe`, `measure`, `section`,
    `check`, `diff`, `history`, `wait_build`, `board`, `tracings`, `try_fillet`, `try_params`, `features`, `scans`, `scan_clash`, `scan_deviation`: Claude Code runs the calls of those side by side;
    `look` reads, the picture it writes under `.torno/views/` being torno's own), the rest `readOnlyHint: false,
    destructiveHint: false`. `scene`, `look`, `marks`, `describe`, `measure`, `show`, `resolve_mark` and `features` have
    `_meta["anthropic/alwaysLoad"]` (Claude Code's tool search defers every other MCP tool until it is searched for,
    and each upfront tool costs context in every turn and sits in the prompt cache's prefix: the list stays short).
    The server gives `instructions` at `initialize` (`SERVER_INSTRUCTIONS`: a paragraph on what the server is for,
    then a line for every tool in the words an agent would search with; under 4,096 characters, which Claude Code
    cuts at: `schemas.test.ts` holds that, every tool's line, and every description under the same length). A
    tool added to `TOOLS` has a title, annotations and a line there, or the test fails. Annotations change nothing
    of what `--allowedTools` permits.
  - Every tool is registered through `registerTools`, which refuses a key the
    tool's schema in `TOOLS` does not name (`refusedKeys`, `mcp/keys.ts`),
    naming the keys it takes: a dropped key would change what is measured. A
    new argument goes into the schema, or it is refused.
  - The schemas of a plane and of an end of a measurement refuse nothing
    (`planeInput`, `endInput`: a union that ends in `z.unknown()`): whatever
    is given reaches the handler, which answers with what one looks like
    (`NO_PLANE`, `noEnd`). Keep it so: the schema's own refusal says only
    "Invalid input".
  - `measure`, `section` and `check` answer with the kernel's reply and a
    `reading` of it in a line. Refs and marks are checked against the scene in
    main before the kernel is asked (`endsOf`: a mark stands for what it is on
    only when the last build's check confirmed it, and a dimension for
    neither of its ends), and nothing is said to be exact that the kernel
    does not say is: `≈` and `approximate` otherwise. A query that took its
    30 s is told as that; the answer of a worker still busy with one is told
    in the kernel's words (`refusal` in `mcp/readTools.ts`).
- **A refusal is not a failure.** What the person asked that cannot be done (a dimension the kernel refuses,
  one placed on an older build or between parts torno spread apart, a change of a mark that is not valid, a
  choice while a session runs) is thrown as a `Refusal` (`main/refusal.ts`). Every channel is registered through
  `handle` in `ipc.ts` (`refusable`), which resolves a `Refusal` as `{ __tornoRefused: message }`
  (`shared/refusal.ts`) so that Electron prints nothing; the preload throws it again (`unrefused`), so the window
  sees a rejection with that message. Anything else is thrown, and logged.
- The MCP prompts (`mcp/prompts.ts`, `PROMPTS`, registered by `registerPrompts` beside the tools): `review`,
  `printable` (argument `bed`, `XxYxZ` in mm, read by `parseBed`) and `explain`, each one user message. Their text
  names tools through a `toolName`, Claude Code's (`mcp__torno__<tool>`): the server is stateless and does not know
  the client. The manual lists them as `/mcp__torno__<name>` (`readme.test.ts` holds it to `PROMPTS`).
