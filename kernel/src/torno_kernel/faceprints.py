"""``face_prints``: what each face of a layout is, to be held against the same faces of another build.

A value of the model's ``Params`` is nudged in a trial (a worker thrown away) and this is asked of the build on show
and of the trial. Each face is told as a print: its type, area, centre, outward normal there and box, in the object
frame of the layout, in the kernel's order of faces (``topo.faces``). The kernel only tells what each build is; the
comparison is main's, which holds both answers (``main/drives/compare.ts``). The kernel never holds two builds.
"""

from typing import Any

from . import extent, queries, topo
from .queries import QueryError


def face_prints(shapes: dict[str, Any], args: dict[str, Any]) -> dict[str, Any]:
    """``{"parts": {name: [print, ...]}}`` for the parts of ``args.layout``; a print is ``{"type", "area",
    "center", "normal", "box"}`` (``normal`` None where the face has none; ``box`` is ``[low, high]``)."""
    layout = args.get("layout")
    if not isinstance(layout, str):
        raise QueryError("bad_request", "face_prints needs args.layout, a string")
    queries.need_layout(shapes, layout)
    prefix = f"{layout}:"
    parts: dict[str, list[dict[str, Any]]] = {}
    for key, shape in shapes.items():
        if key.startswith(prefix):
            parts[key[len(prefix) :]] = [_print(face) for face in topo.faces(shape)]
    return {"parts": parts}


def _print(topods_face: Any) -> dict[str, Any]:
    from build123d import Face

    face = Face(topods_face)
    center = face.center()
    try:
        normal = queries._xyz(face.normal_at(center))
    except Exception:
        normal = None
    low, high = face.bounding_box().min, face.bounding_box().max
    return {
        "type": face.geom_type.name.lower(),
        "area": extent.area_at_a_glance(topods_face).value,
        "center": queries._xyz(center),
        "normal": normal,
        "box": [queries._xyz(low), queries._xyz(high)],
    }
