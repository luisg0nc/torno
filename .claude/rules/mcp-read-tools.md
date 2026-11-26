---
paths:
  - "app/src/main/mcp/readTools.ts"
  - "app/src/main/mcp/readTools.test.ts"
  - "app/src/main/mcp/featureTools.ts"
  - "app/src/main/mcp/featureTools.itest.ts"
  - "app/src/main/mcp/featureTools.test.ts"
  - "app/src/main/mcp/focus.ts"
  - "app/src/main/mcp/tools.ts"
  - "app/src/main/mcp/tools.test.ts"
  - "app/src/shared/focus.ts"
  - "app/src/shared/focus.test.ts"
  - "app/src/shared/view.ts"
  - "app/src/renderer/viewport/sectionDrawing.ts"
  - "app/src/renderer/viewport/sectionDrawing.test.ts"
---

# The MCP tools that read the part: focus, describe, try_fillet, try_params, features, section

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Marks (`app/src/main`)

  - **`focus`** of `look` and `show` (`mcp/focus.ts`, `FocusBox` in `shared/focus.ts`) frames the picture, or their
    camera, on a ref, a group, a mark or a box, and `margin` is a share of the box's longest side (0 to 5, default
    0.3, the side counted as 20 mm at the least so that a pin has room round it). Main works the box out in the
    frame of the layout, against the last build, before the window is asked: a part's is the scene's, a group's the
    box round its parts', a face's or an edge's the kernel's (`measure` bbox: exact or `≈` as it says), a mark's the
    box round the points it is drawn at (`markPoints`; a region of a scan has none and is refused), a box as given.
    What names nothing is refused with what a focus can be (`FORMS`); a part the picture leaves out (`parts`, or the
    user's switched-off parts) is refused before the kernel is asked (`notDrawn`). The parts are drawn together
    (`explode: null`): the box is where they are built, so an explode beside it, or on the screen for `show`, is
    refused (`FOCUS_NOT_EXPLODED`). A saved view frames its own picture and is refused with `focus`. A part torno
    moved for display is framed where it is shown, and the reply says so. The window says what stands between the
    camera and the middle of the focus (`LookResult.hiddenBy`) and the reply tells the agent how to see it
    (`hiddenText`).
  - **`views`** of `look` (#348, `lookTool` in `mcp/viewTools.ts`): `MIN_TILES` to `MAX_TILES` (2 to 6, `shared/view.ts`)
    views instead of `view` (both are refused), tiled in one picture, so that a survey is one call. Each is checked and
    made a request by `askedLook`, exactly as a look of that view alone would be (a saved view's own parts, section and
    explode are its tile's alone), with every other argument shared; what is wrong with one view is told as `view 2 of
    views: …`, and nothing is drawn. The window is asked once: `{ size, tiles }`, where `size` is the long edge of the
    whole picture (the same cap and default as any look, so it costs what one look costs). `PictureMaker.renderTiles`
    (`viewport/picture.ts`) reads the store once and draws every tile with no wait between them, so all are of one
    build; `tileGrid` lays them out (2×1, 2×2 to four, 3×2 to six, 4:3 cells; the `current` view is fitted into its
    cell), each with its number and view on a plate. The reply is one image, a line for the whole, a numbered caption
    per tile with what is said after a single look's (the saved view's passed over, spread parts, what hides the focus),
    and the focus said once. One picture is kept under `.torno/views/`. A card made of one (`add_card`) keeps no camera.
    "See in view" has no one view to go to and says so (`MANY_VIEWS`, `state/seeAgain.ts`).
  - `describe` of a face or an edge asks the kernel for a `selector` (`deps.describe(…, { selector: true })`; a part and
    the window's hover never do), a build123d expression on `part` that picks it now, with `robust` (`by geometry` or
    `by order`) and `checked: "this build only"`, or `selector: null` with `selectorWhy`. It is of the part as it stands in
    the layout asked: `selectorFrame` (`mcp/tools.ts`) says whose frame that is, and where the layout moves or turns the
    part from where its function builds it (`Part.loc`), names the layouts that leave it as built. torno never writes it
    into the model.
  - `try_fillet` (`tryFilletTool` in `mcp/readTools.ts`) has the kernel try a fillet or a chamfer of edges of one
    part on the last build that worked and throw it away (`try_fillet` in `queries.py`). The part and its edges are
    checked against the scene before the kernel is asked (`checkRef`: refs of that part's edges, 200 at most; a
    radius above 0; `kind` fillet or chamfer), each refusal saying what to give. It answers with the kernel's reply
    (`works`, and when false the diagnosis of a failed build, `frame: 'object'`, its edges by ref) and a `reading`:
    `Tried on rN and thrown away, nothing changed:` and `diagnosisText`. Read-only: it changes no model and no mark.
  - `try_params` (`tryParamsTool` in `mcp/readTools.ts`, `ToolDeps.trial`, `Builds.trial`, the kernel's `trial` request)
    builds the model with other values of its `Params` (`set`, the fields `scene` lists with an `editable` kind,
    each checked for its type before the kernel is asked, over the person's own overrides) in a worker the
    supervisor forks and throws away, and answers `measure` (`bbox`, `volume`, `area`, `mass`, `distance`) and
    `check` queries there, 10 of each at most, of whole parts by name: a trial has no refs of a build to give, so a
    face, an edge or a mark is refused. It answers with `sceneDiff` against the last build, each reading as
    `measureReading` and `checkReading` word it, and says everywhere it is of the trial. It changes and keeps nothing
    (no file, no live worker, no scene sent to the window, no revision); a trial the kernel refuses (`busy`,
    `no_room`) is told as such. To keep a value the agent edits the model.
  - `features` (`featuresTool` in `mcp/featureTools.ts`) has the kernel's live worker of the last good build list the
    holes, bosses, fillets, chamfers and patterns of one part (`features.py`; `part`, `kinds`, `layout`; the part is checked against the scene as
    `try_fillet`'s is). It answers with the kernel's data (each feature with its numbers, `exact` and, when false,
    `how`; the faces it is made of and the ones it opens in as refs; counts of what was left out or is no feature)
    and a `reading` worded from that data alone: equal holes counted together, `≈` before a number the kernel did
    not say is exact. The reading is never worked out from a feature's numbers here.
  - The agent's `section` tool asks the kernel for the plane and its `deflection` only. The kernel's `section` also takes `axes` (the caller's frame of the plane) and
    `snaps` (the cut's corners and circle centres); main asks for both to cut a tracing (`kernel-measures`, `tracings`), and the tool passes neither, so what Claude is
    told by `section` is unchanged. `tracings` is the read tool of the tracings (`mcp/tracingTools.ts`: the list, or one tracing's plane, outline, layers and photo's words, and with
    `picture: true` the window's drawing of it, at most 2000 px): read-only, with `add_tracing` and `add_layer` beside it (`mcp-tools`, `tracings`). Whether the photo is on this
    computer is main's own check of the file (`photoHere`), and every number of a photo is told as not exact.
  - The picture `section` returns is a 2D drawing of the kernel's outlines
    (`src/renderer/viewport/sectionDrawing.ts`), made by the window on a
    canvas of its own whichever object it shows, on the light sheet whatever
    the theme, with what is up in the world up on it. The kernel is asked for
    outlines within 0.01 mm (`SECTION_DEFLECTION`; the agent may give
    `deflection`, 0.005 to 0.05), and the drawing is made from them in full.
    The JSON holds at most 1,500 points in all (`MAX_SECTION_POINTS`,
    `pointsFor`), the parts' outlines and a scan's lines together: each loop
    its share by its length, 8 at least, the shortest beyond 187 loops left
    out and counted (`loopsOmitted`); the scan's share is asked of the kernel
    as `points` (`scanShare`), which thins its lines once and tells them to
    0.1 mm. The reading says what was thinned. Areas are the kernel's, never
    worked out from thinned points.
  - A plane is `{origin, normal}` or `{axis, at}` (`planeOf` in
    `shared/view.ts`): the latter has its normal along +axis.
  - `add_mark` with `kind: 'dimension'` goes through `addDimensionTold`, as
    the dimensions the person keeps do through `addDimension`, kept `sent`. One kept
    without a value of the last build is answered `NOT MEASURED: …` first
    (`keptUnmeasured`), so that its line is not taken for a measurement.
  - `marks` is the tool that reads the rounds of a review. With `review` (`R1` or `all`) `marksTool` (`mcp/tools.ts`) answers with
    `reviewData` (`main/reviews/text.ts`, `ToolDeps.rounds`) in place of the list, oldest round first: the build, line and layout of each, and
    its items with `intent` (`want`, `dont` or `plain`), status, `resolvedNote`, `judged` and a `said` sentence; a don't want item judged OK says
    `removed on purpose; keep it out`, and one judged Still wrong `still wrong in h42: <the note>`. An unknown round is an error result that
    names the rounds there are. The plain list says each mark's intent and round in its line (`describeMark`). Nothing here sets an intent: the
    agent reads rounds and sets none (`mcp-tools`).
- **A named set in the read tools.** `describe` of `#deck` or `part/#deck` (`mcp/setRefs.ts` `setDescribed`) is the set (name, comment, layout, who made it,
  `proposed`, `said`) with its members told by the kernel (20 at most, `omitted` counts the rest; a stroke by its sketch and id with its line from
  `strokeLine`) and what is lost, and passes no `selector: true` for them; it never shows `selector.form`. `measure` of a set measures what it
  measures of several refs, so a set of one face measures and a set of several is refused naming them, a lost member said in the end's words
  (`tub/F5 (#worn: 1 face (1 of 2 faces lost))`). `look`'s `focus: '#deck'` frames the box round its parts, faces and edges (the kernel's
  `measure bbox`, 20 queries at most, the rest covered by their part's box and told approximate) and strokes (their points, approximate),
  leaves lost members out and says so, and refuses when nothing is found. Every number is the kernel's and says whether it is exact; nothing
  in a set makes a number exact that it was not.
