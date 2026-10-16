# torno: what both sides use (`app/src/shared`)

The types and the pure rules main and the window both go by; `bridge.ts` is everything the renderer may ask
of main. A rule that is here is here so that it is one rule: neither side has a copy of its own.

What binds every part of torno is in the `CLAUDE.md` at the root of the repository: read that first. Here
is the detail of this folder, under the headings it has there. Paths are from `app/`.

## Section

- One plane per object view (`SectionPlane` in `shared/view.ts`: `origin` and
  a unit `normal`, object frame; what is on the side the normal points to is
  not drawn). It is view state: `store.section`, saved in `scene.json`
  (`section`), reported in `ViewState`, drawn in `look` pictures unless they
  ask for another plane or none. The agent's `show` sets it for now, never in
  the saved file. It never changes geometry or marks.
- Numbers shown or told of a section go through `shared/format.ts`.
- A section and an explode are never on together (Explode, below): cutting
  puts the parts of the layout shown together, and nothing is drawn apart
  while the section is there.

## Explode

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

## Groups

- `shared/groups.ts` is the one rule of a model's groups of parts (`Scene.groups`, `PartGroup`), for main and the
  window alike: `groupsIn(scene, layout)` (the groups with a part in the layout, each with only those parts),
  `groupOf`, `partsNamed(scene, layout, names)` (part or group names to the part names of the layout, in order, no
  repeats; an unknown name is the failure, worded `unknown part '…'; parts in layout …; groups: …`) and
  `groupVisibility` (`all`, `some`, `none`; a part with no settings is visible).
- Which groups are folded in the layers list is view state: `folded` (group names) in `scene.json`, read by
  `main/scenefile.ts` as one-line names, each once. A saved view keeps part names, never a group's.

## Views

A saved view is how an object was looked at, kept under a name (`SavedView` in
`shared/views.ts`): the camera, the layout, the names of the parts switched
off, a section or an explode, and how each scan is shown (`visible`,
`opacity`). The views of an object are in its `scene.json` (`views`, in the
order they were saved): 24 at most of the person's (`MAX_VIEWS`: those they
made or kept), and beside them at most 12 proposals of the agent's
(`MAX_PROPOSALS`), which take no place of theirs. The person at 24 is told so
where they ask for one more (the field, or under the strip for "Keep"); the
agent is never told to remove a view.

- **View state only.** Applying a view changes no geometry, no mark and no
  measurement, and starts no build. It holds a section or an explode, never
  both: saving while there is a section keeps the section; `savedViewOf`
  keeps the section of a file that says both; `save_view` given both is
  refused with `VIEW_NOT_BOTH`, which says which to leave out.
- **`hidden` is by name, and of the parts switched off**, not of those on: a
  part the model gains later is in the view, as it is on screen. A view
  names its layout, its hidden parts and its scans; what of that is gone
  when it is applied is passed over and said, never in silence (`viewGone`,
  one rule for the strip, the tools and `state.md`). The chip says `2 parts
  gone`; the reply of `look` and `show` names them after the caption
  (` · passed over, of the view "Hinge side": the part clip, which layout
  assembly no longer has`); an explode kept of a layout that can no longer
  be drawn apart is passed over the same way (`ViewGone.explode`: the chip
  says `not drawn apart`, and such a view is on while its parts are
  together). What a file brings in is held to what can be told and drawn
  (`savedViewOf`): a layout of more than a line is no view, a hidden name of
  more than a line is dropped, a camera beyond ±1e9 mm is none and its zoom
  is kept within 0.001 to 1000. A view whose layout is gone
  stays in the strip, cannot be applied and says why. A file with a broken
  view loses that view only.
- **A name** is trimmed, one line with no control character, 1 to 40
  characters, never `current` or a standard view's (`RESERVED_VIEW_NAMES`),
  and unique in the object whatever the case (`findView`); it is shown as
  written, without what does not show or turns its reading (`cleanViewName`:
  a name of nothing that shows is no name). `viewNameRefusal` is the one rule, for the field, the store,
  main and the window's answer to the agent.

## The page of objects

- **What a thumbnail is.** The rule is `shared/thumbnail.ts` `thumbnailPlan` (pure, no three.js: main can ask
  it too): the object as it was last looked at, as its `scene.json` has it: its layout when the build still
  has it (else `thumbnailLayout`: `assembly`, or the first), the parts switched on in their colours
  (`shared/palette.ts`), cut by the section kept or drawn apart by the one rule `explodeShown`, never both.
  What would leave it empty is passed over (a part thinned to nothing counts as off; every part off: all are
  drawn, whole; a section that keeps nothing, `shared/cut.ts` `keepsNothing`: none). The drawing is
  `viewport/thumbnail.ts` `ThumbnailMaker`: a scene of its own, into a target of the viewport's renderer,
  which is left as it was found; 480 × 360, the standard iso view in perspective, brought near until the
  parts fill the picture. Parts and edges only: no mark, no scan (a scan may show the real world), no grid, no
  gizmo. The ground is clear (alpha 0) and the part palette is the same in both themes, so one file serves
  both. Parts are built with `buildPart(part, blob, { tree: false })` and disposed of after the frame; the PNG
  is `pngOf` (`viewport/picture.ts`) with the alpha kept.

## Scans

- One transform per layout (`Scan.alignments`), scan frame to object frame,
  `p' = s · R(q) · p + t`. No transform for a layout: "not aligned" there,
  drawn where it was imported, and refused by `scan_clash`, `scan_deviation`,
  `section`'s `scan`, a scan end of `measure` and `look`'s `scanColour`. The
  maths is `shared/align.ts`, pure, for both sides.
  - What only main says of an alignment (`ALIGNMENT_MAIN_ONLY`: `frame`,
    `at`, `revision`, `fitRms`, `rough`, `sourceChanged`, `confirmed`,
    `before`) is never taken from the window; residuals, `rms` and `rough`
    are worked out by main (`reckoned`). Main refuses an alignment made on
    another build than the last, one tied to a part torno moved
    (`tiedToMoved`), and a rough or scaled one without the person's yes.
  - What an alignment rests on is `basisOf`: a fit of `pairs`, a `floor`
    only, or a `hand`, and whether a hand moved it afterwards. `rough` is of
    a fit of pairs alone (fewer than 3, almost in a line, or `fitRms` over
    5 mm), and a move by hand does not launder it.
  - `ScanLayerState.transform` is where the window draws the scan, which may
    be a preview. Nothing told to the agent or stored reads it.

## Exactness

- A coordinate or a size under a millionth of its part's extent is told as 0: by the kernel in what it words
  (`describe.number`'s `least`), by the app in a mark's line (`describeMark` given the `scene`,
  `numberWithin` in `shared/format.ts`). A direction of a region is told to two decimals (`directionText`).
  A new cut is put at the middle of the parts to 0.01 mm (`newCut` in `shared/cut.ts`).
