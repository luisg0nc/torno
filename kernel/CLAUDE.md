# torno: the kernel (`kernel`)

The Python package `torno_kernel`: it loads build123d models and tessellates them in forked workers, answers
what is asked of the last build, and imports scans in a process of its own.

What binds every part of torno is in the `CLAUDE.md` at the root of the repository: read that first. Here
is the detail of this folder, under the headings it has there.

## Scans

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

## Exactness

- Areas, volumes and boxes are measured in one place, `kernel/src/torno_kernel/extent.py`. A volume is exact
  only of a part all planes, cylinders, cones, spheres and tori that end in lines and circles. Of any other part
  the volume is integrated by Gauss-Kronrod, never to 1e-9: at finer and finer tolerances for
  as long as the looser ones together took under 0.1 s of processor time (`VOLUME_TOLERANCES`, `_SPARE`), once
  per solid in a build, and told as approximate (`volumeExact: false` in the scene, `describe` and `check
  overlap`; `exact: false` in `measure volume` and `mass`). How far it can be relied on is what two integrals
  that differ agree to, one digit fewer, two to six (`good to about N significant digits`), or, when they agree
  to fewer than two, by how much they differ (`in doubt by X %`); when every integral gave the same number it is
  held against the quick fixed-order one. That is agreement, not proof: on a half of `guitar-wall-stand` it says
  4 digits of a volume that is 2e-5 out. Which tolerance is reached depends on what the looser ones cost on the
  day, so the last digits of a freeform volume may differ from one build to the next, within what it says: no
  app test pins the digit count of a freeform fixture.
  An area is exact of planes, cylinders, cones, spheres and tori, and
  of a curve extruded straight whose length settles; of any other face `measure area` takes three integrals and
  says the digits they agree to, never as exact, and a face's descriptor (`describe`, `nearest`) takes one
  (`areaExact: false`, `≈`). The whole area `describe` tells of a part is its faces' areas as their
  descriptors have them, added up (`extent.area_of_all_at_a_glance`: one integral a face, `areaExact: false`
  when any is not exact, with no count of digits); `measure area` of the part keeps its three integrals a face
  and its digits. The two are kept apart in the worker (`area_at_a_glance_of`, `area_of` in `queries.py`) and
  neither is told as the other; an area that is exact is one number, measured once whoever asks first. A part has one box, told alike by the scene, `describe` and `measure bbox`
  (`tess.part_box`), exact only of planes and cylinders with straight and circular edges
  (`extent.boxed_exactly`, `bboxExact`).
- A build spends about a second on the volume of a part of a hundred freeform faces and up to a second on its
  box: on the owner's `guitar-wall-stand` (two halves of 92 and 94 faces, in two layouts) 3.7 s on volumes and
  1.3 s on boxes, where volumes to 1e-9 took 164 s. The whole area of a freeform part costs three
  integrals a face in `measure area` (1.5 s there, 10 s on the lid of
  `micra-intake` (2,635 faces) when it was last measured, when `describe` of the part cost the same) and one
  integral a face in `describe` of the part, at a fixed order (not timed on those parts since). A query has 30 s.
- `check overhang`, `thin` and `bed` (`printable.py`) are of the layout asked (the app asks `print`). An
  overhang of a plane is exact; a curved face is judged by its normals on a 9 × 9 grid of its parameters and
  told `exact: false`. `thin` is never exact: the wall along the inward normal at 5 × 5 points of each face, in
  10 s at most (`THIN_BUDGET`, then `sampling.complete` false). `bed` is the layout's box from the parts' boxes
  (`tess.part_box`), exact only when every one of them is.
- An angle (`measure.py` `_angle`) is exact between planes, lines and the axes of cylinders, cones, tori and
  circles (`_round_axis`). A face of another type that `GeomLib_IsPlanarSurface` finds flat within 1e-6 mm, or an
  edge whose 129 sampled points are within 1e-6 mm of the line through its ends (`_flat`, `_straight`), is taken
  for a plane or a line, and the angle is then `exact: false`, `how` ending `flat` or `straight within 1e-6 mm`.
  One that is not is refused as `curved: an extrusion face that is not flat`. The exact `_plane` and `_line` are
  what distances use.
- `measure`'s `moved`, on a thickness, is how far the given point was from
  the face it was laid on; it says nothing of the value's precision.

## Kernel invariants

- **The supervisor only imports.** `python -m torno_kernel` imports build123d
  and ocp-tessellate so that every worker it forks has them loaded, and then
  only routes frames. It never loads a model, builds, tessellates or answers a
  query: one OCC operation in it would start OCC's thread pool, and every
  worker forked afterwards would deadlock. It reads two files of `/proc`
  before a build (`meminfo` again after each worker it lets go) and nothing
  else of the system; on macOS it asks Mach for the VM statistics and libproc for the worker's resident
  size instead, and nothing else.
- **OCP's names come from OCP.** In a workspace with a `pyproject.toml` the kernel runs in the workspace's
  environment with the kernel laid over it (`uv run --no-sync --project <ws> --with-editable <kernel>`): its OCP
  and build123d are the workspace's, and ocp-tessellate is resolved afresh within the kernel's `>=3.5,<4`
  (3.6.2 beside OCP 8.0.1.1 in the owner's), not the 3.5.3 the tests run with. 3.6 no longer hands on OCP's
  names from `ocp_utils`, so a name of OCP is imported from OCP (`torno_kernel/ocp.py` for the TopTools maps
  that some builds moved to `OCP.collections`, and `downcast`), and from ocp-tessellate only its own functions:
  `tests/test_ocp_names.py` holds the list.
- **Workers never fork.** One worker is forked per build. For each object
  folder, the last one that succeeded stays alive to answer queries about that
  object, and is replaced when the next build of that folder succeeds. At most
  four stay alive: a fifth folder retires the one least recently built or
  queried, whose queries are then `no_build`. Fewer stay when memory is
  short: before a build is forked the supervisor reads `MemAvailable`
  (`/proc/meminfo`) and the `VmRSS` of the folder's live worker
  (`/proc/<pid>/status`); on macOS it asks Mach for the VM statistics (free and inactive pages) and libproc
  for the worker's resident size, by ctypes alone (`machmem.py`), and nothing else of the system. It takes the build to need that (`ROOM_LEAST`, 2 GiB,
  at least) and `ROOM_SPARE` (2 GiB) more, and while less is available
  retires the live workers of other folders, least recently used first, then
  the folder's own (`Supervisor._make_room`). `build.started` carries
  `retired`, the folders let go; a query of one is `no_build` with `reason:
  "memory"` until a build of it succeeds. When `/proc` cannot be read nothing
  is retired; nor with `TORNO_KEEP_BUILDS=1`, which torno's own test suites
  set (`kernel/tests/conftest.py`, `app/vitest.config.ts`,
  `app/playwright.config.ts`) and nothing in use ever does. A worker keeps what `nearest`
  worked out of each part it was asked about. A query names its folder (`dir`)
  and has 30 s, after which it is answered `timeout` and the worker left alone.
  Until that worker has answered every query that was given up on, new queries
  to it are answered `timeout` at once: it answers one at a time, and is still
  busy with those.
  A worker leaves through `os._exit`.
- **prctl.** Each worker sets `PR_SET_PDEATHSIG` to SIGKILL, so it dies with
  the supervisor even when that is killed, and `PR_SET_DUMPABLE` to 0, so a
  crashing model does not wait seconds on a core dump. macOS has no prctl: there a worker sets
  `RLIMIT_CORE` to 0 and starts a daemon thread (`worker._watch_parent`) that waits with kqueue for the
  supervisor's exit (polling `getppid()` where there is no kqueue) and then calls `os._exit(0)`. The
  supervisor's pid is read before the fork and passed to the worker, so a supervisor that dies in between is
  still seen. The thread is not a fork and holds no lock a model could want.
- **Timeouts.** Every build has one: 600 s unless the request names another
  (the app passes `TORNO_BUILD_TIMEOUT`), a day at most; one that is not a
  positive, finite number is a `bad_request`.
  A build past it is killed and answered with `error.kind: "timeout"`. A
  worker that crashes is answered with `crash`, one that is superseded with
  `cancelled`. The supervisor never blocks on a write.
- **A worker is not trusted.** A frame from the building worker that is not a
  result (not JSON, or without its scene or error) is a `crash` of that build;
  the supervisor carries on. Frames are written with `allow_nan=False`: a scene
  that holds a NaN is an `exception` reply, never bytes that are not JSON.
- **One geometry.** A `print` layout whose parts overlap in XY is spread along
  X in the worker, before tessellation (`arrange.py`). The shape itself is
  moved, so the mesh, the bounding box and the shape kept for queries agree;
  the part carries the translation as `arranged`. The viewport never moves a
  part, with one exception that is display only: explode (below).
- **stdout is the protocol.** The kernel keeps the real stdout for frames and
  points fd 1 at stderr; a worker points fd 1 and 2 at a capture buffer and
  stdin at `/dev/null`. What a model prints comes back as `output`.
- **Params are read, never written.** The worker that loads a model reads its `Params` dataclass
  (`loader.read_params`: name, type as written, default, whether that default is a literal in the source, the
  field's comment) and the build's scene carries it as `params`; `scene` lists it. Nothing in torno writes the
  model file: it is the person's, outside `.torno/`. A `Params` that cannot be read is no failure: `[]`.
- **Groups are read by the worker too.** Under the `Params` convention, an optional `groups(p)` (group name to
  part names) is called with `Params()` by `loader._groups`, inside the load's `try`, and checked against the
  part names of every layout: a dict of str to a list of str, no empty group or name, no `/`, not `M<n>`, not a
  part's name, every part in some layout, a part in one group at most. Anything else fails the build as an
  `exception` that says what is wrong. The scene carries it as `groups` (`[]` without), and each part of a group
  names it (`group`); the supervisor passes the
  frame on and reads none of it.
- The app starts the kernel with `PYTHONDONTWRITEBYTECODE=1`, so importing a
  model writes no `__pycache__` into the workspace.
