# torno: main (`app/src/main`)

The shell, the kernel client, the sessions, the HTTP server with the MCP tools and the hooks, the marks
(`marks/`), the scans (`scans/`), the page of objects (`show/`) and what makes an export (`export/`).

What binds every part of torno is in the `CLAUDE.md` at the root of the repository: read that first. Here
is the detail of this folder, under the headings it has there. Paths are from `app/`.

## Marks

- "OK all" is `MarkStore.acknowledge(objectId, ids)`: every id checked as `update` checks one (resolved, by
  the agent), all of them acknowledged in one change (one atomic write, one `changed`), or none and a refusal
  that names the first that is not the agent's to acknowledge. Only the person asks it (`marks:acknowledge`);
  no MCP tool does.
- A delete is undone by `MarkStore.restore` (`marks:restore`): the store keeps, in memory only, the mark removed
  last of each object, whole (`MAIN_ONLY_KEYS` as main had them), with a region's bits (`removeMark` reads them
  first); restoring puts it back by its number in one change (a region's mask is written first, `restoreMark`),
  only that mark and once, and `forget` clears it.
- After every successful build, and when a mark is added, reopened or put
  somewhere else, the marks are checked against the build
  (`src/main/marks/reanchor.ts`, one `nearest` query per layout). A mark stays
  where it was put on its part; its ref and descriptor are refreshed;
  `anchorState` says `drifted` or `orphaned`. Whatever reports a mark says so:
  the agent is told nothing it cannot rely on.
  - The one way a mark moves: its anchor records how far its part was spread
    for display (`Anchor.arranged`, zeros for a part that was not moved), and
    when a build spreads the part otherwise, everything the mark holds moves
    by the difference before it is judged. An anchor that records none (a
    mark from before) is not moved: the check records it. Main sets
    `arranged` (`asPlaced`), never the window.
  - A tag the model gives a face or an edge (`Part.tags`, from `tags(p, parts)`; `shared/tags.ts`) is kept on the
    anchor of a mark placed on that one (`Anchor.tag`): main says it from the build the ref is of (`withTag`, in
    `asPlaced`, `asReplaced` and `anchorFor`), never taken from the window or a tool. A check looks for it first:
    when the build's part has the tag and it names exactly one face or edge, the anchor is on that (`ref`,
    `edge`, normal, descriptor, `between` refreshed; `nearest` is asked `face` or `edge` of it, so the answer says how
    far the point is), `ok` however far it moved, and its point stays while it is within reach (the part's
    `tolerance` of a face, `EDGE_TOLERANCE_MM` of an edge) and else is set on the nearest point of it. Without the
    tag, or with a tag of several, the nearest-point rule judges it as ever and the tag stays on the anchor for a
    build that gives it back. The tools take `<part>/@<tag>` (`checkRef` gives the face's own ref beside the tag;
    `highlight` and `ask` take a tag of several as its refs; the kernel resolves the tag itself for `describe` and
    `measure`).
  - A check writes what it judged each mark from; `MarkStore.reanchor` passes
    over a mark whose anchors are no longer those (it was put somewhere else
    meanwhile).
  - `checkedRevision` is the build a mark was last checked against. An open
    mark with any other than the last build's is unchecked (`isUnchecked`),
    and every report of it says so. Revisions count from 1 in every run, so
    the store drops what a file says of it when the file is read. A check
    that could not say of every mark is tried again after 2, 10 and 30 s
    (`retrying`), until the workspace is closed; and every 30 s beyond that
    while the kernel only answers that its worker is still busy (`isBusy` in
    `kernel/client.ts`: the check resolves `'busy'`).
  - A pin whose point is on an edge is on that edge (`judgePin`): its anchor
    has `edge` and, when two faces meet there, `between`.
- Status: `draft` until a `UserPromptSubmit` hook has carried the mark to the
  agent of its own object (`src/main/context.ts`; turned `sent` only once the
  answer has left), then `resolved`. Nothing else consumes drafts. A sent
  mark of the person's whose note or shape changes is a draft again
  (`sentBefore`: told as `(changed)`), as is a dimension of the agent's whose
  `expected` or `tolerance` the person changes; and one the person makes a
  draft again after it was resolved says so until it is sent (`reopened`:
  told as `(reopened by the user)`).
- A dimension is a mark that holds an exact value: a distance or an angle
  between its two ends (`a`, `b`), or a radius, a diameter or a wall thickness
  at its one. Main measures it with the kernel's `measure` as it is kept
  (`src/main/marks/measure.ts`: each end goes with its ref and its point, an
  end with no ref as a bare point). One the kernel refuses is not kept, nor
  one placed on another build than the last; one the kernel could not be
  asked about is kept without a value. The Measure tool keeps none by
  itself: what it measures goes to `geometry:measure` (`measureOnce`), which
  answers the kernel's value with the same refusals (`measurableOnLast`, shared
  with `addDimensionTold`: no build, another build, parts spread apart; and the
  kernel's reason), rejects plainly when the kernel cannot be asked, and
  writes nothing. A measurement not kept is told to no one: not in the
  prompt, not in `state.md`, not in a tool's answer. Kept (the strip's button
  or Enter) it comes through `marks:add` and is measured again there.
  `value`, `how`, `points`, `measuredRevision`, `refused` and `verdict`
  (`MEASURED_KEYS`) are main's alone, like `MAIN_ONLY_KEYS`. The verdict is
  never stored on anyone's word: the sanitiser works it out
  (`shared/dimension.ts`: pass when `|value − expected| <= tolerance`, 0.05 mm
  or 0.1° when none is given). A changed `expected` or `tolerance` is news of
  the mark (`(changed)`); a value measured again is not. Its ends are judged
  like pins. Numbers shown are written by `shared/format.ts` `number`, on
  both sides.
  - Dimensions are the person's checks of the part. After every successful
    build, once the marks are checked against it, every unresolved dimension
    is measured on it, in the same pass (`checkMarks`: `reanchorAll`, then
    `remeasureAll`; one write for all, under the guard of re-anchoring: a
    dimension whose ends or expectation changed meanwhile is passed over).
    Only from ends that check judged on that build (`checkedRevision`): never
    through a ref of an older build. A pass that could not measure every
    dimension is tried again like one that could not check every mark.
  - `measuredRevision` is the build the kernel last said of it on. A
    dimension whose value is not of the last build has no value there
    (`measuredValue(mark, revision)`, the one rule for `describeMark` and the
    tools' data, and through `shownDimension` in `shared/dimension.ts` for
    the row, the chip and the picture): it is `not measured on rN (was 6 mm
    on r11)`, with no verdict, and its line on the part is drawn dimmed
    (`staleValue`). Revisions are of this run, so on the first build of a
    run every dimension is measured; until then one read from its file is
    `not measured yet`, and what it holds is told to no one.
  - A resolved dimension is no longer measured. Whatever shows it gives what
    it holds as `as measured on rN`, stale, with no verdict
    (`shownDimension`; `[as measured on rN]` and `resolvedValue` in main).
    So `resolve_mark` refuses a dimension of the person's that has an
    `expected` (`resolveMarkTool`), saying how the check stands, and says of
    any other dimension it resolves that it is no longer measured.
  - An end the build moved (`drifted`) is measured from the face its
    refreshed ref names, and the mark says `[moved since it was placed: check
    it]`. Nothing is ever measured through a ref the check did not confirm or
    refresh: an end on an edge keeps the edge it was put on when that is no
    longer under it, and is then not measurable (`the edge plate/E7 it was on
    is not under its end on r12`), never measured by that number nor from the
    face under it. Whether an edge is under a point is one rule
    (`marks/tolerance.ts` `edgeIsUnder`), for judging an end and for
    measuring through it: the edge of that number is within
    `EDGE_TOLERANCE_MM` (0.5 mm) of the point, or the nearest point of the
    part is on that very edge and within the part's tolerance (`tolerance`:
    `max(0.5 mm, 0.5 % of the bbox diagonal)`). So a dimension between two
    edges of a plate that gets thinner by more than that, or whose edges are
    renumbered, is not measurable and has to be placed again, while one
    whose edge moved less is measured through it. Between the plate's faces
    it is measured again however thin the plate gets: faces are what to
    click for a check that must hold across edits. Besides
    that, only a lost part (`orphaned`) or a refusal by the kernel makes it
    `not measurable`; `refused` keeps the reason.
  - A measurement is of the build its refs are of: `measureDimension` is
    given that revision and rejects when the last build is another, before or
    after the kernel is asked. `MarkStore.reanchor` drops `measuredRevision`
    of a dimension when it gives an end another ref or point, and
    `MarkStore.measured` keeps nothing measured through other ends, or for a
    resolved mark.
  - `history` (`DimensionMark.history`, `DimensionSample`: build and value) is what the kernel said of a dimension on
    each of the last 20 builds of this run (`HISTORY_LENGTH`, `withSample` in `shared/dimension.ts`). It is main's
    alone and in memory only (`MarkStore.histories`, by folder and mark id; cleared by `forget`): never in
    `marks.json`, since revisions count from 1 in every run, and never taken from the window or a tool (the sanitiser
    does not read it). It is added to the marks only for the window (`MarkStore.shown`, in the `marks:changed`
    broadcast and `marks:list`); `list()`, the tools, the prompts and `state.md` never carry it. It starts again when an end
    is put on other geometry (`reanchor`). The verdict of each sample is worked out where it is shown (`samplesOf`), from
    the expectation as it is now; `since(mark, revision)` says `fails since r12; passed on r11`. Telling the agent
    the same is not done here.
  - Sent and unresolved, it is "pinned": with every prompt, under
    `Dimensions (measured on rN):` (`dimensionsHead`: it also says when a
    build is running or the latest failed, so that these are not of the last
    edit), each pinned dimension that fails, is not measurable or was
    not measured on the last build has its line, until it passes, and the
    number that pass is said, naming those among them that moved
    (`src/main/context.ts`). A draft dimension is
    told with the drafts. The status line counts every unresolved dimension
    that fails, sent or not.
- **The model's own checks** (`checks(p)`, kernel `modelchecks.py`) arrive in the scene as `checks`, measured by the
  kernel, each with its `status`, `value`, `unit`, wanted `min`/`max`, the kernel's `exact` and `how`, and the
  `declared` dict. They are the model's, never the person's: no check resolves, replaces or silences a dimension
  (a mark). `shared/modelChecks.ts` is the one rule for the words (`checksLine`, `checkText`). `context.ts` tells
  them in one line (at most `CHECKS_LIMIT`) after the dimensions, with every prompt and after an edit, saying
  while a build runs that they are not of the last edit; `state.md` has a `## Checks` section; `scene` gives them
  under `checks`. A failing check never holds the Stop back and never fails a build. The agent writes both the part
  and its checks, so `Builds.succeeded` compares each new build's checks with the build before (`keepNotes`) and
  keeps, as `Scene.checkNotes`, a note for each check removed, made easier to pass (`min` lowered, `max` raised or
  dropped, a bed made larger, an angle widened) or aimed at other parts, with the build it was first seen on; it
  stays while the check is weaker than it first was, in memory only. The window shows the notes; the agent is told
  of them by `state.md` and `scene` (`checksEasier`).
- The MCP tools (`src/main/mcp/schemas.ts` holds every input schema and
  description, and `TOOLS`; `mcp/tools.ts` registers them and holds what
  every tool shares, with `marks` and `describe`; `scene`, `look`, `show` and
  `save_view` are in `mcp/viewTools.ts`; those that place and resolve marks in
  `mcp/markTools.ts`; those that read the part in `mcp/readTools.ts`; those
  that ask about scans in `mcp/scanTools.ts`): `scene`, `look`, `marks`,
  `describe`, `highlight`, `ask`, `show`, `save_view`, `add_mark`, `resolve_mark`,
  `measure`, `section`, `check`, `diff`, `history`, `expect`, `try_fillet`, `try_params`, `features`, `scans`, `scan_clash`, `scan_deviation`.
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
  note that it is as of then); `history` (`historyTool`) lists the kept builds newest first or gives one with the paths of its
  copies, so that the agent can read them and edit the project's files itself.
  Each part is compared by `partDiff` of `shared/diff.ts`, which the window's status line and ghosts use too,
  from what the kernel sent with each, asking it nothing: a number is `exact` only where both builds say so.
  `look` and `show` take the name of a saved view as `view`, and `save_view`
  proposes one (Views). `show` changes
  the view for now and is never saved to `scene.json`; it is refused while a
  button is held in the viewport. `marks`, `describe`, `add_mark`, `measure`,
  `section`, `check` and the three scan tools say which
  revision they answer from, and that it is stale while a newer build runs or
  has failed. `scene` counts the unresolved dimensions held to a value
  (`dimensions: {pass, fail, notMeasured}`).
  - What a client reads of a tool before it calls one is beside its description in `TOOLS`: a `title` (sentence
    case), `annotations` and, for the tools loaded upfront, `meta`. Every tool has `openWorldHint: false`; the
    ones that only read have `readOnlyHint: true` (`scene`, `look`, `marks`, `describe`, `measure`, `section`,
    `check`, `diff`, `history`, `try_fillet`, `try_params`, `features`, `scans`, `scan_clash`, `scan_deviation`: Claude Code runs the calls of those side by side;
    `look` reads, the picture it writes under `.torno/views/` being torno's own), the rest `readOnlyHint: false,
    destructiveHint: false`. `scene`, `look`, `marks`, `describe` and `measure` have
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
- **Groups of parts.** `show`, `look` and `save_view` take group names in `parts`, and `highlight` in `refs` (a
  bare name only: `flat/F1` is refused, saying that `flat` is a group and naming its parts), expanded in main by
  `partsNamed` before the request goes to the window; the window expands what reaches it by the same rule. A
  saved view is kept with part names. `scene` lists `groups` for the layout shown (`{name, parts, visible}`) and
  each part's `group`; `describe` of a group's name is the box of its parts and their volume, from the scene,
  exact only where every part's is, naming by part a member with a solid inside out (`reversed`). `state.md` names each layout's groups before its parts.
- `<object>/.torno/state.md` says the same as the tools, as text
  (`src/main/statefile.ts`): the build (and under it the digest of a build that
  worked, naming tools as `the diff tool`), the parts, the scans with how each is
  aligned in every layout, the open marks. Its first line is when it was
  written. A `## Params` section lists each numeric `Params` field with the source its comment begins with
  (`shared/params.ts` `sourceOf`: the model's claim, never checked; no or unknown word is `no source`, never
  `assumed`). The answer to an edit adds `Assumed: …; no source: n` (`paramsLine` in `context.ts`) only when the set
  differs from the build before's, compared from the two kept scenes, so no state is tracked.

## Params the person tries

- `<object>/.torno/params.json` (`{ "overrides": { "wall": { "value": 2.4, "default": 2 } } }`, `src/main/paramsfile.ts`)
  holds the values the person tries in place of the model's defaults, with the default the file had when each was
  made. Main is the only writer: one change at a time per folder, atomically (`writeOwn`), git-ignored
  (`ensureIgnored`), the memory put back when a write fails. The model file is never written: that is the rule that
  keeps torno from being a modeller, and the one thing that bakes a value in is the agent editing the model.
  `Builds` gives every build of the folder `overrideValues(dir)` (`overrides` of the kernel's build request, which
  applies only what an `editable` field of its type can take and says what it dropped).
- **The file always wins.** After each good build `reconcile` (called from `Builds`, `OverridesPort`) holds the
  overrides against the scene: one whose field the model no longer offers, that the kernel refused, or whose recorded
  default is not the file's default now is dropped and noted (`Scene.overrides.dropped`, with the reason, until the
  person says anything of that field), and that build, made with a value that was let go of, is made again. One equal
  to the default is dropped with no word and no build. `scene.overrides` and each `Param.value` are how the window
  and the agent learn what a build was made with.
- The agent is told every time (`triedLine` of `shared/params.ts`; the second line of `contextFor` and
  `buildContextFor`, at most `TRIED_LIMIT` characters, its room kept before the status is fitted), in `state.md`
  (`## Params tried`) and by `scene` (`params[].value`, `paramsTried`), that the build is not the file's values. The
  channels `object:setParam` and `object:resetParams` are the window's; the agent has no tool that writes an override
  (`try_params` asks a trial and keeps nothing).

## Print profile

- The printer and material an object is made for (`shared/profile.ts`: `Profile`, the one rule for the types, the
  starter materials, `fitVerdict`, `leastWall`, `profileLine`) are the person's numbers, never the kernel's. The
  person's own printers and materials are in torno's user data (`profiles.json` beside `config.json`,
  `UserProfiles` in `main/profile.ts`, in memory with no config file), never in a workspace. The object's choice is
  `<object>/.torno/profile.json`, a copy of the values (`projectProfile` reads it at each question, `setProjectProfile`
  writes it through `writeOwn`; the window's `profile:set`, nothing else writes it), not ignored: it travels.
- `ToolDeps.profile` gives `check` and `measure` their defaults when the call leaves a value out: `bed` the printer's
  bed, `thin` the least wall (the material's, else two nozzles), `overhang` the material's angle, `mass` its density.
  A call that gives a value keeps it. A reading that used the profile ends `by your profile (Bambu X1C, PETG): the
  person's numbers, not measured`, and the data has `profile`. `check` clearance with `fit` is judged against the
  material's band per side (`fitJudged`: `passes`/`FAILS`, how far outside, overlap fails) and always says it is not a
  claim that the part prints; `fit` without a material, or on another kind, is refused. The model's own `checks(p)`
  are not given defaults: they declare their numbers.
- A new conversation is told it in one line (`profileLine`, in `contextFor` with the references, only if it fits; not
  in the system prompt, which is at its cap), `state.md` has a `## Print profile` section, and `scene` gives it as
  `printProfile`. A change of the profile has `state.md` written anew (`onProfile`).

## Explode

- **The agent.** `look` takes `explode` (a number, or `{amount, axis,
  scale}`; absent is as on screen for the layout on screen, `null` or `0`
  together); `show` sets it for now. What is nearly an explode is refused
  with what one is (`explodeAsked`, exported for `save_view`): an amount
  outside 0 to 1 (a percentage), a scale outside its range, an axis that is
  none, a key it does not take. Only a file and the window's own report are
  brought into range (`explodeOf`). `scene` reports `explode` and says so in
  its `note`; the first line of the prompt's context says `, exploded 40 %
  along z (display only)` after the layout. A picture drawn exploded, and
  what `show` answers, say `exploded 40 % along z` with `EXPLODED_NOTE`.
  Every other tool answers of the parts as built and says nothing of
  explode. The view the window reports (`ViewState.explode`) is kept by
  `reportView` only as what `explodeOf` makes of it.
- **What the agent shows is never the person's, field by field.**
  `shownByAgent.explode` holds, by layout, how the person had it (`theirs`).
  A field the person then sets by hand (the slider is `amount`, the bar's
  buttons `axis` and `scale`, a cut by hand is `amount: 0`) is theirs from
  then; the fields they did not set stay the agent's on screen, for now, and
  theirs as they had them in the file (`apartByHand`), as with a scan's
  view. A person who draws apart by hand a view the agent took the cut out
  of has no cut of theirs any more: the file holds one or the other.

## Views

- **`scene.json` is the window's to write**, and main never writes one of
  its own accord. Main keeps the file of each folder as it last read it or
  was given it to save (`sceneFileNow` in `main/scenefile.ts`), and answers
  `scene`, `look {view}`, `show {view}`, `save_view` and `state.md` from
  that. The window gives the file to main at once when the views change
  (not after the 500 ms of the other edits), so what main tells of them is
  true as soon as a tool is answered. A read of the disk never replaces a
  file given while it was under way, and the first save of a folder main has
  not read is held against the file on the disk. `forgetSceneFiles` when the
  workspace is closed.
- **Whose a view is.** `author` is `user` or `agent`; `proposed` (only ever
  true, only on an agent's) says the person has not kept it yet. Both are
  main's to vouch for, never an argument of a tool (`save_view` has neither
  key, and the wrapper refuses them) and never taken on the window's word
  alone: `saveSceneFile` lets a view be the agent's, or proposed, only when
  main asked the window to keep it for the agent (`proposalAsked`, through
  `proposing`: the name is let go of only when the window has answered, never
  on a timeout, so a view the window keeps late is the agent's proposal
  still) or the file already said so of that view (`owned`); anything else the window
  calls the agent's is the person's, and a kept view is never proposed
  again. A file read from the disk is taken as it is.
- **The agent** lists the views in `scene` (`viewSummary`: `name`, `by`,
  `proposed`, `layout`, `section` or `exploded`, `hidden` as a count,
  `note`), draws one with `look {view: "name"}` and puts one on screen with
  `show {view: "name"}` (`namedView` in `mcp/viewTools.ts`). Any text that
  is neither `current` nor a standard view is a name; one that is no view is
  refused with the names there are. `look` then draws exactly that view
  whatever the screen shows (it passes the view's own section, or null, and
  its own explode, or null: nothing of it is `'current'`), and the caption
  names it in quotes (`viewSaid`). `show` applies it for now, by the rule
  every `show` follows (`showForAgent`): the scene file goes on saying what
  the person had, and the view's chip is the one that is on
  (`actions.viewShown`). What is given beside the name wins, and a section
  or an explode given takes the place of the other (`section: 'current'`
  cuts only when the user has a section). A picture draws the scans the
  view switches on, each as thin as it is on screen, and says so where the
  view has one otherwise (`how thin it has S1 (50 %), which is drawn as thin
  as the user's screen has it`).
- **`save_view` proposes.** Main checks the name, the layout, the parts, the
  plane and the explode; the window (`proposeView` in `state/agent.ts`)
  builds the view from the request and from what is on screen for what the
  request leaves out (the camera is where it is going when `show` has just
  sent it somewhere: `Viewport.cameraGoal`, which the strip's save and
  update use too), keeps it as the agent's and proposed
  (`actions.proposeView`, whatever the view says of itself), and gives the
  scene file to main at once. The tool answers once that file is on the
  disk, and with an error that says so when it could not be written.
  Nothing on screen changes. The agent may
  replace its own proposal of a name, never a view the person made or kept
  (refused, naming theirs). One more proposal than 12 drops the oldest of
  them, and the reply says which.
- `state.md` names the views in a line, with what of each is gone.

## The first screen

- The folders opened lately are `recent` in torno's own config file
  (`~/.config/torno/config.json`, on macOS `~/Library/Application Support/torno/config.json`, or `TORNO_CONFIG`; `src/main/recent.ts`):
  the newest first, eight at most, beside `workspace`. Never in a workspace.
  One that is no longer a folder is shown struck and leaves the list only
  when the person removes it. A test run reads and writes no config file but
  one it names with `TORNO_CONFIG`, and Electron keeps its own profile in a folder of the run in the temporary
  folder (`testProfile.ts`).
- The example is a copy of the project in `app/resources/example` (`EXAMPLE_OBJECTS` in
  `src/main/example.ts`: one, `enclosure`, a model written after the `torno-model` skill's template, with its
  `brief.md` and, in its `.torno/`, `marks.json` and `scene.json` and nothing else of it:
  `copiedOfExample`; `kernel/tests/test_example.py` builds it and holds its marks to the build) made in the
  system's temporary folder when it is asked for, once in a run, with a marker file at its top
  (`EXAMPLE_MARKER`). It is removed at the end of `will-quit`, after the
  writes that were under way and the sessions have ended (`removeExample`),
  and one a crash left is removed at the next start (`sweepExamples`): only
  ever a real folder that marker names, of a torno that no longer runs.
  `WorkspaceInfo.example` says the open folder is it, and the window says
  `EXAMPLE_NOTE` under the workspace's name.
  The example's own folder is never opened in place and never written to (the kernel's test workspace has nothing
  to do with it). **Keeping it** (`keepExample`, channel `workspace:keepExample`; the root CLAUDE.md names it among the writes
  outside `.torno/`) copies the open copy, with whatever was made in it (not the marker, `__pycache__`, links, nor
  `.torno/session.json` and `state.md`, which are of the run), to a new folder at the path the save dialog gave
  (under test `pickSave`): planned first (256 MB, 5,000 entries, 12 deep at most), written in a hidden
  `.<name>.torno-new-<random>` beside it, the name taken by `mkdir` and the hidden folder renamed onto it as the last
  step, refused for any name that is taken in any case; the copy to keep is `ws.info.root`, which must carry the
  marker. The folder is then opened and remembered like one chosen in "Open folder"; the temporary copy stays until
  quit, as ever. The copy is
  not remembered: not as the workspace to open next, not as a recent folder.

- **What torno needs** (`main/ready.ts`, `main/readiness.ts` `ReadyKeeper`, `shared/ready.ts` `Ready`; the channels `ready:check`,
  `ready:make`, `ready:changed`) is found before anything fails, for the first screen, the empty workspace, the page of a
  new object and the sheet of the folder menu. `checkTools` looks for the agent's command (`AgentAdapter.probe`: with
  `TORNO_AGENT_CMD`, the stand-in's) and for `uv` on `process.env.PATH` (the login shell's, on a Mac or Linux, after
  `applyLoginPath`) with the `findCommand` a session uses, and runs nothing for it. Outside tests (`askCli`, false under
  `TORNO_TEST=1`) it also asks the CLI `--version` and `auth status`, once per run and again only for "Check again" (`get(true)`), each
  within `ASK_MS` (3 s, then the process is killed: a runner that never answers is given up on as well), nothing
  written, standard input closed; and `uv --version`. The runner is an argument (`Runner`) so a test runs the
  stand-in, which answers both (`FAKE_AGENT_VERSION`, `FAKE_AGENT_AUTH`). The version rule is Task 5's (`outside`,
  `TESTED_CLAUDE`: quiet inside the tested minor); the account is read from the JSON's `loggedIn` and `authMethod` only
  (`signed-out` on `loggedIn: false` or `none`; any other shape is not known, and the email is never kept); a CLI that
  does not answer is `silent`. Whether the Python environment is made is whether `pyvenv.cfg` and a `site-packages/build123d`
  are there (`ownEnvironmentMade`: a folder uv began and did not finish is not made): torno's (`ownEnvironment()` in
  `paths.ts`: `kernel-env` under `userData` packaged, `kernel/.venv` otherwise), or, for a workspace with a
  `pyproject.toml`, its `.venv`, which is only reported (`environmentOf`). The kernel of the open workspace is
  `none`/`starting`/`ready` (versions)/`failed` (its reason, 600 characters at most), set by `ReadyKeeper.opened` and
  `closed` from `openWorkspace` and `closeWorkspace`, and by what the kernel tells of every start (`KernelClient.onState`:
  `starting` when it is started again, after one exit or by the build that follows a stop for good, `ready` when it answers,
  `failed` when it stops for good), so a kernel that failed and was mended by a rebuild is not said to have failed any
  longer; a kernel of a workspace that was left no longer speaks (`epoch`). The CLI and uv are asked with `agentEnv(process.env)`
  (`sessions/agentEnv.ts`), the environment a session gets: without a parent Claude Code session's variables, nor an
  outer torno's session.
  `ReadyKeeper.makeNow` ("Make it now") runs `environmentCommand` (`uv sync --project <kernel dir>`, `--frozen` and
  `UV_PROJECT_ENVIRONMENT` when packaged) on torno's own kernel project, never on a workspace: it refuses a folder
  with its own project, no `uv`, and a kernel that is starting (it makes the environment itself); it tells uv's lines as
  `changed`. The window is told the whole `Ready` at each change; the window sends nothing that is run or written.

## The page of objects

- **A card is read, never made** (`shared/show.ts` `ObjectCard`, `src/main/show/cards.ts` `cardsOf`). Asking
  for the cards builds nothing, starts no worker, opens no session and loads no scan: of an object opened in
  this run it says what main knows (its build state, its marks from the store), of any other what the files
  under its `.torno/` say. The marks of an object not opened are read with `peekMarks`, which only reads: no
  file is set aside and nothing is written (the store would do both). `show:changed` tells the window, at most
  once in 200 ms, that a card may say something else: a build state, the marks, a session's status, a picture
  kept, the list of objects read again.
- **No verdict of a build that is not of this run.** `dimensions` (failing, not measured, passing) is only of
  an object opened here whose revision is above 0, counted as the status line counts (`unmetDimensions`,
  `standingOf`). Otherwise it is null, and `lastRun` says how many open dimensions the object has and how many
  failed when they were last measured: told as `1 dimension failed as of its last run`, in no colour of a
  verdict, never as a pass. Likewise the build line: of a build of this run it is in ink behind the status
  line's dot (`buildLine`: `standing`); of an object not opened here it is muted and has no dot, and says
  `Model saved N ago` from `sourcesMtimeMs` (the newest `.py` of the object and `common/`, read from the files
  as `behind` is; absent when it has no model), the plain `Not opened in this run` being its tooltip.
- **Main alone keeps it** (`show/cards.ts` `keepThumbnail`, `saveThumbnail`, `thumbnailOnFile`; `ipc.ts` only
  joins them to the open workspace): `<object>/.torno/thumb.png` and `thumb.json` (`at`, `layout`, `parts`,
  `model`, `sourcesMtimeMs`, `bytes`, `hash`, and `cut`, `apart`, `hidden` when the picture is cut, drawn
  apart or leaves parts out). Only for an object opened in this run whose last good revision is the one the
  window names, and only bytes `thumbnailRefusal` passes: a PNG (signature and `IHDR`) of 480 × 360, at most
  `THUMB_MAX_BYTES` (512 KB). Anything else is dropped. Each file is written atomically and the saves of one
  folder go one after the other; the facts say how many bytes the picture has and their SHA-256, and **a
  picture that is not the one its facts are of is no picture**: `cardsOf` drops it by its size (one `stat`),
  `thumbnailOnFile` by its bytes, and the card then says `No picture yet` and nothing of one.
- **git is read, never written** (`src/main/git.ts`, `shared/git.ts`; #62). `gitState(objectDir)` runs one `git status
  --porcelain=v2 --branch -z` by `execFile` (no shell) with `--no-optional-locks`, `GIT_OPTIONAL_LOCKS=0`, `core.fsmonitor=false`, no
  prompt, `GIT_DIR` and its kin taken out of the environment, 5 s (`GIT_TIMEOUT_MS`) and then killed, over the project's folder and
  the `common/` beside it (the paths of the work tree, found by `rev-parse --show-toplevel`), and drops what is under `.torno/`.
  It answers the commit, the branch and the files that differ (30 named at most, all counted), or null: no git, not a work tree,
  no answer in time. `git.test.ts` holds that the index's mtime, inode and size are as they were after a status on a stale entry.
  No other git command is run, none that writes: **torno never commits**; the person asks the agent to (the Marks panel offers the
  request). It reaches the window as `git.status(objectId)` (`gitStateRecently`: an answer is kept for a second, so a page of
  cards and the status line cost one run) and as `ObjectCard.git`.
- **A build has an identity** (`src/main/buildlog.ts`, #62). When a build lands, `BuildLog.record` finds `sourcesHash` (twelve hex of the
  SHA-256 of the `.py` files directly in the project's folder and in `common/`, and the files the build says it imported from
  elsewhere in the workspace, `Scene.uses` when the kernel gives it; each by its path and bytes), the commit (`gitState`) and whether files
  differ from it, keeps that in memory for the run (40 builds an object; `identity(id, revision)`, `buildIdentity` in `ipc.ts`) and
  adds a line to `.torno/builds.jsonl` (`revision`, `at`, `run`, `sources`, `head`, `dirty`): one write at a time, through
  `ownTorno` and `ensureIgnored(dir, ['builds.jsonl'])`, appended, or the last 500 lines written whole when it would pass that.
  `run` is the run of torno (random): a revision counts from 1 in every run, so a line of the file is a revision of *that* run alone.
  The hash is of the files as they are when the build lands; a save during a build builds again.
- **A history of builds** (`src/main/history.ts`, `shared/history.ts`; #56). `History.keep` (called from `ipc.ts` when a build lands, with the
  promise of `BuildLog.record`, so in the order builds landed) keeps each build that worked under `.torno/history/`, ignored through
  `ensureIgnored(dir, ['history/'])`: `index.json` (`{ next, entries }`, written whole and atomically), and per build `h41/scene.json` (the
  scene without `output`; its mesh was never in it), `h41/source/<path from the workspace>` (copies of the files `sourcesHash` goes by, read
  once with `readSources`; not copied, and the entry kept with `files: []`, when they hash otherwise than `BuildRecord.sources` says, or pass
  `MOST_FILE_BYTES` a file or `MOST_COPY_BYTES` a build) and `h41/thumb.png` (the card's picture, attached by `History.thumbnail` from
  `show:saveThumbnail` once `keepThumbnail` took it; at most `MOST_THUMB_BYTES`). The folder of a build is written before the index names it,
  so a crash leaves the index whole and at most a folder no index names, which the next change sweeps (only folders named `h<n>`). **An id
  is `h<n>`, counts on across runs and is never given twice** (`next`, and above any folder there: a lost index does not repeat one); a revision
  is of its run and is told beside it. A build made from the sources the newest entry was made from is not kept again (unless the person's
  `Params` made it: the files are the same and the shape is not). **What caused each build, and its prompt, are main's alone** (`cause`, `turn`,
  `wentBackTo`: never from the window or a tool): `Builds` says what it started a build for (`BuildReason`: `watch`, `params`, `rebuild`,
  `goback`, `open`, on the `build` and `scene` events), `params` and `goback` are the cause as they are, and else `Sessions.causeOf(objectId,
  startedMs)` says `agent` (a session of the object has a turn running whose first edit, `TurnState.changedAt`, was at or before the build began;
  a build begun between the prompt and that edit is the person's) with the turn (`conversation`, `prompt`: the uuid a chat's prompt was sent
  with, or `t-<conversation>-<n>` in a terminal, `text`: its first 200 characters), or `person`. A build that **failed** is kept too
  (`History.keepFailed`, from `ipc.ts` on the `build` event): a line with `failed`, `error` (`errorLine`), `files: []`, the revision of the last
  good build, no folder; the same failure of the same sources as the newest's is not kept again; not for a cancel, a stopped kernel or a project
  with no model. `thumbnail` and `dimensions` never go to a failed entry. Pruning lets go of the oldest failed entries before any build, and never
  of the newest entry. A build whose declared
  checks fail is kept and marked (`failing`). The newest 100 are kept besides every starred one (`HISTORY_KEPT`; `History.star`). The entry's
  verdicts are **as of then** (`dimensions` is set when the check that followed the build ends, `keepDimensions` in `ipc.ts`): never told as
  how the build stands now. One writer, one change at a time per object, `ownTorno(dir, 'history')` before every write and delete; nothing
  of it is ever copied back: torno never restores a file (the window asks the agent to).
  **Meshes for the ghost of a kept build** (`src/main/meshes.ts` `RecentMeshes`, `ws.meshes`): the scene and the blob of each build of
  this run, in memory only, never written; `MESH_BUDGET_BYTES` (64 MB) for all the objects, not counting the newest build of each, the
  oldest let go first. `history:list` says which kept builds still have theirs (`ghosts`), `history:ghost` hands them to the window
  (a build of this run only).
- **`.torno/.gitignore` has one writer**, `src/main/ignored.ts` `ensureIgnored(dir, lines)`: it adds the
  lines that are missing at the end, makes the file when there is none, never removes or rewrites what is
  there, and adds nothing against a line the person negated (`!thumb.png`). The thumbnails ask it for
  `thumb.png` and `thumb.json`, the state file for `state.md`, a conversation put on file for `session.json`,
  a chat's log for `chat/`, an export for `exports/`, a picture for `views/`, the builds' record for `builds.jsonl`, the overrides of
  `Params` for `params.json`. What is the
  object's travels: `scene.json`, `marks.json`, `scans.json`, `profile.json`, `agent.json`.
- **`.torno` is named in one module, `src/main/own.ts`** (`FOLDER`), and every write under it goes through
  `ownTorno(dir)` first (`writeOwn` for a file written whole): a link or a file in its place is refused with a
  plain reason, nothing is written, and the person is told once for each object, in the Marks panel
  (`onNotOwn`, wired in `index.ts`). (`.torno/views/` and `.torno/scans/` each have a `.gitignore` of their own
  inside them, written by whoever makes the folder.)
  - The folders torno keeps under it are held to the same rule by the same function, named after the folder:
    `ownTorno(dir, 'views')`, `ownTorno(dir, 'exports')`, `ownTorno(dir, 'scans', 'S1')` (`ownFolders` and
    `linkRefusal` of the scans are that call), `ownTorno(dir, 'chat')`. It is asked before every write into
    such a folder and before every delete in it (the pictures cleared away past the newest 20, a scan's
    folder, a mask, a sweep): a link or a file in its place is refused, nothing is written or deleted where it
    leads, and the window is told once for each such folder, by itself (`inside` of the listener: the rest of
    the object is kept, and the Marks panel does not say that nothing is).
- With 40 objects, none opened: `show.cards()` takes 3 to 8 ms, and the pictures of the first three rows are
  asked for. A thumbnail of a two-part fixture costs about 7 ms; of a generated part of a million triangles
  (23 MB of meshes) 35 to 90 ms of the window's time (7 to build, 21 to 49 to draw, 6 to 35 to read back).

## Scans

- The source is only read: referenced by absolute path, size, modification
  time and SHA-256, never copied, moved or written. The scan works from its
  mesh when the source is gone (`sourceState`), and says what to do when the
  mesh is gone too (`meshState`).
- Main is the only writer of `.torno/scans.json` and of `.torno/scans/`
  (`src/main/scans/store.ts`, with a region's mask files in
  `scans/masks.ts` and what an alignment becomes when it is kept, undone,
  held or checked in `scans/alignments.ts`, each a scan made of a scan):
  one change at a time per object, written atomically before it is told. Ids are `S1`, `S2`, … per object, never
  reused, also when `scans.json` is lost and a folder `S<n>` is still there.
  Visibility, opacity and colour mode are view state, in `scene.json`
  (`scans`); what `show` sets of them never reaches that file.
  - A conversion or a re-import writes a new file, `mesh.<n>.bin`, and the
    record names it (`imported.mesh`; absent means `mesh.bin`): the write of
    `scans.json` is the commit, the old file goes after it. Never build a
    mesh's path by hand: `ScanStore.paths()`, after `list()`.
  - What may be deleted under `.torno/scans/` is in `meshfiles.ts` `sweep`:
    a folder only when it holds the `importing` marker of an import that
    never ended, an unnamed mesh only while the named one is there, nothing
    through a link, nothing beside a `scans.json` that was set aside. Nothing
    is written through a link either (`ownFolders`: `.torno`, `.torno/scans`,
    a scan's folder), and nothing else is deleted through one (`linkRefusal`
    in `masks.ts`): not a mask, not a scan's folder when the scan is removed
    (the removal is refused, saying to take the link away, and the scan kept), and the sweep clears nothing
    where `.torno` or `.torno/scans` is one. A re-import that a removal
    overtook takes away the folder it made again, only when it is empty.
  - What `scans.json` says is bounded as it is read (`scans/file.ts`): a
    layout name and a source path are one line, 200 and 4,096 characters at
    most; a mesh whose header gives no box is refused (`parseScanMesh`).
  - `list` and a failed read of a mesh tell the scans anew when a source or
    a mesh is found gone or back (`looked`), so a row never says "aligned"
    of a scan the tools refuse. The window asks for a mesh again when it is
    back, and after a failure only once the scans were told anew
    (`ui/scanMeshes.ts`).
  - Main alone names a mesh or a mask file. The one path the window gives is
    the source of an import, which main checks (`sourceOf` in `scans/source.ts`: absolute, one of
    the five formats, not inside the object's `.torno/`) and only reads.
- After every build and every alignment the alignments are checked
  (`main/scans/alignCheck.ts`): the model points an alignment is tied to
  (ends clicked on a part, a floor laid on a face) are looked for on their
  parts again with the kernel's `nearest`, and each part's `arranged` is
  compared with what it was. What is found is told; nothing is ever
  re-fitted. An alignment not checked against the last build is asked about
  again every 30 s and whenever the scans are listed for a tool, the prompt
  or the window (`keepChecking`, `recheckAlignments`), until it is. "Still
  right" (`alignmentHolds`) holds the alignment against the model as it is
  now (`confirmed.held`).
  - **No check by itself has an object built again.** A check after a build,
    on a timer or at a listing asks with `Builds.query(…, { restore: false
    })` (`checkingAlignments`, and the marks' `retrying`, whose `restore` is
    true only for the run a person's act or a tool asked for); when the
    kernel no longer holds the build it records why (`uncheckedFor`, `the
    kernel no longer holds this build`) and waits for the next `scene`. When
    the model, as it is, does not build either (`NotBuilding`, which
    `Builds.query` throws then, asked to restore or not), that is the reason
    recorded (`NOT_BUILDING`), and it is not tried again. The scans' store is
    looked up at each run of the check, as the marks' is.
  - `Builds.query` restores a build the kernel let go, for a tool or an act
    of the person; but not sources that have just failed to build
    (`Entry.failure`, until a source changes or a rebuild is asked for): it
    then rejects saying there is no build to answer from, and that one comes
    when a source changes or Rebuild is pressed. `BuildState.letGo`
    (`memory`) says the kernel let the object's build go to make room
    (`build.started`'s `retired`, or a `no_build` with `reason: "memory"`);
    `letGoText` words it for the status line and for `scene`.
- **One notion, one wording.** How an alignment stands is `standingOf(scan,
  layout, revision)` in `shared/scans.ts` (`basis`, `rough`, `stale`,
  `unchecked`, `waiting`, `failed`, `note`), for the row, the bar and the
  picture's caption (`scansNote`). What main says of it to the agent is
  `alignmentSaid` in `main/scans/said.ts`, and nothing else in main words an
  alignment: the tools' `alignment`, the doubts that open a reading
  (`first`), its closing sentence (`last`), the `Scans:` line of the prompt,
  `state.md`. A tool reads it again once the kernel has answered (`saidNow`).
- A part torno moved for display is refused by the scan checks
  (`scanSpread`), saying the whole way: a layout that places it as the model
  does and in which the scan is aligned, or `def assembly(p)`, a build, and
  the user aligning the scan in it (an alignment is of one layout); and the
  parts it did not move. A scan not aligned in the layout asked names only
  the layouts that would answer for that part (`notAligned`). So is a part
  that stood elsewhere when the scan was aligned (`scanFrame`). Other parts being spread
  otherwise is a doubt, said first, not a refusal. Refusals are made in main
  before the kernel is asked (`scanFor`).
- **Nothing from a scan is ever said to be exact.** Every reply has `exact:
  false`, `approximate` (`SCAN_APPROXIMATE`) and `≈`, the revision, the
  layout and the alignment with its rms. `measure` with a scan end forces
  `exact` false whatever the kernel says of the distance.
  - **A dimension is of the model.** `add_mark` with `kind: 'dimension'`
    refuses an end that is a point of a scan or a region (`dimensionFor`):
    it would be kept as a bare point, told as exact and checked on every
    build.
  - In a reading a length or a point taken from a scan is told to 0.1 mm
    (`scanNumber`, `scanVector`; under 0.05 mm is `under 0.1 mm`); the data
    keeps the kernel's. A reading closes with how the scan is aligned and,
    of a fit, that its RMS is of the clicked points (`RMS_OF_CLICKS`):
    never a word on how true the scan is. The fit's own figures (RMS, worst,
    where a hand left the pairs, a floor's plane) are told to 0.1 mm too in
    whatever the agent reads: what main says (`tenth` of `shared/format.ts`,
    given to `alignmentText`) and a caption, of a picture or of `show` (`standingOf`
    gives `basisText` the same). The bar and the row show the person theirs
    to the thousandth, and the data keeps them in full. What else is known of an
    alignment (`standing.note`) is said once a reply, in the reading.
    `scan_deviation` says the least distance, and that `within` is where the
    looking stops.
- A region is a mark of kind `region` (`main/marks/regions.ts`): its
  triangles are `<id>/<stem>.mask` (`maskStem`: `M7`, and `M7.2` once it was
  painted again), a bit each, of the triangle count of the mesh it was
  painted on. The window sends the bits (`NewRegion.bits`), never a path;
  main checks them against the mesh, works out its numbers (`REGION_KEYS`,
  `shared/regions.ts`), held in the scan's own frame under `local`, and
  writes the mask before the mark. `add_mark` has no such kind: only the
  person paints.
  - It is of its scan in every layout: `layout` is only where it was
    painted. It is drawn, numbered and listed in whichever layout is shown,
    and told in the layout asked (`describeMark`'s `layout`: the one on show
    for the prompt, a tool's `layout` argument), where the scan's alignment
    there puts it, or as having no place there.
  - Its size is that of its own box (`local.box`: the axes it spreads along,
    from the second moments of its surface), told as `≈ 200 × 10 × 2 mm, its
    long side along (…)`; the box along the layout's axes is told as what it
    lies `within`. Flat is thin against its lesser side (`isFlat`), the same
    however the scan is turned. Every number of it has `≈`.
  - The mark records the mesh it was painted on (`mesh`, `meshIdentity`: the
    source's hash, the counts, unit and up). `MarkStore.list` orphans a region
    whose scan is gone or has another mesh, whenever the marks are listed:
    there is no second step to skip. A mask that is gone or of another
    triangle count orphans too (`tendRegions`, when the window lists the
    scans); a mask that could not be read for any other reason leaves the
    region as it was and is said as a problem line. Orphaning is undone when
    its cause passes: `list` brings back an orphaned region whose scan is
    there again with the mesh the mark records and a mask that reads
    (`maskReads`), and says so once (`M7 is back: …`). A mask that did not
    read is not read again at every listing: one `stat` a listing
    (`maskStamp`) says whether its file is another than it was, and then it
    is, as when the scans are told anew (`MarkStore.scansChanged`); a read
    that failed for a reason that may pass (`maskReads` rejects) is
    remembered of nothing. One the window could not get for its tints is
    asked for again when the scans are told anew (`regionTints.ts`). A region's data says in a
    word how the alignment it is placed by stands (`alignment`, as
    `alignmentSaid().state`); a draft region of an object that is not the
    one open is told in the first layout of its build, and its line says
    which (`[in layout assembly]`).
  - A conversion keeps the triangles and restates the numbers and the mesh
    (`convertScan`); when that fails the scan's regions are orphaned, with why.
  - "Edit" on its row takes its mask in hand as a painting; "Keep" writes a
    new mask file, then the mark with its numbers anew (a sent one is a draft
    again, `(changed)`), then removes the old file (`repaintRegion`). A mask no
    mark names is cleared away by `tendRegions`.
  - The kernel leaves out of `ignore` only the scan vertices every triangle
    round which is painted, and as crossings only painted triangles: the rim
    of a region still counts. Asked for alone (`region`), its rim is its own.
  - The Region tool (`tools/regionTool.ts`; what is painted and not yet
    kept, and what the bar and a mark's row do with it, is the registry in
    `tools/regionPainting.ts`) takes the scan only where it is
    what is drawn at the pixel under the pointer: not behind a part in front
    of it, not in the half a section took away. The brush is a ball round
    that point. A stamp takes nothing a part hides: whenever the box of a
    part that is drawn meets the square round the stamp on the screen
    (`boxMeetsBrush`), each triangle the stamp would change is asked about
    at its middle, one pick of the parts' faces (`edges: false`: an edge is
    found 6 px off it, and is no part in front; the pointer's own pick is
    asked again so when it names an edge), and what a part is nearer than
    is left (`tools/stamp.ts` `stampTriangles`). What was asked is kept for
    the stroke while the camera is where it was. A stamp asks about 1,000
    anew at most (`STAMP_TESTS`) and takes none unasked: the bar then says,
    once the stroke has ended, that near a part the brush paints slower
    (`SLOWER`). With no part's box near, nothing is asked. When none is
    chosen the brush is a thirtieth of the scan, 25 mm at
    most (`usualRadius`); a box takes what faces the eye unless "Through"
    is chosen, and does not look at what hides what. It works while the build
    is stale. A painting is discarded by "Clear" alone, and `Z` brings that
    back; another tool, `Escape` or another object parks it (per object, in
    this run, not on the disk; it goes with its scan only once that object's
    scans are known, `scansKnown`, and with the workspace), the palette's
    Region button shows a dot, and `Escape` in the middle of a stroke gives
    up that stroke only. A kept region whose "Edit" is parked is drawn from
    its kept mask: it is left out of the tints only while the tool is in hand.
  - In Pairs (`tools/alignTool.ts`) a click gives the end that is asked for
    and no other (`expects`: the end the open pair lacks, else `first`, which
    `Tab` switches); the bar's line names the pair and the end (`nextLine`).
    A scan aligned in another layout offers that transform as a start, kept
    as by hand (`startedFrom`): never as a fit of this layout.
  - A press during a view move is answered from the camera as it is at the
    press (`CameraMove.drop`): nothing jumps the move to its end.
- What the window says of its scans (`ViewState.scans`) is sanitised in main
  (`scansOf` in `main/look.ts`) before anything is told of it.
- What must never happen: a number of a scan told as exact; a preview told
  or stored as the alignment; a mask applied to another mesh than the one it
  was painted on; a mesh or mask path taken from the window or from a tool's
  arguments; a write outside `.torno/`, or to a scan's source.

## Exactness

- The app says `≈` wherever the kernel does not say exact: `scene` gives each part `sizeExact` and
  `volumeExact` (true only where the kernel's flag is) and a note when one is false; `state.md` writes `≈`
  before such a size; `measureReading` and `checkReading` (`mcp/readTools.ts`) write `≈` and the kernel's `how`.
  `scene`'s sizes are for orientation: its description sends the agent to `measure` for a number to rely on.
  A part with solids turned inside out (`Part.reversed`, indexes 0-based in the kernel's order) lists them in `scene`
  with a note (`REVERSED_NOTE`), and `checkReading` of an overlap or a clearance names the parts the kernel says have one.
  `scene` gives each part `solids`, `openShells` only above 0 (`OPEN_NOTE`) and `meshVolume` only beside
  `meshDisagrees` (`MESH_NOTE`): what a mesh encloses is never exact, is said with `≈` wherever it is said, and is
  only ever a warning.
- A `print` layout that was spread (`arrange.py`) has its parts where torno
  put them. Between two parts of which either was moved, `check overlap`,
  `check clearance` and `measure distance` are refused in main
  (`spreadApart` in `marks/spread.ts`), naming the layouts that place both
  as assembled; so is a distance from a bare point to a part that was moved, and `check interference`, which is of every part
  of the layout (`spreadLayout`).
  A dimension of such a distance is not kept, and one there already is not
  measurable on that build (`spreadReason`, with where to measure it). An
  angle is answered, since parts are moved and never turned: each end of a
  dimension moves with its own part (`shiftB`). The window says it in a line
  (`SPREAD_LINE` in `tools/measureTool.ts`), in place of the estimate. An answer of one part carries its `arranged`, and a `section` a
  note and each part's. Fit is checked in a layout that places the parts as
  assembled (`assembly(p)`).

## Export

- Main is not held while a file is made: deflating is zlib's own, on its threads (`squeeze`), and a scan is
  reduced in turns of the event loop (`clusterScanInTurns`). A reduced scan is kept by folder, scan,
  `meshIdentity` and size until the sheet is put away (`export:done`, `forgetExportScans`); packed parts by
  their build's blob.
- Saving (`export:save` in `ipc.ts`): the file is made first, then the save dialog is asked (under test
  `__tornoMain.pickSave`, with `savePicks` and `saveOffered`), opening in `<object>/.torno/exports/`
  (`prepareExports`: made on demand, ignored through `ensureIgnored(dir, ['exports/'])`), and `writeExport`
  writes it whole or not at all: `<path>.<random>.tmp` opened `wx`, written, synced, renamed onto the path, and
  removed if anything fails; the file that was there is never truncated first. No folder is made. A name
  without the format's extension gets it (`exportPath`: `.html`/`.htm`, `.step`/`.stp`, `.stl`, `.3mf`); if that
  file is there already the dialog never asked about it, so torno asks before replacing it (under test
  `__tornoMain.replace`, counted in `replaceAsked`).
- **A file of the model** (`format` `step`, `stl` or `3mf`; `export/model.ts`) is of one object, one layout and
  the parts the sheet names (a group's name stands for its parts, `partsNamed`), in the colours torno draws them
  (`partColors`): STEP the assembly unless asked, a mesh the `print` layout, an STL one part with a solid. The
  window sends names and two numbers, never a path (`exportAsked`). It is made by the kernel's live worker of the
  last good build (`Builds.query` of `export` with `blob`, `KernelClient.query`'s `{ result, blob }`), before
  the dialog is up, of the revision there was when it was asked for (`NEW_BUILD` if another landed while it was
  made, or replaced the worker that made it: `KernelClient.query` asks a cancelled query again of the new worker, but
  never `export`, `export_check` or `try_fillet`, `NOT_RETRIED`, whose answer is of the build that went and which
  would hold up the new build's checks for minutes); `writeExport` is given a `check`, run on the `.tmp` once it is whole and closed and before
  the rename: `checkModelFile` has the same worker read that file back (`export_check`) and throws, with every
  problem it found (`FAILED_CHECK`), when it did not pass, or when another build of the object landed since the
  file was made (`NEW_BUILD`). A write under way is in `exportsUnderWay` until it ends; `will-quit` gives each up
  (`stopExports`: the check is not waited for, nothing is named) and waits, with the stores' writes, until its
  `.tmp` is removed. A file that fails is never named and the `.tmp` is removed. The sheet is told what
  was checked (`ExportSaved.checked`). A 3MF asked to be opened (`ExportRequest.open`, the sheet's tick) is
  handed to the system once it is named (`shell.openPath`; under test the path is put in
  `__tornoMain.openedFiles` and nothing is opened). The plan of such a file weighs nothing (`exportPlan`: each
  object's `layoutParts`, and `ONE_OBJECT` when several are ticked).
- After a save the sheet offers `export:reveal` and `export:openSaved`. Neither takes an argument: they act on
  `savedHere`, the path the last `export:save` wrote, kept in main until `export:done`, and refuse when the
  file is gone. Under test they go through the `revealFile` and `openFile` hooks (`revealedFiles`,
  `openedFiles`) and nothing is shown or opened.

- **A picture of the view** (`export:savePicture`; `FileFormat` `png` in `shared/exportdata.ts`; the export sheet's reader "A picture"): the window draws it
  (`pictureForPerson`, the renderer of `look` with `ImageRequest.person`: up to 4000 px, `MAX_PICTURE_EDGE`, and
  without the axes and scale bar when asked) and sends the PNG's bytes and the object's id; main reads the header
  (`checkedPicture`: a PNG, at most 4000 px and 64 MB, else refused), asks where to save (`askWhere`, the same dialog and
  hook as any export, opening in `.torno/exports/`, default name `<name>-r<revision>.png`) and writes through
  `writeExport`. The path is the dialog's alone and no agent has a tool for it; the agent's pictures stay within
  2000 px (`checkedImage`, `pictureSize` without `forPerson`).
- **A drawing of the section on screen** (`export:saveSection`, `export/section.ts`, `export/sectionSvg.ts`; `FileFormat`
  `svg`, or `pdf`): the window sends the object's id and `svg` or `pdf`. Main takes the plane, the layout and the parts that are on from the
  view the window last reported (`latestView`), asks the kernel for the outlines within `SECTION_DEFLECTION`
  (0.01 mm) of the last good build, in full (not the thinned points the `section` tool tells), refuses when there is no
  section on screen (`NO_SECTION`), nothing cut (`NOTHING_CUT`) or a build landed meanwhile (`NEW_BUILD`), and writes
  the SVG through `askWhere` and `writeExport`. A PDF (`export/pdf.ts` `pdfOfSvg`) is that SVG printed by `printToPDF` in a `BrowserWindow` that is never shown (`show: false`, sandboxed, no script, every request but the data URL cancelled) on a page of the drawing's own size in millimetres, made before the dialog is up. Both set `savedHere`, so the sheet's "Show in folder" works for them. `sectionSvg` is pure: the file is in millimetres (its width and height
  in `mm`, the viewBox in the same numbers, so one unit is one millimetre; no scaling), with a scale bar, a title block
  whose numbers are in full (`full`), and the dimension marks of the layout that are not resolved, are measured on the
  build (`measuredValue`) and have both ends within `IN_PLANE_MM` of the plane, with the value and, when set, `expected
  ± tolerance`; the others are listed in `left`. What the build was made from (#62: `identitySaid` of `buildIdentity`,
  sources hash, commit and "with changes") goes in the title block as `Source` through `SectionDeps.identity`.

## Agents

- Claude Code is the one agent torno runs. It is started by an adapter (`src/main/sessions/adapter.ts`: `AgentAdapter`; `claude.ts`
  `claudeAdapter`, the one there is), which says the `command` looked for on PATH, whether it is given torno's
  `skills`, how its client names a tool of torno's to the model (`toolName`: `mcp__torno__scene`), and
  `launch(ctx)`: the command, its arguments as a list of strings (never a line for a shell), variables to
  add to the environment, and files to write (`AgentLaunch.files`). Everything the agent is given of torno is on its
  command line, in its environment, or in a config file of torno's that holds no secret (the `--mcp-config` file,
  `<userData>/agent/<session id>.mcp.json`, written before the agent starts and removed when it has gone; the folder
  is cleared at start). The session's token (`LaunchContext.token`) is in its environment alone, as `TORNO_SESSION`:
  never in an argument or a file. A `TORNO_SESSION`, `TORNO_OBJECT` or `TORNO_SESSION_ID` torno itself was started with
  (from inside a session of another torno) reaches no process it starts: `withoutSession` of `sessions/agentEnv.ts`
  takes them out of the environment of the kernel, the import of a scan, `runCommand` and `makeEnvironment` of
  `ready.ts`, and `agentEnv` of the agent's, whose own the session then sets; an outer token would otherwise reach a
  model that prints its environment, and from its output a chat log that `redact` does not know it for. Nothing of the person's configuration of it is written, and none of its settings is
  read (the instruction files Claude Code reads are listed by path and size, below, and never read), and nothing is
  written in the object folder outside `.torno/`. The MCP address given is of that object alone, and the session's
  token opens that object's MCP server and that session's hooks, nothing else.
- The system prompt is one text (`src/main/prompt.ts` `systemPrompt(toolName, skills)`). Claude Code is
  given torno's skills, a plugin in `app/resources/agent-plugin` (`torno-model`, `build123d`, `scans`,
  `dimensions`) passed with `--plugin-dir` (`paths.ts` `agentPluginDir()`; nothing is installed in the person's
  Claude Code), so its prompt (`SYSTEM_PROMPT`, `skills` true, under 7,000 characters) says of scans and
  dimensions only what a prompt's lines need and names the skills; `SCANS_TEXT` and `DIMENSIONS_TEXT` are said
  to the letter in the skills `scans` and `dimensions`. Started without the plugin folder (`skills` false) it is
  told the whole text (`FULL_PROMPT`, under 8,000 characters). A change to what the prompt says of scans
  or dimensions is a change to the skill too (`prompt.test.ts` holds them together); the template of
  `torno-model` is built by the kernel's `tests/test_skill_template.py`. The `build123d` skill carries files beside its `SKILL.md`, which `electron-builder.yml` ships with the plugin folder: an API reference of the pinned build123d, generated (`kernel/scripts/build123d_api.py`) and held to it by `tests/test_skill_api.py`, which also runs the skill's examples, and `reference/fasteners.md`. The skill sends the agent to grep the reference (`${CLAUDE_SKILL_DIR}`), never to run Python for it, and says `bd_warehouse` is in torno's kernel, with the sizes for a model that should not depend on it; the `torno-model` skill has the section on `references(p)`. Claude Code is also given a subagent on
  its command line, `--agents` with `torno-reviewer` (`claude.ts` `reviewerAgents`): tools `scene`, `look`,
  `marks`, `measure`, `check`, `section`, `describe`, `diff`, the scan tools and `Read`, never one that edits,
  resolves, adds a mark or changes the view; `model: sonnet` (`TORNO_REVIEWER_MODEL` names another, or `inherit`
  passes none) and `maxTurns: 20`; its prompt reads `brief.md`, then checks the build against what was asked, every
  open mark and every dimension, numbers first and at most two looks, and ends with lines of `HOLDS`, `FAILS` or
  `UNCHECKED` (never left out). Claude Code's prompt says to use it after a change of several steps, before saying it
  is done. The prompt states the verify loop in one paragraph: after an edit, numbers first (`measure`, `check`,
  `section`, `diff`), then one `look` with the marks drawn, a second only for what the first could not show; `review`
  asks the same (one or two looks at all the open marks, a look at one mark alone only where numbers cannot settle
  it). It is appended with `--append-system-prompt`, not an agent definition or an output style. `contextFor`
  names tools through `opts.toolName` likewise.
- **Ablations of an eval run** (`main/ablations.ts`, `ablations()`, read once in `index.ts`): `TORNO_EVAL_ABLATE`
  (`skills`, `reviewer`, `stop`, `look`, `digest`), and `evalTuning()` of `TORNO_EVAL_LOOK_SIZE` (`ToolDeps.lookSize`,
  the fallback of `clampSize`) and `TORNO_EVAL_HOLDS` (`Sessions`' `mostHolds`, 1 or 2), are read only when both
  `TORNO_TEST=1` and `TORNO_EVAL=1` are set, and are empty otherwise; an unknown name or a value out of range throws.
  `digest` is `ContextDeps.digest: false` on the deps of `buildContextFor` (`state.md` keeps its digest). Each is one switch: no plugin folder for the adapter, `claudeAdapter`'s
  `reviewer: false` (no `--agents`), `Sessions`' `holdStops: false` (`stopAnswer` holds nothing), `ToolDeps.off` (the
  tool answers `LOOK_OFF`). None of the variables reaches the agent (`agentEnv`). Only `app/evals` sets them together.
- The view of an object's sessions, chat or terminal, is chosen under the session header and kept in
  `<object>/.torno/agent.json` (`{ "agent": "claude", "view": "terminal" }`; `sessions/choice.ts`, main's alone,
  atomic; `agent` is written still, so that the file is one an older torno reads). No file is the chat. A file
  that cannot be read, that names another agent (Copilot CLI: "which torno no longer supports"; or one torno
  never knew) or a view torno does not know is the chat too, with a `note` the pane shows beside "Use Claude
  Code", which writes the file anew. Main refuses a choice while a session runs or starts in the object (`End
  the session first`). `TORNO_AGENT_CMD` is run in place of `claude`, with Claude Code's arguments.
- `session.json` holds the conversation to resume, with `"agent": "claude"` (`sessions/resume.ts`, written
  through `writeFileAtomic`, one change at a time). A file without the key is Claude Code's; one an older torno
  wrote with another agent's conversation last holds Claude Code's under `kept.claude`, and that one is resumed;
  any other conversation is not. `Sessions.start` is a promise (the view is read from the disk); a second start
  for an object while the first is under way is answered with the first, and `stopAll` waits for one that is.
- `agent.json` is not ignored: the choice is the object's and travels with it, as `scene.json` does. `session.json`
  is ignored from the first conversation put on file. The `prompt.md` and `agent/` that sessions of Copilot CLI
  left under `.torno/` are neither read nor removed, nor their lines in `.gitignore`.
- The pane says in one line what the next prompt carries (`nextPromptLine`, `nextCarries` in `shared/agents.ts`).
- `stopAll` ends the sessions there are and those being started when it is called, not one started while it
  waits (`Sessions.busy` says whether any is there or on its way).
- "End" in the session header (`ui/SessionPane.tsx`) ends the session shown through `session.stop` and starts
  none; it asks first when the session is busy (`busyWith`), as "New session" does.
- **The build after an edit, and the Stop of a turn** (`Sessions.toolHook`, `afterEdit`, `stopAnswer`). Tool hooks
  are read (up to 8 MB; longer, or no JSON, is answered `{}`) only for the tool's name and `file_path`. The
  `PostToolUse` of `Edit`, `Write` or `MultiEdit` of a `.py` inside the object's folder waits for a build begun at
  or after that tool's `PreToolUse` (`Sessions.built`, fed every `BuildState` from `index.ts`), then, of a build
  that worked, for its marks to be checked against it and its dimensions measured (`Verdicts.settled`, 10 s at
  most, `EDIT_SETTLE_MS`), and is answered with `buildContextFor` of `context.ts` (the first lines and the
  dimensions of `contextFor`, in the same words, and between them the digest: The sanity pass, below) as
  `additionalContext`; the chat puts it under that tool's card (`Transcript.toolContext`: `forTool`), with the digest as data
  (`digest` of the `context` item), how long a build that worked took (`seconds`) and the last line of what one that
  failed said (`error`, `errorLine` of `shared/build.ts`: the traceback's last line), which the window draws the
  build line from. No build begun within 3 s: `{}`. Still running at 55 s: `A build is running
  (rN); call scene …` (`claude.ts` gives `PostToolUse` a 60 s timeout).
  A `Stop` (`stopAnswer`, `claude.ts` gives it a 25 s timeout) is judged from what the turn did (`TurnState`, made at
  its `UserPromptSubmit` by `beginTurn`: the count of builds ended, the last successful build and what the dimensions
  said of it, the last `look`, the reasons already held, when the turn first changed a source). A build is the turn's
  (`caused` in `stopAnswer`) only if it began at or after `TurnState.changedAt`: the `PreToolUse` of an `Edit`, `Write`
  or `MultiEdit` of a `.py` inside the object, or the start of a `Bash` after which the newest `.py` directly in the object's
  folder or in `common/` is newer than before (`aroundBash`, `Sessions` dep `sourcesSaved`; the command's text is never read, and
  a Bash that rewrites nothing is no change). The first build of an object just opened, a save of the person's before
  the turn's first edit, and every build of a turn with no edit are told as ever (digest, context) and never hold a
  Stop back, nor is waited for: every one of the five reasons looks only at a build the turn caused, and the hard-defect
  and dimension reasons then judge it against the build the turn began with. First it
  waits, up to `STOP_WAIT_MS` (20 s), for a build the turn caused that is still running and, when a dimension passed
  when the turn began, for the dimensions to be measured on the build that ended, if the turn caused it (`Verdicts.settled`, to the same
  deadline). Then it is held back (`decision: block`) for the first of these five reasons: the build the turn caused is still running; the latest build, caused
  and ended in the turn, failed (said as "The build after rN failed", `failedAfter`: a revision names a build that worked, and a
  failure has no number of its own); the last successful build, caused by the turn, has a hard defect (`hardDefects`) that the
  last successful build when the turn began (`TurnState.before`) had not, and the reason says the agent may answer
  that it is meant; a dimension that passed on that build fails on the latest, which the turn caused (`verdictChanges` of `verdicts.ts`,
  kept `pass` to `fail`; the reason names it with `valueAgainstExpected`); a build the turn caused, ended
  after the turn's last `look` (`TurnState.lookedAt`, the count of builds ended at the `PostToolUse` of a `look`, one
  of a subagent too), however the model was written, unless nothing in the parts changed since the build the turn
  began with (`partsUnchanged` of `sanity.ts`: the same parts, each with the same `hash` and the same `loc` and
  `arranged`; the digest's `changed` is not enough, a moved hole keeps every count and size; the turn began with no
  build, or a scene that is not the latest's: it looks). A reason already held is not waited for again: a Stop after
  one held for a running build does not wait for the build, one after a dimension hold does not wait for the
  measuring. A reason is held once
  (`TurnState.held`) and a turn is held twice at most (`holds`): `stop_hook_active` is no guard of its own, the ledger
  is. A hold for a defect or a dimension that finds the build unlooked says so, and counts for that reason too. The
  reasons say "built during this turn", never "you edited": the person's own edit also ends a build. Never for a
  dimension that failed when the turn began, never for a change of volume alone. A Stop held back moves no status
  and ends no turn.
- **The sanity pass** (`src/main/sanity.ts`, pure). After every successful build `sanity(previous, current,
  verdicts)` holds it against the successful build before (`Builds.scenes`, the data `diff` reads) from what the
  kernel sent with each (`solids`, `openShells`, `meshVolume`, `meshDisagrees`, `valid`, `reversed`): no query.
  Parts are compared by name, each in the first layout of the build that has it, with `partDiff` (`shared/diff.ts`, which `diff`
  uses too: the same line, the volume's change also in percent, `≈` where either build is not exact; a number that
  is not exact has changed only by more than both builds' doubt of it, `volumeDoubt` and `bboxDoubt`, twice that of
  a size); unchanged parts are counted. Its flags are of the shape alone, never a guess at intent: not valid, inside out, no solid or
  no volume, more than one solid or another count than before, an open shell, a mesh that disagrees, a part come
  or gone, face or edge counts changed (refs may name others), a dimension that passed on the build before and
  fails now. Each says whether it is new; a hard one (`DigestFlag.hard`: not valid, inside out, a solid count that
  went up, a mesh that disagrees, each new) holds a Stop back. `digestText` says it in two lines, `Changed since
  rN:` and `Check:`, in at most `DIGEST_LIMIT` (1,200) characters, cut by whole parts and flags, the hard ones
  first and what is cut counted with where to read it. `buildContextFor` puts it after the status and before the
  dimensions, in what their least leaves of `CONTEXT_LIMIT` (status, digest, dimensions, output, each outranking
  the next); it is told nowhere else to the agent (not with a prompt), and `state.md` writes it under the build.
- **Each build's verdicts** (`src/main/verdicts.ts`, `Verdicts`, in memory only, 16 builds an object). Recorded
  from the marks whenever they change and when a check of them against a build ends (`onMarksChecked` of
  `registerIpc`), always of the last successful build, never of an older one: a mark holds one value.
  `verdictChanges(was, now)` is the one place that says which dimensions changed verdict between two builds
  (`{ id, was, now }`, each `pass`, `fail` or `none`): the digest takes it from there, and so does whatever else
  needs it.
- **What the model printed reaches the agent** (`modelOutput` of `context.ts`; the kernel returns it as `output` of
  the scene of a good build and of the error of a failed one). The model's own text, run through `HttpRouter.redact`
  (`ContextDeps.redact`, `ToolDeps.redact`) before it is cut. It is told in two places and in no other (not with a
  prompt, not in `state.md`): the last block of `buildContextFor`, `Model printed (last N lines):` and the tail
  (`OUTPUT_LINES` 15, `OUTPUT_CHARS` 1,000, the end kept; `, earlier output cut` when anything was left out), and
  `output` (with `outputCut`) of `scene`, which also gives it after a first build that failed, with no scene. It is
  of the build that ended last: a failed build's is its error's, never the output of the good build before; none
  while a build runs; none for the error main makes when the kernel process stopped (`kernelStderr`, whose `output` is the kernel's stderr and
  not the model's); a build process the supervisor reports as a `crash` (killed, a garbled result) keeps its prints. It takes
  what is left of `CONTEXT_LIMIT` after the status, the digest, the dimensions and the count of those that pass, so a
  traceback, the digest and a dimension outrank it; with less than `MIN_OUTPUT_CHARS` left it is a line that there is output and that
  `scene` has it, or nothing.
- **Why a fillet or a chamfer failed** (`BuildError.diagnosis`, the kernel's `diagnose.py`; the words are
  `diagnosisText` of `shared/diagnosis.ts`, numbers through `shared/format.ts`, a bisected size by `thousandth`).
  Before a failed build that carries one is told, `Builds.withRefs` asks the live worker of the last good build
  (`match_edges`, `MATCH_MS`, 2 s at most; nothing when there is none, it was let go, or the kernel cannot say) which
  of its edges are exactly those of the diagnosis (ends, length, curve and the points sampled along it), and sets
  `sameAs` (`{ ref, layout, revision }`) on those: a ref only where an edge matches exactly and of one part (the
  same part in two layouts is that part; an edge two parts share, as a lid and a base built at the origin, is named
  by neither, never the first), said as of that build; the rest are known by their number in the call and their
  ends in the frame of the shape filleted (`local`). It is told under the error's message, before the traceback,
  wherever the error is: the status lines of `contextFor` and `buildContextFor` (in `DIAGNOSIS_LIMIT`, 1,000
  characters, leaving `TRACEBACK_LEAST`, 200, to the traceback, the edges cut first and counted), `scene` under
  `build.error.diagnosis` (the data and its `reading`) and in its error before a first build that worked, `state.md`,
  and the error sheet (`ui/BuildErrorSheet.tsx`, under "Why", and in what Copy takes). Nothing is retried in the
  model: the agent decides.
  A failed **boolean** carries a diagnosis of the other kind (`BooleanDiagnosis`, the kernel's `booleans.py`: its
  operands, how base and tool meet, `causes`), told by the same `diagnosisText` in the same places. Its operands are
  not parts of any build and `Builds.withRefs` leaves it as it is (`isBoolean`): nothing in it is named by a ref.
- A `StopFailure` hook (a turn an error of the API ended: a login that failed, an overload; posted in place of the
  `Stop`) is idle and ends the turn as a `Stop` does, and is never held back (`stopAnswer` is not asked; the CLI reads
  no answer to it), so a terminal session is not left "working" until its next prompt.
- A `Notification` hook is a question (`needs_input`) unless its body says it is none (`reduceStatus` in
  `sessions/status.ts`: `notification_type` `idle_prompt` or `auth_success`, or, without a type, a message that
  it is waiting for input): Claude Code also posts one when it has only been idle at its prompt for a while.
- A session that moves to `needs_input` while the window is not focused draws the eye once: `Attention.moved`
  (`attention.ts`) is true for the move into `needs_input` only (not for the same status told again, nor for an ask
  that came while the window was in use), and `index.ts` then flashes the frame (`flashFrame(true)`, put out on
  `focus`) or, on macOS, bounces the dock icon (`informational`). There is no system notification: it would touch
  the person's system, so it would have to be asked for. Under `TORNO_TEST=1` the rule runs and nothing is flashed.
- **Closing the window ends torno and every session in it, so it is asked first.** Main holds the window's
  `close` (`createWindow` in `index.ts`) and sends `window:closeAsked`; the window answers `window:closeAnswer`
  at once (`App.tsx`, from `renderer/closing.ts` `closingWhy`): `true` when nothing would be cut short, and the
  window closes; `false` while it asks the person in a dialog over the whole window (`ui/WorkspaceQuestion.tsx`: "Close torno?",
  "Keep it open" in focus), and then `true` only on "Close torno". The dialog lists what is cut short, a line each, with the
  object it is of as a link to it (`closingWhy` returns `{ objectId, what }` items): a session working or waiting for an
  answer (`busyWith`), a prompt written and not sent, a new object not made, a first prompt held, a painting of a region
  holding what is not kept (`unkept`), an import, an export being written. A window that does not answer within
  `CLOSE_ANSWER_MS` (1.5 s), or is loading or crashed, is closed without one; a quit that does not come through
  the window (`before-quit`, as `app.close()` of a test) is not held. Under test the question is answered by
  clicking it (`e2e/session.spec.ts`).
- **The chat session** (Claude Code with `view` `chat`; `sessions/transport.ts`, `stream.ts`, `transcript.ts`,
  `chatlog.ts`, `permissions.ts`, `Sessions` in `manager.ts`). `Sessions` drives a chat through `AgentTransport`
  (`transport.ts`: `prompt`, `control` for `initialize`, `set_model` and `set_permission_mode`, `interrupt`, `answer` to an ask, `end`, and `terminate` and `kill` for
  an agent that stays after `end` (`Sessions.stop` times them; the process group is the transport's, `signals.ts`), and the events `message`, `ask`, `note`, `stderr`, `exit`) and never through a class of its own:
  the adapter makes it (`AgentAdapter.chat`), and `ClaudeStream` (`stream.ts`) is the one there is. `sessions/memory.itest.ts`
  drives `Sessions` with a transport in memory. Another
  transport (the Agent SDK's) would be another `chat` of an adapter, with the messages in the CLI's shapes, the
  transcript unchanged. The adapter adds `HEADLESS` to the same arguments as a terminal
  session (`claude.ts`); the CLI is spawned on pipes, detached, in the object's folder, with the terminal
  session's environment. There is no PTY. The stream is framed by line and a line that is no JSON, or a message
  of a type nobody knows, is passed over: what the CLI prints changes between versions, and nothing here throws
  at it. Torno answers `initialize` (the commands and models, told to the window as a `capabilities` event),
  `interrupt`, `set_model`, which changes this session's model and nothing of the person's, and `apply_flag_settings`
  for its effort (below).
- **The mode of a session** (`MODES`, `isMode`, `MODE_NOTE` in `shared/chat.ts`; `ModeMenu`). The edits menu beside the
  model offers `default`, `acceptEdits` and `plan`. `Sessions.setMode` (`chat:setMode`, the mode checked by `isMode`
  first) sends the control request `set_permission_mode` and, once the CLI has answered, the transcript says it
  (`modeSet`). The CLI holds it in memory for that session: no settings file is written, so a permission answer and a
  mode alike never write the person's settings. `ChatMeta.permissionMode` is the `permissionMode` of every `init`
  (the person's own start mode may be one torno does not offer; it is shown as the CLI names it). The `setMode`
  suggestion of an ask is still never passed on (below): the mode is chosen by the menu alone. The request is built
  on the Agent SDK's documented control request; the stand-in answers it, and a real CLI is still to be checked
  (the manual's last section).
- **The model and effort of a session** (`AgentChoice`, `agentChoiceOf`, `MODEL_NAME`, `EFFORTS` in `shared/chat.ts`).
  `Sessions.start` takes `model` and `effort` (`StartOptions`), for that session alone; `claude.ts` passes them as one
  argument each, `--model=<name>` and `--effort=<level>`, so that a value can never be read as a flag, and nothing
  when absent (the person's own default). What the window sends is held to the rule first: a model of `MODEL_NAME`
  (starts with a letter or digit), an effort of `EFFORTS`; anything else is dropped, never refused. The effort is on
  the meta (`ChatMeta.effort`: the one started with or set since; absent for the person's default, which the CLI
  does not say). `Sessions.setEffort` (`chat:setEffort`) sends `apply_flag_settings` with `{ effortLevel }`, the
  CLI's flag layer, held in its memory as `--effort` is: no settings file is written; once taken the transcript says
  `Effort: <level>` (`effortSet`). Each model the CLI offers carries the efforts it says it takes (`modelsOf` in
  `sessions/models.ts`, from `supportedEffortLevels`; empty for `supportsEffort: false`). The last list a chat's CLI
  offered is kept for the page of a new object (`KnownModels`, `models.json` beside the config file, atomically, or
  for the run alone with none; `chat:models`), and before any chat Claude Code's aliases (`MODEL_ALIASES`).
- The transcript (`Transcript`) knows what the stream means and nothing of processes or files: it reduces
  messages and torno's own records (a prompt sent, a hook answered, an ask, the end) to the items of
  `shared/chat.ts`, at most 2,000, and the 40 newest pictures keep their data. Items are never changed once
  handed out. A prompt sent while the agent works is `queued`: it is drawn last, and is sent, moving to the end,
  when the CLI takes it up; the transcript is the one source of that order, for live and for reload, and of
  whether any prompt is still untaken (`untakenCount`, which `Sessions` asks: there is no counter of its own). The
  CLI takes a prompt up in one of two ways, as measured on the real one: a `UserPromptSubmit` hook that names it
  (matched by text; else the oldest untaken that is not a command), which also folds a prompt sent while a tool
  ran into the running turn with no `init` and no result of its own; or, for a prompt beginning with `/`, an
  `init` that no hook explains (`explained`). After a `result`, prompts still untaken are given 1.5 s
  (`IDLE_GRACE_MS`) for their hook or `init` to come; if nothing came, the CLI is idle and they are taken
  (`idle()`), so nothing waits for good. The context of a `UserPromptSubmit` (`text`, `sentMarkIds`, and as data
  the build and selection) is put under the prompt that hook names; the window never parses text for it. Every
  prompt torno writes carries a `uuid` (kept by the transcript, not on the item), and the CLI's `command_lifecycle`
  with `state: "started"` for it takes it up first and whatever else has or has not happened (the other rules are
  fallbacks for a CLI without those events); a prompt taken up that way is not taken twice, and the `init` it
  explains takes no other. An `interrupt` drops nothing: the prompts in its `still_queued` stay queued and the CLI runs
  them afterwards, together, in one turn with one `init`. A prompt the CLI never took up is `not-sent` when the session
  ends, and only then. A tool whose ask the person refused is `denied`, one whose ask ended with the turn stopped
  `cancelled` (the later error result does not make either "failed"); `error` is for a failure the person did not cause. The messages of a subagent
  (`parent_tool_use_id`) are not the agent's words: they are counted on the `Task` card (`steps`) and its tool
  calls listed in `inside`. A thought's `seconds` run from its block's start to its stop. A `user` message that is the
  compaction summary (`isSynthetic`) is not drawn; one that is `<local-command-stdout>` (what `/cost` or
  `/context` print) is a quiet note, and the "Compacted" of `/compact` is not a second one.
- **What the CLI says of itself** (`Transcript.system`, `finished`). From the `init`, the meta (`ChatMeta`) takes
  `version` (`claude_code_version`), `apiKeySource` and `pluginLoaded`; `result` adds `costUsd` (`total_cost_usd`) and
  `context` (the tokens of the last request, `usage.iterations`' last or else `usage`, against the `contextWindow` of
  the session's model in `modelUsage`; unchanged when the result has no tokens, as a `/compact`'s has none);
  the `turn` item takes the tokens the `result` counts as `usage` (`TurnUsage`: `usage` summed, `num_turns` as `requests`,
  and `modelUsage` per model; numbers only, so it is in the chat's log; none when the result counts none);
  a `warn` note `NO_HOOKS` says once per session that the hooks do not arrive: a prompt of ours the CLI started
  (`command_lifecycle`, not a `/` command) with no `UserPromptSubmit` by `hookWaitMs` (8 s) or the end of its turn, in a
  session where none has come (a setting that limits `httpHookAllowedEnvVars` makes every hook 404). It never moves
  the status; the stand-in's `FAKE_AGENT_NO_HOOKS=1` plays it. The terminal view cannot tell it: the manual's
  troubleshooting names it.
  `api_retry` sets `retrying` (`{ attempt }`) until a `stream_event`, an `assistant`, a `user` or a `result` comes.
  Notes: a `warn` when torno's tools are `failed` (with the text of the entry of `mcp_server_errors` that is
  `torno`'s own: a `name`, `plugin`, `plugin_name` or `server` field that is `torno`, or a string that is or begins
  `torno:` or `torno@`; a path or another plugin's message that holds the word is not), a `warn` when the plugin torno passed did not load, a `quiet` once a session when `apiKeySource` is
  anything but `none` or `oauth` ("This chat is billed to an API key (Claude Code names its source: `user`), not to
  your Claude login: you pay per token."; `ANTHROPIC_API_KEY` is named only as an example, since the source may be a
  helper or a setting), a `quiet` once a session when the version is older than `TESTED_CLAUDE`'s minimum or of a
  newer major or minor than its maximum (`claude.ts`: the versions of the recordings in `test/fixtures/`, held to them
  by `claude.test.ts`; any patch of the tested minor is quiet; the note ends "if something in the chat looks wrong,
  this may be why"), and a `warn` at a `result` for each
  `permission_denials` entry no card shows (a tool card `denied`, `cancelled` or `stopped` is shown), once per
  `tool_use_id`. The plugin did not load when it is not in `plugins` or an entry of `plugin_errors` is `torno`'s own. The
  `skills` are read only when they show skills of plugins (an entry with a `<plugin>:` name): the recordings list
  the plugins loaded and, in `skills`, none of theirs, so a list without any says nothing; with some, a skill of
  `TORNO_PLUGIN` missing (named alone or as `torno:<skill>`) is a failure. It is judged only when the
  session was started with the plugin (`Transcript` `plugin`, from `adapter.plugin` and `skills`). **A field that is
  missing or is not the shape expected is "not known", never a warning,** and nothing here throws. `Sessions.start`
  takes `skills: false` (the window's "Restart with the whole prompt", which stops the session and starts it again
  resumed): the system prompt is then the whole text (`systemPromptFor` is given the adapter with `skills` false) and
  `--plugin-dir` is left out (`LaunchContext.skills`). **A turn that could not authenticate** (#117: `-p` under `--bare` reads no login, and the CLI says `--bare` will become its default) is known by one typed field alone, an assistant message's `error: "authentication_failed"` (the Agent SDK's `SDKAssistantMessage.error`; not yet seen from a real CLI), never by the words of the message or of the `result`, and never by `apiKeySource` `none`, which a login reports too: a `warn` note once a session after what the CLI said, `LOGIN_FAILED` ("Claude Code's chat could not use your login: …"), with `action: 'terminal'`, the window's button that writes `view` `terminal` and starts a terminal session resuming the conversation, live chat or ended (`readLog` drops any other `action`). It moves no status. What is known before any session (`main/ready.ts`, The first screen) is the one place torno
  runs `claude --version` and `claude auth status`; a session says what it can of itself through its `init`. Nothing
  of the person's settings is read, and of the instruction files Claude Code reads only the paths and sizes are.
- **`ask`, the question of torno's own** (`mcp/askTool.ts`, `main/asks.ts`, `shared/ask.ts`, `ui/QuestionCard.tsx`): `ask
  {question, options: [{label, refs}], pick?}` puts a card to the person and waits for what they choose, as data: the
  option (label and refs), or the one face or edge they select in the view when `pick`, or "not answered". Refs are
  checked as `highlight`'s are (`checkedRefs`: marks and groups turned into refs, all or nothing); at most 6 options of 20
  refs, one question per object at a time (a second is refused). It is not an `AgentAsk`: nothing of the CLI's is
  in it, so it is no transcript item. `Asks` keeps the open questions and tells the window the whole list on every
  change (`asks:changed`; `asks:list` for a window just begun; `asks:answer` back, checked by `answerOf` against the
  options of that question); the window never says more than an index or a ref. **Status:** a session shows
  `needs_input` while it has one open, by `Sessions.holdAsk` (a count, `Session.held`), the one status the hooks do not
  say, since the call is a single tool open as long as the person takes and nothing is posted meanwhile. A
  `PostToolUse` of another tool meanwhile does not make it `working`; when the last is answered the status goes
  back to what it was. The question ends with the first of: an answer, 10 minutes (`ASK_LIMIT_MS`: "not answered"), the
  client hanging up, the turn ending (the session turns `idle`: Claude Code's cancel of one call does not reach a
  server without sessions, so the end of the turn is what ends it), the session ending, the window closing or the
  workspace being left. While it waits the tool sends a progress notification every 30 s (`ASK_PROGRESS_MS`) when the
  client gave a progress token, since Claude Code ends an MCP call quiet for 5 minutes. An answer says when the model was built again
  meanwhile; a picked ref is looked up in the last build. It changes nothing in the person's view beyond lighting refs.
- Asks (`control_request` `can_use_tool`) wait in `Session.asks`, are answered only through `Sessions.respond` and
  show the status `needs_input` while open. They end when the CLI cancels the request (`control_cancel_request`,
  which it sends right after an `interrupt`; the card reads "Cancelled: the turn was stopped", `why`), at any
  `result`, and with the session (`ended`, no `why`); a late answer to one does nothing. The tool runs with the
  input it asked with; only the answers of `AskUserQuestion`, filtered to the question texts it asked, are taken
  from the window. **Session-only rule:** "Allow for this session" sends `updatedPermissions` made by
  `sessionRules` alone, the `addRules` suggestions with `destination: "session"`; `localSettings`,
  `projectSettings`, `userSettings`, `setMode` and `addDirectories` are never passed on, because the first three
  would write `.claude/` in the object's folder or the person's settings. A deny with no reason says "The person
  denied this."
- **A drawing on the view** (`sessions/drawing.ts`). `chat:send` takes `attachedView` (the bytes of the picture "Attach view" showed, checked by `Sessions.sendOne` as any picture for the agent and attached in place of a fresh `deps.picture`) and `drawing` (`ViewDrawing`, `shared/drawing.ts`):
  the window's data, checked field by field by `drawingOf` before anything is sent (a `Refusal` with its reason
  otherwise): one-line names and caption, a build above 0, a camera within ±1e9 mm, the picture a PNG main may attach
  (`checkedImage`, now `main/images.ts`: at most 2000 px and 3.75 MB) of the size it says, the ink `#rrggbb`, at most
  `MOST_STROKES_TOLD` strokes, each within the picture, with at most `MOST_REFS_TOLD` faces (a face as `refOf` names
  it: any one-line part name, faces from `F0`), `MOST_CUTS_TOLD` parts whose section's cut face it lies over (one-line
  names, told as "the cut face of lid": a cut face has no ref) and `MOST_SCANS_TOLD` scans; a descriptor is folded and
  cut to 200.
  `Sessions.sendOne` refuses a drawing of another object than the session's, and puts in the prompt, in order: the
  text, `drawingText` (what the picture is and on which build, the ink and its colour, the camera as JSON with how
  to `look` from it, a line per stroke of what it lies over, and that the model was built again since when it was),
  the picture, then the picture "Attach view" asks for. No line of the caption begins with a word the stand-in agent
  takes for a command. The picture is written nowhere. What the ink lies over goes on the prompt's user item as
  `drawing` (`drawnOver`, `shared/drawing.ts`: the faces once each, the cut faces, the scans, the strokes over no part and those partly over none,
  the build it was drawn on and the latest when that is another; refs and counts only, no kernel line, no box, no
  camera, each ref through `redact`), which the window shows under the picture and the chat's log keeps as text. The
  caption's words are not the item's text.
- When the CLI stops without being asked to (not through `stop`), or with a non-zero code, the pane gets a `warn`
  note "Claude Code stopped (exit code N): <its last stderr line>" (the last 20 lines of stderr are kept, redacted)
  and, when it never printed a line, "It did not start: is `claude` up to date and signed in? …". An `initialize`
  that fails is a quiet note. `send` runs one prompt after another (a picture is awaited before the next). Closing
  the workspace lets go of the transcripts of sessions that have ended (`forgetEnded`); `endedChat` names the one an
  object still has, for a window loaded since. `Sessions` events `stream`, `ask`, `asked` and `context` have no
  listener in the app: they are the probe the integration tests watch the stand-in through.
- **The instruction files Claude Code reads** (`src/main/instructions.ts` `findInstructions`, the types and words in
  `shared/instructions.ts`; paths and sizes only: **no file's text is ever read**, not for the pane and not for the
  agent). What Claude Code loads at launch by default, as its documentation says ("How Claude remembers your project"),
  in its load order: the organisation's `CLAUDE.md` (`/etc/claude-code/` on Linux, `/Library/Application
  Support/ClaudeCode/` on macOS: `managedPath`), the person's `~/.claude/CLAUDE.md` and `~/.claude/rules/`, then from `/`
  down to the object's folder, in each `CLAUDE.md`, `.claude/CLAUDE.md`, `.claude/rules/` (one entry: the folder, the
  `.md` files under it and their size) and `CLAUDE.local.md`; the person's own `~/.claude` is one entry though the way up
  passes through their home. `AGENTS.md` and `.claude/AGENTS.md` (Claude Code 2.1.277 or later) are listed in each of those
  folders only when none of `CLAUDE.md`, `.claude/CLAUDE.md` and `CLAUDE.local.md` is in the object's folder or above it
  (the person's file, the organisation's and rules do not count; a link counts, as it may be loaded). `@path` imports, a
  subfolder's files (loaded on demand) and the settings that leave files out are not followed, and the pane says these
  are what Claude Code reads by default. A link is `lstat`ed and listed by its own path, with no size, never followed
  (a link to a network path can hang a stat; `trust.ts` does the same), `.claude` being one included; the rules walk follows
  none, stops at `MOST_RULE_ENTRIES` entries and `MOST_RULE_DEPTH` levels (the counts are then "at least") and passes
  over a folder it cannot read; the whole lookup is given `DEADLINE_MS` (3 s for the pane, `HOOK_DEADLINE_MS`, 1 s, on the way to a prompt's hook, which has 5 s in all) and finds nothing past it. A `.claude/rules/` entry is an upper bound ("up to N files": a rule with `paths:` loads only for matching files, which is in its text). `home` and the managed
  path are parameters of the finder, with `top` (default `/`, where the way up stops) so that a test is never read by a
  `CLAUDE.md` of the machine above its temporary folder. `InstructionList` keeps, for each object, the list the
  pane last asked for (`session:instructions`); a row is shown in its folder by its index into that list
  (`session:revealInstruction`: an object of the open workspace, a row of the list kept for it, which is dropped when the workspace is left; `shell.showItemInFolder`, never opened, never run, never a path from the window; under
  `TORNO_TEST=1` the path goes into `__tornoMain.revealedFiles` and no file manager is started). The first prompt of
  every session, resumed or not (`first` of `contextFor`'s opts, `Session.firstPrompt`), and the first prompt of another
  conversation (`fresh`, after `/clear`, when the CLI loads the files again: `tellsInstructions`), ends with `instructionsLine`:
  the files Claude Code loads by default with their sizes (six at most, each path cut to `MOST_PATH_CHARS`, the line at most
  `INSTRUCTIONS_LIMIT` characters, so the room it keeps never leaves the status a negative limit) and "What torno's tools say of the build is current: a file that names
  another viewer, report or export step is about another way of working, so take its advice on how to model, not on how
  to see the build", nothing when there are none; its room is kept before the marks are listed and, with the selection's
  and the scans', before the status is fitted, so the cut at `CONTEXT_LIMIT` never takes it. The same rule is one line
  in the `torno-model` skill (the system prompt has no room for it). The context item carries how many files it named
  (`instructions`, `PromptContext`), which the chat draws as "N instruction files" in the "torno added" line. Nothing is written or remembered of it: there is no
  "seen" state.
- **Trust (`src/main/trust.ts`).** Headless (`-p`) Claude Code skips its workspace-trust question. Before a chat
  starts, `Trust.pending` looks for `.mcp.json`, `.claude/settings.json` and `.claude/settings.local.json` in the
  object folder and each parent up to, not including, the person's home (a link is reported by its own path, not
  followed); with any there and the folder's real path not in `trusted.json` (beside the config file, written
  atomically, never in a workspace; in memory only when there is no config file) the start is refused with
  `trustQuestion`. `session:trust` records it. The terminal view is never asked: it has the CLI's own question.
- The log (`chatlog.ts`) appends each item as it becomes final to `.torno/chat/<conversation>.jsonl`: text only,
  the data of a picture never, `redact` applied to every line, one write at a time per file, the folder checked
  with `ownTorno(dir, 'chat')` and ignored (`ensureIgnored`); after one write fails none is tried. A picture of the
  first prompt of a new object carries `file`, its path in `reference/` (the transcript reads it from the caption
  before it, `REFERENCE_CAPTION`), and the log keeps that and never the data. `chat:reference` (`sessions/reference.ts`
  `readReference`) gives the window the bytes of such a file again, for a session of the open workspace (one ended
  too): only a name of the form `create.ts` gives (`REFERENCE_FILE`), only a plain file read with `readRegular` of
  `create.ts` (no link, `reference` itself no link), at most `MAX_PHOTO`; anything else is null, never an error. A resumed chat
  reads the tail of the file as "Earlier in this conversation". The pane with no session shows the end of the conversation on file the same
  way, read-only (`chat:lastConversation`, `lastConversation` of `chatlog.ts`: the last eight `user`, `text` and `turn` items and the
  log's modification time; it only reads, and the object must be of the open workspace). A log over 5 MB is cut to its last 2,000 lines, whole
  and atomically, when a session starts on it (`trimLog`). Switching `view` ends the session and resumes the
  conversation in the other kind (`session.json` is the same).
- **What a turn changed in the model** (`sessions/snapshots.ts`, `shared/changes.ts`, `chat:changes`). When a
  prompt is sent (its `UserPromptSubmit`, read before the hook is answered, so before the agent can have touched
  anything) and when the turn ends (its `result`, as the transcript puts the turn item), main reads the text of the `.py`
  files directly in the object's folder (as `sourceFolders` has the own folder; not `<workspace>/common`; plain files
  only, `lstat` and `O_NOFOLLOW`, 60 files at most, `MAX_FILE_BYTES` (200 KB) each: a larger file is told to have
  changed by its size and mtime, with no text), and keeps the files that differ as `TurnChanges`, by the id of the turn's item
  (`KeptChanges`: the last `MAX_TURNS` (20) turns of a session and `MAX_KEPT_CHARS` (4 M characters) of text, the oldest let
  go first). **Held in memory only**: never written (not under `.torno/`, not in `.torno/chat/`, not in `state.md`), not
  a chat item and not logged, gone with the session's record. A prompt folded into a turn under way is not a start of its
  own (the turn keeps its first snapshot); a turn with no hook before it begins where the last ended. What the
  person saved between two turns is no turn's. A change made by a `Bash` is found too (it is by the files, not by
  the tools); a file outside the folder is not. `chat:changes(sessionId, turnId)` answers null for a session that is not
  of the open workspace and for a turn it holds nothing of (also one that changed no file there); it waits for the
  turn's snapshot to be read. The window draws the diff (`ChangesSheet`); torno never writes the model.
  **Undo** (`Sessions.undoTurn`, `chat:undo`, `sessions/undo.ts`) is a request, not a restore: for the last turn of an
  idle chat (refused with a `Refusal` otherwise: working or asking, a prompt untaken, not the last turn, nothing kept of it)
  main puts a quiet note in the transcript and sends one prompt of its own words (`undoPrompt`), as the person's, that asks
  the agent to put the files back, with the lines to reverse (`reverseBlock`: what the file has now between what the two
  texts share at their ends as `-`, what it had as `+`, a line of context each side; at most `MAX_REVERSE_CHARS`, 12,000, for
  all files, a file beyond it or too large to have been kept being named without lines; a file the person saved since,
  read again now, is said to have changed). The agent edits, through its own tools and permission cards: torno writes nothing
  of the model, and this rule is unchanged. Claude Code's checkpoints (`--rewind-files`) are not used: they await the spike
  in the manual's "Not yet verified" (`Part of #131`).
- The first prompt of a new conversation (`newConversation`: a session not resumed, its first `UserPromptSubmit`;
  or `fresh`, after /clear or after a compaction: the `PostCompact` hook, which moves no status, or the stream's
  `compact_boundary`, either sets `Session.compacted`, which the next prompt takes once as `fresh`) is told in a last line the files of `reference/` (`referencesLine` in `context.ts`,
  `listReferences`: plain files of create's names, photos then doodles, twelve named at most). It is no mark, and is
  left out when it does not fit in the context's limit. The onboarding prompt names them too; the repetition is
  accepted.

## New objects

- `objects/create.ts` (`objects:create`, the one place torno makes a folder in a workspace) makes `<root>/<name>/` from
  `objects/template.py.txt` (the single source of torno's template, imported as raw text; the kernel's
  `tests/test_template.py` builds that same file through the real loader), `brief.md` and `reference/`.
  Everything is made in `.<name>.torno-new-<random>` (dot first: the listing of a workspace never shows it), then the name is
  taken by `mkdir` (fails if it is there) and the temp folder is renamed onto it, the last step; on any failure the temp
  folder is removed. The name rule is `shared/objectName.ts`, the window's and main's alike, compared with every entry of
  the workspace folder without regard to case. The rule refuses more than the kernel does, since torno makes the
  folder: a `.` anywhere (the module name folds it to `_`, which the kernel and `scanWorkspace` do not take for the
  folder's name, so a second `.py` would make the object ambiguous; existing objects with dots are untouched), `common`, `tests`, `out` (the workspace's own) and `docs`, `tools`, `reference` (torno gives them a meaning);
  a Python keyword; a name whose model file would be taken for a test (`test_*`, `*_test`, `conftest`); a folder
  or file of the workspace that is the same module (`a-b` and `a_b`); and a name that would stand in for a library, since
  the loader puts the object's folder first on `sys.path`: those a model or the worker imports and torno's own
  (`SHADOWING_LIBRARIES`: `build123d`, `OCP`, `numpy`, `typing`, `json`, `common`, `torno_kernel`, ...) and every module of
  Python's standard library (`STDLIB_MODULES` in `shared/pythonModules.ts`, generated once from
  `sys.stdlib_module_names` of the kernel's Python 3.12, without the underscore names; the file says how). Both lists
  are compared without regard to case.
- A folder of the name that is empty (a crash between the claim and the rename leaves one) is free: it is renamed onto,
  which fails should anything be put in it meanwhile. One that appears empty while a create works is not taken. When a
  workspace is opened, `sweepStaleNew` removes the hidden `.<name>.torno-new-<12 hex>` folders more than ten minutes old
  (real folders only; a link of that name is left alone; the age, not the run, since another torno may be creating),
  but not one that holds files in `reference/`: its doodles are nowhere else, so it stays (the manual says it can be
  deleted).
- Photos come as paths, copied as `reference/photo-<n>.<ext>` (png, jpg, jpeg, webp; at most 25 MB; `lstat` and an
  `O_NOFOLLOW` open, so no link, folder or pipe; read through the open handle, never more than the size said). Doodles
  come as PNG bytes (signature checked, at most 8 MB). Vendor STEP files (bought parts; `.step`/`.stp`) come as paths too, copied as they are to `reference/<their name>`
  (`stepFiles` in `shared/objectName.ts` names them, window and main alike: the stem made safe, the ending lower case, `-2` for a name taken, in any case), at most 50 MB
  (`MAX_STEP_BYTES`), through the same `readRegular` (no link, folder or pipe). They are listed in the brief after the doodles and
  named in the first prompt as a reference body for `import_step` and `references(p)` (`OnboardDraft.steps`: `reference/<file>` and a note;
  the file is checked as a plain file of `reference/` with a STEP name). torno reads nothing of them. `objects:pickStep` is their dialog
  (`__tornoMain.pickStep`, `stepPicks` count). Scans are not copied (`objects:onboard` imports them) and other objects are named
  by id; the path of a scan is refused if it holds a control character, a line break above all, as it is a line of `brief.md`,
  which writes a path under the home folder with `~`. At most 12 photos, 6 doodles, 4 bought parts (STEP), 4 scans and 8 objects (`MOST_REFERENCES` in `shared/objectName.ts`, held by the window and main alike). `brief.md` is `# name`, the description, and `## References` with a line per item in the
  order photos, doodles, STEP files, scans, objects.
- `objects:create` answers after `rescan`, so the listing has the object; if the workspace was left meanwhile, or it
  does not list the object, it rejects saying the object "was made, but ..." (the window then does not offer the
  draft again). It validates the request (name, caps, every note, every scan and object, the same photo, scan or object given
  twice) before the temp folder is made; the photos are read, and the doodles checked, as they are written, and a
  failure there removes the temp folder. A description is at most 20,000 characters, a note 2,000 (after folding to
  one line). `objects:taken` lists the entries of the root, for the window to check a name against as main does.
- `objects:pickPhotos` is the photo dialog; tests answer it with `__tornoMain.pickPhotos` (`photoPicks` counts).
  Every path it returns goes into `Offered` (`objects/offered.ts`, at most 500, cleared when a workspace is opened or
  closed). `objects:readPhoto` (the window cannot read a file, and the picture for the prompt must be scaled there)
  serves only a path in `Offered`: any other is refused ("That file was not chosen in this window."), however
  plain a picture file it is. The same rules hold as for the copy: absolute, no link, no pipe, `O_NOFOLLOW`, a
  PNG, JPEG or WebP of at most 25 MB (`MAX_PHOTO_BYTES`). A photo dropped on the page is read by the window itself
  (`File.arrayBuffer`); its path for the copy is `objects.pathOf` (`webUtils.getPathForFile`), and `create` still
  checks that path as a plain file. A file with no path is not taken.

### Onboarding the new object (`onboard.ts`, `objects:onboard`)

- After `create` the window opens the object and calls `objects.onboard(objectId, draft)` (`OnboardDraft` in
  `shared/bridge.ts`: the description, the photos and doodles by their `reference/` file with the note and the
  picture, the scans by path, the objects by id). It rejects, doing nothing, for an object that is not of the open
  workspace, one with a session or one starting (`sessionRunning`), one already being onboarded (a second call while the first imports), and a draft that is not what it may be (files that are not
  plain files of `reference/`, caps, a scan that is not a scan path, an object that is not of the workspace or is the
  object itself). Then it imports each scan through `ScanStore.import` (one that fails does not stop the rest: the text
  says it could not be imported), starts the chat session (`Sessions.start`, the agent chosen for the object, which
  has no `agent.json`, on the model and effort of `OnboardDraft.choice` held to `agentChoiceOf`), and sends one
  prompt (`Sessions.prompt`): the text of `onboardPrompt`, then the pictures.
  The text ends in three numbered steps (#111): list the sizes that decide fit or function with the source of each
  (`brief.md`, a picture's note, a scan, another object, or nowhere); ask for those from nowhere in one round with
  `AskUserQuestion` (at most 4 questions, each with 2 to 4 options, one a typical value labelled as such; "build
  with assumptions" is an answer; nothing about what it can choose freely); build with the answers, a size still
  unknown being "assumed" in `Params` and listed in the reply. The same rule is in the `torno-model` skill, "Before
  the first model", which also applies it to a later feature whose key size is not given; the system prompt has no
  room for it. Both are held by `onboard.test.ts` and `prompt.test.ts`. The window needs nothing new: the question
  is the chat's card (or the CLI's own in a terminal).
- The pictures are the window's. Main has no decoder (Electron's `nativeImage` has none for WebP, and the window already
  decodes), so the window scales to a long edge of 1280 px and sends PNG or JPEG bytes; main reads the size from the
  header (`checkedImage`) and attaches only a PNG or JPEG of at most 2000 px and 3.75 MB (`MAX_IMAGE_BYTES`; base64 of
  it is 5 MB, the API's limit). One that is not is left out and the
  text says "not attached: read reference/<file>". Photos and doodles in order, then the pictures of the objects referred
  to (`.torno/thumb.png`, read as a plain file only, `readThumb`), at most 6 in all (`MOST_IMAGES`); a further one is named
  in the text as not attached.
- A referred object is told as `objectSummary` of its last build in this run (the parts of the first layout and their box,
  `exact` or `approximate` as the kernel's `bboxExact` says) or "not built in this run". Notes are one line each.
- Each picture comes after a text block naming it ("Picture 2: reference/doodle-1.png (the person's doodle): <note>",
  "Picture 3: ../lid/ as torno last drew it (its thumbnail): <note>"), because the CLI gives the model no file name for an
  image; the main text says "(attached: picture N)". The transcript's user item shows the first text only: a later text
  right before an image is a caption and is not shown. The caption's form is also read by the transcript, which keeps
  the path of a photo or doodle on its picture (`REFERENCE_CAPTION`): it is a contract, held by `transcript.test.ts`,
  which builds its prompt with `onboardPrompt`.
- The answer has `prompt` (as sent, "attached: picture N" for a picture) and `held` (for the composer to hold: every picture
  "not attached: read reference/<file>", a referred object's as `../<name>/.torno/thumb.png`); the window holds
  `held`. The prompt names the scan tools by the adapter's tool names (`scans`, `section` with `scan`, `scan_clash`,
  `scan_deviation`) and says the person aligns a scan in torno; every tool it names is a key of `TOOLS` (`onboard.test.ts`).
- After the prompt is sent `Sessions.began` is awaited (the CLI said anything, or ended: then its exit note is the
  `problem`, and `held` is held again; a CLI silent for 10 s is taken to have begun). Tested with `FAKE_AGENT_FAIL`.
- A session that cannot be started (the command is not on PATH, the trust question) is not a rejection: the answer is
  `sessionId: null`, the prompt text, `held` and the reason, for the composer to hold. An agent whose view is not the chat
  gets `sessionId` and a `problem`, and nothing is sent.
- One onboarding at a time per object: a set of objects in flight, entered before anything is imported and freed in
  `finally`, also after a rejection. Everything that can be refused (the draft's shape, caps, notes folded and
  length-checked, scan paths with control characters, duplicates, the object and the files) is checked before the
  first scan is imported or the session is started. A prompt that cannot be built or sent is not a rejection either:
  the answer holds `sessionId`, the text and a `problem`.
- Tested: `onboard.test.ts` (the text, the pictures, the rules) and `onboard.itest.ts` (the stand-in agent, the real scan
  import: one prompt with its pictures, the scan in `scans.json`, the hook's context, a missing command).

## macOS

- **The menu** (`menu.ts` `menuTemplate(platform, actions)`) is pure and `null` but on darwin, where `index.ts`
  builds it; elsewhere `Menu.setApplicationMenu(null)` stays (a lone Alt shows the bar on Linux). On darwin: the app
  menu, `editMenu`, `windowMenu`. Quit is no role: it closes the window (so the "Close torno?" question holds) and
  quits only when there is none; the Dock's Quit and a logout come as `before-quit` and are not held. No Close, no View.
- **PATH** (`loginPath.ts`): on darwin, not under `TORNO_TEST=1`, `applyLoginPath()` asks `$SHELL -ilc` for its PATH
  (5 s, then killed) before the first workspace opens, and sets `process.env.PATH` (`mergedPath`: shell, current, then
  the usual folders that exist). Failure is one stderr line with the shell's path and nothing of its output.
- **Paths from a process are real paths** (`sessions/inside.ts` `isInsideFolder`): whether an edited file is inside the
  object compares real paths (the nearest existing folder for a file not written yet). The example is copied under
  `realpathSync(tmpdir())`. What is stored (`recent`, `config.json`) keeps the path as it was opened.
- `scripts/node-pty-exec.mjs` (the app's `postinstall`) gives node-pty's darwin `spawn-helper` its execute bit.
