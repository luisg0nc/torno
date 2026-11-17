"""``refind``: faces and edges a person once pointed at, found again on the build as it is now.

A stored member is what torno kept of a face or an edge: the structured form of its selector (``selectors.py``), its
type, a point on it and, of a face, its outward normal there. A rebuild may renumber the faces and move them, and
this finds each again, in this order:

1. **in place.** A face of the stored type that is within ``within`` mm of the stored point and whose normal there is
   within ``NORMAL_DEGREES`` of the stored one (an edge of the stored type within ``within`` of the point) is the
   member, whatever the selector says: a boss added on top makes the selector give the boss, and a slot makes it
   give a tie. It is told ``selector`` when the selector gives the same one, else ``nearest``.
2. **by its selector**, when nothing of the type is at the stored place (the face moved). The form is checked field
   by field (``selectors.parse_form``; one that fails is no form), its text is written by the kernel from the form and
   evaluated on the part as it stands in the layout; a prefix that gives more than one shape where it is to give one,
   or an end or a group that ties with another, picks none. Its face is taken only if it is still what was stored: of
   the same surface type, with its normal at the point nearest the stored point within ``NORMAL_DEGREES`` of the
   stored one (an edge of the same type).
3. **by its point and normal alone**: the nearest face of any type within ``within`` that faces as stored; the
   nearest edge within ``within`` of the point.
4. else it is **lost**, and the caller keeps its last point and normal. Past ``REFIND_BUDGET`` the members not yet
   looked at are told ``lost`` with ``unchecked: true`` and ``why`` "not checked", not as gone.

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
            found.append(_lost(f"no part {member['part']} in layout {layout}"))
            continue
        if clock() >= deadline:
            # Out of time: this one and every one after it is not looked at, and says so, not that it is gone.
            found.append({**_lost("not checked: the query ran out of time"), "unchecked": True})
            continue
        surface = queries.surface_of(shapes, key, kept)
        if key not in evaluators:
            evaluators[key] = selectors.Evaluator(shapes[key])
        one = _face if member["kind"] == "face" else _edge
        found.append(one(surface, key, member, evaluators[key], lambda: clock() < deadline))
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
    surface: Any, key: str, member: dict[str, Any], evaluator: Any, in_time: Callable[[], bool]
) -> dict[str, Any]:
    """A face of the stored type with its normal within ``NORMAL_DEGREES`` that is still at the stored point is the
    face (the place wins over the selector: a boss or a slot makes the selector give another, or none); told
    ``selector`` when the selector agrees and ``nearest`` when not. Only when none is there is the selector's
    face taken, if it is what was stored; then the nearest face of any type that faces as stored."""
    from build123d import Face

    part, point, normal, within = member["part"], member["point"], member["normal"], member["within"]
    placed = surface.nearest_facing(key, point, normal, within, NORMAL_DEGREES, geom_type=member["type"])
    chosen = None
    form = selectors.parse_form(member["form"], "face") if member["form"] is not None else None
    if form is not None and in_time():
        picked = evaluator.pick(form)
        index = None if picked is None else surface.face_index(picked.wrapped)
        if index is not None and member["type"] == _type_of(Face, surface.face_shape(key, index)):
            at = surface.face_at(index, point)
            if at is not None and (normal is None or (at[2] is not None and _within(normal, at[2]))):
                chosen = index
    if placed is not None:
        return _answer("selector" if chosen == placed else "nearest", surface, key, part, placed, point)
    if chosen is not None:
        return _answer("selector", surface, key, part, chosen, point)
    index = surface.nearest_facing(key, point, normal, within, NORMAL_DEGREES)
    if index is None:
        facing = "" if normal is None else f", facing the stored normal within {NORMAL_DEGREES:g} degrees"
        return _lost(f"no face of {part} within {within:g} mm of the stored point{facing}")
    return _answer("nearest", surface, key, part, index, point)


def _edge(
    surface: Any, key: str, member: dict[str, Any], evaluator: Any, in_time: Callable[[], bool]
) -> dict[str, Any]:
    """As ``_face``, of an edge: one of the stored type still within ``within`` of the stored point is the edge."""
    from build123d import Edge

    part, point, within = member["part"], member["point"], member["within"]
    placed = surface.nearest_edge(key, point, within, geom_type=member["type"])
    chosen = None
    form = selectors.parse_form(member["form"], "edge") if member["form"] is not None else None
    if form is not None and in_time():
        picked = evaluator.pick(form)
        index = None if picked is None else surface.edge_index(picked.wrapped)
        if index is not None and member["type"] == _type_of(Edge, surface.edge_shape(key, index)):
            if surface.edge_at(index, point) is not None:
                chosen = index
    if placed is not None:
        return _answer("selector" if chosen == placed else "nearest", surface, key, part, placed, point, edge=True)
    if chosen is not None:
        return _answer("selector", surface, key, part, chosen, point, edge=True)
    index = surface.nearest_edge(key, point, within)
    if index is None:
        return _lost(f"no edge of {part} within {within:g} mm of the stored point")
    return _answer("nearest", surface, key, part, index, point, edge=True)


def _answer(
    how: str, surface: Any, key: str, part: str, index: int, point: list[float], edge: bool = False
) -> dict[str, Any]:
    """The told answer for a face or an edge found: its ref, the point of it nearest the stored one, its normal
    there (a face's) and its type."""
    from build123d import Edge, Face

    if edge:
        at = surface.edge_at(index, point)
        if at is None:
            return _lost(f"{part}/E{index} cannot be measured")
        return _told(how, f"{part}/E{index}", at[1], None, _type_of(Edge, surface.edge_shape(key, index)))
    face = surface.face_at(index, point)
    if face is None:
        return _lost(f"{part}/F{index} cannot be measured")
    return _told(how, f"{part}/F{index}", face[1], face[2], _type_of(Face, surface.face_shape(key, index)))


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
