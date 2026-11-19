---
paths:
  - "app/src/renderer/ui/numbered.tsx"
  - "app/src/renderer/ui/numbered.test.ts"
  - "app/src/renderer/ui/typed.ts"
  - "app/src/shared/scans.ts"
  - "app/src/shared/scans.test.ts"
  - "app/src/shared/align.ts"
  - "app/src/shared/align.test.ts"
  - "app/src/renderer/viewport/scan*.ts"
  - "app/src/renderer/ui/Scan*.tsx"
  - "app/src/renderer/ui/scan*.ts"
  - "app/src/renderer/ui/AlignBar.tsx"
  - "app/src/renderer/ui/view/ProcedureCard.tsx"
  - "app/src/renderer/styles/procedures.css"
  - "app/src/renderer/viewport/askedBox*.ts"
  - "app/src/renderer/ui/align/**"
  - "app/src/renderer/state/align.ts"
  - "app/src/renderer/state/align.test.ts"
  - "app/src/renderer/styles/scans.css"
  - "app/src/renderer/styles/align.css"
  - "app/e2e/scan.spec.ts"
  - "app/e2e/align.spec.ts"
---

# Scans in the window, and the alignment maths

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Scans (`app/src/shared`)

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

## Scans (`app/src/renderer`)

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
  the line "Not all in view" in its row's detail from `store.scansClipped`, which
  the viewport sets with every view it reports, and `reaches beyond the
  view: not all of it is drawn` in a picture's caption).
- **Import scan…** is `pickScan` (`ui/scanDrop.ts`), asked from `ImportScan` (`ui/ScansPanel.tsx`), the `action` in the head of the Scans view's panel (`ScansSide`, a `ViewPanel`: the Scans tab of the view's switch, shown while the project has a scan, with the 3D view kept, the panel in the column in the bench's place), and from the `+` menu of the switch, which is how the first scan of a project is imported (a project with none has no Scans tab). Both are off while a scan is read.
- A scan's row (`ScanRow` in `ui/ScansPanel.tsx`) is one line, as a layer's: id, name (`.row-name`, whole with
  its source in the `title`), a dot while how it was read is a guess, its state in one word, the opacity on
  hover, the eye, and the arrow that opens its detail beneath it (`.scan-detail`; one open at a time, the
  `open` of `ScansPanel`). Everything else is in the detail: how it was read, the state's sentence (with the
  basis, `.scan-basis`), Frame, Align, Rename (main's `scans.rename`), the fields. The word and its sentence
  come from `ui/scanState.ts` (`scanState`): `aligned`, `placed`, `pending`, `check`, `rough`, `unaligned`,
  `missing`. `placed` is an alignment tied to no point of the model (`tiedPoints` 0), which no build checks:
  it never reads as `aligned`. How a scan this window just imported is read, when its unit or up axis was
  assumed, is asked once by `ui/ScanReadSheet.tsx`, a card in the view (330 px, the tag's look, `data-tag-avoid`) under the switch at the top left (`left: 66px`, past the reed), shown for `store.scanAsking`
  (set by `importScan`, cleared by Keep, Read it in, Next: align, Later or another object), with the dial of `ui/scanDial.ts` (`dialSizes`: the longest side as each unit would make it, in the mono form; a foot is there for the dial's sake, but a scan is read in mm, cm, m or in only, so the card shows those four), the size from `sizeAs`
  (`shared/scans.ts`), the size of the parts of the layout shown (`boxSize`, worded "about"), and, past
  `UNIT_DOUBT` (100) times either way, a `--warn` line naming the unit `sizeAgainst` finds nearest. While it is up,
  the scan's detail does not ask the same (no "right? Yes", no "Read as" fields: it says "Asked in the view"). Pointing at (or focusing) a unit draws the scan's box at that size from the scan's lowest corner, dashed in `--accent` with its size (`Viewport.showAskedBox`, `viewport/askedBox.ts`, on the overlay canvas, in no picture; `scanDial.askedBox`), and the card is tied to the scan's nearest corner in view by a leader published through `publishTag` (`ui/view/useTagAt.ts`, id `scan-ask`), never `setToolLeaders`. The change of unit that drops an alignment asks with `Confirm`, a popover from the button. A scan just imported is framed
  with the parts once (`importScan`, `actions.frameScan`; the viewport waits for the mesh if it is not drawn yet),
  and again after Apply; `F` and the named views still frame the parts only. `unaligned` is `--muted` for a scan
  never aligned in any layout (`data-never`), `--warn` otherwise.
- The Align card is `ui/AlignBar.tsx` in a `ProcedureCard` (`ui/view/ProcedureCard.tsx`: bottom right of the view, 320 px for Align, title "Align scan" with its icon and "Esc put down", `data-tag-avoid`, `styles/procedures.css`), its three bodies `ui/align/`. Its three ways are steps one under the other
  (`1 Floor · 2 Pairs · 3 Nudge`: a number in a 20 px circle, done in ink, current in the accent, to come in the hairline) with a tick (`--ok`) for each in `stepsDone` of the alignment in the layout shown
  and a muted line of what the step is for; the current step holds its body. The rough question is a `--warn-wash` block with "Not yet" and "Keep as rough". The pairs are two lines each (the point and its part, then three fields and the residual). `state/align.ts` `firstStep` picks where the tool opens (`beginAlign`, from
  `alignScan` in `ui/scanDrop.ts`: the Align button, "Next: align S1" on the read card, the card's scan select): Floor for
  a scan `muchLarger` than the parts (`SURROUNDINGS`, 10 times the diagonal) with nothing done, else Pairs, Nudge once
  there are pairs; it comes back to what was chosen last for that scan (`chooseAlignMode`); a floor or pairs kept
  moves it on (`advanceAlign`). A tick is a step, not a state: the row still says `placed` for a floor only.
  (`FloorBody`, `PairsBody`, `NudgeBody`, and `format.ts` for what they
  share); the field one number is typed in is `ui/Field.tsx`, the Region
  card's too, and what was typed is read by `ui/typed.ts`.
- Refs and numbers in a sentence are set in the monospace face by
  `ui/numbered.tsx`, a ref whole. `.torno/views/` ignores itself for git.
- A scan and a picture coloured by distance use tokens of their own
  (`--scan-plain`, `--deviation-*`); a region is a mark and is tinted in its
  author's mark colour.
