---
paths:
  - "kernel/src/torno_kernel/scans.py"
  - "kernel/src/torno_kernel/scanfile.py"
  - "kernel/src/torno_kernel/scanclash.py"
  - "kernel/src/torno_kernel/section.py"
  - "kernel/tests/scanfix.py"
  - "kernel/tests/test_scan*.py"
  - "app/src/main/scans/importer.ts"
  - "app/src/main/scans/importer.itest.ts"
  - "app/src/main/scans/importer.test.ts"
  - "app/src/test/scanFixtures.ts"
---

# The kernel: scans, their import and the scan queries

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Scans (`kernel`)

- A scan is one mesh in millimetres and Z up, `<object>/.torno/scans/<id>/mesh.bin`
  (layout: `kernel/src/torno_kernel/scanfile.py`, read alike by the kernel,
  main and the window through `shared/scans.ts` `parseScanMesh`). What is
  drawn is what is picked, painted and checked. A triangle's number is its
  place in that file and never changes while the file is the same.
- Import is a process of its own, `python -m torno_kernel.scans
  import|convert` (`main/scans/importer.ts`, `kernel/client.ts`
  `scanCommand`): never the supervisor, never a build worker, never the
  window. trimesh and pillow are the extra `scans` of the kernel package,
  asked for by that command only; the kernel starts without them. Its stdout
  is one line of JSON, its last; stages go to stderr. It runs in a process
  group of its own, and the group is killed on its timeout (300 s) and when
  the workspace is left. One file at a time.
- Unit and up axis are assumed from the format and the size (`scans.guess`),
  shown on the row, and changed there by `convert`. Above 2,000,000 triangles
  the import reduces the mesh and says so.
- The kernel's scan queries (`scanclash.py`: `scan_clash`, `scan_deviation`,
  `scan_section`) run in the live build worker, which is given paths and
  never looks for a file: inside or outside by ray parity on the part's own
  tessellation, crossings by the edges of each mesh against the other's
  triangles, distances from a `cKDTree` over that mesh sampled every
  millimetre (scipy, from the workspace, imported when first needed), the
  points an answer names taken again on the B-rep. At most 200,000
  candidates, 32 points retaken, 8 clusters told, 10 s (`BUDGET`); a
  deviation takes 100 to 20,000 samples within 0.1 to 200 mm; a section
  tells as many points as it is asked for (`points`, 2 to 4,000), to 0.1 mm.
  The 10 s start once what is worked out once of the part and the scan is
  there (cut so that both stay within 20 s where they can: after one-off
  work longer than that the answer is partial and says so); when they run out before every point was
  measured (`sampling.measured`), depths and the nearest are of the points
  measured, and the reading says so. What was thinned or left undone is in
  `sampling`, and a reading never tells an unfinished count as a no. A scan and its masks are kept by path, inode, times and
  size: a file written anew is read anew.
- Tests make their scans in code (`kernel/tests/scanfix.py`,
  `app/src/test/scanFixtures.ts`). No scan file is committed.
