---
paths:
  - "kernel/src/torno_kernel/extent.py"
  - "kernel/src/torno_kernel/tess.py"
  - "kernel/src/torno_kernel/printable.py"
  - "kernel/src/torno_kernel/measure.py"
  - "kernel/src/torno_kernel/checks.py"
  - "kernel/src/torno_kernel/describe.py"
  - "kernel/tests/test_extent.py"
  - "kernel/tests/test_tess.py"
  - "kernel/tests/test_printable.py"
  - "kernel/tests/test_measure.py"
  - "kernel/tests/test_checks.py"
  - "app/evals/score.py"
---

# The kernel: areas, volumes, boxes, sanity and printability

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Exactness (`kernel`)

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
