---
paths:
  - "app/src/renderer/viewport/brushRing.ts"
  - "app/src/renderer/viewport/brushRing.test.ts"
  - "app/src/renderer/viewport/alignPoints.ts"
  - "app/src/renderer/viewport/alignPoints.test.ts"
  - "app/src/renderer/viewport/cameraMoves.ts"
  - "app/src/renderer/viewport/cameraMoves.test.ts"
  - "app/src/renderer/state/region.ts"
  - "app/src/main/marks/regions.ts"
  - "app/src/main/marks/regions.test.ts"
  - "app/src/shared/regions.ts"
  - "app/src/shared/regions.test.ts"
  - "app/src/main/mcp/scanTools.ts"
  - "app/src/main/mcp/scanTools.itest.ts"
  - "app/src/main/mcp/scanTools.test.ts"
  - "app/src/main/scans/said.ts"
  - "app/src/main/scans/said.test.ts"
  - "app/src/renderer/tools/region*.ts"
  - "app/src/renderer/tools/stamp.ts"
  - "app/src/renderer/tools/stamp.test.ts"
  - "app/src/renderer/tools/alignTool.ts"
  - "app/src/renderer/ui/RegionBar.tsx"
  - "app/e2e/region.spec.ts"
  - "app/e2e/align.spec.ts"
---

# Scans: nothing exact, regions, painting, aligning by pairs

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Scans (`app/src/main`)

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
