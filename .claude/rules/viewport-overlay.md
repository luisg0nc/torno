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
  - "app/src/renderer/styles/layout.css"
  - "app/src/renderer/styles/viewbars.css"
  - "app/src/renderer/ui/ToolHint.tsx"
  - "app/src/renderer/ui/ToolPalette.tsx"
  - "app/src/renderer/ui/ViewBar.tsx"
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
  `state/step.ts`, `shared/pointer.ts`). The palette has no `title`: each button has torno's own tip beside it (`ToolTip`,
  at once on the pointer and on the keys' focus, `:focus-visible` only; any key puts it away; it takes no pointer
  and is `aria-hidden`, the button holding the same words as its `aria-description`): the name, the key cap from
  `hint`, what the tool does (`doesOf`, the `does` of `TOOL_KEYS` without its name) and, below, what else is worth
  knowing now (`noteOf`: a scan's tool with no scan says `Import a scan first`, a painting that waits on a scan, the
  shape the Shape tool places). A scan's tool (`SCAN_TOOLS`: Region, Align) with no scan in the object, once main has
  said so (`scansKnown`), is drawn quieter (`data-quiet`, the icon in `--muted`) and stays enabled: its click and its tip
  say why. The key letters are 11 px. The Keys button has the same tip.
  With a tool other than Select in hand one line at the foot of the view (`ToolHint`, `aria-live="polite"`, no
  animation, no pointer) says what the tool waits for next: `next` of the tool's row in `TOOL_KEYS`, with
  Measure's `then` once the first end is clicked (`stepStore.stage`, set by `measureTool` through `setFirst`, once
  per click, never per move), Pin's `click the part where M3 should be` while a mark is being put elsewhere, and
  `import a scan first` for a scan's tool with no scan (`stepFor`, `hintLine`). The line names no key of a tool: only
  `Esc` (`hint('escape')`), which steps back. The first time an object is drawn in this install the same line, with no
  tool in hand, says how the pointer moves the view (`pointerLine()`, and `?` from `hint('keys')`); a tool's step takes
  its place while it is in hand, and the hint goes at the first move of the camera the person makes with the pointer
  (a drag or the wheel: `Viewport.onNavigated`, not a view key, Fit or a click that moves nothing), remembered in
  the window's `localStorage` under `torno.pointerHint` (`pointerHintDue`, `rememberPointerHint`: a storage that is
  not there or refuses shows it again; never in a workspace). The line stands on `--bar-floor` and, while it is
  there (`:has(.tool-hint)`), lifts every bar at the foot of the view by a row (`--hint-lift`, 40 px) so that none meets it
  (`styles/layout.css`, held by `viewport/overlay.test.ts`). The sheet of keys starts with a group "Pointer"
  (`POINTER` in `shared/pointer.ts`: drag, right drag, scroll, double click with Measure; "In the view": with Arrow or
  Draw in hand a drag that starts on the part draws instead; the others' own press is in their step lines): gestures, no row of `KEYS`, searched with them and counted
  after them (the count line gives the keys, then `, N of the pointer`); the manual's table of them is held to it (`readme.test.ts`).

## Explode (`app/src/renderer`)

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
  scale bar`, as before. The scale bar is 100 px at most on screen. The strip of the Measure tool stands above the
  triad, and the bars at the bottom of the view (the section's, the selection's, the Align and Region tools', the
  agent's line) keep `BAR_SIDE` in from each side, clear of the triad and of the scale; where the view is narrower than
  the widest of them needs (`NARROW_BELOW`, `data-narrow` on `.viewport-pane`, set by `ViewportPane` as the view is
  resized) they stand above the triad (`--bar-lift`) instead, and above the strip of the Measure tool while it is in hand (the strip is also above the triad, at the left, and the two never meet),
  the bars that stack there (the selection's, the section's, the agent's line, the step line, the Region tool's) 60 px in
  from each side (`--stack-side` of `[data-narrow]`), clear of the palette of tools, which a short view's stacked bars
  would reach; the Align tool's bar, which stands alone and whose rows need the width, keeps `--space-3`. In a wide view the bottom row stands below the strip, beside the triad, and a bar raised a row up (the
  section's over the selection or the agent's line, the agent's line over the selection) stands at `--strip-top` at the
  least while the strip is there, above it. `TRIAD_CLEAR`, `BAR_SIDE` and `NARROW_BELOW` are in
  `viewport/overlay.ts`, and `--triad-clear`, `--bar-side` in `styles/layout.css` are held to them by `overlay.test.ts`;
  `e2e/section.spec.ts` reads the bar's box against the corners, the palette and the strip, and the strip's against the
  selection's, at seven sizes, with a selection and without.
