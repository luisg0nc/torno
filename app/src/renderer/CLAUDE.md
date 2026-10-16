# torno: the window (`app/src/renderer`)

The UI (`ui/`), the three.js viewport (`viewport/`), the tools that point at it (`tools/`), the store
(`state/`) and the stylesheets (`styles/`: `tokens.css`, and `app.css`, which is nothing but the list of
the stylesheets by area in the order of the cascade; `styles.test.ts` holds it to that).

What binds every part of torno is in the `CLAUDE.md` at the root of the repository: read that first. Here
is the detail of this folder, under the headings it has there. Paths are from `app/`.

## Marks

- User marks are drawn in `--user-mark`, agent marks in `--agent-mark`, and
  nothing else in the UI uses those colours. A picture for the agent draws
  every mark alike: no active mark, no selection, no hover, no gizmo. A mark
  on a part that is not drawn is not drawn either, on screen or in a picture.
- Tools and keys: every key torno listens to is a row of `shared/keys.ts`
  (`KEYS`: its keys, what it does, the group the sheet lists it in, and the
  scope it is listened to in). A handler asks `pressed(e, id)` or
  `which(e, id)` and never names a key; a button or a tooltip takes its key
  from `hint(id)`; the palette's tools, the view bar's views and the gizmo's
  ways are `TOOL_KEYS`, `VIEW_KEYS` and `GIZMO_KEYS`; the sheet of keys (`?`,
  `ui/KeySheet.tsx`) is `cheatSheet()`. A tool's key is shown on its
  palette button and in its tooltip, and on the sheet of keys; nowhere else. The empty Marks section names no key: it
  says what a mark is and that it goes with the next prompt. A new key is added there first:
  `keys.test.ts` reads the sources of the window, the preload and
  `main/devkeys.ts` and fails for any read of `.key`, `.code`, `.keyCode` or
  `.which` outside `shared/keys.ts` (a handler hands the press whole to
  `pressed` or `which`; main through `pressOf`), for a key of the keyboard
  named in a source, for a key or a chord written out in a text, for two rows
  of one scope with the same key, for a key of the shape in hand that the
  viewport has too (`keyClashes`), and for a key heard while typing (scope
  `global`) that a field or the terminal would take (`typed`). The scan is by
  source text: what else in the window is called a key (a part's, a light's,
  a row's) is read through a receiver listed in the test (`NOT_A_PRESS`; a one-letter name only in the
  files `SHORT_NAMES` lists), a key taken apart (`({ key }) =>`, `const { key } = e`) is a read too, and
  its fixtures hold every spelling of a bypass it is to catch.
  `Ctrl+Shift+B` is "Rebuild" (`rebuild`, heard everywhere; while a build runs the button reads
  "Building…" and neither it nor the key nor `Builds.rebuild` starts one over; the button is in
  the status line, `ui/BuildStatus.tsx`); main's sentences name it by
  `REBUILD_HOW` in `shared/build.ts`. A tool in hand is offered a key before the viewport is, so the
  Region tool's `E` stays its own and explode's is the viewport's. Shift with
  a key is that key unless Shift with it has a row of its own in that scope.
  A slider is no field to type in (`ui/typing.ts`): the keys work with one in
  focus. After a click or an action the next letter is the view's (`e2e/focus.spec.ts` walks a session of
  work pressing `P` after each step): a field, a list being chosen in with the keys, and the session pane keep
  the keys (`TYPING`); what the pointer took up gives them back once done with: a choice made in a list
  (`pointerChoice`, `chosen`), the session pane's edge once dragged, as Enter and Escape do in a field
  (`giveKeysBack`). The exported page's own keys (`src/export/viewer`) are not in the
  table: it is another program. The Measure tool is `tools/measureTool.ts`;
  what its clicks measure is chosen in the strip `MeasureChoice` of
  `ui/ToolPalette.tsx`, and a dimension's expectation is typed in
  `ui/DimensionFields.tsx`. In Angle, before the second click, an end the kernel takes by its axis, only if
  flat or straight, or never (`angleTaking`, by the descriptor's type, the kernel's rule) is said at the pointer
  in place of the `≈` estimate; it is a hint, never a gate: the click is sent whatever it says. A tool is a `Tool`
  (`src/renderer/tools/Tool.ts`) and gets every pointer event from the one
  subscription in `ui/ViewportPane.tsx`. Nothing of a pointer move goes
  through React or the store.
- A mark's row is one line, its note cut to the room there is; what the last build did to its mark (`moved:
  check it`, `its part is gone`) is a line of its own under the note (`.mark-anchor`, `late.css`), and the
  status word is never cut. The Marks list never scrolls sideways (`e2e/reanchor.spec.ts`, with a note longer
  than the column). A dimension opened out leaves its value and verdict to its fields under the first line, so
  that `Add a note` is whole beside the buttons of the row (`marks.css`, `e2e/measure.spec.ts`).

## Section

- Drawing is `viewport/section.ts`: the parts' materials are clipped, and each
  closed solid (`BuiltPart.solid`) gets its cut face by stencil counting, per
  part, with an outline from the mesh. A part that is no closed solid is cut
  open. What lies in the plane is kept (`KEPT_WITHIN_MM`); a part the plane
  only touches or leaves nothing of is not drawn (`keepsNothing`). Marks,
  grid and gizmo are not cut; a mark anchored in the half taken away is drawn
  dimmed (`MarkLayer.setSection`).
- Picking sees what is drawn (`pickUnder`): on a cut face nothing is hit and
  the pointer says so.
- Taken in hand with nothing cut (`X`), the Section tool cuts at once: `newCut` (`shared/cut.ts`) puts the
  plane through the middle of the parts (to 0.01 mm), across the axis the camera looks most along, open
  towards the viewer (`towardsViewer`: the half taken away is the one on the camera's side). The bar's X, Y
  and Z and an exported page's cut ask the same rule. What that rounding leaves is no distance: the bar tells a
  plane within 0.005 mm of the middle of the parts as at it, `0` (`sectionOffset`).
- A number field gives the keys back to the view on Enter and on Escape (`giveKeysBack` in `ui/typing.ts`),
  and keeps what was typed once (`toKeep` in `ui/Field.tsx`).
- The Section tool (`tools/sectionTool.ts`) moves the plane only by a drag
  that starts on its handle; any other drag turns the camera. The bar is
  `ui/SectionBar.tsx`. The plane moves in the viewport during a drag and is
  kept in the store once, on release, to the millionth of a millimetre. The
  bar's number and slider follow the plane as it is drawn, through
  `Viewport.onSectionMoved`, never through React. The cursor over the handle
  is the resize cursor nearest to the way its arrow points on screen
  (`handleCursor`), and `ns-resize` where the view looks along the normal and
  the drag goes by the pointer's height.

## Explode

- `E` on a layout of one part opens no bar: the button says why for a moment.
  One rule for the camera when the parts are drawn apart, by whatever path (`E`, an axis or scale button, the
  slider let go, a layout, the agent's `show`, a saved view applied), in the window and in an exported page:
  the camera stays, and is framed anew only when a part would leave the view (`leavesView` in
  `shared/explode.ts`; `Viewport.keepApartInView`, asked by `ViewBar` once the explode bar is laid out, and by
  `ViewsStrip` after a view's camera); together again, it goes back to where it was before that, if nobody
  moved it meanwhile (`cameraBack`; a view key, Fit, Ortho or Frame make the camera the person's). In the
  window the view is what the bars over its top leave (`Viewport.setCoveredTop`, measured by `ViewBar`): a
  view key, Fit, a scan's Frame and that rule frame the parts below them (`fitBelow` in `viewport/views.ts`);
  a picture for the agent has no bars. Fit, Ortho and Frame act on where the camera is going when it is on its
  way (`cameraGoal`): a view key and then `F` at once is that view, fitted. While the parts are apart no shape
  is in hand (`connectShapeEdit`).
- **Exploded is display only.** `Part.loc`, `Part.bbox`, every anchor, every
  `points` of a dimension and everything the kernel is asked are of the parts
  as built. `Viewport.setExplode` moves each part's group (`placePart`, the
  one place a group is put; `viewport/explode.ts` holds the offsets as drawn
  and as they will be once a move has ended, `PartsApart`), and nothing else:
  the scans and the grid stay. The slider moves the parts as it is dragged
  and the store keeps the amount once, on release (`actions.setExplode`);
  `E` and the agent's `show` go there over 220 ms, a step a frame, with no
  state in React.
- **A pick is of the part as built.** `Viewport.pick` takes the display
  offset of the part hit away from the point (`asBuilt`). Selecting,
  hovering, "Insert" and the readout at the pointer work exploded.
  `Viewport.project(point, part)` says where a point of a part is drawn;
  `bounds()`, `partBoxes()` and `sectionBox()` are of the parts as built,
  while `fit` and the named views frame them where they are drawn.
- **Nothing is marked, moved or measured from the window while the parts
  are drawn apart.** Pin, Arrow, Draw, Shape, Measure, Section, Align and
  Region are handed no pointer event and no key (`routePointer`,
  `ToolContext.exploded`), and the pointer says `EXPLODED_TOOLS`. The gate
  reads the store **and the screen** (`explodeNow(s) !== null ||
  viewport.exploded()`): the parts are still apart for a moment after the
  store says together, and under a slider being dragged before it says
  apart, and a pointer's ray is of the screen. What a tool had under way is
  dropped once when the parts go apart. "Note" on the selection, "Re-place"
  and a region's "Edit" are disabled with the same words, the gizmo holds
  nothing (a shape's or a scan's), and the points of an alignment and the
  brush ring are not drawn.
- **Marks are drawn moved with their part** (`viewport/marks/apart.ts`
  `markOffset`, `MarkLayer.setOffsets`): the mark's objects and its label,
  never the mark. A mark whose ends are on parts that moved differently
  (`'split'`: a dimension between two parts, an arrow whose head is at
  another part than its foot, by the parts' boxes) is drawn between them
  where they are drawn, dimmed and dashed (`spanning`, `setDashed`): the
  line is as long as the parts are apart, which measures nothing. Its row
  says `spans parts drawn apart`, the caption of a picture and of `show`
  names it (`spanningMarks`, `explodedNote`), and a dimension's value stays
  the kernel's, of the parts as built. A mark on no part, and a region, do
  not move.
- **A section is never drawn exploded (D2).** While there is a section
  nothing is drawn apart (the rule above). `actions.setExplode` answers
  `Take the section away to draw the parts apart` to an amount above 0;
  `actions.setSection` with a plane sets the `amount` of the layout shown to
  0, as if by hand. Another layout keeps its own, in the file too, and is
  drawn together while the section is there, apart again when it is gone.
  `sceneFileOf` never writes a section with an amount above 0 for the layout
  the file opens to. `look` and `show` refuse the two together
  (`NOT_EXPLODED_AND_CUT`), in main and again in the window. A picture that
  is cut by a plane of its own while the screen is exploded is drawn of the
  parts together; so is one that colours a scan by its distance to a part
  (`scanColour`), and its caption says so. Scans are not moved: a caption
  that draws both says `scans are where they are`, and so does the bar.
- The control is `ui/ExplodeControl.tsx`: `ExplodeToggle`, one button in the
  view bar (pressed while the parts are apart or its bar is open, with the
  amount beside the word; pressed while apart it puts them together), and
  `ExplodeBar` under the view bar (`.viewbars` stacks them): the slider with
  the amount beside it, `From centre X Y Z`, `×0.5 ×1 ×2 ×4`, and a line
  with `role="status"` that says it is for display only, or why nothing is
  drawn apart. The bar is the notice that the parts are not where they are
  drawn. The view bar is one row at 1440 × 900 for an object with two
  layouts (`explode.spec.ts` holds it to that); in a narrower pane it wraps
  rather than run under the panels. `window.__tornoTest.exploded()` says
  whether the viewport draws the parts apart, or is on its way there or back.

## Views

- **The person** saves what is on screen (`actions.saveView`, also where the
  agent's `show` has it otherwise: they save what they see), over any view
  of that name ("Replace"), which is theirs from then on; renames, updates
  to what is on screen and deletes (asked twice) from the chip's menu.
  `actions.applyView` is one edit of theirs: the layout first, every part of
  it on but those hidden, the section or none, the layout's explode or
  together, each scan still there as the view has it; `shownByAgent` is
  cleared, and what the view does not set is as the person had it
  (`sceneFileOf`). The caller then moves the camera
  (`viewport.setView(view.camera, true)`).
- **The strip** (`ui/ViewsStrip.tsx`, the last child of `.viewbars`,
  `role="toolbar"`): a chip per view (`button.view-chip[data-view]`), the
  one that is on marked (`aria-pressed`: `activeView`, while the screen
  still shows what it holds, `viewMatches`, and until the camera rests
  somewhere else, `actions.cameraSettled`), and "+ Save view" with one field.
  Six chips at most (`stripChips`: the one that is on, then the proposals,
  then the others as saved, shown in saved order), each name cut at 160 px
  and whole in the tooltip; with more views a chip `18 more` opens the list
  of all of them, a row each with what it holds. The strip is two rows at
  most at the default pane (`views.spec.ts` holds it to that with 26). Its
  menus take the focus, the arrows, Home and End; Escape and every action
  give the focus back to the chip, and never reach the pane's own Escape.
  A proposal is drawn dashed with the word `proposed`, "Keep" and
  "Discard": in no mark's colour, as a view is not a mark. The digits are
  not bound to the saved views: `1` to `4` are the standard views.

## The first screen

- With no folder open the window is `ui/Welcome.tsx`: what torno is, what an
  object is and what to do, a sentence each; "Open folder"; the folders
  opened lately; and, where torno runs from its repository, "Open the
  example". Its head is the logo (`ui/Logo.tsx`) over the name: the vise in `--ink`, the part in `--accent`. The
  same logo is in `--muted` over an empty view or page, and plain (one colour) where a picture is missing.
- With a folder open, the folder button of the left column is a menu
  (`ui/FolderMenu.tsx`): the recent folders, "Open folder…", "Open the
  example". A folder torno is started with (`TORNO_WORKSPACE`) is added to the
  recent ones; the workspace to open next stays the one chosen in the window.
- A workspace with no object says what to make (`ui/ShowPage.tsx`), and one
  without a `pyproject.toml` that its models are built with torno's own
  build123d. torno runs no `uv` command there.

## Light and dark

- The tokens (`app/src/renderer/styles/tokens.css`) are held to their
  contrasts by `shared/contrast.test.ts`, which reads the file: whatever is
  read as text is 4.5:1 on the ground it stands on (`--ink` 7:1; `--muted`,
  `--accent`, `--ok`, `--warn`, `--fail` on `--surface` and `--panel`; the
  accent on its wash; the sixteen terminal colours on the panel, but the dark
  theme's black); what is only drawn is 3:1 (the two mark colours on the
  surface); a hairline is between 1.15 and 2. A token is changed there first.
- A verdict (`--ok`, `--fail`) is no mark's colour to the eye, in both
  themes: 1.5:1 at least from the mark colour of its hue (`--agent-mark`,
  `--user-mark`), darker in light and lighter in dark. A verdict is read, a
  mark is drawn. Muted words and the verdicts are 4.5:1 on `--accent-wash`
  too. The dark `--warn` is an ochre, not an amber.
- A mark's lines (a pin's leader, an arrow's shaft, a stroke, a dimension's
  lines, a shape's outline) are drawn over a casing in `--panel`, 2 px wider
  (`MarkColours.casing`, `Parts.cased` in `viewport/marks/markObjects.ts`; in
  an exported page `.mark-casing` under `.mark-line`, as SVG over the
  canvas). The line is 3:1 on its casing; the casing is 3:1 on every part
  colour in dark and 2:1 in light, where no panel-coloured casing can do more
  against pastel parts.
- The person's ink on a picture of the view is `--drawing-ink`, magenta in both themes: 3:1 on its casing and on the
  ground, 30° of hue at least from either mark colour, and no axis's, the accent's or `--deviation-near`
  (`contrast.test.ts`). `ui/drawing/make.ts` writes the light values out for where the stylesheet cannot be read.
- What the system draws follows the theme: `color-scheme` is one scheme at a time, said outright in
  `tokens.css` (never `light dark`, which left the native light scrollbars in the dark theme), and every
  scroller of the window has the thin bar in `--scroll-thumb` (`late.css`). `e2e/themes.spec.ts` holds both.
- No text is dimmed by `opacity`, and nothing animates without end
  (`styles/styles.test.ts` reads the stylesheets): the dot of a session at
  work is still, and a build's beats with the count of its seconds
  (`data-beat`, set by `BuildStatus` once a second). The axes (`--axis-x`, `-y`, `-z`) are the gizmo's and the triad's of
  a picture, and are neither mark colour.
- The light values are written out where no stylesheet is read
  (`viewport/theme.ts` `LIGHT_THEME`, `viewport/sectionDrawing.ts` `SHEET`,
  `viewport/overlay.ts` `AXIS_COLOURS`, `SURFACE` in `src/main/index.ts`,
  `src/export/page.css`): the same test, and `export/page.test.ts`, hold them
  to the tokens.

## The page of objects

- `ui/ShowPage.tsx`, over the 3D view (`store.page`: `'object' | 'objects'`; the view stays mounted under it,
  `inert` and not painted, and the open object keeps its selection, camera and note). A workspace of several
  objects, or of none, starts on it; one object alone is shown itself. `W` outside a field or the first row of
  the object list brings it up (not while a button of the pointer is held: a drag in the view is not over); a
  card, or Escape, leaves it, and what had the focus has it again.
- The list of objects in the left column gives way to the layers and the scans under it (a share of the
  column at most); with neither there (no object open, or the page up) it has their room, every object in
  sight (`panels.css`, `e2e/show.spec.ts`).
- **The keys on the page** are one capture-phase listener. Left alone: what is typed in a field or the
  terminal (`TYPING`), any `input` outside the page (a slider of the left column keeps its arrows), and
  whatever is inside a `[role="dialog"]` or `[role="alertdialog"]`. Everything else is the page's and goes no
  further, so no tool under it is handed a key: arrows from card to card (`ui/cards.ts` `stepCard`), Enter
  opens, `/` or a letter filters by name. **Escape goes to what is on top**: a sheet or a confirm that is
  there to be seen (not one of the view put away under the page) gets it first, as if pressed there; then the
  filter is emptied; then the page goes. A sheet opened over the page (the export's) needs one of those two
  roles and nothing more.
- **No build is ever started for a picture.** A thumbnail is made by the window when a build of an object
  opened in this run lands (`state/thumbs.ts` `connectThumbs`): one at a time, in an idle callback, the latest
  build of each object only, one sent again as it was passed over. It subscribes to nothing: the viewport's
  one handler of `object.onScene` (`ViewportPane.tsx`) hands it each message (`landed`), so a build's meshes
  cross the bridge once, and are held only until the picture is drawn. An object not built in this run keeps
  the picture it has on file, or has none and says `No picture yet`.
- **A card says how far its picture can be trusted** (`ui/cards.ts`): when it was made (with the year when
  that is not this one); what it draws otherwise than the object is (`cut by its section`, `parts drawn
  apart`, `1 part left out`); and `A source has changed since` (`thumbOf`: `behind`). The sources of an object
  are what a change in has it built again (`Builds.open`): the `.py` files directly in its folder and in
  `<workspace>/common` (`sourceFolders`, `newestPython`; the kernel does not say which files a model read, so
  there is nothing finer). `sourcesMtimeMs` is the newest of them when the picture was kept, and no later
  than when that build was started, so a source saved during the build is newer than its picture; a card is
  behind when the newest now is newer, when either cannot be said, or when the model is another file. When
  the last build failed the status says so in `--fail`, the picture is dimmed and is said to be `of the last
  build that worked`. A picture is asked of main only once its card is in view or near it
  (IntersectionObserver).

## A new object

- `ui/onboard/NewObject.tsx` is a page in place of the viewport (`store.page`: `'new'`; the view is `covered` and
  inert under it as under the page of objects, and the layers and scans are hidden). It is opened from "New object"
  at the foot of the list, in the head of the page of objects and in its empty state (`openNewObject`). It takes the
  focus (the name field) when it comes and gives it back to where it was when it goes. Leaving the workspace
  (opening another folder) asks when the draft has something: "A new object is set up here and not made yet".
- **The draft** (`state/onboard.ts`) lives in the window, for the workspace it was begun in, until the object is made
  or the person throws it away; nothing of it is on disk, and it is dropped when the workspace root changes. Caps
  are `MOST_REFERENCES` (shared with main), a photo or scan is refused as a duplicate by path and an object by id.
  A doodle keeps its strokes as vectors as well as its PNG, so that it is opened again to change. `epoch()` goes up
  at each discard: photos being read when the draft was thrown away are not put back. The held first prompt
  (`hold/take/dismiss`) is in the same store.
- **Keys** are rows of `shared/keys.ts`: `new.back` (Esc) in the scope `newobject`, and the board's `board.undo` (Ctrl+Z) in the scope `sheet`. The
  page listens in the capture phase and takes every key not meant for a field, so no tool of the view is handed
  one. In a field Esc leaves the field (the keys go back to the page) when the draft has something, and the page
  when it has not; elsewhere it leaves the page, asking first ("Discard this new object?") when there is something in
  it. A sheet or question asked over the page (the sheet of keys, the closing question) keeps its own keys.
  `export` and `rebuild` keys do nothing on this page.
- **Images are scaled in the window** (`images.ts`): the window decodes (WebP too), scales to a long edge of 1280
  px (a PNG stays PNG, anything else becomes JPEG at 0.85; a PNG already within 1280 px and 3.75 MB goes as is, a
  heavier one goes as a JPEG) and
  hands main the bytes. The header is read before anything is decoded (`headerSize`: PNG, JPEG, WebP): over 50
  megapixels is refused with its reason on the card, and a HEIC is refused with how to get a JPEG (`HEIC_REASON`). Main reads a chosen photo through `objects.readPhoto`, which serves only the paths its
  dialog offered; a dropped file is read by the window (`File.arrayBuffer`, at most 25 MB, checked before it is
  read) and its path comes from `objects.pathOf`. The copy in `reference/` is the original; the scaled picture is
  only the prompt's.
- **The board** (`Doodle.tsx`, a wrapper over `ui/board/Board.tsx`, which the chat's "Draw on view" uses too) is a sheet over the page: a canvas of 1200 x 800 board pixels, scaled to fit, pointer
  events and canvas only (no React state per move). A thin and a thick pen and an eraser; Undo takes the last
  stroke, Clear all of them; Done gives back the strokes and the PNG, Cancel and Esc leave, asking "Discard this
  doodle?" when the strokes are other than it was opened with. Its keys (Esc is `sheet.close`, Ctrl+Z `board.undo`)
  are heard in the capture phase before anything else, so that no tool under the board gets them. The PNG is made
  by `strokes.ts` with a white ground and dark ink whatever the theme: what is drawn on screen follows the theme,
  what Claude receives does not (`PNG_GROUND`).
- The name is checked against `objects.taken()` (every entry of the workspace folder, read when the page opens and
  after each create) as well as the objects. While `Creating…` shows, Escape, Cancel and the discard question do
  nothing. A note field is named by its card ("Note for photo desk.png"); numbers in the page's prose are set by
  `numbered`.
- **Create** is `ui/onboard/make.ts` (`makeObject`, tested with fakes, and guarded against a second call while one
  runs). The order is `objects.create`, the list is refreshed, the draft is spent, the object is opened as a click
  opens it, then `objects.onboard` once; the session main started is put into the store. A failure of `create`
  stays on the page with its reason and the draft intact. An error saying the object "was made, but ..." is never
  offered again: the draft is spent and the object opened if the workspace lists it. When `sessionId` is null or
  there is a `problem`, the object is open and `onboarding.hold` keeps the text: the session pane says why
  (`session-held`, with Dismiss) and the first chat's composer starts with the text, not sent. A held prompt that
  was not sent counts among what closing the window asks about (`closingWhy`'s `heldPrompt`), as does the draft.
- Styles are `styles/onboard.css`, on the tokens only; the page and the board are in `e2e/themes.spec.ts` as
  `onboard` and `onboard-board` in both themes.

## Scans

- In the window a scan's bounds tree is built in a worker
  (`viewport/scanBvh.worker.ts`), indirect, so triangle numbers hold; a scan
  is drawn before it can be pointed at. A scan drawn at 95 % or more blocks
  the pick of a part behind it, and the pointer says so (`hiddenByScan`); a
  thinner one does not. Seen through, a scan lays its depth down first
  (`depthOnly`), so only its nearest layer is blended. Nothing of a brush
  stroke or of a drag of the gizmo goes through React or the store. A picture
  coloured by distance is refused past 60,000 points or 1.5 s
  (`scanDeviation.ts`): it is worked out on the window's thread. It is lit,
  seen through beyond the range, and what is inside the part is drawn over
  it (`ScanLayer.colourFor`): its caption says the colours are approximate.
  A named view frames the parts; `look`'s `frame: 'all'` and "Frame" on a
  scan's row take the scans in, and a caption says when a scan reaches
  beyond the picture (`beyondNote`), when spread parts are not where a scan
  drawn has them (`spreadBesideScans`), and which scans have no mesh. The
  camera reaches for a scan no further than `SCAN_REACH` (200) times the
  sphere round the parts (`reaching`); a scan drawn of which some is outside
  the sphere the camera is then given is cut by the far plane, and says so
  (`beyondReach`, each scan against that one sphere: `ScanLayerState.clipped`,
  the chip "not all in view" on its row from `store.scansClipped`, which
  the viewport sets with every view it reports, and `reaches beyond the
  view: not all of it is drawn` in a picture's caption).
- The align bar is `ui/AlignBar.tsx`, its three bodies `ui/align/`
  (`FloorBody`, `PairsBody`, `NudgeBody`, and `format.ts` for what they
  share); the field one number is typed in is `ui/Field.tsx`, the Region
  bar's too, and what was typed is read by `ui/typed.ts`.
- Refs and numbers in a sentence are set in the monospace face by
  `ui/numbered.tsx`, a ref whole. `.torno/views/` ignores itself for git.
- A scan and a picture coloured by distance use tokens of their own
  (`--scan-plain`, `--deviation-*`); a region is a mark and is tinted in its
  author's mark colour.

## Agents

- The agent's terminal (`ui/SessionPane.tsx`) has its inset in the pane in the terminal's ground: the panel's,
  or the one the agent paints the edges of its screen in, when it paints one. Most of the left column and the
  bottom row decides (`ui/termGround.ts` `edgeGround`, after every write parsed); the terminal's own ground and
  the inset then take it, so that the agent's screen fills the pane (`window.__tornoTerm.ground()`; the
  stand-in's `ground r g b`).
- The session header names Claude Code, the one agent there is; under it, "Chat · Terminal" chooses the view.
  When `.torno/agent.json` could not be followed (`note` of `session:current`) the pane says why, with "Use
  Claude Code", which writes the file anew and is disabled while a session runs.

- **The chat pane** (`ui/chat/`, `state/chat.ts`; a Claude Code session whose `view` is chat has no `.xterm`). The
  window draws what main's transcript says: `placed` and `drawn` in `state/chat.ts` reproduce main's order
  (an item keeps its place; a queued prompt is drawn after all the others; sent, it goes to the end), and items
  and metas are merged by `seq` with the history, so none is drawn twice or lost. Each `context` item is drawn
  under its prompt, as chips from its fields (marks, build, selection), never from its text. A tool card reads "denied" (the person refused its ask) or "cancelled" (its ask ended with the turn stopped) in the muted colour; "failed", in the fail colour, only for an error the person did not cause. Nothing is per frame
  in React, and there is no endless animation in it: a working indication is still, toggled once a second by
  `useBeat`, and only while something streams or runs (`styles.test.ts` fails for an endless one). The window holds
  at most `MAX_ITEMS` (2,000) as main does, dropping the oldest, and says once, at the top, "Earlier items are not
  shown"; a session no pane shows takes in no picture data, also from a history that was on its way.
  The chat that ended before the window was loaded is shown from main's transcript (`session:current`'s `ended`).
- Refs are chips (`RefChip`, `refs.ts` `refInfo`): hover lights the ref through `peek` in `state/agent.ts`, which
  is not an agent highlight (no agent line, no locked tools); click focuses a mark or selects a face or edge, and
  a click with the pointer gives the keys back to the view (`giveKeysBack`), as every action on the view does. A
  ref that names nothing now is an inert span with the reason as its title. A ref in prose that names nothing the
  object has is not a chip at all (`RefInfo.plain`: a mark it has not, `M3` the screw; a build above the current or
  `r0`; a part the build has in no layout); a part in another layout, or a face it lacks, is an inert chip with
  its reason. Code is never searched for refs. Numbers in the person's prompt and in a card's questions and
  options are set in the monospace face like the rest.
- Keys of the chat are rows of `shared/keys.ts` in the scopes `composer` and `picture`: `chat.send` Enter,
  `chat.newline` Shift+Enter, `chat.command` Up/Down and `chat.complete` Tab (while `/` commands are offered),
  `chat.close` Esc (a picture shown large; the focus returns to its thumbnail). Escape in the box gives the keys
  back, except while the list of `/` commands is open: it closes the list. A card takes focus once per request, and
  only when the composer is empty and not focused. An unsent prompt in a chat that is not over is among what closing
  the window asks about (`closingWhy`'s `unsent`). "Attach view" is sent in order: main waits for the picture
  before taking the next prompt, so one sent meanwhile cannot overtake it.
- The chat is refused, with a question, for a folder that has Claude Code settings of its own and has not been let
  (`SessionPane`: `trusting`; main's refusal is `trustQuestion` of `shared/agents.ts`): "Start the chat" asks main
  to remember the folder and starts again, "Use the terminal" chooses that view and starts it.
- The agent's text is drawn by torno's own `markdown.tsx`: React text nodes, never raw HTML, a link shows its URL
  and is not an `<a>`. A picture without its data says "Picture not kept".
- **"Draw on view"** (`ui/drawing/`, `state/drawing.ts`). The ground is the agent's own picture of the view
  (`picture({ view: 'current', size: 1280 })`, the code of `look`), opened on `ui/board/Board.tsx` by `ViewBoard`, over
  the whole window as the export sheet is. The ink is `--drawing-ink` over a casing in `--panel` (`InkLook`), read once
  when the picture is made: the picture is of that theme. "Done" (`finishDrawing` in `make.ts`) composes the PNG
  (`compose.ts`) and, only while the screen is what the picture was made of (`ViewHost.shows()`, registered by
  `ViewportPane`: object, build, layout, camera, canvas size, section, explode, parts and scans shown), picks the view
  along each pen stroke where ink is left (`under.ts`: every 6 board pixels, 48 points a stroke at most): a face
  (`edges: false`), else a section's cut face, by its part (`Viewport.pickedCutOf`, from `pickUnder`'s `cutOf`), else a
  scan, else nothing. `ViewHost.shows()` is `screenShows`: a scan counts by whether it is drawn, how thin, whether its
  mesh has come and where it stands, not by whether its tree is made. A point of the picture is the same fraction of the canvas: one camera,
  one aspect. The faces' descriptors are waited for 3 s. The drawing then waits per session above the composer's box
  ("Edit", "Remove"); the board put away, by Done or Cancel, gives the keys to the composer's box (its own giving back
  finds "Draw on view" disabled once a drawing waits). It is taken by the next send and given back if that fails, counts as an unsent prompt when the
  window is closed (`unsentPrompts`), and goes with the workspace (`clearDrafts`). The composer's box takes the pane's
  width; its buttons are a row under it.

## Export

- "Export…" is a button in the status line for the open object, in the head of the page of objects for every
  object that can be exported, and on each card that has a build of this run, for that object. The sheet is
  modal (`aria-modal`, Tab stays in it, nothing behind it takes a click). `Ctrl+Shift+E` (the row `export` of
  `shared/keys.ts`, heard everywhere, the terminal included) brings it up: for the open object, or from the page
  of objects for any. There is no agent tool for it.
