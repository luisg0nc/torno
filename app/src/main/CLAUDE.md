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
  asked about is kept without a value.
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
  - Sent and unresolved, it is "pinned": with every prompt, under
    `Dimensions (measured on rN):` (`dimensionsHead`: it also says when a
    build is running or the latest failed, so that these are not of the last
    edit), each pinned dimension that fails, is not measurable or was
    not measured on the last build has its line, until it passes, and the
    number that pass is said, naming those among them that moved
    (`src/main/context.ts`). A draft dimension is
    told with the drafts. The status line counts every unresolved dimension
    that fails, sent or not.
- The MCP tools (`src/main/mcp/schemas.ts` holds every input schema and
  description, and `TOOLS`; `mcp/tools.ts` registers them and holds what
  every tool shares, with `marks` and `describe`; `scene`, `look`, `show` and
  `save_view` are in `mcp/viewTools.ts`; those that place and resolve marks in
  `mcp/markTools.ts`; those that read the part in `mcp/readTools.ts`; those
  that ask about scans in `mcp/scanTools.ts`): `scene`, `look`, `marks`,
  `describe`, `highlight`, `show`, `save_view`, `add_mark`, `resolve_mark`,
  `measure`, `section`, `check`, `diff`, `scans`, `scan_clash`, `scan_deviation`.
  `diff` compares two of the last two successful builds (`Builds.scenes`; the blob of the older is not kept)
  from what the kernel sent with each, asking it nothing: a number is `exact` only where both builds say so.
  `look` and `show` take the name of a saved view as `view`, and `save_view`
  proposes one (Views). `show` changes
  the view for now and is never saved to `scene.json`; it is refused while a
  button is held in the viewport. `marks`, `describe`, `add_mark`, `measure`,
  `section`, `check` and the three scan tools say which
  revision they answer from, and that it is stale while a newer build runs or
  has failed. `scene` counts the unresolved dimensions held to a value
  (`dimensions: {pass, fail, notMeasured}`).
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
    the Measure tool's do through `addDimension`, kept `sent`. One kept
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
  the client. The README lists them as `/mcp__torno__<name>` (`readme.test.ts` holds it to `PROMPTS`).
- `<object>/.torno/state.md` says the same as the tools, as text
  (`src/main/statefile.ts`): the build, the parts, the scans with how each is
  aligned in every layout, the open marks. Its first line is when it was
  written.

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
  (`~/.config/torno/config.json`, or `TORNO_CONFIG`; `src/main/recent.ts`):
  the newest first, eight at most, beside `workspace`. Never in a workspace.
  One that is no longer a folder is shown struck and leaves the list only
  when the person removes it. A test run reads and writes no config file but
  one it names with `TORNO_CONFIG`, and Electron keeps its own profile in a folder of the run in the temporary
  folder (`testProfile.ts`).
- The example is a copy of four objects of `kernel/tests/fixtures/ws`
  (`EXAMPLE_OBJECTS` in `src/main/example.ts`) made in the system's temporary
  folder when it is asked for, once in a run, with a marker file at its top
  (`EXAMPLE_MARKER`). It is removed at the end of `will-quit`, after the
  writes that were under way and the sessions have ended (`removeExample`),
  and one a crash left is removed at the next start (`sweepExamples`): only
  ever a real folder that marker names, of a torno that no longer runs.
  `WorkspaceInfo.example` says the open folder is it, and the window says
  `EXAMPLE_NOTE` under the workspace's name.
  The fixtures are never opened in place and never written to. The copy is
  not remembered: not as the workspace to open next, not as a recent folder.

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
  line's dot (`buildLine`: `standing`); of an object not opened here it is muted and has no dot.
- **Main alone keeps it** (`show/cards.ts` `keepThumbnail`, `saveThumbnail`, `thumbnailOnFile`; `ipc.ts` only
  joins them to the open workspace): `<object>/.torno/thumb.png` and `thumb.json` (`at`, `layout`, `parts`,
  `model`, `sourcesMtimeMs`, `bytes`, `hash`, and `cut`, `apart`, `hidden` when the picture is cut, drawn
  apart or leaves parts out). Only for an object opened in this run whose last good revision is the one the
  window names, and only bytes `thumbnailRefusal` passes: a PNG (signature and `IHDR`) of 480 × 360, at most
  `THUMB_MAX_BYTES` (512 KB). Anything else is dropped. Each file is written atomically and the saves of one
  folder go one after the other; the facts say how many bytes the picture has and their SHA-256, and **a
  picture that is not the one its facts are of is no picture**: `cardsOf` drops it by its size (one `stat`),
  `thumbnailOnFile` by its bytes, and the card then says `No picture yet` and nothing of one.
- **`.torno/.gitignore` has one writer**, `src/main/ignored.ts` `ensureIgnored(dir, lines)`: it adds the
  lines that are missing at the end, makes the file when there is none, never removes or rewrites what is
  there, and adds nothing against a line the person negated (`!thumb.png`). The thumbnails ask it for
  `thumb.png` and `thumb.json`, the state file for `state.md`, a conversation put on file for `session.json`,
  a chat's log for `chat/`, an export for `exports/`, a picture for `views/`. What is the
  object's travels: `scene.json`, `marks.json`, `scans.json`, `agent.json`.
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
- A `print` layout that was spread (`arrange.py`) has its parts where torno
  put them. Between two parts of which either was moved, `check overlap`,
  `check clearance` and `measure distance` are refused in main
  (`spreadApart` in `marks/spread.ts`), naming the layouts that place both
  as assembled; so is a distance from a bare point to a part that was moved.
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
  without `.html` gets it; if that file is there already the dialog never asked about it, so torno asks
  before replacing it (under test `__tornoMain.replace`, counted in `replaceAsked`).

## Agents

- Claude Code is the one agent torno runs. It is started by an adapter (`src/main/sessions/adapter.ts`: `AgentAdapter`; `claude.ts`
  `claudeAdapter`, the one there is), which says the `command` looked for on PATH, whether it is given torno's
  `skills`, how its client names a tool of torno's to the model (`toolName`: `mcp__torno__scene`), and
  `launch(ctx)`: the command, its arguments as a list of strings (never a line for a shell), and variables to
  add to the environment. Everything the agent is given of torno is on its command line or in its environment.
  Nothing of the person's configuration of it is read or written, and nothing is written in the object folder
  outside `.torno/`. The MCP address given is of that object alone.
- The system prompt is one text (`src/main/prompt.ts` `systemPrompt(toolName, skills)`). Claude Code is
  given torno's skills, a plugin in `app/resources/agent-plugin` (`torno-model`, `build123d`, `scans`,
  `dimensions`) passed with `--plugin-dir` (`paths.ts` `agentPluginDir()`; nothing is installed in the person's
  Claude Code), so its prompt (`SYSTEM_PROMPT`, `skills` true, under 6,400 characters) says of scans and
  dimensions only what a prompt's lines need and names the skills; `SCANS_TEXT` and `DIMENSIONS_TEXT` are said
  to the letter in the skills `scans` and `dimensions`. Started without the plugin folder (`skills` false) it is
  told the whole text (`FULL_PROMPT`, under 7,400 characters). A change to what the prompt says of scans
  or dimensions is a change to the skill too (`prompt.test.ts` holds them together); the template of
  `torno-model` is built by the kernel's `tests/test_skill_template.py`. Claude Code is also given a subagent on
  its command line, `--agents` with `torno-reviewer` (`claude.ts` `reviewerAgents`): tools `scene`, `look`,
  `marks`, `measure`, `check`, `section`, `describe` and `Read`, never one that edits, resolves, adds a mark or
  changes the view; its prompt checks the build against what was asked, every open mark and every dimension, with
  numbers from the tools. Claude Code's prompt says to use it after a change of several steps, before saying it
  is done. `contextFor` names tools through `opts.toolName` likewise.
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
  or after that tool's `PreToolUse` (`Sessions.built`, fed every `BuildState` from `index.ts`) and is answered
  with `buildContextFor` of `context.ts` (the first lines and the dimensions of `contextFor`, in the same words)
  as `additionalContext`; the chat puts it under that tool's card (`Transcript.toolContext`). No build begun
  within 3 s: `{}`. Still running at 55 s: `A build is running (rN); call scene …` (`claude.ts` gives
  `PostToolUse` a 60 s timeout). A `Stop` is held back (`decision: block`) when the turn (since its
  `UserPromptSubmit`) saw a build end and the latest failed, or edited the model and no `look` came after;
  never with `stop_hook_active`, never for a failing dimension. A Stop held back moves no status and ends no turn.
- A `Notification` hook is a question (`needs_input`) unless its body says it is none (`reduceStatus` in
  `sessions/status.ts`: `notification_type` `idle_prompt` or `auth_success`, or, without a type, a message that
  it is waiting for input): Claude Code also posts one when it has only been idle at its prompt for a while.
- **Closing the window ends torno and every session in it, so it is asked first.** Main holds the window's
  `close` (`createWindow` in `index.ts`) and sends `window:closeAsked`; the window answers `window:closeAnswer`
  at once (`App.tsx`, from `renderer/closing.ts` `closingWhy`): `true` when nothing would be cut short, and the
  window closes; `false` while it asks the person in place ("Close torno?", "Keep it open" in focus), and then
  `true` only on "Close torno". What is cut short: a session working or waiting for an answer (`busyWith`), a
  painting of a region holding what is not kept (`unkept`), an import, an export being written. A window that does not answer within
  `CLOSE_ANSWER_MS` (1.5 s), or is loading or crashed, is closed without one; a quit that does not come through
  the window (`before-quit`, as `app.close()` of a test) is not held. Under test the question is answered by
  clicking it (`e2e/session.spec.ts`).
- **The chat session** (Claude Code with `view` `chat`; `sessions/stream.ts`, `transcript.ts`, `chatlog.ts`,
  `permissions.ts`, `Sessions` in `manager.ts`). The adapter adds `HEADLESS` to the same arguments as a terminal
  session (`claude.ts`); the CLI is spawned on pipes, detached, in the object's folder, with the terminal
  session's environment. There is no PTY. The stream is framed by line and a line that is no JSON, or a message
  of a type nobody knows, is passed over: what the CLI prints changes between versions, and nothing here throws
  at it. Torno answers `initialize` (the commands and models, told to the window as a `capabilities` event),
  `interrupt` and `set_model`, which changes this session's model and nothing of the person's.
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
- **A drawing on the view** (`sessions/drawing.ts`). `chat:send` takes `drawing` (`ViewDrawing`, `shared/drawing.ts`):
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
  takes for a command. Nothing of it is written anywhere.
- When the CLI stops without being asked to (not through `stop`), or with a non-zero code, the pane gets a `warn`
  note "Claude Code stopped (exit code N): <its last stderr line>" (the last 20 lines of stderr are kept, redacted)
  and, when it never printed a line, "It did not start: is `claude` up to date and signed in? …". An `initialize`
  that fails is a quiet note. `send` runs one prompt after another (a picture is awaited before the next). Closing
  the workspace lets go of the transcripts of sessions that have ended (`forgetEnded`); `endedChat` names the one an
  object still has, for a window loaded since. `Sessions` events `stream`, `ask`, `asked` and `context` have no
  listener in the app: they are the probe the integration tests watch the stand-in through.
- **Trust (`src/main/trust.ts`).** Headless (`-p`) Claude Code skips its workspace-trust question. Before a chat
  starts, `Trust.pending` looks for `.mcp.json`, `.claude/settings.json` and `.claude/settings.local.json` in the
  object folder and each parent up to, not including, the person's home (a link is reported by its own path, not
  followed); with any there and the folder's real path not in `trusted.json` (beside the config file, written
  atomically, never in a workspace; in memory only when there is no config file) the start is refused with
  `trustQuestion`. `session:trust` records it. The terminal view is never asked: it has the CLI's own question.
- The log (`chatlog.ts`) appends each item as it becomes final to `.torno/chat/<conversation>.jsonl`: text only,
  the data of a picture never, `redact` applied to every line, one write at a time per file, the folder checked
  with `ownTorno(dir, 'chat')` and ignored (`ensureIgnored`); after one write fails none is tried. A resumed chat
  reads the tail of the file as "Earlier in this conversation". A log over 5 MB is cut to its last 2,000 lines, whole
  and atomically, when a session starts on it (`trimLog`). Switching `view` ends the session and resumes the
  conversation in the other kind (`session.json` is the same).

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
  but not one that holds files in `reference/`: its doodles are nowhere else, so it stays (the README says it can be
  deleted).
- Photos come as paths, copied as `reference/photo-<n>.<ext>` (png, jpg, jpeg, webp; at most 25 MB; `lstat` and an
  `O_NOFOLLOW` open, so no link, folder or pipe; read through the open handle, never more than the size said). Doodles
  come as PNG bytes (signature checked, at most 8 MB). Scans are not copied (`objects:onboard` imports them) and other objects are named
  by id; the path of a scan is refused if it holds a control character, a line break above all, as it is a line of `brief.md`,
  which writes a path under the home folder with `~`. At most 12 photos, 6 doodles, 4 scans and 8 objects (`MOST_REFERENCES` in `shared/objectName.ts`, held by the window and main alike). `brief.md` is `# name`, the description, and `## References` with a line per item in the
  order photos, doodles, scans, objects.
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
  has no `agent.json`), and sends one prompt (`Sessions.prompt`): the text of `onboardPrompt`, then the pictures.
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
  right before an image is a caption and is not shown.
- The answer has `prompt` (as sent, "attached: picture N" for a picture) and `held` (for the composer to hold: every picture
  "not attached: read reference/<file>", a referred object's as `../<name>/.torno/thumb.png`); the window holds
  `held`. The prompt names the scan tools by the adapter's tool names (`scans`, `scan_section`, `scan_clash`,
  `scan_deviation`) and says the person aligns a scan in torno.
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
