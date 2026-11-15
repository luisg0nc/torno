"""Score one project of an eval run against its case's checks, on the B-rep, with torno's own kernel loader.

    uv run --no-sync --project kernel python app/evals/score.py <object folder> <checks.json>

Prints one JSON object: ``build`` (``ok``, and ``error`` when the model did not load) and ``checks``, one result per
check, each ``{"id", "kind", "pass", "value", "expect", "exact"}``. Volumes and boxes are the kernel's own
(``torno_kernel.extent``), exact where it says they are (``.claude/rules/kernel-measures.md``): a box only of planes and
cylinders, a volume only of analytic faces; a ratio of boxes is exact when the box is. A check that cannot be measured
fails, with ``error``.

The kinds (each takes ``layout``, by default the model's first):

- ``valid``: every part (or ``part``) is a valid B-rep.
- ``parts``: the part names are exactly ``names``, or there are ``count`` of them.
- ``solids``: ``part`` has ``count`` solids.
- ``size``: the box of ``part`` along ``axis`` (x, y or z) is ``expect`` within ``tol``.
- ``ratio``: the box of ``part`` along ``axis`` over that along ``over`` is ``expect`` within ``tol``.
- ``volume``: the volume of ``part`` is within ``min`` and ``max`` (mm³).
- ``clearance``: the least distance between ``a`` and ``b`` is at least ``min`` (and at most ``max`` if given).
- ``overlap``: the volume ``a`` and ``b`` share is at most ``max`` (0 by default).
- ``hole``: ``part`` has at least ``count`` (1) cylindrical holes of diameter ``diameter`` within ``tol``, through
  the part when ``through`` is true, blind when false, either when absent; with ``near`` ([x, y, z]) only those whose
  axis passes within ``within`` (1 mm) of that point.

This file runs a model: it is given only a temporary copy of a case, never a person's workspace.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any

TOL = 0.01


def _load(folder: Path) -> dict[str, dict[str, Any]]:
    from torno_kernel.loader import choose_model, load_scene

    return load_scene(folder, choose_model(folder).name)


def _box(shape: Any) -> tuple[tuple[float, float, float], bool]:
    """The part's box as torno tells it (`extent.box`), and whether it is exact (`extent.boxed_exactly`)."""
    from torno_kernel import extent

    lo, hi = extent.box(shape)
    return (hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]), extent.boxed_exactly(shape)


def _axis(name: str) -> int:
    return "xyz".index(name.lower())


def _holes(shape: Any) -> list[dict[str, Any]]:
    """The inner cylindrical faces of a shape: their diameter, and whether each runs through its box along its axis."""
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.GeomAbs import GeomAbs_Cylinder
    from OCP.TopAbs import TopAbs_REVERSED

    box = shape.bounding_box()
    holes = []
    for face in shape.faces():
        surface = BRepAdaptor_Surface(face.wrapped)
        if surface.GetType() != GeomAbs_Cylinder:
            continue
        cylinder = surface.Cylinder()
        axis = cylinder.Axis()
        d = axis.Direction()
        normal = face.normal_at(face.center())
        centre = face.center()
        location = axis.Location()
        # From the axis out to the surface: outward on a boss, inward (toward the axis) on a hole.
        t = (centre.X - location.X()) * d.X() + (centre.Y - location.Y()) * d.Y() + (centre.Z - location.Z()) * d.Z()
        foot = (location.X() + t * d.X(), location.Y() + t * d.Y(), location.Z() + t * d.Z())
        out = (centre.X - foot[0], centre.Y - foot[1], centre.Z - foot[2])
        inward = out[0] * normal.X + out[1] * normal.Y + out[2] * normal.Z < 0
        if face.wrapped.Orientation() == TopAbs_REVERSED and not inward:
            inward = True
        if not inward:
            continue
        direction = (abs(d.X()), abs(d.Y()), abs(d.Z()))
        along = max(range(3), key=lambda i: direction[i])
        aligned = direction[along] > 1 - 1e-6
        fb = face.bounding_box()
        lo, hi = (box.min.X, box.min.Y, box.min.Z), (box.max.X, box.max.Y, box.max.Z)
        flo, fhi = (fb.min.X, fb.min.Y, fb.min.Z), (fb.max.X, fb.max.Y, fb.max.Z)
        through = aligned and abs(flo[along] - lo[along]) < 1e-3 and abs(fhi[along] - hi[along]) < 1e-3
        holes.append({"diameter": 2 * cylinder.Radius(), "through": through, "axis": ((location.X(), location.Y(), location.Z()), (d.X(), d.Y(), d.Z()))})
    return holes


def _off_axis(point: list[float], origin: tuple[float, ...], direction: tuple[float, ...]) -> float:
    """How far a point is from a line through ``origin`` along the unit ``direction``."""
    v = [point[i] - origin[i] for i in range(3)]
    t = sum(v[i] * direction[i] for i in range(3))
    return math.sqrt(max(0.0, sum(x * x for x in v) - t * t))


def _one(check: dict[str, Any], scene: dict[str, dict[str, Any]]) -> dict[str, Any]:
    kind = check["kind"]
    layout = check.get("layout") or next(iter(scene))
    if layout not in scene:
        raise KeyError(f"no layout {layout!r} (has {', '.join(scene)})")
    parts = scene[layout]
    tol = float(check.get("tol", TOL))

    def part(key: str = "part") -> Any:
        name = check[key]
        if name not in parts:
            raise KeyError(f"no part {name!r} in {layout} (has {', '.join(sorted(parts))})")
        return parts[name]

    if kind == "valid":
        shapes = [part()] if "part" in check else list(parts.values())
        value = all(s.is_valid for s in shapes)
        return {"pass": value, "value": value, "expect": True, "exact": True}
    if kind == "parts":
        names = sorted(parts)
        if "names" in check:
            return {"pass": names == sorted(check["names"]), "value": names, "expect": sorted(check["names"]), "exact": True}
        return {"pass": len(names) == check["count"], "value": len(names), "expect": check["count"], "exact": True}
    if kind == "solids":
        value = len(part().solids())
        return {"pass": value == check["count"], "value": value, "expect": check["count"], "exact": True}
    if kind == "size":
        size, exact = _box(part())
        value = size[_axis(check["axis"])]
        return {"pass": abs(value - check["expect"]) <= tol, "value": value, "expect": check["expect"], "exact": exact}
    if kind == "ratio":
        size, exact = _box(part())
        value = size[_axis(check["axis"])] / size[_axis(check["over"])]
        return {"pass": abs(value - check["expect"]) <= tol, "value": value, "expect": check["expect"], "exact": exact}
    if kind == "volume":
        from torno_kernel import extent

        told = extent.volume(part())
        value = told.value
        # A solid turned inside out is a broken part, whatever its size.
        ok = not told.reversed and check.get("min", -math.inf) <= value <= check.get("max", math.inf)
        return {"pass": ok, "value": value, "expect": [check.get("min"), check.get("max")], "exact": told.exact}
    if kind == "clearance":
        value = part("a").distance_to(part("b"))
        ok = value >= check.get("min", 0) - 1e-9 and value <= check.get("max", math.inf)
        return {"pass": ok, "value": value, "expect": [check.get("min", 0), check.get("max")], "exact": True}
    if kind == "overlap":
        common = part("a").intersect(part("b"))
        value = common.volume if common is not None else 0.0
        return {"pass": value <= check.get("max", 0) + 1e-6, "value": value, "expect": check.get("max", 0), "exact": True}
    if kind == "hole":
        found = [h for h in _holes(part()) if abs(h["diameter"] - check["diameter"]) <= tol]
        if "near" in check:
            found = [h for h in found if _off_axis(check["near"], *h["axis"]) <= check.get("within", 1.0)]
        if "through" in check:
            found = [h for h in found if h["through"] == check["through"]]
        want = check.get("count", 1)
        return {"pass": len(found) >= want, "value": len(found), "expect": want, "exact": True}
    raise ValueError(f"no check of kind {kind!r}")


def score(folder: Path, checks: list[dict[str, Any]]) -> dict[str, Any]:
    try:
        scene = _load(folder)
    except Exception as e:  # the model did not load: every check fails, the build apart
        error = getattr(e, "message", None) or str(e)
        return {"build": {"ok": False, "error": error[:2000]}, "checks": [{"id": c.get("id", c["kind"]), "kind": c["kind"], "pass": False, "error": "no build"} for c in checks]}
    results = []
    for check in checks:
        head = {"id": check.get("id", check["kind"]), "kind": check["kind"]}
        try:
            results.append({**head, **_one(check, scene)})
        except Exception as e:
            results.append({**head, "pass": False, "error": str(e)[:500]})
    return {"build": {"ok": True}, "checks": results}


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    folder = Path(argv[1]).resolve()
    checks = json.loads(Path(argv[2]).read_text())
    # A model's own prints go to stderr: stdout is the one JSON line.
    real, sys.stdout = sys.stdout, sys.stderr
    try:
        result = score(folder, checks)
    finally:
        sys.stdout = real
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
