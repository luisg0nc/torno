---
paths:
  - "app/src/test/diagnosisFixtures.ts"
  - "kernel/src/torno_kernel/diagnose.py"
  - "kernel/src/torno_kernel/booleans.py"
  - "kernel/src/torno_kernel/selectors.py"
  - "kernel/tests/test_diagnose.py"
  - "kernel/tests/test_booleans.py"
  - "kernel/tests/test_selectors.py"
  - "app/src/shared/diagnosis.ts"
  - "app/src/shared/diagnosis.test.ts"
  - "app/src/main/fillet.itest.ts"
---

# The kernel: why a fillet or a boolean failed, and selectors

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Kernel invariants (`kernel`)

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
