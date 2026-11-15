---
paths:
  - "kernel/src/torno_kernel/loader.py"
  - "kernel/src/torno_kernel/modelchecks.py"
  - "kernel/src/torno_kernel/worker.py"
  - "kernel/src/torno_kernel/tess.py"
  - "kernel/tests/test_loader.py"
  - "kernel/tests/test_params.py"
  - "kernel/tests/test_modelchecks.py"
  - "kernel/tests/test_references.py"
  - "kernel/tests/test_bd_warehouse.py"
  - "kernel/tests/test_skill_*.py"
  - "kernel/tests/test_template.py"
  - "kernel/tests/test_example.py"
  - "kernel/scripts/**"
  - "kernel/pyproject.toml"
  - "app/resources/agent-plugin/**"
---

# The kernel: what it reads of a model (Params, groups, tags, checks, references, imports)

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Kernel invariants (`kernel`)

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
- **The build123d skill's API reference is made from the pinned build123d.** `app/resources/agent-plugin/skills/build123d/reference/api-<version>.txt`
  lists every name `build123d` exports (and the bases of those classes) with its signature and the first line of its
  docstring. `scripts/build123d_api.py` writes it (`cd kernel && uv run --no-sync python scripts/build123d_api.py`,
  `--check` to compare) and `tests/test_skill_api.py` fails when it is stale, when the pin in `pyproject.toml` is
  not the installed version, when the file is not named for the pin, or when it passes 150 KB. The same test
  runs every `python` example of the skill and of `reference/fasteners.md`; change a pin, regenerate the file,
  rename it in `SKILL.md`, and read the examples again.
