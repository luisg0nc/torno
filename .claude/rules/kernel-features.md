---
paths:
  - "kernel/src/torno_kernel/features.py"
  - "kernel/src/torno_kernel/patterns.py"
  - "kernel/src/torno_kernel/measure.py"
  - "kernel/tests/test_features*.py"
  - "kernel/tests/test_measure.py"
  - "app/src/main/mcp/featureTools.ts"
  - "app/src/main/mcp/featureTools.itest.ts"
  - "app/src/main/mcp/featureTools.test.ts"
---

# The kernel: holes, bosses, fillets, patterns, angles

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Exactness (`kernel`)

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
