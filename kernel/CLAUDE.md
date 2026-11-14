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

- Areas, volumes and boxes are measured in one place, `kernel/src/torno_kernel/extent.py`. A volume is taken of
  each solid on its own, with OCC's sign: a solid turned inside out integrates as negative while `is_valid` stays
  true, and the sign is the one thing that says it is broken. `Volume.value` is the sum of the solids' sizes
  (never negative) and `Volume.reversed` the indexes, 0-based among `topo.solids` (as faces are numbered, never
  `S<n>`, which is a scan's id), of the negative ones; `abs` is taken only there, never where a verdict is wanted.
  The scene (`Part.reversed`), `describe`, `measure volume` and `mass` and `check overlap` and `clearance` carry
  it, only when there is a reversed solid; torno never mends the shape (`Solid.fix()`). A volume is exact
  only of a part all planes, cylinders, cones, spheres and tori that end in lines and circles. Of any other part
  the volume is integrated by Gauss-Kronrod, never to 1e-9: at finer and finer tolerances for
  as long as the looser ones together took under 0.1 s of processor time (`VOLUME_TOLERANCES`, `_SPARE`; one budget
  for the whole part, all its freeform solids refined together a tolerance at a time), once
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
- Of a part whose volume is not exact the scene gives `volumeDoubt`, its spread (mm³), and of one whose box is not
  exact `bboxDoubt`, the deflection it was drawn at (mm): an untouched part's approximate numbers may differ that
  much from one build to the next, and main does not tell that as a change. Absent of an exact one.
- What a build tells of a part besides its sizes (`tess._sanity`): `solids`, how many it has; `openShells`, how many
  of its shells have a free edge (one that only one of their faces has: a seam and a pole are none); and
  `meshVolume`, the size of what the part's own mesh encloses, a sum over the triangles it is drawn with. That is
  never exact and never a number to rely on: it is there to raise `meshDisagrees` (present only when true) when it
  and the B-rep's volume are further apart than `MESH_SLACK` (2) deflections over the mesh's area and the volume's
  own doubt explain. It is not judged of a part with no solid, an open shell or a solid inside out. None of it is a
  boolean or a second integral. A void whose shell faces into it integrates as material, and positive: OCC's check
  (`valid`) is what finds it.
- A build spends about a second on the volume of a part of a hundred freeform faces and up to a second on its
  box: on a real `guitar-wall-stand` (two halves of 92 and 94 faces, in two layouts) 3.7 s on volumes and
  1.3 s on boxes, where volumes to 1e-9 took 164 s. The whole area of a freeform part costs three
  integrals a face in `measure area` (1.5 s there, 10 s on the lid of
  `intake` (2,635 faces) when it was last measured, when `describe` of the part cost the same) and one
  integral a face in `describe` of the part, at a fixed order (not timed on those parts since). A query has 30 s
  (an `export` or `export_check` 120 s).
- `check overhang`, `thin` and `bed` (`printable.py`) are of the layout asked (the app asks `print`). An
  overhang of a plane is exact; a curved face is judged by its normals on a 9 × 9 grid of its parameters and
  told `exact: false`. `thin` is never exact: the wall along the inward normal at 5 × 5 points of each face, in
  10 s at most (`THIN_BUDGET`, then `sampling.complete` false). `bed` is the layout's box from the parts' boxes
  (`tess.part_box`), exact only when every one of them is.
- `features` (`features.py`) finds holes and bosses of a part in the layout asked on the B-rep's own adjacency, with no
  boolean and no mesh: faces that are cylinders, cones or tori about one axis (the same axis within 1e-5 mm), that
  meet at an edge or on the plane of a step, form a run, and a run whose every surface goes right round (its faces'
  parameter ranges add up to a full turn) is a hole where the material is outside it and a boss where it is
  inside; the side is the sign of the face's outward normal against the radial vector. A run's ends are read from
  the faces across its boundary edges at the ends: a plane or other face whose outward normal points on along the
  axis is where it opens (a hole) or where a boss ends, one that points back into it is a floor or a boss's base;
  a cone that comes to a point is a drill point or a tip. A hole drilled across another is two runs and is joined
  into one (`crosses`). Diameters, angles and axes are exact; an entry, a depth or a height is the distance
  between where the axis meets the faces at its ends, exact when each is a plane, a cylinder, a cone, a sphere or a
  torus (a line met with an analytic surface by `GeomAPI_IntCS`), and otherwise (a mouth on a freeform wall) is
  taken at the end of the run and told with `exact: false` and `how`. Slot ends and rounded corners (round faces
  that do not go all the way round) and a cylinder that stands on nothing are counted (`notFeatures`), not told;
  freeform faces are counted too, since a hole in one is not recognised. A fillet is a cylinder or a torus less than
  half a turn round (its sweep, the cylinder's angle or the torus's tube angle) whose boundary edges meet faces with
  no corner (normals alike within 1e-6 at the middle of the edge), at least two of them; blends of one radius and
  side that touch are one. A chamfer is a plane with all lines for edges, two of them parallel and the longest,
  across which are two planes it leaves at 5° to 85°, the same way round, whose line of meeting is parallel to
  them, and whose setback from that line (the distance between parallel lines, so exact) is under half of what is
  left of each face (a hexagon's sides and a ramp are not); or a cone between a plane across a cylinder's axis and
  that cylinder (setbacks the radii's difference and the axial distance), unless it is a step of a hole, which is
  told as a countersink. A pattern (`patterns.py`) is holes (or bosses) alike in diameter, shape, end, depth and
  direction, taken as one set whole, whose axes (their places across the axis, so wherever along it the hole
  was measured) lie on a line at equal steps, in a grid (the rows along the way to the nearest of the others from the
  first, a full rectangle) or at equal angles on a circle (three are a circle only if they fill it; a part of
  one needs four); a set that is none of these is told as none, and its holes are still told one by one.
  A line is tested before a grid and a grid before a circle, so four holes at the corners of a square are a 2 × 2
  grid. Positions are in the frame of the shapes
  as built, so of an `arranged` part in the displayed frame. It is bounded as `check overhang` is: 10 s
  (`BUDGET`, then `complete` false and the runs left over are not told as none) and `MAX_FEATURES` (100) of a
  kind told, the rest counted in `left`. What it found is kept in the worker, under `("features", key)`, until
  the next build.
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
  and the label sequence that some builds moved to `OCP.collections`, `IFSelect_RetDone`, and `downcast`), and from ocp-tessellate only its own functions:
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
  and has 30 s from when the worker takes it up, not from when it was queued: it answers one at a time, in
  order, so the clock of a query starts when the one ahead of it is answered (`_Worker.start_next`), and a few
  asked at once (read tools called together) do not time each other out; an `export` or an `export_check` has
  `EXPORT_TIMEOUT` (120 s) in place of the 30 (`supervisor.query_seconds`). Past its time a query is answered
  `timeout` and the worker left alone; those queued behind it are answered `timeout` at once, as busy (they were
  sent, and the worker answers them in their turn). Until that worker has answered every query that was given up
  on, new queries to it are answered `timeout` at once the same way: it answers one at a time, and is still
  busy with those. The busy answer names the time the query it was given up on had (`_Worker.stuck`): 30 s, or
  120 s behind an export.
  A worker leaves through `os._exit`.
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
- **prctl.** Each worker sets `PR_SET_PDEATHSIG` to SIGKILL, so it dies with
  the supervisor even when that is killed, and `PR_SET_DUMPABLE` to 0, so a
  crashing model does not wait seconds on a core dump. macOS has no prctl: there a worker sets
  `RLIMIT_CORE` to 0 and starts a daemon thread (`worker._watch_parent`) that waits with kqueue for the
  supervisor's exit (polling `getppid()` where there is no kqueue) and then calls `os._exit(0)`. The
  supervisor's pid is read before the fork and passed to the worker, so a supervisor that dies in between is
  still seen. The thread is not a fork and holds no lock a model could want.
- **Socket buffers.** On macOS the supervisor sets `SO_SNDBUF` and `SO_RCVBUF` of both ends of each worker's
  socketpair to `SOCKET_BUFFER` (1 MiB) before the fork: macOS gives about 8 KB, and a 64 MiB mesh then took
  149 ms to pass against 10 ms. Linux's are left as they are.
- **Timeouts.** Every build has one: 600 s unless the request names another
  (the app passes `TORNO_BUILD_TIMEOUT`), a day at most; one that is not a
  positive, finite number is a `bad_request`.
  A build past it is killed and answered with `error.kind: "timeout"`. A
  worker that crashes is answered with `crash`, one that is superseded with
  `cancelled`. The supervisor never blocks on a write.
- **A failed fillet says why** (`diagnose.py`). When a build fails inside build123d's `fillet` or `chamfer`
  (the innermost frame of such a method of a build123d shape in the traceback, or in that of the exception it was
  raised from), the worker that failed, before it writes the error and exits, takes the call's `self`, size and
  edges from that frame's locals and tries it again in parts with OCC's own `BRepFilletAPI` (a try works when the
  result is done and `BRepCheck_Analyzer` finds it valid, as build123d asks): each edge alone at the size asked; if
  each works alone, the pairs, those that share a face first and the others only when none of those fails, within
  half of what is left; then the largest size that works for them all and for each edge that fails alone, bisected
  on a grid of `STEP` (0.001 mm) under the size asked. An uneven chamfer keeps its proportions. No fork and no other
  process. It has `BUDGET` (5 s), or what the build's timeout leaves less `MARGIN` (1 s) when that is less: the
  supervisor passes the worker its deadline. OCC's tries cannot be stopped, so the clock is read between them, and
  no try is started with less left than `SLACK` (2) times the longest try so far; what it had no time for is said
  (`complete: false`) and never told as a finding. What OCC prints meanwhile goes to `/dev/null`, not into the
  model's output. A diagnosis that fails is none: the build's error is written as it was. It runs fillets the model
  never ran, and one may crash the worker or overrun the build's timeout: so before the first try the error's
  message and the last line of its traceback are written at the end of the captured output (`[torno] The build
  failed: …`), where a `crash` or a `timeout` still reports them, and the capture is cut back to before them
  (`ftruncate`; the supervisor reads it by `pread`) once the diagnosis is over. The error carries it as `diagnosis`: the shape filleted is an
  intermediate one with no place in the scene, so its edges are numbered by their place in the call (from 0) and
  described with their ends in its frame, `frame: "local"`. `match_edges`, asked of the live worker of the last
  good build by main, names the edges of that build that are exactly one of them: the same curve, ends and length
  within `SAME_EDGE`, 1e-6 mm, either way round, and every one of the points the diagnosis sampled along it
  (`samples`, at each eighth of its length, `diagnose.describe_edge`) within `SAME_EDGE` of that edge. Ends and a
  length alone are not enough: an arc bulging the other way, or a circle in another plane through the same seam,
  has them. An edge told without samples, or of a shape moved or changed since, matches none. It names every
  part's edge that matches; which, if any, the edge is, is main's to say.
  `try_fillet` (`queries.try_fillet`, `diagnose.trial`) is the same trial asked by the agent of the live worker,
  on a part of the last good build (`part` as `layout:name`, `edges` as `name/E<i>`, 200 at most, `radius`,
  `kind`): the fillet of them all is tried first, and only when it fails is it diagnosed, in `TRIAL_BUDGET` (20 s)
  of the query's 30, its edges named by their refs, ends in the object frame (`frame: "object"`). Every try is a
  new shape thrown away: the worker's shapes are left as they were.
- **A failed boolean says why** (`booleans.py`, reached through `diagnose.find` and `diagnose.from_exception`). When a
  build fails inside a boolean of build123d (the innermost `_bool_op` frame of a build123d shape in the traceback, or
  in that of the exception it was raised from; a `cut`, `fuse`, `intersect` or `split` and the operators and builders
  over them), the worker that failed takes `args` and `tools` from that frame's locals and looks at them: it runs
  no boolean, tries nothing in the model and starts no process, on the same budget, clock, `SLACK` rule,
  `/dev/null` for OCC's prints and note in the captured output as a fillet's (`worker._diagnose`). Each operand is
  told by its type (`solid`, `face`, `empty`, …), OCC's `BRepCheck_Analyzer` and the `BOPAlgo_ArgumentAnalyzer`'s
  faults (self-intersection, small edges); for each base and tool that are valid solids, `BRepExtrema`'s distance
  (`apartExact: false`), how many points sampled on each (its vertices and the middles of its edges, 60 at most)
  `BRepClass3d_SolidClassifier` finds inside the other solid, and the pairs of faces that are one surface (planes
  within `NEAR`, 1e-4 mm, with their `gap` and whether they face the `same` or `opposite` ways; cylinders and spheres
  to `SAME`, 1e-7 mm) and share area (the area of `BRepAlgoAPI_Common` of the two faces only, never of the
  operands). `causes` is what that comes to; a count of points inside is a sample, never told as proof, and
  operands past `MOST_OPERANDS` (4) a side are left out and counted (`operandCount`, `complete: false`). The
  operands have no place in the scene: faces are numbered by their place in the operand (`F3`, from 0) and
  everything is in the frame of the operand, `frame: "local"`. The error carries it as `diagnosis` beside a
  fillet's, told apart by `operation` (`cut`, `fuse`, `intersect`, `split`); main sets no `sameAs` on it. A boolean that
  succeeds but gives an empty or wrong result raises nothing and is not diagnosed.
- **A selector for a face or an edge** (`selectors.py`; `describe` asked with `selector: true`, which only the `describe`
  tool sends, never the window's hover). The kernel tries a short list of build123d expressions on the part as it stands in
  the layout asked, most robust first (type or direction; the extreme along an axis, or along one and then another;
  where it is, its radius, its area or length; last an index into a sort, `robust: "by order"`), evaluates each with
  build123d on the worker's own shape and keeps the first that gives exactly that shape, with no other as far along
  the axis (`TIE`, 1e-5 mm) for an extreme or a place in a sort. **The worker evaluates only expressions it made itself**:
  the text is put together from fixed method names, build123d's own enumeration names (the target's
  `geom_type.name`) and numbers written to 4 decimals, nothing of a tool's arguments (the ref says only which shape),
  and `eval` has no builtins but `abs` (`_Search.globals`). It has `BUDGET` (10 s) of the query's 30, read between
  candidates; past it, or with no form, `selector` is `null` with `selectorWhy`. The selector is checked on this build only.
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
  Each field also says `value` (what this build used), `editable` (`float`, `int`, `bool` or `choice`: only a field
  whose default is a literal number or bool, or a `Literal` of literals, with a default among them), `choices` and
  `metadata` (the plain numbers `min`, `max`, `step` of the field's own `metadata`).
- **A build may carry overrides of `Params`** (`overrides`, field name to a bool, number or string; anything
  else is a `bad_request`). The loader makes every `Params()` it calls (`assembly`, `printables`, `make_<part>`,
  `groups`, `checks`) as `dataclasses.replace(Params(), **applied)` (`loader._params`); `apply_overrides` takes only
  an `editable` field's value of its type (a whole number for a float is made a float, a bool is no number), and
  drops the rest. The scene's `overrides` says `applied` and `dropped` (`name`, `reason` naming the type wanted),
  so none is lost silently. A range in a field's metadata is for the window to keep, not enforced here. A model
  that makes `Params()` itself, not taking `p`, does not see an override.
- **Groups are read by the worker too.** Under the `Params` convention, an optional `groups(p)` (group name to
  part names) is called with `Params()` by `loader._groups`, inside the load's `try`, and checked against the
  part names of every layout: a dict of str to a list of str, no empty group or name, no `/`, not `M<n>`, not a
  part's name, every part in some layout, a part in one group at most. Anything else fails the build as an
  `exception` that says what is wrong. The scene carries it as `groups` (`[]` without), and each part of a group
  names it (`group`); the supervisor passes the
  frame on and reads none of it.
- **Tags are read by the worker too, and matched before the print layout is spread** (`loader._tags`). Under the
  `Params` convention an optional `tags(p, parts)` is called once for each layout with a copy of the dict that
  layout's function returned (the shapes themselves, so a face taken from one is the part's own), and returns part
  name to tag name to a face, an edge or a list of them. Each is matched to the kernel's index by `IsSame` in
  `TopExp.MapShapes` maps, the same as `topo` walks, in `load_model`, before `tess.build_scene` runs `arrange.spread`
  (a moved shape is no longer the same one; the order of faces and edges survives it). They travel with the layouts
  (`loader.Layouts.tags`, `(layout, part)` → tag → `{"faces": [...], "edges": [...]}`, empty lists left out; the one
  `Layouts` class that also holds `references`), so `load_model` still returns four things. References are in the
  assembly's dict only, so a `tags` that takes a face of one guards `if name in parts`. A tag that is not a letter or `_` then letters, digits, `_ . -`, a part no
  layout has, a result of the wrong shape, an empty list, a shape that is not a face or an edge, or one the part
  does not have (a face of another part or taken before the part was changed: the tag is stale) fails the build as
  an `exception` that says which; a part named that this layout lacks but another has is skipped. The scene carries
  them on the part as `tags` (`worker._tag_parts`), and the worker keeps them in `kept[("tags", key)]` for
  `queries.resolve`, which takes `layout:part/@tag` for the face or edge it names when it names exactly one (`describe`
  tells the face's own ref and the `tag`) and refuses several, naming them. `nearest` may be given the `face` a tag
  names now (as it is given an `edge`) and says whether the part has it and how far the point is (`faceFound`,
  `faceDistance`, `facePoint`, `faceDescriptor`, `faceNormal`; an edge's `edgePoint`).
- **The model's own checks are declarations, measured by torno** (`modelchecks.py`). Under the `Params` convention an
  optional `checks(p)` returns a list of dicts in torno's vocabulary, not predicates: `name`, `kind` (`clearance`,
  `overlap`, `solids`, `volume`, `thin`, `overhang`, `mesh`, `bed`, and `interference`, which takes no part: it passes when no pair of the layout shares volume),
  part or group refs `a` and `b` (a group stands for its parts; never `F12`), an optional `layout`, and what is
  wanted (`min`/`max`, `equals`, or `expected` with `tolerance` or `percent`; `thin` takes `min` as its least wall,
  the printing kinds want none found). `loader._checks` reads only their shape and names, inside the load's `try`:
  a malformed one fails the build as an `exception` that says what is wrong, as a bad `groups(p)` does. The worker
  measures them after tessellation (`worker._model_checks`, `modelchecks.run`), through `checks.check` and
  `measure.measure` as they are, in `modelchecks.BUDGET` (10 s; the rest are `not run`), and the scene carries the
  results as `checks`: `status` (`pass`, `fail`, `error` for one that could not be measured, `not run`), `value`,
  `unit`, `min`, `max`, `exact` and `how` of the kernel, and the `declared` dict. A check that does not pass never
  fails the build; a `thin` that finds none says so by sampling, never as a proof.

- **References are bought parts, read by the worker** (`loader._references`). Under the `Params` convention an optional
  `references(p)` (name to shape, in the assembly's frame) is called with `Params()` after the layouts are collected and
  before `groups(p)` and `checks(p)`, which may name them. They are added to every layout but `print` (a model with
  only a print layout fails the build, saying it needs an assembly), as `loader.Layouts`, a dict that also holds which
  names are references (`Layouts.references`), so the signature of `load_model` is as it was. A shape with children (a
  bearing of bd_warehouse, a STEP with an assembly in it) is taken as the compound of its solids, where they are. A
  name is refused when it is a part's, has a `/`, has the form `M<n>`, or the value has no solid. A vendor STEP is
  read by the model itself (`import_step`); the kernel reads no file. `tess.build_scene` tells such a part `role:
  "reference"` and notes it in `kept[("reference", key)]` (`queries.is_reference`), which is all the queries know.
  A reference is an obstacle: `clearance`, `overlap` and `interference` take it against the parts (`interference`
  never against another reference, and names them in `references`). It is not made: `bed` leaves it out (and says
  so), `mass`, `mesh`, `overhang`, `thin` and a STL or 3MF refuse it (`queries.need_made`; a group in a model's
  `thin`, `overhang` or `mesh` check skips them, and naming one is refused when the model loads), while a STEP may
  hold it when asked. `describe` says `role: "reference"`.

- **The scene says what the model imported (`uses`).** After the load, the worker (`loader.used_files`, from
  `sys.modules`, never from a declaration) lists the Python files under the workspace (the folder above the
  model's) that it imported from outside its own folder, `common/` included, as paths from the workspace with `/`.
  `.venv`, `site-packages` and models loaded as models are not among them. Main watches those files and rebuilds on
  a save; a cycle between two projects is shown on both and never refused here. Only a good build reports it.
- The app starts the kernel with `PYTHONDONTWRITEBYTECODE=1`, so importing a
  model writes no `__pycache__` into the workspace.
- **The build123d skill's API reference is made from the pinned build123d.** `app/resources/agent-plugin/skills/build123d/reference/api-<version>.txt`
  lists every name `build123d` exports (and the bases of those classes) with its signature and the first line of its
  docstring. `scripts/build123d_api.py` writes it (`cd kernel && uv run --no-sync python scripts/build123d_api.py`,
  `--check` to compare) and `tests/test_skill_api.py` fails when it is stale, when the pin in `pyproject.toml` is
  not the installed version, when the file is not named for the pin, or when it passes 150 KB. The same test
  runs every `python` example of the skill and of `reference/fasteners.md`; change a pin, regenerate the file,
  rename it in `SKILL.md`, and read the examples again.
