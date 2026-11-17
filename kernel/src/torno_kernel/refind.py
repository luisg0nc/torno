"""``refind``: faces and edges a person once pointed at, found again on the build as it is now.

A stored member is what torno kept of a face or an edge: the structured form of its selector (``selectors.py``), its
type, a point on it and, of a face, its outward normal there. A rebuild may renumber the faces and move them, and
this finds each again, in this order:

1. **by its selector.** The form is checked field by field (``selectors.parse_form``; one that fails is no form),
   its text is written by the kernel from the form and evaluated on the part as it stands in the layout, and the
   face or edge it gives is taken only if it is still what was stored: a face of the same surface type whose normal,
   at the point of it nearest the stored point, is within ``NORMAL_DEGREES`` of the stored normal; an edge of the
   same type. A prefix that gives more than one shape, where it is to give one, picks none.
2. **by its point and normal.** The nearest face within ``within`` mm of the stored point whose normal there is
   within ``NORMAL_DEGREES`` of the stored one; the nearest edge within ``within`` mm of the point.
3. else it is **lost**, and the caller keeps its last point and normal.

The kernel evaluates only the text it wrote itself (``selectors.Evaluator``); nothing of the member is in it but
numbers it has checked and names of ``GeomType``.
"""

import time
from collections.abc import Callable
from typing import Any

from . import queries, selectors
from .queries import QueryError

# How far a face's normal may be from the stored one (degrees) for it to be the same face.
NORMAL_DEGREES = 10.0
# Seconds all the selectors of one query may take of its 30: past them members are found by point and normal alone.
REFIND_BUDGET = 20.0


def refind(
    shapes: dict[str, Any],
    args: dict[str, Any],
    kept: dict[Any, Any] | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> dict[str, Any]:
    """``{"members": [...]}``: for each member of ``args.members``, in order, ``found`` (``selector``, ``nearest``
    or ``lost``) and, when found, its new ``ref`` (``part/F<i>``, no layout), the ``point`` of it nearest the stored
    one, its ``normal`` there (a face's) and its ``type`` (a ``GeomType`` name); when lost, ``why``.

    A member is ``{"part", "kind": "face" | "edge", "type"?, "form"?, "point", "normal"?, "within"}``, in the object
    frame of ``layout``; ``within`` is main's tolerance, in mm. A member that is not that is a ``bad_request`` naming
    its index; a part the layout lacks is a member ``lost``."""
    layout, members = args.get("layout"), args.get("members")
    if not isinstance(layout, str) or not isinstance(members, list):
        raise QueryError("bad_request", "refind needs args.layout, a string, and args.members, a list")
    wanted = [_member(i, m) for i, m in enumerate(members)]
    deadline = clock() + REFIND_BUDGET
    evaluators: dict[str, selectors.Evaluator] = {}
    found = []
    for member in wanted:
        key = f"{layout}:{member['part']}"
        if key not in shapes:
            found.append({"found": "lost", "why": f"no part {member['part']} in layout {layout}"})
            continue
        surface = queries.surface_of(shapes, key, kept)
        form = None
        if member["form"] is not None and clock() < deadline:
            form = selectors.parse_form(member["form"], member["kind"])
        evaluator = None
        if form is not None:
            if key not in evaluators:
                evaluators[key] = selectors.Evaluator(shapes[key])
            evaluator = evaluators[key]
        one = _face if member["kind"] == "face" else _edge
        found.append(one(surface, key, member, form, evaluator))
    return {"members": found}


def _member(index: int, raw: Any) -> dict[str, Any]:
    """The member checked as ``_anchor`` checks an anchor, or a ``bad_request`` naming its index."""
    if not isinstance(raw, dict):
        raise _bad(index, "is not an object")
    part, kind, within = raw.get("part"), raw.get("kind"), raw.get("within")
    if not isinstance(part, str):
        raise _bad(index, "needs part, a string")
    if kind not in ("face", "edge"):
        raise _bad(index, "needs kind, face or edge")
    point = queries.as_point(raw.get("point"))
    if point is None:
        raise _bad(index, "needs point, three finite numbers")
    if not queries._is_coordinate(within) or within <= 0:
        raise _bad(index, "needs within, a positive, finite number of mm")
    normal = raw.get("normal")
    if normal is not None:
        normal = queries.as_point(normal)
        if normal is None or not any(normal):
            raise _bad(index, "has a normal that is not three finite numbers, one of them not 0")
    stored = raw.get("type")
    if stored is not None and not isinstance(stored, str):
        raise _bad(index, "has a type that is not a string")
    return {
        "part": part,
        "kind": kind,
        "type": stored,
        "form": raw.get("form"),
        "point": point,
        "normal": normal,
        "within": float(within),
    }


def _bad(index: int, what: str) -> QueryError:
    return QueryError("bad_request", f"member {index} of refind {what}")


def _lost(why: str) -> dict[str, Any]:
    return {"found": "lost", "why": why}


def _face(
    surface: Any, key: str, member: dict[str, Any], form: dict[str, Any] | None, evaluator: Any
) -> dict[str, Any]:
    from build123d import Face

    part, point, normal = member["part"], member["point"], member["normal"]
    if form is not None:
        picked = evaluator.pick(form)
        index = None if picked is None else surface.face_index(picked.wrapped)
        if index is not None and member["type"] == Face(surface.face_shape(key, index)).geom_type.name:
            at = surface.face_at(index, point)
            if at is not None and (normal is None or (at[2] is not None and _within(normal, at[2]))):
                return _told("selector", f"{part}/F{index}", at[1], at[2], member["type"])
    index = surface.nearest_facing(key, point, normal, member["within"], NORMAL_DEGREES)
    at = None if index is None else surface.face_at(index, point)
    if index is None or at is None:
        facing = "" if normal is None else f", facing the stored normal within {NORMAL_DEGREES:g} degrees"
        return _lost(f"no face of {part} within {member['within']:g} mm of the stored point{facing}")
    return _told("nearest", f"{part}/F{index}", at[1], at[2], _type_of(Face, surface.face_shape(key, index)))


def _edge(
    surface: Any, key: str, member: dict[str, Any], form: dict[str, Any] | None, evaluator: Any
) -> dict[str, Any]:
    from build123d import Edge

    part, point = member["part"], member["point"]
    if form is not None:
        picked = evaluator.pick(form)
        index = None if picked is None else surface.edge_index(picked.wrapped)
        if index is not None and member["type"] == _type_of(Edge, surface.edge_shape(key, index)):
            at = surface.edge_at(index, point)
            if at is not None:
                return _told("selector", f"{part}/E{index}", at[1], None, member["type"])
    index = surface.nearest_edge(key, point, member["within"])
    at = None if index is None else surface.edge_at(index, point)
    if index is None or at is None:
        return _lost(f"no edge of {part} within {member['within']:g} mm of the stored point")
    return _told("nearest", f"{part}/E{index}", at[1], None, _type_of(Edge, surface.edge_shape(key, index)))


def _told(how: str, ref: str, point: list[float], normal: list[float] | None, kind: str | None) -> dict[str, Any]:
    told: dict[str, Any] = {"found": how, "ref": ref, "point": point}
    if normal is not None:
        told["normal"] = normal
    if kind is not None:
        told["type"] = kind
    return told


def _type_of(shape_class: Any, topods: Any) -> str | None:
    """The ``GeomType`` name of a face or an edge, or None for one with no such type."""
    try:
        return str(shape_class(topods).geom_type.name)
    except Exception:
        return None


def _within(stored: list[float], now: list[float]) -> bool:
    return bool(queries._angle(stored, now) <= NORMAL_DEGREES)
