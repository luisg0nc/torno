---
paths:
  - "app/src/renderer/viewport/pointer.ts"
  - "app/src/renderer/viewport/pointer.test.ts"
  - "app/src/renderer/viewport/overlay.ts"
  - "app/src/renderer/viewport/overlay.test.ts"
  - "app/src/renderer/viewport/overlayPass.ts"
  - "app/src/renderer/viewport/focus.ts"
  - "app/src/renderer/viewport/focus.test.ts"
  - "app/src/renderer/viewport/views.ts"
  - "app/src/renderer/viewport/views.test.ts"
  - "app/src/renderer/viewport/tracings.ts"
  - "app/src/renderer/viewport/tracings.test.ts"
  - "app/src/renderer/state/tracingsIn3d.ts"
  - "app/src/renderer/styles/layout.css"
  - "app/src/renderer/styles/viewbars.css"
  - "app/src/renderer/ui/ToolHint.tsx"
  - "app/src/renderer/ui/view/Hint.tsx"
  - "app/src/renderer/viewport/captionAt.ts"
  - "app/src/renderer/styles/caption.css"
  - "app/src/shared/captionPlace.ts"
  - "app/src/shared/captionPlace.test.ts"
  - "app/src/renderer/ui/ToolPalette.tsx"
  - "app/src/renderer/ui/view/Compass.tsx"
  - "app/src/renderer/ui/view/ViewCube.tsx"
  - "app/src/renderer/ui/view/MeasureTag.tsx"
  - "app/src/renderer/styles/compass.css"
  - "app/src/renderer/ui/CompareBar.tsx"
  - "app/src/renderer/ui/ReviewBar.tsx"
  - "app/src/renderer/ui/view/Band.tsx"
  - "app/src/renderer/ui/view/bandKind.ts"
  - "app/src/renderer/styles/bands.css"
  - "app/src/renderer/ui/ExplodeControl.tsx"
  - "app/src/renderer/state/step.ts"
  - "app/src/renderer/state/step.test.ts"
  - "app/src/shared/pointer.ts"
  - "app/src/shared/pointer.test.ts"
  - "app/src/shared/focus.ts"
  - "app/src/shared/focus.test.ts"
---

# The view: the focus, the frame cues, the bars at its foot, and the hints of the tools

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Marks (`app/src/renderer`)

- **Learning the tools and the pointer without the manual** (`ui/ToolPalette.tsx`, `ui/ToolHint.tsx`,
  `state/step.ts`, `shared/pointer.ts`). The reed (`ToolPalette`: round buttons in three pills, `data-tag-avoid`) has no `title` on a tool: each button has torno's own tip beside it (`ToolTip`,
  at once on the pointer and on the keys' focus, `:focus-visible` only; any key puts it away; it takes no pointer
  and is `aria-hidden`, the button holding the same words as its `aria-description`): the name, the key cap from
  `hint`, what the tool does (`doesOf`, the `does` of `TOOL_KEYS` without its name) and, below, what else is worth
  knowing now (`noteOf`: a scan's tool with no scan says `Import a scan first`, a painting that waits on a scan, the
  shape the Shape tool places). A scan's tool (`SCAN_TOOLS`: Region, Align) with no scan in the object, once main has
  said so (`scansKnown`), is drawn quieter (`data-quiet`, the icon in `--muted`) and stays enabled: its click and its tip
  say why. No letter is drawn on a button: the key is the button's `aria-keyshortcuts`, in the tip and in the name of the tool in hand. **The tool in hand** is an accent circle and its name grows out to the right (`.reed-pill`, 0.22 s `reed-grow`, none under reduced motion): `pillOf(tool, { scope, scopeOpen, sketching })` in `ui/view/reedPill.ts` says what it holds (the name, the key cap, the choices: Measure's Distance, Angle, ⌀, r and `T` thickness, Shape's four, Draw's four pens while a sketch is open, Region's Brush and Box; Align a name only). Select is the tool at rest and has none until `scopeOpen` (a click on it, or its key while it is in hand; it goes when another tool is taken) or while the scope is not Any. A tool with its name grown out shows no tip. `ReedPillView` draws the pill for the model's reed and for a tracing's (`tracings/Palette.tsx`: Trace's Line, Circle, Label and Ink's pens, `tracingPillOf`); the choices keep the groups and labels the strips had (`What to measure`, `What a click selects`, `Shape to place`, `Pens of the sketch`, `How to paint`). Keys is the `?` button of the status line. Measure's last reading and its Keep button are the tag on the measured line (`ui/view/MeasureTag.tsx`, `data-tag="measure"`, placed at the middle of the line by `readingAt`; see `dimensions.md`).
  With a tool other than Select in hand a **caption** (`ToolHint`, an ink pill: `--ink` ground, `--surface` text, 12 px,
  `--radius-full`, a pill) stands by the pointer, 18 px below and to its right (`captionPlace` in `shared/captionPlace.ts`:
  to the other side at the edge of the pane, beyond the readout `.pick-readout` when that is there, and below the switch of Model and Board or a band (`.pboard-switch`, `.band`, at the top left) when the pointer is by them: `captionAt` reads their boxes and passes them as `avoid`). `CaptionAt`
  (`viewport/captionAt.ts`) puts it, with a transform written on every pointer move over the pane, never through React; no animation but a
  90 ms fade, and it takes no pointer. It says what the tool waits for next: `next` of the tool's row in `TOOL_KEYS`, with
  Measure's `then` once the first end is clicked (`stepStore.stage`, set by `measureTool` through `setFirst`, once
  per click, never per move), Pin's `click the part where M3 should be` while a mark is being put elsewhere, and
  `import a scan first` for a scan's tool with no scan (`stepFor`, `hintLine`). It names no key of a tool: only
  `Esc` (`hint('escape')`), which steps back (the words "steps back" are for a screen reader). Its words are always in the
  `aria-live="polite"` region (`.tool-hint-live`); only the look is the pause rule: `captionShows(uses, stillMs)` is true
  for the first `CAPTION_USES` (10) takings of a tool with a step (`countToolUse`, `toolUses`, the window's `torno.toolUses`; a
  storage that is not there or refuses counts none) and after that once the pointer was still `CAPTION_PAUSE_MS` (500); the element has
  `data-shown` while it shows, and none while the pointer is out of the pane. The **hint** (`ui/view/Hint.tsx`, `.view-hints`, bottom
  middle: a pill on the panel at 92 %, muted 12 px) holds the pointer's way (the first time an object is drawn in this install, with no
  tool in hand: `pointerLine()`, and `?` from `hint('keys')`; it goes at the first move of the camera the person makes with the pointer
  (a drag or the wheel: `Viewport.onNavigated`, not a view key, Fit or a click that moves nothing), remembered in
  the window's `localStorage` under `torno.pointerHint` (`pointerHintDue`, `rememberPointerHint`: a storage that is
  not there or refuses shows it again; never in a workspace)), the agent's line (`AgentLine`, `.agent-line`) and, while a sketch is open, the
  sketch's standing line (`sketchLine`: "Snapping on, hold `Ctrl` to drop it", X-ray and its key). It stands at the bottom middle, `--space-3` from the foot and `--triad-clear` in from each side, clear of the triad and of the
  grid step; nothing lifts it, and no bar stands over it (`styles/caption.css`, held by `viewport/overlay.test.ts`). The sketch's box by the pointer (`viewport/sketchHint.ts`, on the overlay canvas)
  is the caption's look, an ink pill, and an accent one (`--on-accent` text) where the pointer would snap (`hintLook`). The caption's, the hint's and the readout's rules are in `styles/caption.css` (the readout's look in `overlays.css`). The sheet of keys starts with a group "Pointer"
  (`POINTER` in `shared/pointer.ts`: drag, right drag, scroll, double click with Measure; "In the view": with Arrow or
  Draw in hand a drag that starts on the part draws instead; the others' own press is in their step lines): gestures, no row of `KEYS`, searched with them and counted
  after them (the count line gives the keys, then `, N of the pointer`); the manual's table of them is held to it (`readme.test.ts`).

## Tracings in the view (`app/src/renderer`)

- **A tracing shown in 3D** (`TracingLayer` in `viewport/tracings.ts`, held by `Viewport`, given its list by `connectTracings3D` in
  `state/tracingsIn3d.ts`, never through React per frame): the straightened photo as a textured quad in the tracing's plane at the photo's
  fade times `PHOTO_SHARE` (0.6), the outline of the last cut as lines in the ink colour, each layer that is not hidden as lines in its colour
  (`Theme.layers`, held to the tokens by `contrast.test.ts`), a faint sheet and its edge sized to the outline's bounds, the photo's rectangle and
  the layers, plus a margin (`extend` takes it into the frame the camera reaches). Every material has `depthWrite` false and `depthTest` false (so the plane reads
  through the parts it cuts, and the parts through it; a builder's call), `renderOrder` below the marks, and no clipping plane: **a section never cuts
  it** (as it does not cut a mark), and it is never picked (`raycast` is a no-op). Of the layout on screen only (`show`, from `showMarks`). Made once per
  tracing and again only when its plane, shapes, cut, photo or fade change (`drawnAsOf`); a picture is uploaded once (`textureOf` by `ImageBitmap`) and let go
  when no tracing holds it.
- **Which are shown** is `SceneFile.tracingsShown` (`store.tracingsShown`, `actions.setTracingShown`, `keepTracingsShown` for a tracing the project lost):
  view state, in `scene.json`, never sent as a change. A tracing shown counts as shown for main (`shownIds`, `tracings:shown`), so each build cuts it
  again and tells the window (`tracings:outline`); `connectTracings3D` asks for the outline of one that has none, or whose plane moved (`cutKey`), and has
  the window read or make the photo's straightened copy.
- **A `look` picture draws them** when they are shown on screen (`PictureHost.tracings`: `show` for the picture's layout, `extend`, `drawn`) and
  says `· tracing T1 shown in its plane` (`tracingsSaid`). The Tracing view's panel has a row for each tracing (`ui/TracingRows.tsx`),
  whose eye puts it in or takes it out of `tracingsShown`. There is no "Marks hidden" switch in the window, so the marks of a tracing are never hidden with it.
- A **span** is drawn as a dimension line (`line` and a `tick` at each end) with its value in its chip (`spanValue`: `≈ 41.8 mm`), an **offset** as an
  arrow from `from` to `to` in its author's colour with its chip at `to` (`build` in `viewport/marks/markObjects.ts`), whether the tracing is shown or not.

## Bands (`app/src/renderer/ui/view/Band.tsx`, `bandKind.ts`, `styles/bands.css`)

- A **band** is the one sentence at the top left of the view (14 px in, a pill 34 px high, radius full, dropping 8 px in 0.3 s; none
  under reduced motion) for a mode of the whole view. `bandOf` (`bandKind.ts`, pure) picks one: export, lineup, facePick, review,
  compare, sketch, failed. A review that is open keeps its band while a sketch opens inside it. `useBand()` is that rule over the stores
  (the model's modes count while the model is shown, the line-up while a tracing is, none on the board or over a page); each mode's component
  (`ReviewBar`, `CompareBar`, `SketchBand`, `FailedBand` in `ViewportPane`, `FacePickBar` in `App`, `LineUp`'s own) draws only while `useBand()` is its kind.
  `exportOpen` is always false until the dock holds export (Task 34).
- The tone is `BAND_TONE`: `accent` (review, lineup, export; buttons are `--on-accent` grounds with accent text when `primary`) or `quiet`
  (`--raise`, ink, a hairline; failed, sketch, compare, facePick). The band carries `data-band`, `data-tone`, `data-part` and **`data-tag-avoid`**
  (tags stand clear of it). It is a toolbar when it holds buttons, else a status. `BoardSwitch` returns nothing while `useBand()` is not null.
- The words are `bandKind.ts`'s (`sketchWords`, `failedWords`, `compareWords`, `planeSaid`); refs and numbers are in the face of numbers.
  What a mode could not do is `.band-note` under the band (`--fail` on `--fail-wash`). `.sign-disc` is `reviews.css`'s (`ui/SignDisc.tsx`).

## Explode (`app/src/renderer`)

- The control is `ui/ExplodeControl.tsx`: `ExplodeToggle`, one button in the
  compass (pressed while the parts are apart or its tag is up, with the
  amount beside the word; pressed while apart it puts them together), and
  `ExplodeTag`: a **track** (`viewport/explodeTrack.ts`: `planTrack` stands it beside the parts' box along Z, or the
  axis the view shows longest when Z is end on, keeping its corner while that is about as good, and only a place with both ends in the view (`trackFits`, `TRACK_CLEAR` from the edges); where none has, a fixed place at the view's bottom right, `TrackPlan.screen` from `fixedTrack`, #212; `trackEnds` is where its ends are drawn either way, and the tag takes `Tag`'s `clear` (`trackBox`) so it stands beside the track and never over it; drawn on the overlay by
  `drawExplodeTrack`, graduated every 10 % and numbered 0, 50, 100, with a 16 px handle; `Viewport.setExplodeTrack`) and
  a `Tag` (`data-tag="explode"`) at its top with the amount (mono 19 px), "apart, for the view only", `From centre X Y Z`,
  `×0.5 ×1 ×2 ×4`, and a last line with `role="status"` that says what `E` does, or why nothing is
  drawn apart. The handle (`.explode-handle`, a pointer target placed every frame) is dragged along the track: the amount is
  the foot of the pointer on it; the range input `.explode-slider` beside it is the track's for the keys and assistive technology. The tag is the
  notice that the parts are not where they are drawn, and it folds the saved views. No bars cover the top of the view
  any more (`setCoveredTop` is gone), and `keepApartInView` is asked by the tag when the parts are drawn apart.
  The compass fits at 1280 × 800 for an object with two
  layouts, apart or together, inside the view, clear of the reed and with the explode tag clear of it The compass fits at 1280 × 800 for an object with two
  layouts, apart or together, inside the view, clear of the reed and with the explode bar clear of it
  (`explode.spec.ts` holds it to that). **The compass** (`ui/view/Compass.tsx`, `data-tag-avoid`, `role="toolbar"`
  named View) stands at the top right, 14 px in, items right-aligned 7 px apart: the cube tile (118 × 112,
  `--radius-sheet`), Perspective / Ortho (`O`), the row of the layout (a pill with its name and a menu of the others,
  only with more than one), Fit (`F`) and Explode, and the saved views (`saved-views.md`). The standard views and `F`,
  `O`, `E` are its keys (one listener, in `Compass`), after the tool in hand. The still cube
  (`ui/view/ViewCube.tsx`) is an iso SVG with a real button over each face (Top `4`, Front `2`, Right `3`, the corner
  Iso `1`, "···" for Back, Left and Bottom); the face of the view on screen (`lockedView`) has `data-on`, the accent wash
  and the padlock (a drawing on it is a flat profile). While a sketch is open (the tool Draw with a sketch) the tile is
  the canvas's: `viewport/viewCube.ts` draws the tile and the cube turned as the camera is, in the tile's box
  (`cubeCentre`, `TILE`; `CUBE_HALF_PX` 26, which keeps an iso cube of 85 px inside the 112 px tile), with XY, XZ, YZ and
  `⇧1` to `⇧3` on its faces, and the DOM tile is clear, with "Planes" in the accent at its corner. `window.__tornoTest.exploded()` says
  whether the viewport draws the parts apart, or is on its way there or back.

## Views (`app/src/renderer`)

- **A focus** (`FocusBox`, `focusCamera` in `viewport/views.ts`): a picture for the agent, or `show`, is framed on
  a box and its margin by `fitCamera`, looking the way a standard view does (orthographic, as a picture of one is),
  or the way the camera on screen or the agent's own camera looks, with its projection kept. A picture says
  `framed on the focus` and which parts stand between the camera and the middle of the box (`hiddenBehind` in
  `viewport/focus.ts`: a line cast at the meshes of the parts drawn, both faces, what a cut takes away left out,
  the box's own surface not in the way). Parts are drawn together unless the picture says otherwise; `show`
  refuses a focus while the screen is exploded. All of it is synchronous once started, like the rest of a picture.
- **The frame in the view** (`drawFrameCues` in `viewport/overlay.ts`, drawn by `OverlayPass` with every frame on the
  canvas the labels are on, never through React): the axis triad bottom left, its arms about 32 px (`SCREEN_UNIT`)
  in `--axis-x`, `-y`, `-z`, and bottom right the scale bar in an orthographic view or, in perspective, where no one
  scale holds, the grid's step as `grid 5 mm` (`groundOf`'s `step`; the grid lies on the ground in the object frame, so
  its step is a true length in any projection). It is of the camera and the object frame only, so it stays while the
  parts are apart. A picture for the agent has the same triad and bar, and in perspective its note `perspective, no
  scale bar`, as before. The scale bar is 100 px at most on screen. The foot of the view holds the hint (bottom middle), the triad and the grid step or scale bar, and nothing
  else: no bar stands there, so there is no lift (`--bar-lift`, `--hint-lift`, `--stack-side`, `--strip-top`, `data-raised` and `data-narrow`
  are gone). The tools' tags, the procedure cards and the bands keep to their own rules. `TRIAD_CLEAR` is in `viewport/overlay.ts`, and
  `--triad-clear` in `styles/layout.css` is held to it by `overlay.test.ts`, which also holds the removed names out of the stylesheets;
  `e2e/section.spec.ts` ("nothing over the reed, the compass or the band") reads the tag's box against the reed, the compass and the band at
  1440 × 900 and 1280 × 800, with a selection and without.
