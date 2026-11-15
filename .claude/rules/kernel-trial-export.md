---
paths:
  - "kernel/src/torno_kernel/export.py"
  - "kernel/src/torno_kernel/worker.py"
  - "kernel/src/torno_kernel/supervisor.py"
  - "kernel/src/torno_kernel/queries.py"
  - "kernel/tests/test_export.py"
  - "kernel/tests/test_supervisor.py"
  - "app/src/main/export/model.ts"
  - "app/src/main/export/model.itest.ts"
  - "app/src/main/export/model.test.ts"
  - "app/src/main/kernel/**"
---

# The kernel: trials, and the files a build exports

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Kernel invariants (`kernel`)

- **A trial is a worker that answers once and leaves** (`trial` request: `dir`, `model`, `overrides`, `queries`,
  `timeout`; `Supervisor._trial_request`, `worker._answers`). The supervisor forks it as it forks a build, with
  the overrides, but it never becomes live, holds no build, and a live worker is never retired for it:
  `_has_room` asks the same memory as `_make_room` (`ROOM_LEAST` and `ROOM_SPARE` more than the folder's live
  worker holds) and the trial is refused `no_room` when it is not there, `busy` while a build or another trial
  runs; a build that starts cancels a trial. The worker loads the model, builds the scene, answers each of at most
  `MOST_TRIAL_QUERIES` queries in its own process (`queries.run` over its shapes: a query that fails fails alone)
  and writes one frame with the scene (no mesh) and `answers`, then exits. Its refs are of no build and main gives
  none. It has the build's timeout and its output is captured the same way. With `mesh: true` (a bool) that frame
  carries the blob of a build's own, and the folder above `dir` goes first on `sys.path` in the worker: the trial of
  the copy of an older kept build (`main/oldbuild.ts`), which lies in a workspace of its own under `<userData>/compare/`,
  so that `common/` and another project's module are the copy's, not those of the workspace the kernel runs in (its cwd,
  which is on the path of every build).
- **Files of a build are made by its worker and never written by the kernel** (`export.py`). `export` (`format`
  `step`, `stl` or `3mf`, `layout`, `parts`, `tolerance` mm and `angle` degrees for a mesh, `colors`, `name`)
  answers with the file's bytes as the reply's blob (`queries.WithBlob`, sent by `worker._serve`; every other
  reply's blob is empty): STEP the B-rep, each part a component named and coloured, written and read through OCC's
  XCAF document with names as UTF-8 (`_step`, `_read_step`; never build123d's `export_step`/`import_step`, which
  turn `ção` into mojibake and a space, a dot or a bracket into `_`); STL one part; 3MF a plate, each part a
  named object in millimetres where the layout has it, coloured, and a part of several solids an object made of a
  mesh of each solid (`<name> 1`, `<name> 2`, components). An STL of a part whose solids touch or overlap is
  refused (`<part> is N solids that touch: fuse them in the model, or export 3MF`), and a mesh of a part with a
  face of no solid. A mesh is OCC's of a copy of the part (or of the solid), at the tolerance and angle asked,
  absolute (0.01 mm and 5° unless asked; 0.001 to 1 mm, 0.5 to 45°), never the screen's, welded as
  `checks.welded` welds, no triangle with two corners in one place. OCC's meshing cannot be stopped, so what it
  would make is estimated first (`estimate`: a rough mesh at a 500th of the diagonal and 15°, scaled face by face;
  never under the count on the parts tried, up to about three times over), and more than `MOST_TRIANGLES`
  (500,000: a torus of that many took 57 s, a sphere 22 s) is refused before anything is meshed, as is a count
  over it after. `export_check`, with the same arguments and `path`, reads that one file back and holds it
  against the shapes: of STEP the same parts by name, the same solid counts, volumes within 1e-6 (or their doubt)
  and the same boxes; of STL and 3MF, each mesh (of a part, or of each solid of one) closed once welded (no side
  of one triangle or of three, none gone along twice the same way), no triangle of no area, as many pieces as it
  has shells, what it encloses positive and within `MESH_SLACK` tolerances over its area of the B-rep's volume,
  and its box. It answers `passed` and `problems`, a sentence each; it never throws for a bad file.
