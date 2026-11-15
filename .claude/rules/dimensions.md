---
paths:
  - "app/src/main/marks/measure.ts"
  - "app/src/main/marks/measure.test.ts"
  - "app/src/main/marks/tolerance.ts"
  - "app/src/main/marks/describe.ts"
  - "app/src/main/marks/describe.test.ts"
  - "app/src/shared/dimension.ts"
  - "app/src/shared/dimension.test.ts"
  - "app/src/main/context.ts"
  - "app/src/main/context.test.ts"
  - "app/src/renderer/tools/measureTool.ts"
  - "app/src/renderer/ui/DimensionFields.tsx"
  - "app/e2e/measure.spec.ts"
---

# Dimensions: marks that hold a measured value

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Marks (`app/src/main`)

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
