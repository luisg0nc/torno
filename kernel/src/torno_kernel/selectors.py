"""A build123d selector that picks a face or an edge of a part now, for ``describe``.

A face or an edge is named by a ref (``lid/F12``) that the next build may renumber, while the model must pick it in
code, and an agent writes that selector by hand from a descriptor ("plane, normal +Z, z = 20"). Here the kernel
tries a short list of forms on the part as it was built, from the most robust to the least, and gives the first
that picks exactly that shape and no other:

1. its type, or its direction (``filter_by(Axis.Z)``: the planar faces across Z, the lines along it), when that
   alone picks it;
2. the extreme of those along an axis (``sort_by(Axis.Z)[-1]``), when no other is as far along it, or the extreme
   along one axis and then along another among those that tie (``group_by(Axis.X)[0].sort_by(Axis.Y)[-1]``);
3. a value it has: where it is, its radius, its area or length, alone or with an extreme;
4. its place in the sort along an axis (``sort_by(Axis.X)[2]``), told ``by order``: the next edit may break it.

Each form is the text of an expression on ``part``, evaluated here with build123d on the part's own shape and kept
only if the result is that one shape. The worker evaluates expressions it made itself and nothing else: the text is
put together from a fixed list of method names, the names of build123d's own enumerations and numbers it wrote with
``repr``; nothing of a tool's arguments is in it (the ref only says which shape). Evaluation is given a namespace
with ``part``, ``Axis``, ``GeomType``, ``Vector`` and ``abs``, and no builtins.

Each form that stands on geometry is also a **structured form**, plain JSON: ``{"of": "faces" | "edges", "prefix":
..., "terminal": ...}``, the same pair the search tried. The text is written from the form alone (``expression_of``),
and a form that came back from outside (a file the person's git carries) is checked field by field against a fixed
list (``parse_form``) before anything is made of it: the kernel never evaluates a text it did not make. Forms
``by order`` are never answered: they can name the wrong face silently.

The selector is of the part as it stands in the layout asked, in that layout's frame. A selector found is checked on
this build only.
"""

import math
import time
from collections.abc import Callable
from typing import Any

# Seconds the search may take of its query's 30: each candidate is a pass over the part's faces or edges.
BUDGET = 10.0
# Two coordinates this close along an axis (mm) are a tie: an extreme or a place in a sort between them is not told.
TIE = 1e-5
# How close a coordinate, a radius, an area or a length must be to the one told (mm, mm², relative for the last two).
CLOSE = 1e-3
_AXES = "XYZ"
# The forms that stand on a value tell it as written to this many decimals: well inside CLOSE.
_DECIMALS = 4

BY_GEOMETRY = "by geometry"
BY_ORDER = "by order"

# Seconds the selectors of several faces of one part may take, all together, of their query's 30.
SELECTORS_BUDGET = 20.0
# No number of a form is further from 0 than this: sums of larger ones overflow, and none is a size in mm.
_FARTHEST = 1e9


def selector_for(
    part: Any, target: Any, kind: str, budget: float = BUDGET, clock: Callable[[], float] = time.monotonic
) -> dict[str, Any]:
    """``{"selector": {...}}`` with the ``expression`` (on ``part``), how ``robust`` it is (``by geometry`` or ``by
    order``), what it was ``checked`` on and, for ``by geometry``, the ``form`` it was written from; or ``{"selector": None, "selectorWhy": ...}`` when no form picks only
    this shape in the time given. ``part`` is the build123d shape the ref is of, ``target`` the TopoDS face or edge,
    ``kind`` ``face`` or ``edge``."""
    try:
        return _Search(part, target, kind, clock() + max(0.0, budget), clock).run()
    except Exception as e:  # a selector that cannot be made is none: describe still answers
        return {"selector": None, "selectorWhy": f"no selector could be made of it ({type(e).__name__})"}


class _Part:
    """Stands for the part in an evaluated expression: its faces and edges are taken once, and every selection
    makes a new list, so the same list serves each candidate."""

    def __init__(self, part: Any) -> None:
        self._part = part
        self._cache: dict[str, Any] = {}

    def faces(self) -> Any:
        if "faces" not in self._cache:
            self._cache["faces"] = self._part.faces()
        return self._cache["faces"]

    def edges(self) -> Any:
        if "edges" not in self._cache:
            self._cache["edges"] = self._part.edges()
        return self._cache["edges"]


class _Search:
    def __init__(self, part: Any, target: Any, kind: str, deadline: float, clock: Callable[[], float]) -> None:
        from build123d import Edge, Face, GeomType

        self.kind = kind
        self.target = target
        self.shape = Face(target) if kind == "face" else Edge(target)
        self.deadline = deadline
        self.clock = clock
        self.globals: dict[str, Any] = namespace(part)
        self.GeomType = GeomType
        self.prefixes: dict[str, list[Any] | None] = {}
        self.cut_short = False

    # The facts of the target that the forms are made of

    def facts(self) -> dict[str, Any]:
        shape = self.shape
        center = shape.center()
        facts: dict[str, Any] = {
            "type": shape.geom_type.name,
            "center": (float(center.X), float(center.Y), float(center.Z)),
            "axis": None,
            "radius": None,
            "size": None,
        }
        facts["axis"] = self._axis_of(shape)
        if facts["type"] in ("CYLINDER", "SPHERE", "CIRCLE"):
            try:
                radius = shape.radius
                facts["radius"] = None if radius is None else float(radius)
            except Exception:
                pass
        try:
            facts["size"] = float(shape.area if self.kind == "face" else shape.length)
        except Exception:
            pass
        return facts

    def _axis_of(self, shape: Any) -> int | None:
        """The axis a planar face is across or a line runs along, if one."""
        try:
            if self.kind == "face":
                if shape.geom_type.name != "PLANE":
                    return None
                direction = shape.normal_at()
            else:
                if shape.geom_type.name != "LINE":
                    return None
                direction = shape.tangent_at(0.5)
            components = (abs(direction.X), abs(direction.Y), abs(direction.Z))
        except Exception:
            return None
        for index, component in enumerate(components):
            if component > 1 - 1e-6:
                return index
        return None

    # The search

    def run(self) -> dict[str, Any]:
        facts = self.facts()
        for tier, steps in self._candidates(facts):
            if self.clock() >= self.deadline:
                self.cut_short = True
                break
            try:
                found = self._try(steps)
            except Exception:
                found = None  # a form that cannot be evaluated here is no form
            if found is not None:
                selector: dict[str, Any] = {
                    "expression": expression_of(found),
                    "robust": tier,
                    "checked": "this build only",
                }
                if tier == BY_GEOMETRY:
                    selector["form"] = found
                return {"selector": selector}
        why = (
            "the search for one ran out of time"
            if self.cut_short
            else f"no selector picks only this {self.kind}: others are as far along every axis, or have the same size"
        )
        return {"selector": None, "selectorWhy": why}

    def _candidates(self, facts: dict[str, Any]) -> Any:
        """The forms to try, as ``(robust, form)``, the most robust first. A form is a prefix (a selection) and a
        terminal (how one is taken of it): ``{"only": True}``, ``{"end": axis, "at": 0 or -1}``, ``{"group": ...}``
        or, ``by order`` only, ``{"order": axis}`` whose index ``_try`` finds."""
        of = "faces" if self.kind == "face" else "edges"
        gtype, axis, radius, size = facts["type"], facts["axis"], facts["radius"], facts["size"]
        by_type = {"by": "type", "type": gtype}
        by_axis = None if axis is None else {"by": "axis", "axis": axis}
        at = {"by": "at", "type": gtype, "center": list(facts["center"])}
        by_radius = None if radius is None else {"by": "radius", "type": gtype, "radius": radius}
        by_size = None
        if size is not None:
            by_size = {"by": "size", "type": gtype, "size": size, "within": max(CLOSE, abs(size) * 1e-4)}
        # The axes to sort along: the one it is across or along first, then Z, X, Y.
        axes = list(dict.fromkeys([a for a in (axis, 2, 0, 1) if a is not None]))

        def form(prefix: dict[str, Any], terminal: dict[str, Any]) -> dict[str, Any]:
            return {"of": of, "prefix": prefix, "terminal": terminal}

        # 1. Type and direction, when that alone picks it.
        for prefix in (by_axis, by_type):
            if prefix:
                yield BY_GEOMETRY, form(prefix, {"only": True})
        # 2. The extreme of those along an axis.
        for prefix in (by_axis, by_type):
            if prefix:
                for a in axes:
                    for end in (-1, 0):
                        yield BY_GEOMETRY, form(prefix, {"end": a, "at": end})
        for prefix in (by_axis, by_type):
            if prefix:
                for a in axes:
                    for b in axes:
                        if a != b:
                            for end in (-1, 0):
                                for end2 in (-1, 0):
                                    yield BY_GEOMETRY, form(prefix, {"group": a, "at": end, "then": b, "thenAt": end2})
        # 3. A value it has: where it is, its radius, its size, alone or with an extreme.
        for prefix in (at, by_radius, by_size):
            if prefix:
                yield BY_GEOMETRY, form(prefix, {"only": True})
        for prefix in (by_radius, by_size):
            if prefix:
                for a in axes:
                    for end in (-1, 0):
                        yield BY_GEOMETRY, form(prefix, {"end": a, "at": end})
        for prefix in (by_radius, by_size):
            if prefix:
                for a in axes:
                    for b in axes:
                        if a != b:
                            for end in (-1, 0):
                                for end2 in (-1, 0):
                                    yield BY_GEOMETRY, form(prefix, {"group": a, "at": end, "then": b, "thenAt": end2})
        # 4. Its place in a sort: the next edit may change it.
        for prefix in (by_axis, by_radius, by_type, by_size):
            if prefix:
                for a in axes:
                    yield BY_ORDER, form(prefix, {"order": a})

    def _selection(self, prefix: str) -> list[Any] | None:
        """The shapes a selection gives, or None when the target is not among them (nothing built on it can pick it)."""
        if prefix not in self.prefixes:
            items = list(eval(prefix, self.globals))  # noqa: S307 - the text is made here, of nothing a caller gave
            self.prefixes[prefix] = items if any(self._is_target(s) for s in items) else None
        return self.prefixes[prefix]

    def _is_target(self, shape: Any) -> bool:
        return bool(shape.wrapped.IsSame(self.target))

    def _try(self, form: dict[str, Any]) -> dict[str, Any] | None:
        """The form, with the index of a place in a sort filled in, when its expression picks exactly the target."""
        prefix = prefix_expression(form["of"], form["prefix"])
        terminal = form["terminal"]
        items = self._selection(prefix)
        if items is None:
            return None
        if "only" in terminal:
            return form if len(items) == 1 and self._picks(expression_of(form)) else None
        if len(items) < 2:
            return None
        mine = next(i for i, s in enumerate(items) if self._is_target(s))
        if "group" in terminal:
            return form if _group_ok(items, mine, terminal) and self._picks(expression_of(form)) else None
        axis = terminal.get("end", terminal.get("order"))
        keys = [_coordinate(s, axis) for s in items]
        # A tie with any other makes a place in the sort, or an end of it, arbitrary.
        if any(abs(k - keys[mine]) <= TIE for i, k in enumerate(keys) if i != mine):
            return None
        rank = sum(1 for k in keys if k < keys[mine])
        if "end" in terminal:
            if rank != (0 if terminal["at"] == 0 else len(items) - 1):
                return None
            made = form
        else:
            index = rank if rank <= len(items) - 1 - rank else rank - len(items)
            made = {**form, "terminal": {"order": axis, "index": index}}
        return made if self._picks(expression_of(made)) else None

    def _picks(self, expression: str) -> bool:
        """Whether the expression, evaluated, gives this shape. The check of every form: what is told is what it did."""
        try:
            return self._is_target(eval(expression, self.globals))  # noqa: S307 - as above
        except Exception:
            return False


def _end_ok(items: list[Any], mine: int, axis: int, at: int) -> bool:
    """Whether item ``mine`` is the end ``at`` (0 or -1) of the items along ``axis`` and no other is as far along it
    (``TIE``): an end that ties with another is arbitrary, and is no pick."""
    keys = [_coordinate(s, axis) for s in items]
    if any(abs(k - keys[mine]) <= TIE for i, k in enumerate(keys) if i != mine):
        return False
    rank = sum(1 for k in keys if k < keys[mine])
    return rank == (0 if at == 0 else len(items) - 1)


def _group_ok(items: list[Any], mine: int, terminal: dict[str, Any]) -> bool:
    """Whether item ``mine`` is the extreme along ``then`` of the group that is the extreme along ``group``: both
    ends strict, the group a part of the items and not all of them."""
    a, end, b, end2 = terminal["group"], terminal["at"], terminal["then"], terminal["thenAt"]
    keys = [_coordinate(s, a) for s in items]
    group = [i for i, k in enumerate(keys) if abs(k - keys[mine]) <= TIE]
    outside = [keys[i] for i in range(len(items)) if i not in group]
    if not outside:
        return False
    if end == 0 and any(k <= keys[mine] + TIE for k in outside):
        return False
    if end == -1 and any(k >= keys[mine] - TIE for k in outside):
        return False
    across = {i: _coordinate(items[i], b) for i in group}
    if any(abs(k - across[mine]) <= TIE for i, k in across.items() if i != mine):
        return False
    return len(group) >= 2 and across[mine] == (min if end2 == 0 else max)(across.values())


def _coordinate(shape: Any, axis: int) -> float:
    center = shape.center()
    return float((center.X, center.Y, center.Z)[axis])


def _n(value: float) -> str:
    """A number as the expression writes it: to ``_DECIMALS`` decimals, no trailing zeros, never ``-0``."""
    text = f"{round(float(value), _DECIMALS):.{_DECIMALS}f}".rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


# The form: what a selector by geometry is made of, its text, and what is accepted back


def namespace(part: Any) -> dict[str, Any]:
    """What an expression is evaluated with: ``part`` (its faces and edges taken once), ``Axis``, ``GeomType``,
    ``Vector`` and ``abs``, and no builtins."""
    from build123d import Axis, GeomType, Vector

    return {
        "__builtins__": {"abs": abs},
        "part": _Part(part),
        "Axis": Axis,
        "GeomType": GeomType,
        "Vector": Vector,
    }


def prefix_expression(of: str, prefix: dict[str, Any]) -> str:
    """The text of a selection: the part's faces or edges, filtered. Written from numbers and names of the list
    only: a form that has not been through ``parse_form`` is not given to it unless the kernel made it."""
    var = "f" if of == "faces" else "e"
    base = f"part.{of}()"
    by = prefix["by"]
    if by == "axis":
        return f"{base}.filter_by(Axis.{_AXES[prefix['axis']]})"
    by_type = f"{base}.filter_by(GeomType.{prefix['type']})"
    if by == "type":
        return by_type
    if by == "at":
        x, y, z = prefix["center"]
        return f"{by_type}.filter_by(lambda {var}: ({var}.center() - Vector({_n(x)}, {_n(y)}, {_n(z)})).length < {CLOSE:g})"
    if by == "radius":
        return f"{by_type}.filter_by(lambda {var}: abs({var}.radius - {_n(prefix['radius'])}) < {CLOSE:g})"
    quantity = "area" if of == "faces" else "length"
    return f"{by_type}.filter_by(lambda {var}: abs({var}.{quantity} - {_n(prefix['size'])}) < {_n(prefix['within'])})"


def terminal_expression(terminal: dict[str, Any]) -> str:
    """What a terminal adds to a selection: the index, or the sort and the index, or the group, the sort and both."""
    if "only" in terminal:
        return "[0]"
    if "end" in terminal:
        return f".sort_by(Axis.{_AXES[terminal['end']]})[{terminal['at']}]"
    if "group" in terminal:
        return (
            f".group_by(Axis.{_AXES[terminal['group']]})[{terminal['at']}]"
            f".sort_by(Axis.{_AXES[terminal['then']]})[{terminal['thenAt']}]"
        )
    return f".sort_by(Axis.{_AXES[terminal['order']]})[{terminal['index']}]"


def expression_of(form: dict[str, Any]) -> str:
    """The text of the expression on ``part`` a form says, written by the same helpers the search uses: the text
    the search answered for it, byte for byte."""
    return prefix_expression(form["of"], form["prefix"]) + terminal_expression(form["terminal"])


def parse_form(raw: Any, kind: str) -> dict[str, Any] | None:
    """``raw`` as a form of a ``face`` or an ``edge``, checked field by field against the grammar below, or None.

    The prefixes are ``type``, ``axis``, ``at``, ``radius`` and ``size``; the terminals ``only``, ``end`` and
    ``group``. An axis is 0 to 2, an end 0 or -1, a type a name of ``GeomType``, a number finite and within
    ``_FARTHEST``. Nothing else is in a form: a key not listed refuses it, and so does a terminal ``by order``
    (the search makes one, and never answers it). The answer is a copy, of the kernel's own types. Never raises.
    """
    try:
        return _parse_form(raw, kind)
    except Exception:
        return None


def _parse_form(raw: Any, kind: str) -> dict[str, Any] | None:
    of = {"face": "faces", "edge": "edges"}.get(kind)
    if of is None or not _keys(raw, {"of", "prefix", "terminal"}) or raw["of"] != of:
        return None
    prefix = _parse_prefix(raw["prefix"])
    terminal = _parse_terminal(raw["terminal"])
    if prefix is None or terminal is None:
        return None
    return {"of": of, "prefix": prefix, "terminal": terminal}


def _keys(value: Any, keys: set[str]) -> bool:
    return isinstance(value, dict) and set(value) == keys


def _is_number(value: Any) -> bool:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value) and abs(value) <= _FARTHEST
    except OverflowError:
        return False


def _is_axis(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 2


def _is_end(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value in (0, -1)


def _is_type(value: Any) -> bool:
    from build123d import GeomType

    return isinstance(value, str) and value in GeomType.__members__


def _parse_prefix(raw: Any) -> dict[str, Any] | None:
    by = raw.get("by") if isinstance(raw, dict) else None
    if by == "type" and _keys(raw, {"by", "type"}) and _is_type(raw["type"]):
        return {"by": "type", "type": raw["type"]}
    if by == "axis" and _keys(raw, {"by", "axis"}) and _is_axis(raw["axis"]):
        return {"by": "axis", "axis": raw["axis"]}
    if by == "at" and _keys(raw, {"by", "type", "center"}) and _is_type(raw["type"]):
        center = raw["center"]
        if isinstance(center, list) and len(center) == 3 and all(_is_number(c) for c in center):
            return {"by": "at", "type": raw["type"], "center": [float(c) for c in center]}
    if by == "radius" and _keys(raw, {"by", "type", "radius"}) and _is_type(raw["type"]) and _is_number(raw["radius"]):
        return {"by": "radius", "type": raw["type"], "radius": float(raw["radius"])}
    if (
        by == "size"
        and _keys(raw, {"by", "type", "size", "within"})
        and _is_type(raw["type"])
        and _is_number(raw["size"])
        and _is_number(raw["within"])
        and raw["within"] > 0
    ):
        return {"by": "size", "type": raw["type"], "size": float(raw["size"]), "within": float(raw["within"])}
    return None


def _parse_terminal(raw: Any) -> dict[str, Any] | None:
    if _keys(raw, {"only"}) and raw["only"] is True:
        return {"only": True}
    if _keys(raw, {"end", "at"}) and _is_axis(raw["end"]) and _is_end(raw["at"]):
        return {"end": raw["end"], "at": raw["at"]}
    if (
        _keys(raw, {"group", "at", "then", "thenAt"})
        and _is_axis(raw["group"])
        and _is_axis(raw["then"])
        and raw["group"] != raw["then"]
        and _is_end(raw["at"])
        and _is_end(raw["thenAt"])
    ):
        return {"group": raw["group"], "at": raw["at"], "then": raw["then"], "thenAt": raw["thenAt"]}
    return None


class Evaluator:
    """Gives the face or the edge a form picks on a part, evaluating the text ``expression_of`` writes of it and of
    nothing else. A selection is worked out once, however many forms share it."""

    def __init__(self, part: Any) -> None:
        self.globals = namespace(part)
        self._items: dict[str, Any] = {}

    def _selection(self, of: str, prefix: dict[str, Any]) -> Any:
        text = prefix_expression(of, prefix)
        if text not in self._items:
            try:
                self._items[text] = eval(text, self.globals)  # noqa: S307 - the text is written here
            except Exception:
                self._items[text] = None
        return self._items[text]

    def pick(self, form: dict[str, Any]) -> Any | None:
        """The build123d face or edge of the form (one that ``parse_form`` gave), or None when it picks none, when
        a prefix that is to give one gives more, or when its end or group is a tie with another (an extreme that
        two share is arbitrary, and no pick; the checks the search made when it found the form)."""
        from build123d import Edge, Face

        try:
            items = self._selection(form["of"], form["prefix"])
            terminal = form["terminal"]
            if items is None:
                return None
            if "only" in terminal:
                picked = items[0] if len(items) == 1 else None
            else:
                picked = eval("items" + terminal_expression(terminal), {**self.globals, "items": items})  # noqa: S307 - as above
                mine = next((i for i, s in enumerate(items) if s.wrapped.IsSame(picked.wrapped)), None)
                if mine is None:
                    return None
                if "end" in terminal and not _end_ok(items, mine, terminal["end"], terminal["at"]):
                    return None
                if "group" in terminal and not _group_ok(items, mine, terminal):
                    return None
        except Exception:
            return None
        return picked if isinstance(picked, Face if form["of"] == "faces" else Edge) else None


# The query: the forms of several faces and edges of one part in one pass


def selectors_of(
    shapes: dict[str, Any],
    layout: str,
    refs: Any,
    kept: dict[Any, Any] | None = None,
    budget: float | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> dict[str, Any]:
    """``{"selectors": [...]}``, one entry for each of ``refs`` (``part/F<i>`` or ``part/E<i>``, of one part of
    ``layout``, no layout in front), in order: its ``ref``, ``type`` (a ``GeomType`` name), ``center`` and, of a
    face, ``normal`` there, and its ``selector`` (``selector_for``) or None with ``selectorWhy``.

    ``center`` is a point of the face or the edge itself, the one nearest its centre (which is its centre for a face
    that has it, and for an edge its middle), so that the point finds it again, which the centre of a hole's wall or
    of a circle would not. All the refs share ``SELECTORS_BUDGET`` seconds; those not begun when it is out are told
    ``out of time``."""
    from build123d import Edge, Face

    from . import queries
    from .queries import QueryError

    if not isinstance(layout, str) or not isinstance(refs, list) or not all(isinstance(r, str) for r in refs):
        raise QueryError("bad_request", "selectors needs args.layout, a string, and args.refs, a list of strings")
    parsed = [queries.subshape(ref) for ref in refs]
    parts = sorted({part for part, _, _ in parsed})
    if len(parts) > 1:
        raise QueryError("bad_request", f"selectors takes the refs of one part, not of {', '.join(parts)}")
    queries.need_layout(shapes, layout)
    for part in parts:
        queries.need_part(shapes, layout, part)
    surfaces: dict[Any, Any] | None = kept
    deadline = clock() + max(0.0, SELECTORS_BUDGET if budget is None else budget)
    told = []
    for ref, (part, letter, index) in zip(refs, parsed):
        key = f"{layout}:{part}"
        surface = queries.surface_of(shapes, key, surfaces)
        entry: dict[str, Any] = {"ref": ref}
        try:
            topods = surface.face_shape(key, index) if letter == "F" else surface.edge_shape(key, index)
        except QueryError:
            # A ref the build no longer has: that entry says so, and the others are answered all the same.
            what = "face" if letter == "F" else "edge"
            told.append({"ref": ref, "selector": None, "selectorWhy": f"the part has no {what} {letter}{index}"})
            continue
        if letter == "F":
            shape = Face(topods)
            entry["type"] = shape.geom_type.name
            center = shape.center()
            entry["center"] = [float(center.X), float(center.Y), float(center.Z)]
            at = surface.face_at(index, entry["center"])
            if at is not None:
                entry["center"] = at[1]
                if at[2] is not None:
                    entry["normal"] = at[2]
        else:
            shape = Edge(topods)
            entry["type"] = shape.geom_type.name
            try:
                middle = shape.position_at(0.5)
            except Exception:
                middle = shape.center()
            entry["center"] = [float(middle.X), float(middle.Y), float(middle.Z)]
        remaining = deadline - clock()
        if remaining <= 0:
            entry.update({"selector": None, "selectorWhy": "out of time"})
        else:
            kind = "face" if letter == "F" else "edge"
            entry.update(selector_for(shapes[key], topods, kind, min(BUDGET, remaining), clock))
        told.append(entry)
    return {"selectors": told}
