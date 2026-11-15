---
paths:
  - "app/src/renderer/viewport/Viewport.ts"
  - "app/src/renderer/viewport/picking.ts"
  - "app/src/renderer/viewport/picking.test.ts"
  - "app/src/renderer/state/store.ts"
  - "app/src/renderer/state/store.test.ts"
  - "app/src/shared/explode.ts"
  - "app/src/shared/explode.test.ts"
  - "app/src/renderer/viewport/explode.ts"
  - "app/src/renderer/viewport/explode.test.ts"
  - "app/src/renderer/viewport/marks/apart.ts"
  - "app/src/renderer/ui/ExplodeControl.tsx"
  - "app/src/renderer/styles/explode.css"
  - "app/src/main/look.ts"
  - "app/src/main/look.test.ts"
  - "app/e2e/explode.spec.ts"
---

# Explode: parts drawn apart, display only

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Explode (`app/src/shared`)

Explode is view state per layout (`ExplodeState` in `shared/explode.ts`:
`amount` 0 to 1, a distance `scale` 0.25 to 4, an `axis`: from the centre, or
along x, y or z), kept in `scene.json` (`explode`, by layout name), never
geometry, never in a mark or a measurement. `explodeOffsets` says how far each
part of a layout is drawn from where it is: from the centre by
`(R + d) × amount × scale` along the line from the centre of the layout's box
to the centre of the part's (`R` half the diagonal of the layout's box, `d`
the part's distance from that centre; a part within `SHARED_CENTRE_MM`,
0.01 mm, of the centre stays); along an axis the parts are ranked by their
centres on it (level ones, within `SHARED_CENTRE_MM`, in the scene's order)
and set `2R × amount × scale` apart: to both sides of the middle along x and
y, along z upward from the lowest part, which stays (nothing goes under the
ground).
A group of parts moves as one body (`Part.group`, which the worker sets on each part of a group): the rule is
asked of the boxes round each group and of the parts in no group, and every part of a group gets its group's
offset (`bodiesOf`). A layout whose parts are all of one group has nothing to draw apart (`one part`). The
exported page carries no groups yet, so it draws apart part by part.

- `scene.json` may hold a section and, for a layout, an explode above 0 at
  once (a view applied, a layout changed): `explodeShown` decides what is
  drawn, and no picture is wrong for it.
- The parts the rule is asked of are all of the layout, drawn or not. An
  exported page that leaves parts out carries their boxes (`ghosts`, no names)
  and asks the rule of `apartParts` (`shared/exportdata.ts`).
- **One rule says what is drawn apart: `explodeShown(explode, section,
  parts)`** (`shared/explode.ts`). Nothing is while there is a section, of a
  layout with fewer than two parts, or of parts that all share the centre
  they would go from: then nothing is apart, no tool is locked and nothing
  says exploded, whatever is kept for the layout. The window
  (`explodeNow(state, layout)`), a picture (`pictureExplode`) and main ask
  it; an exported page must too. `nothingApart` says which of the last two
  it is: the bar says `These parts share a centre: choose an axis`, and
  `look` or `show` asked for an explode there answers with
  `nothingApartText`.

## Explode (`app/src/main`)

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

## Explode (`app/src/renderer`)

- `E` on a layout of one part opens no bar: the button says why for a moment. The parts of a group of the model
  move as one body (`Part.group`, `explodeOffsets` in `shared/explode.ts`; `e2e/groups.spec.ts`).
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
