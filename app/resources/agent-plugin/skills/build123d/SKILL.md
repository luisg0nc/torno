---
name: build123d
description: Idioms of build123d 0.13 (algebra and builder mode, locations and planes, selectors, fillets and chamfers, booleans), its silent failures, and an offline reference of every name in it. Use when writing or repairing a build123d model.
when_to_use: A build fails in a fillet, a chamfer or a boolean (`StdFail_NotDone`, `command not done`, `Failed creating a fillet`); a build123d name or argument is in doubt, or an import from build123d fails; a screw, nut or insert hole is to be modelled; a part comes out with less volume than it should, or in several pieces.
---

# build123d in torno

torno's kernel is pinned to **build123d 0.13.0**. The examples here run on it and assume `from build123d import *`.
A workspace with its own `pyproject.toml` builds with its own build123d, which may be another version.

## Check a name or an argument: read the reference, do not run Python

`${CLAUDE_SKILL_DIR}/reference/api-0.13.0.txt` lists every name `build123d` gives, with its signature and the first
line of its docstring, by module; a class lists the members it defines, and the bases (`Shape`, `Mixin1D`,
`Mixin2D`, `Mixin3D`) are listed too. It is long: `Grep` it, never read it whole.

```text
Grep "^def fillet"                  one function
Grep "^class Cylinder" -A 2         a class and its signature
Grep "Mixin3D.max_fillet"           a method, by the class that defines it
Grep "sort_by|group_by"             what a word is used for
```

A name that is not there is, very likely, not in 0.13.0 (`ocp_vscode` and `show()` are not in torno's kernel; `bd_warehouse` is, as a package of its own that this reference does not list). Do start Python to look: torno builds the model, and in the usual workspace (no `.venv` of its own)
build123d is not installed where you can run it. Only where the workspace has its own `.venv` can the installed version be read,
with `uv run --no-sync python -c "import build123d; print(build123d.__version__)"` (`--no-sync`, never `uv sync` or a
plain `uv run` there). `${CLAUDE_SKILL_DIR}/reference/fasteners.md` has the sizes of screws, nuts and inserts.

## Silent failures: a build that works is not a part that is right

OCCT often returns a shape that is valid, with one solid, and wrong. A render does not show it. Numbers do.

**1. A boolean can drop geometry and still be valid.** Compare the volume before and after, in the model, and read it
in the build result (what the model prints comes back with it). An add gives at least the larger of the two and at
most their sum; a cut that did something takes away more than nothing and at most the tool.

```python
plate = Box(40, 30, 5)
tool = Pos(10, 0, 0) * Cylinder(3, 5)
cut = plate - tool
removed = plate.volume - cut.volume
print(f"cut removed {removed:.1f} mm3 of a tool of {tool.volume:.1f}")
assert 0 < removed <= tool.volume + 1e-6, "the cut did nothing, or took more than the tool"

boss = Pos(0, 0, 2.5) * Cylinder(4, 6)
joined = cut + boss
assert max(cut.volume, boss.volume) <= joined.volume <= cut.volume + boss.volume + 1e-6, "the join lost geometry"
assert len(joined.solids()) == 1, "the join is in pieces"
```

A tool that only touches along a face or tangent to an edge is where it goes wrong: overlap by a little instead.

**2. An operation applies to the shape its edges were taken from.** `fillet` and `chamfer` find the part from the
edges: edges selected before an earlier operation belong to the old shape, and filleting them gives the old shape
with that one fillet, without the earlier chamfer, and no error. Select again from the shape you hold.

```python
plate = Box(40, 30, 5)
old_vertical = plate.edges().filter_by(Axis.Z)
chamfered = chamfer(plate.edges().group_by(Axis.Z)[-1], 1)
wrong = fillet(old_vertical, 2)                            # the chamfer is gone
right = fillet(chamfered.edges().filter_by(Axis.Z), 2)     # edges of the shape being filleted
assert wrong.volume > chamfered.volume > right.volume
```

**3. A result not assigned is lost.** `fillet`, `chamfer`, `extrude`, `offset`, `mirror` and every boolean return a
new shape in algebra mode and change nothing in place.

```text
fillet(plate.edges(), 1)            # plate is unchanged: the result went nowhere
plate = fillet(plate.edges(), 1)    # right
```

**4. A `ShapeList` has no stable order.** `faces()[3]` is a different face after an edit, and a ref such as `lid/F12`
is renumbered on every build. Never index a selection by number: `sort_by`, `filter_by`, `group_by` and
`filter_by_position` pick by where a thing is and what it is (below).

**5. A union of shapes that do not touch is several solids**, and a cut that misses changes nothing. Count
`len(shape.solids())`; the build result says `plate is 2 solids (was 1)` under `Check:`.

## Two modes

**Algebra mode**: shapes are values, combined with operators. Prefer it in a torno model: each `make_<part>`
returns a value.

```python
plate = Box(40, 30, 5)
plate -= Pos(10, 0, 0) * Cylinder(3, 5)              # subtract
plate = fillet(plate.edges().filter_by(Axis.Z), 2)   # operations return a new shape
boss = extrude(Plane.XY.offset(2.5) * Circle(4), amount=6)
part = plate + Pos(-10, 0, 0) * boss                 # add; & intersects
assert part.volume > plate.volume
```

**Builder mode**: a `with BuildPart() as bp:` block in which each object is added to the part (`mode=Mode.SUBTRACT`
to cut), sketches are made on faces with `BuildSketch`, and `bp.part` is the result.

```python
with BuildPart() as bp:
    Box(40, 30, 5)
    with Locations(bp.faces().sort_by(Axis.Z)[-1]):
        with GridLocations(20, 10, 2, 2):
            Hole(2)
    fillet(bp.edges().filter_by(Axis.Z), 2)
    with BuildSketch(bp.faces().sort_by(Axis.Z)[-1]):
        Circle(4)
    extrude(amount=6)
    fillet(bp.edges(Select.LAST).group_by(Axis.Z)[-1], 1)
part = bp.part
```

Never mix them in one expression. In a builder, an object is added where it is made: `Pos(20, 0, 0) * Box(5, 5, 5)`
adds the box at the origin and throws the moved copy away. Use `with Locations((20, 0, 0)): Box(5, 5, 5)`.

```python
with BuildPart() as wrong:
    Box(10, 10, 10)
    Pos(20, 0, 0) * Box(5, 5, 5)             # added at the origin, inside the first box
with BuildPart() as right:
    Box(10, 10, 10)
    with Locations((20, 0, 0)):
        Box(5, 5, 5)
assert len(wrong.part.solids()) == 1 and len(right.part.solids()) == 2
```

`Hole`, `CounterBoreHole` and `CounterSinkHole` work in a builder only (in algebra mode they fail with `ValueError: No
depth provided`): there, subtract a `Cylinder` that overshoots both faces.

## Locations and planes

- `Pos(x, y, z) * shape` moves, `Rot(x, y, z) * shape` turns (degrees, about X, then Y, then Z),
  `Location((x, y, z), (rx, ry, rz))` both; `shape.moved(loc)` too. They compose left to right as written:
  `Pos(...) * Rot(...) * shape` turns, then moves.
- Primitives are centred on their location by default (`Box(10, 10, 2)` spans z -1 to 1); `align=(Align.MIN,
  Align.MIN, Align.MIN)` puts a corner there instead. Arguments to look out for: `Box(length, width, height)`,
  `Cylinder(radius, height)` (radius first, along Z; turn it with `Rot` for another axis), `Cone(bottom_radius,
  top_radius, height)`, `Sphere(radius)`, `Torus(major_radius, minor_radius)`, `Circle(radius)`.
- `Plane.XY`, `Plane.XZ`, `Plane.YZ`, `Plane.XY.offset(z)`, `Plane(face)`: `plane * Circle(4)` puts a sketch on
  it; `extrude(sketch, amount=...)` extrudes along its normal.
- When the side of a plane matters, extrude around the middle plane, `both=True` (`amount` is then each way), and assert
  the bounding box's position, not only its size. A sketch that was made by a subtraction, put on a plane and extruded
  once went to the wrong side of it: the solid was valid and the size right, and only the overlap check noticed. The
  cause was not found; `both=True` avoided it.

```python
# A web 5 mm thick that sits on both sides of z = 10.
profile = Rectangle(30, 20) - Pos(5, 0, 0) * Circle(4)
web = extrude(Plane.XY.offset(10) * profile, amount=2.5, both=True)
box = web.bounding_box()
assert abs(box.size.Z - 5) < 1e-6                                      # the size alone passes on the wrong side too
assert abs(box.min.Z - 7.5) < 1e-6 and abs(box.max.Z - 12.5) < 1e-6   # where it is
```
- `GridLocations(dx, dy, nx, ny)`, `PolarLocations(r, n)`, `Locations(...)`: in algebra mode
  `[loc * Cylinder(1, 10) for loc in GridLocations(10, 10, 2, 2)]`.
- Sizes are `shape.volume`, `shape.area` (properties, no parentheses), `shape.bounding_box().size`, `shape.center()`.

## Selectors

- `shape.faces()`, `.edges()`, `.vertices()`, `.solids()` give a `ShapeList`.
- `.sort_by(Axis.Z)[-1]`: the topmost; `[0]` the lowest. `.sort_by(SortBy.AREA)`, `SortBy.LENGTH`, `SortBy.RADIUS`.
- `.filter_by(Axis.Z)`: edges along Z, or faces whose normal is along Z; `.filter_by(GeomType.CIRCLE)`.
- `.group_by(Axis.Z)[-1]`: everything at the highest Z, as one list.
- `.filter_by_position(Axis.Z, 0, 2.5)`: what lies between two heights. `.sort_by_distance(point)`: nearest first.
- In builder mode `bp.edges(Select.LAST)` is what the last operation made.
- After an operation in algebra mode, `new_edges(before, combined=after)` is the edges `after` has that `before` does
  not: the rim of a hole just cut, the edges of a chamfer. Select again from `after`, not from `before`.

```python
plate = Box(40, 30, 5)
drilled = plate - Pos(10, 0, 0) * Cylinder(3, 5)
rim = new_edges(plate, combined=drilled).filter_by(GeomType.CIRCLE)
assert len(rim) == 2
rounded = fillet(rim, 0.5)
assert rounded.volume < drilled.volume
top = plate.faces().sort_by(Axis.Z)[-1]
assert abs(top.center().Z - 2.5) < 1e-9 and len(plate.faces().filter_by(Axis.Z)) == 2
```

Select by position and kind, never by a face's number: torno's refs (`lid/F12`) are for talking about a model, and
must never be written into it.

## Holes and blends

Before you move, resize or add to the holes of a part, call `mcp__torno__features` (`{"part": "lid", "kinds":
["hole"]}`): it lists the holes of the last build with their diameter, axis, where each opens (a face ref), depth,
through or blind, and a counterbore or countersink, as the B-rep has them, so you need not describe their faces one
by one or read the numbers off the code. A diameter it gives is exact; a depth it marks `≈` is not. With `kinds`
`["fillet", "chamfer"]` it lists the fillets (radius, outside edge or inside corner, the edges they run along) and
chamfers (setback), so you can see the radius a fillet has before you change it, then `try_fillet` the new one; with
`"pattern"` it says which holes lie in a row, a grid or on a circle at equal steps, and the step.

To pick the face or edge a ref names, describe the ref, paste its `selector` (an expression on `part`, such as
`part.faces().filter_by(Axis.Z).sort_by(Axis.Z)[-1]`), and look at the result. The kernel evaluated it on the last
build and it gave exactly that shape, so it is right for this build only: `robust: "by geometry"` is made of a
direction, an extreme, a radius or a place, `"by order"` of an index into a sort that the next edit may break (read
it again after an edit, and prefer a form by geometry). Where there is `selector: null` write one by hand from the
descriptor. `selectorFrame` says whose frame it is in: a layout that moves or turns the part gives directions in its
own frame, not the one its own function builds in.

## Fillets and chamfers

- `fillet(edges, radius)`, `chamfer(edges, length)`. A radius must be under the wall and under half the shortest
  adjacent edge, and two fillets or chamfers on edges of one face need more than twice their size of face between
  them.
- Order matters: make all the solid geometry first (bosses, cuts, holes), then fillet; fillet the larger radii
  before the smaller, and vertical edges before the ones round the top. A fillet that meets another fillet's edge
  often fails: select edges from the shape just before (Silent failures, 2). A fillet that fails after a boolean
  usually has tiny edges the boolean left in its selection: narrow it (`filter_by`, `group_by`) or fillet first.
- **When one fails, read why before you edit.** The build's error says it under the message (`Why: fillet R6 of 8
  edges: each works alone; 4 pairs of adjacent edges fail (edges 4-5, ...: 12 mm apart, two R6 need more); the 8
  together work up to R5.999`), and `mcp__torno__scene` has it under `build.error.diagnosis`: the edges that fail
  alone, else the pairs that fail, and the largest radius that works. Its edges are numbered by their place in the
  call, with their ends in the frame of the shape filleted; one that is an edge of the last good build is named by
  that ref too. Then try the change on the last good build with `mcp__torno__try_fillet` (`{"part": "lid",
  "edges": ["lid/E3", "lid/E7"], "radius": 2}`, `"kind": "chamfer"` for a chamfer) before editing again: it
  changes nothing. Do not call `max_fillet()`: it often raises where the radius can be found.
- **Never wrap a fillet in `try` and quietly use a smaller radius**, nor lower it on every edge when only some
  fail: the part is then not the part asked for, and nothing says so. Change the radius in `Params`, or the
  selection (a smaller radius on the edges that need it), and say it.

```python
plate = Box(20, 20, 5) - Box(12, 12, 5)  # a 12 mm pocket: two R6 on its corners need more than its 12 mm side
corners = plate.edges().filter_by(Axis.Z).group_by(SortBy.DISTANCE)
assert [len(group) for group in corners] == [4, 4]  # the pocket's corners, then the outside's
plate = fillet(corners[-1], 6)  # the outside keeps R6
plate = fillet(plate.edges().filter_by(Axis.Z).group_by(SortBy.DISTANCE)[0], 5)  # the pocket's take R5
assert plate.is_valid and len(plate.solids()) == 1
```

## Booleans

- `StdFail_NotDone`, `BRep_API: command not done` or an empty result: the two shapes touch only along a face or an
  edge, or are coincident. Make a cutting tool overshoot what it cuts (a hole 0.01 mm or more longer each way) and
  a join overlap by a little rather than meet exactly. A build that fails in a boolean says why under its message
  (`Why: cut failed: …`): an operand that is a face or a wire and not a solid, one that is empty or not valid, a tool
  face flush with the face it cuts, or shapes that only touch. Its faces are numbered in the operand (`tool F5`),
  not as in the scene; read it before editing, and do not wrap the boolean in `try`.
- A union of shapes that do not touch is several solids: torno takes each part as it is, and the build result of an
  edit says so under `Check:` (`plate is 2 solids (was 1)`), with every part that is not valid, inside out or open.
- Many small cuts are faster as one: build the tools as a list and subtract their sum, or use `Hole` in builder mode.
- Thin walls under about 0.01 mm and self-intersecting sketches give invalid solids: `check` with `kind: "mesh"`
  says whether the part's mesh is closed.

## Imports

Import from `build123d` and nothing deeper: `from build123d import Box, Pos, fillet`, or `import *`. Every name in
the reference is there, the exporters and importers too (`export_step`, `import_step`). The modules under it
(`build123d.topology.one_d`, `build123d.exporters`...) are its inside and have moved between versions. A model does
not write files: it returns shapes and torno draws and exports them.

## Screws, nuts and inserts

`bd_warehouse` is in torno's kernel environment in any workspace: `from bd_warehouse.fastener import SocketHeadCapScrew,
ClearanceHole, InsertHole`, `from bd_warehouse.bearing import SingleRowDeepGrooveBallBearing`. Use it for a standard
part rather than computing a head or a tap diameter by hand, with `simple=True` for a screw, and put the fastener
or bearing itself among `references(p)` (a bought part: see the `torno-model` skill), not among the parts. A bought part
that is not a standard fastener may already be on the parts shelf (`common/parts/`, see the `torno-model` skill): look there first. The
hole sizes of metric screws, their heads and nuts, with the standards they come from, the heat-set insert holes
(assumed values: the insert's datasheet wins), and examples are in `${CLAUDE_SKILL_DIR}/reference/fasteners.md`. Keep
each size a field of `Params` with its source in a comment, or "assumed" where it has none.

## Text and threads

`Text("A", font_size=5)` is a sketch, to extrude or cut. Real threads are slow to build and heavy to draw: model
a printed thread only when it is asked for, and keep its `Params` (pitch, length) explicit.
