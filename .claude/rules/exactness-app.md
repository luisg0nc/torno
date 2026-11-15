---
paths:
  - "app/src/shared/format.ts"
  - "app/src/main/mcp/readTools.ts"
  - "app/src/main/mcp/readTools.test.ts"
  - "app/src/main/statefile.ts"
  - "app/src/main/statefile.test.ts"
  - "app/src/main/marks/spread.ts"
  - "app/src/shared/sanity.ts"
  - "app/src/shared/sanity.test.ts"
  - "app/src/main/sanity.ts"
  - "app/src/main/sanity.test.ts"
  - "app/src/shared/cut.ts"
  - "app/src/shared/cut.test.ts"
  - "app/e2e/spread.spec.ts"
---

# Exactness in the app: what is said exact, spread layouts, numbers told as 0

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## What crosses processes (root `CLAUDE.md`)

- Every number told to the agent is the kernel's, from the B-rep, and says whether it is exact, with two
  exceptions. One is the box of a part that is not exact: it is widened to hold the mesh the part is drawn with, and
  it is the mesh's alone when the kernel's took a build more than a second (`tess.BOX_SECONDS`), `bboxExact:
  false` either way. The mesh
  drives only the estimate read out at the pointer while a measurement is
  pending (`≈`), which the kernel's value replaces. What is taken from a scan
  is the other, and is never said to be exact (see Scans).

## Exactness (`app/src/main`)

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

## Exactness (`app/src/shared`)

- A coordinate or a size under a millionth of its part's extent is told as 0: by the kernel in what it words
  (`describe.number`'s `least`), by the app in a mark's line (`describeMark` given the `scene`,
  `numberWithin` in `shared/format.ts`). A direction of a region is told to two decimals (`directionText`).
  A new cut is put at the middle of the parts to 0.01 mm (`newCut` in `shared/cut.ts`).
- What the window says is wrong with the shape of a part is one rule, `partDefects` in `shared/sanity.ts`, read
  from the kernel's own fields (`valid`, `reversed`, `openShells`, `meshDisagrees`) and nothing else; main's digest
  (`main/sanity.ts`) flags those same fields, in its own words, with which are new. The digest's types (`BuildDigest`, `DigestFlag`,
  `VerdictChange`) are there too, as the data of a chat item the window draws.
