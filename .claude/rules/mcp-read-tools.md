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
