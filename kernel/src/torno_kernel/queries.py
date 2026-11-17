"""Exact-geometry queries, answered by the worker that holds the built shapes."""

import math
import re
from typing import Any

from . import extent, tess, topo
from .describe import descriptor
from .ocp import (
    TopAbs_EDGE,
    TopAbs_FACE,
    TopAbs_VERTEX,
    TopExp,
    TopTools_IndexedDataMapOfShapeListOfShape,
    TopTools_IndexedMapOfShape,
)

_SUBSHAPE = re.compile(r"^(?P<key>.+)/(?P<kind>[FE])(?P<index>\d+)$")
# `lid/@top`: a face or an edge the model named (`tags(p, parts)`), with the part's key in front.
_TAGGED = re.compile(r"^(?P<key>.+)/@(?P<tag>[A-Za-z_][A-Za-z0-9_.-]*)$")
# No part has a face or an edge of a million: a longer number is not one, and
# one of thousands of digits is more than int() takes.
_INDEX_DIGITS = 6
# No coordinate is further from the origin than this, mm: sums and squares of
# larger ones overflow, and an infinity cannot be written in a reply.
FARTHEST = 1e9


class WithBlob:
    """What a query answers with bytes beside its result (``export``): the worker sends them as the reply's blob."""

    def __init__(self, result: dict[str, Any], blob: bytes) -> None:
        self.result = result
        self.blob = blob


class QueryError(Exception):
    """A query could not be answered. ``kind`` is a protocol error kind."""

    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind
        self.message = message


def run(
    shapes: dict[str, Any], name: str, args: Any, kept: dict[Any, Any] | None = None
) -> "dict[str, Any] | WithBlob":
    """Answer the query ``name`` over the shapes of the last build, by part key.

    ``kept`` is where what was worked out of a part is kept from one query to
    the next: a worker hands in the same dict for as long as it lives, which
    is as long as its shapes are the ones asked about. ``nearest`` keeps a
    part's surface under its key; the others keep theirs under a pair
    ``(what, key)``. What is said of a whole part and is slow to work out of
    a large one is among them: its ``volume`` and its ``box`` (which the build
    has already measured, ``tess.build_scene``), whether that box is its own
    (``boxed``), its ``area`` and whether it is ``valid``.
    """
    # These build on what is below, so they are imported once that is defined.
    from . import checks, measure, section

    if not isinstance(args, dict):
        args = {}
    if name == "measure":
        return measure.measure(shapes, args, kept)
    if name == "section":
        return section.section(shapes, args)
    if name == "check":
        return checks.check(shapes, args, kept)
    if name in ("scan_clash", "scan_deviation", "scan_section"):
        from . import scanclash

        return scanclash.run(name, shapes, args, kept)
    if name in ("export", "export_check"):
        from . import export

        return export.export(shapes, args, kept) if name == "export" else export.export_check(shapes, args, kept)
    if name == "features":
        from . import features

        return features.features(shapes, args, kept)
    if name == "try_fillet":
        return try_fillet(shapes, args)
    if name == "match_edges":
        return match_edges(shapes, args.get("edges"), kept)
    if name == "describe":
        ref = args.get("ref")
        if not isinstance(ref, str):
            raise QueryError("bad_request", "describe needs args.ref, a string")
        return describe(shapes, ref, kept, selector=args.get("selector") is True)
    if name == "selectors":
        from . import selectors

        return selectors.selectors_of(shapes, args.get("layout"), args.get("refs"), kept)
    if name == "refind":
        from . import refind

        return refind.refind(shapes, args, kept)
    if name == "nearest":
        layout, anchors = args.get("layout"), args.get("anchors")
        if not isinstance(layout, str) or not isinstance(anchors, list):
            raise QueryError(
                "bad_request", "nearest needs args.layout, a string, and args.anchors, a list"
            )
        return {"anchors": nearest(shapes, layout, anchors, kept)}
    raise QueryError(
        "bad_request",
        f"unknown query {name!r}; the queries are describe, nearest, measure, section, check, "
        "scan_clash, scan_deviation, scan_section, export, export_check, features, try_fillet, match_edges, "
        "selectors and refind",
    )


def describe(
    shapes: dict[str, Any], ref: str, kept: dict[Any, Any] | None = None, selector: bool = False
) -> dict[str, Any]:
    """Describe a part (``layout:name``), or one of its faces (``/F<i>``) or edges (``/E<i>``).

    Positions and directions are in the object frame. ``descriptor`` says the
    same in one line. ``kept`` is the worker's (``run``). With ``selector`` a face
    or an edge also gets a build123d selector that picks it now (``selectors``): it
    is searched for only when asked, as it costs a pass over the part.
    """
    key, kind, shape = resolve(shapes, ref, kept)
    if kind == "part":
        return _describe_part(key, shape, kept)
    tagged = _TAGGED.match(ref)
    if tagged:
        # Told by the face or edge's own ref, which is what other tools take; the tag is said beside it.
        one = tag_refs(key, tagged["tag"], kept)[0]
        ref = f"{key}{one[one.index('/'):]}"
    if kind == "face":
        told = _describe_face(ref, shape, _held(kept, "span", key, lambda: extent.span(shapes[key])))
    else:
        told = _describe_edge(ref, shape)
    if tagged:
        told["tag"] = tagged["tag"]
    if selector:
        from . import selectors

        told.update(selectors.selector_for(shapes[key], shape, kind))
    return told


# The seconds a trial fillet may take of its query's 30: OCC's tries cannot be stopped, so some are left over.
TRIAL_BUDGET = 20.0
# The most edges one trial takes.
MOST_TRIAL_EDGES = 200
# Two edges are the same when their ends and their lengths are this close, mm.
SAME_EDGE = 1e-6


def try_fillet(shapes: dict[str, Any], args: dict[str, Any]) -> dict[str, Any]:
    """A fillet (or a chamfer, ``kind``) of ``radius`` of the edges of ``part`` (``layout:name``) named by
    ``edges`` (``name/E<i>``), made and thrown away: whether it works and, when it does not, why
    (``diagnose.trial``: which edges fail alone, the pairs that fail, the largest radius that works), each edge
    told by its ref, in the object frame. The shapes are left as they were."""
    from . import diagnose

    part, edges, radius, kind = args.get("part"), args.get("edges"), args.get("radius"), args.get("kind", "fillet")
    if not isinstance(part, str):
        raise QueryError("bad_request", "try_fillet needs args.part, a part as layout:name")
    if kind not in ("fillet", "chamfer"):
        raise QueryError("bad_request", f"try_fillet makes a fillet or chamfer, not {kind!r}")
    if not isinstance(radius, (int, float)) or isinstance(radius, bool) or not math.isfinite(radius) or radius <= 0:
        raise QueryError("bad_request", "try_fillet needs a radius above 0, mm")
    if radius > FARTHEST:
        raise QueryError("bad_request", f"try_fillet takes a radius of at most {FARTHEST:g} mm")
    key, what, shape = resolve(shapes, part)
    if what != "part":
        raise QueryError("bad_request", f"try_fillet needs a part as layout:name, not {part!r}")
    need_solid(shape, key)
    if not isinstance(edges, list) or not edges:
        raise QueryError("bad_request", "try_fillet needs at least one edge, as a list of refs")
    if len(edges) > MOST_TRIAL_EDGES:
        raise QueryError("bad_request", f"try_fillet takes at most {MOST_TRIAL_EDGES} edges at a time")
    name = key.split(":", 1)[1]
    every = topo.edges(shape)
    picked: dict[str, Any] = {}
    for ref in edges:
        match = _SUBSHAPE.match(ref) if isinstance(ref, str) else None
        if not match or match["key"] != name or match["kind"] != "E":
            raise QueryError("bad_ref", f"try_fillet takes edges of {name}, named {name}/E<i>; not {ref!r}")
        picked.setdefault(ref, _pick(every, _index(match), name, "edges", "E"))
    refs = list(picked)
    return diagnose.trial(shape.wrapped, kind, list(picked.values()), float(radius), refs, TRIAL_BUDGET)


def match_edges(shapes: dict[str, Any], edges: Any, kept: dict[Any, Any] | None = None) -> dict[str, Any]:
    """Which edges of the last good build are, exactly, the edges given: for each, the refs (``layout:name/E<i>``)
    of the edges of the same curve whose ends are within ``SAME_EDGE`` of its own (either way round), whose length is
    as close, and on which every one of its ``samples`` lies within ``SAME_EDGE`` (an arc bulging the other way, a
    circle in another plane through the same seam, is none). ``edges`` are as a diagnosis tells them
    (``diagnose.describe_edge``); one told without samples matches none. An edge of a shape the build moved or
    changed matches none. Every part's edges are looked at: two parts that share an edge are both named, and
    whoever asks says which, if either, it is."""
    if not isinstance(edges, list) or not all(isinstance(e, dict) for e in edges):
        raise QueryError("bad_request", "match_edges needs args.edges, a list of edges as a diagnosis tells them")
    matches: list[list[str]] = []
    for wanted in edges:
        start, end, length = as_point(wanted.get("start")), as_point(wanted.get("end")), wanted.get("length")
        samples = wanted.get("samples")
        points = [as_point(p) for p in samples] if isinstance(samples, list) else []
        if start is None or end is None or not _is_coordinate(length) or not points or any(p is None for p in points):
            matches.append([])
            continue
        found = []
        for key, shape in shapes.items():
            for index, (a, b, edge) in enumerate(_held(kept, "edge ends", key, lambda shape=shape: _edge_ends(shape))):
                if a is None or not (_near(a, start) and _near(b, end) or _near(a, end) and _near(b, start)):
                    continue
                if _same_edge(edge, wanted.get("type"), length, points):
                    found.append(f"{key}/E{index}")
        matches.append(found)
    return {"matches": matches}


def _same_edge(edge: Any, curve: Any, length: float, points: list[list[float]]) -> bool:
    """Whether an edge whose ends are those wanted is the curve, of the length, that every point lies on."""
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex
    from OCP.BRepExtrema import BRepExtrema_DistShapeShape
    from OCP.gp import gp_Pnt

    from . import diagnose

    measured = diagnose._length(edge)
    if measured is None or abs(measured - length) > SAME_EDGE or diagnose._curve(edge) != curve:
        return False
    for point in points:
        extrema = BRepExtrema_DistShapeShape(BRepBuilderAPI_MakeVertex(gp_Pnt(*point)).Vertex(), edge)
        if not extrema.IsDone() or extrema.NbSolution() < 1 or extrema.Value() > SAME_EDGE:
            return False
    return True


def _edge_ends(shape: Any) -> list[tuple[Any, Any, Any]]:
    from . import diagnose

    return [(*diagnose.ends(edge), edge) for edge in topo.edges(shape)]


def _near(a: list[float], b: list[float]) -> bool:
    return all(abs(x - y) <= SAME_EDGE for x, y in zip(a, b, strict=True))


def resolve(shapes: dict[str, Any], ref: str, kept: dict[Any, Any] | None = None) -> tuple[str, str, Any]:
    """What ``ref`` names: its part's key, ``part``, ``face`` or ``edge``, and the shape.

    A part is the shape the model made; a face or an edge is the ``TopoDS``
    one of that index in the kernel's order (``topo``), or the one a tag of the
    model names (``part/@top``, from ``kept``, which the worker fills from the
    model's ``tags(p, parts)``; a tag of several is refused, naming them).
    Anything else is a ``bad_ref`` that names what there is.
    """
    if ref in shapes:
        return ref, "part", shapes[ref]
    tagged = _TAGGED.match(ref)
    if tagged:
        return _resolve_tag(shapes, tagged["key"], tagged["tag"], kept)
    match = _SUBSHAPE.match(ref)
    key = match["key"] if match else ref
    if key not in shapes:
        raise QueryError("bad_ref", f"no part {key!r}; the parts are {', '.join(shapes)}")
    shape = shapes[key]
    index = _index(match)
    if match["kind"] == "F":
        return key, "face", _pick(topo.faces(shape), index, key, "faces", "F")
    return key, "edge", _pick(topo.edges(shape), index, key, "edges", "E")


def tag_refs(key: str, tag: str, kept: dict[Any, Any] | None) -> list[str]:
    """The refs (``part/F<i>``, ``part/E<j>``, no layout) the tag ``tag`` of the part ``key`` names, faces first.
    A ``bad_ref`` when the part has no such tag."""
    named = (kept or {}).get(("tags", key)) or {}
    if tag not in named:
        part = key.split(":", 1)[1]
        have = ", ".join(f"@{t}" for t in named) or "no tags"
        raise QueryError("bad_ref", f"{part} has no tag @{tag}; its tags: {have}")
    part = key.split(":", 1)[1]
    return [f"{part}/F{i}" for i in named[tag].get("faces", [])] + [f"{part}/E{i}" for i in named[tag].get("edges", [])]


def _resolve_tag(shapes: dict[str, Any], key: str, tag: str, kept: dict[Any, Any] | None) -> tuple[str, str, Any]:
    if key not in shapes:
        raise QueryError("bad_ref", f"no part {key!r}; the parts are {', '.join(shapes)}")
    refs = tag_refs(key, tag, kept)
    if len(refs) != 1:
        raise QueryError("bad_ref", f"{key.split(':', 1)[1]}/@{tag} names {len(refs)} faces and edges, not one: {', '.join(refs)}")
    return resolve(shapes, f"{key}{refs[0][refs[0].index('/'):]}")


def need_layout(shapes: dict[str, Any], layout: str) -> None:
    """Refuse a layout the build does not have, naming those it has."""
    if not any(key.startswith(f"{layout}:") for key in shapes):
        layouts = list(dict.fromkeys(key.split(":", 1)[0] for key in shapes))
        raise QueryError("bad_ref", f"no layout {layout!r}; the layouts are {', '.join(layouts)}")


def need_solid(shape: Any, name: str) -> None:
    """Refuse what has no solid: it has no volume, no inside and no walls to measure."""
    if not topo.solids(shape):
        raise QueryError("bad_request", f"{name} is not a solid: it is {topo.what(shape)}")


def is_reference(kept: dict[Any, Any] | None, key: str) -> bool:
    """Whether the part ``layout:name`` is a reference (``loader.Layouts``): bought, not made. Noted by ``tess.build_scene``."""
    return bool(kept) and kept.get(("reference", key)) is True


def need_made(kept: dict[Any, Any] | None, key: str, name: str, what: str) -> None:
    """Refuse a reference where the answer is of something to make: ``what`` says what that is asked of it."""
    if is_reference(kept, key):
        raise QueryError(
            "bad_request", f"{name} is a reference (a bought part): {what} is of the parts to make, and it is not one"
        )


def need_part(shapes: dict[str, Any], layout: str, part: str) -> Any:
    """The shape of ``part`` in ``layout``, or a ``bad_ref`` naming the layout's parts."""
    need_layout(shapes, layout)
    key = f"{layout}:{part}"
    if key not in shapes:
        names = [k.split(":", 1)[1] for k in shapes if k.startswith(f"{layout}:")]
        raise QueryError("bad_ref", f"no part {part!r} in {layout}; its parts are {', '.join(names)}")
    return shapes[key]


def subshape(ref: Any) -> tuple[str, str, int]:
    """The part, the letter (``F`` or ``E``) and the index of a ref of a face or an edge without its layout
    (``lid/F12``); a ``bad_request`` for anything else."""
    match = _SUBSHAPE.match(ref) if isinstance(ref, str) else None
    if match is None:
        raise QueryError("bad_request", f"{ref!r} is not a face or an edge: its ref is part/F<i> or part/E<i>")
    return match["key"], match["kind"], _index(match)


def surface_of(shapes: dict[str, Any], key: str, kept: dict[Any, Any] | None) -> "_Surface":
    """The part ``key``'s surface (``_Surface``), taken apart once for as long as ``kept`` is (as ``nearest`` does)."""
    if kept is None:
        return _Surface(shapes[key])
    if key not in kept:
        kept[key] = _Surface(shapes[key])
    return kept[key]


def volume_of(shape: Any, key: str, kept: dict[Any, Any] | None) -> extent.Volume:
    """The volume of the part ``key`` and whether it is exact: measured once for as long as ``kept`` is."""
    return _held(kept, "volume", key, lambda: extent.volume(shape))


def area_of(shape: Any, key: str, kept: dict[Any, Any] | None) -> extent.Area:
    """The area of the part ``key`` and whether it is exact: measured once for as long as ``kept`` is."""
    return _held(kept, "area", key, lambda: extent.area(shape))


def area_at_a_glance_of(shape: Any, key: str, kept: dict[Any, Any] | None) -> extent.Area:
    """The area ``describe`` tells of the part ``key``: one integral a face, once for as long as ``kept`` is.

    An exact one is the area whoever asks: it is kept as ``area_of``'s too, and
    taken from there when that was asked first, so it is measured once. One
    that is not exact is kept apart: ``measure area`` answers from its own
    three integrals a face, and neither is ever told as the other.
    """
    if kept is not None and getattr(kept.get(("area", key)), "exact", False):
        return kept["area", key]
    area = _held(kept, "area at a glance", key, lambda: extent.area_of_all_at_a_glance(shape))
    if kept is not None and area.exact:
        kept.setdefault(("area", key), area)
    return area


def box_of(shape: Any, key: str | None, kept: dict[Any, Any] | None) -> tuple[list[float], list[float]]:
    """The least and the greatest corner of the axis-aligned box of a shape.

    Of the part ``key`` it is the box the scene tells (``tess.part_box``),
    worked out once for as long as ``kept`` is, and already by the build
    unless that would have held it up. Of a face or an edge, with no key, it
    is OCC's.
    """
    if key is None:
        return extent.box(shape)
    return _held(kept, "box", key, lambda: tess.part_box(shape))


def boxed_exactly_of(shape: Any, key: str, kept: dict[Any, Any] | None) -> bool:
    """Whether the box of the part ``key`` is its own: looked into once for as long as ``kept`` is."""
    return _held(kept, "boxed", key, lambda: extent.boxed_exactly(shape))


def valid_of(shape: Any, key: str, kept: dict[Any, Any] | None) -> bool:
    """Whether OCC finds no defect in the part ``key``: checked once for as long as ``kept`` is."""
    return _held(kept, "valid", key, lambda: bool(shape.is_valid))


def _held(kept: dict[Any, Any] | None, what: str, key: str | None, work: Any) -> Any:
    """What ``work`` makes of a part, from ``kept`` when it was made before."""
    if kept is None or key is None:
        return work()
    if (what, key) not in kept:
        kept[what, key] = work()
    return kept[what, key]


def as_point(value: Any) -> list[float] | None:
    """Three coordinates (finite, within FARTHEST) as floats, or None for anything else."""
    if isinstance(value, list) and len(value) == 3 and all(_is_coordinate(c) for c in value):
        return [float(c) for c in value]
    return None


def nearest(
    shapes: dict[str, Any],
    layout: str,
    anchors: list[Any],
    kept: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """For each anchor, the point of its part's surface nearest to it in ``layout``.

    An anchor is ``{"part": name, "point": [x, y, z]}``, in the object frame of
    that layout. The answer names the face the nearest point is on (without the
    layout: ``lid/F12``), with the point, the face's outward normal there, the
    distance between the two in mm, and the face's descriptor (null for a
    face that cannot be described). Where the nearest point is on an edge or a
    corner, the face is the adjacent one of lowest index. A part the layout
    does not have is ``found: false``. A part it has, of which nothing can be
    said for this point, is ``found: true`` with ``error``, a sentence, and
    nothing else: one such anchor does not fail the others.

    ``support`` says what the nearest point lies on: ``face``, ``edge`` or
    ``vertex``. On an edge, which is where two faces or more meet (a seam,
    where a face meets itself, counts as its face), ``edgeUnder`` is the edge
    (``lid/E40``), ``edgeUnderDescriptor`` what it is (null when it cannot be
    described) and ``between`` the faces that meet there, lowest first.

    An anchor may also name an edge of its part (``"edge": "lid/E3"``), as one
    that was put on an edge does. Its answer then says whether the part has
    that edge (``edgeFound``) and, when it has, how far the anchor's point is
    from it (``edgeDistance``, mm), what it is (``edgeDescriptor``) and the
    faces that meet at it (``edgeBetween``). Edges are numbered anew by every
    build: the distance is what tells whether the number still means the edge
    the anchor was put on.

    A face too (``"face": "lid/F12"``, the face a tag of the model names now): the answer then says whether the
    part has it (``faceFound``) and, when it does, how far the point is from it (``faceDistance``), its
    descriptor (``faceDescriptor``) and its outward normal at the nearest point (``faceNormal``) and the point of it nearest to the anchor (``facePoint``; an edge's is ``edgePoint``).

    ``kept`` holds what was worked out of each part asked about (``run``).
    """
    need_layout(shapes, layout)
    wanted = [_anchor(anchor) for anchor in anchors]
    # A part is asked about once per mark on it, and again after every build
    # of another object, every mark added: taking it apart is done once.
    surfaces: dict[str, Any] = {} if kept is None else kept
    found = []
    for part, point, edge, face in wanted:
        key = f"{layout}:{part}"
        if key not in shapes:
            found.append({"part": part, "found": False})
            continue
        if key not in surfaces:
            surfaces[key] = _Surface(shapes[key])
        try:
            answer = {"part": part, "found": True, **surfaces[key].nearest(part, key, point)}
        except QueryError as e:
            # Of this point nothing can be said; the other anchors are answered all the same.
            found.append({"part": part, "found": True, "error": e.message})
            continue
        if edge is not None:
            answer.update(surfaces[key].edge(part, key, edge, point))
        if face is not None:
            answer.update(surfaces[key].face(part, key, face, point))
        found.append(answer)
    return found


def _anchor(anchor: Any) -> tuple[str, list[float], str | None, str | None]:
    part = anchor.get("part") if isinstance(anchor, dict) else None
    point = anchor.get("point") if isinstance(anchor, dict) else None
    edge = anchor.get("edge") if isinstance(anchor, dict) else None
    face = anchor.get("face") if isinstance(anchor, dict) else None
    if (
        not isinstance(part, str)
        or not isinstance(point, list)
        or len(point) != 3
        or not all(_is_coordinate(c) for c in point)
        or not (edge is None or isinstance(edge, str))
        or not (face is None or isinstance(face, str))
    ):
        raise QueryError(
            "bad_request",
            "each anchor of nearest needs part, a string, and point, three finite numbers; "
            "edge and face, if it names one, are strings",
        )
    return part, [float(c) for c in point], edge, face


def _is_coordinate(value: Any) -> bool:
    """A number that can be a coordinate in mm: finite, and no further out than FARTHEST."""
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value) and abs(value) <= FARTHEST
    except OverflowError:
        # An integer of hundreds of digits, which JSON may hold and no float can.
        return False


class _Surface:
    """A part's faces, and which of them meet at each of its edges and corners."""

    def __init__(self, shape: Any) -> None:
        self._shape = getattr(shape, "wrapped", shape)
        self._faces = topo.faces(shape)
        # The same map topo.faces walks, so an index here is an index there.
        self._index = TopTools_IndexedMapOfShape()
        TopExp.MapShapes_s(self._shape, TopAbs_FACE, self._index)
        self._kinds = {"edge": TopAbs_EDGE, "vertex": TopAbs_VERTEX}
        self._around: dict[str, Any] = {}  # faces around each edge, and each vertex, once asked
        self._descriptors: dict[int, str | None] = {}
        self._span: float | None = None  # about how large the part is, once a face is described
        self._extrema: Any = None  # holds the part taken apart and boxed, once asked
        self._edges: list[Any] | None = None  # in the kernel's order, once an anchor names one
        self._edge_index: Any = None  # the map topo.edges walks, once a point is on an edge
        self._edge_descriptors: dict[int, str | None] = {}
        self._face_box_list: list[tuple[float, ...] | None] | None = None  # the boxes of the faces, once a point is looked for
        self._edge_box_list: list[tuple[float, ...] | None] | None = None

    def nearest(self, part: str, key: str, point: list[float]) -> dict[str, Any]:
        from build123d import Face, Vector
        from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex
        from OCP.BRepExtrema import BRepExtrema_DistShapeShape
        from OCP.gp import gp_Pnt

        if self._extrema is None:
            # The part is the first shape, loaded once: taking it apart and
            # boxing its faces is most of the work, and is the same for every
            # point asked about.
            self._extrema = BRepExtrema_DistShapeShape()
            self._extrema.LoadS1(self._surface())
        extrema = self._extrema
        extrema.LoadS2(BRepBuilderAPI_MakeVertex(gp_Pnt(*point)).Vertex())
        if not extrema.Perform() or extrema.NbSolution() < 1:
            raise QueryError("exception", f"no nearest point on {key} could be computed")
        # Several points may be equally near (the middle of a slot): the one on
        # the face of lowest index is taken, so the answer does not change
        # from one build to the next.
        index, on = min(
            (self._face_under(key, extrema.SupportTypeShape1(i), extrema.SupportOnShape1(i)), i)
            for i in range(1, extrema.NbSolution() + 1)
        )
        at = extrema.PointOnShape1(on)
        at = Vector(at.X(), at.Y(), at.Z())
        try:
            normal = _xyz(Face(self._faces[index]).normal_at(at))
        except Exception:
            normal = None
        return {
            "point": _xyz(at),
            "normal": normal,
            "ref": f"{part}/F{index}",
            "distance": float(extrema.Value()),
            "descriptor": self._descriptor(key, index),
            **self._support(part, key, extrema.SupportTypeShape1(on), extrema.SupportOnShape1(on)),
        }

    def _surface(self) -> Any:
        """The part as the extrema are to be given it: never a solid on its own.

        Of a shape that *is* a solid, the extrema say that a point inside it
        is no distance from it and on none of its faces. Of a solid within a
        compound, as a ``Part`` is, they say how far the point is from its
        faces, which is what is asked. So a bare solid is given within a
        compound: the same faces, edges and corners, to be found in the same
        maps.
        """
        from OCP.BRep import BRep_Builder
        from OCP.TopAbs import TopAbs_COMPSOLID, TopAbs_SOLID
        from OCP.TopoDS import TopoDS_Compound

        if self._shape.ShapeType() not in (TopAbs_SOLID, TopAbs_COMPSOLID):
            return self._shape
        within = TopoDS_Compound()
        builder = BRep_Builder()
        builder.MakeCompound(within)
        builder.Add(within, self._shape)
        return within

    def _support(self, part: str, key: str, support_type: Any, support: Any) -> dict[str, Any]:
        """What a nearest point lies on, and of an edge which it is and the faces that meet there."""
        from OCP.BRepExtrema import BRepExtrema_SupportType

        if support_type == BRepExtrema_SupportType.BRepExtrema_IsInFace:
            return {"support": "face"}
        if support_type != BRepExtrema_SupportType.BRepExtrema_IsOnEdge:
            return {"support": "vertex"}
        between = self._between(part, support)
        index = self._edge_number(support)
        # A seam has one face on both sides; an edge the map does not have is not named.
        if len(between) < 2 or index is None:
            return {"support": "face"}
        return {
            "support": "edge",
            "edgeUnder": f"{part}/E{index}",
            "edgeUnderDescriptor": self._edge_descriptor(key, index, support),
            "between": between,
        }

    def _between(self, part: str, edge: Any) -> list[str]:
        """The faces that meet at an edge, as refs, lowest first, each once."""
        around = self._faces_around("edge")
        faces = around.FindFromKey(edge) if around.Contains(edge) else []
        numbers = sorted({self._index.FindIndex(face) for face in faces} - {0})
        return [f"{part}/F{number - 1}" for number in numbers]

    def _edge_number(self, edge: Any) -> int | None:
        """The index of an edge in the kernel's order, or None for one the part does not have."""
        if self._edge_index is None:
            # The same map topo.edges walks, so an index here is an index there.
            self._edge_index = TopTools_IndexedMapOfShape()
            TopExp.MapShapes_s(self._shape, TopAbs_EDGE, self._edge_index)
        number = self._edge_index.FindIndex(edge)
        return number - 1 if number >= 1 else None

    def _edge_descriptor(self, key: str, index: int, edge: Any) -> str | None:
        """The descriptor of an edge, or None for one that cannot be described."""
        if index not in self._edge_descriptors:
            try:
                described = _describe_edge(f"{key}/E{index}", edge)["descriptor"]
            except Exception:
                described = None
            self._edge_descriptors[index] = described
        return self._edge_descriptors[index]

    def edge(self, part: str, key: str, ref: str, point: list[float]) -> dict[str, Any]:
        """How far ``point`` is from the edge ``ref`` (``part/E<i>``) names, if the part has it."""
        from build123d import Vector
        from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex
        from OCP.BRepExtrema import BRepExtrema_DistShapeShape
        from OCP.gp import gp_Pnt

        match = _SUBSHAPE.match(ref)
        if not match or match["key"] != part or match["kind"] != "E":
            return {"edgeFound": False}
        if self._edges is None:
            self._edges = topo.edges(self._shape)
        index = _index(match)
        if index >= len(self._edges):
            return {"edgeFound": False}
        edge = self._edges[index]
        try:
            vertex = BRepBuilderAPI_MakeVertex(gp_Pnt(*point)).Vertex()
            extrema = BRepExtrema_DistShapeShape(vertex, edge)
            measured = extrema.IsDone() and extrema.NbSolution() >= 1
        except Exception:
            measured = False
        if not measured:
            # An edge with no curve, such as a sphere's pole: nothing can be said to be on it.
            return {"edgeFound": False}
        return {
            "edgeFound": True,
            "edgeDistance": float(extrema.Value()),
            "edgePoint": _xyz(Vector(*_pnt(extrema.PointOnShape2(1)))),
            "edgeDescriptor": self._edge_descriptor(key, index, edge),
            "edgeBetween": self._between(part, edge),
        }

    def face(self, part: str, key: str, ref: str, point: list[float]) -> dict[str, Any]:
        """How far ``point`` is from the face ``ref`` (``part/F<i>``) names, if the part has it."""
        from build123d import Face, Vector
        from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex
        from OCP.BRepExtrema import BRepExtrema_DistShapeShape
        from OCP.gp import gp_Pnt

        match = _SUBSHAPE.match(ref)
        if not match or match["key"] != part or match["kind"] != "F" or _index(match) >= len(self._faces):
            return {"faceFound": False}
        index = _index(match)
        try:
            vertex = BRepBuilderAPI_MakeVertex(gp_Pnt(*point)).Vertex()
            extrema = BRepExtrema_DistShapeShape(vertex, self._faces[index])
            measured = extrema.IsDone() and extrema.NbSolution() >= 1
        except Exception:
            measured = False
        if not measured:
            return {"faceFound": False}
        at = extrema.PointOnShape2(1)
        try:
            normal = _xyz(Face(self._faces[index]).normal_at(Vector(at.X(), at.Y(), at.Z())))
        except Exception:
            normal = None
        return {
            "faceFound": True,
            "faceDistance": float(extrema.Value()),
            "facePoint": _xyz(Vector(at.X(), at.Y(), at.Z())),
            "faceDescriptor": self._descriptor(key, index),
            "faceNormal": normal,
        }

    # The faces and edges found again by where they are (``refind``, ``selectors``)

    def face_shape(self, key: str, index: int) -> Any:
        """The ``TopoDS`` face ``F<index>`` of the part ``key``, or a ``bad_ref`` naming how many it has."""
        return _pick(self._faces, index, key, "faces", "F")

    def edge_shape(self, key: str, index: int) -> Any:
        """The ``TopoDS`` edge ``E<index>`` of the part ``key``, or a ``bad_ref`` naming how many it has."""
        return _pick(self._all_edges(), index, key, "edges", "E")

    def face_index(self, face: Any) -> int | None:
        """The index in the kernel's order of a face of this part, or None for one it does not have."""
        number = self._index.FindIndex(face)
        return number - 1 if number >= 1 else None

    def edge_index(self, edge: Any) -> int | None:
        """The index in the kernel's order of an edge of this part, or None for one it does not have."""
        return self._edge_number(edge)

    def _all_edges(self) -> list[Any]:
        if self._edges is None:
            self._edges = topo.edges(self._shape)
        return self._edges

    @staticmethod
    def _probe(shape: Any, point: list[float]) -> tuple[float, Any] | None:
        """How far ``point`` is from a face or an edge, and the point of it nearest, or None when that cannot be said."""
        from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex
        from OCP.BRepExtrema import BRepExtrema_DistShapeShape
        from OCP.gp import gp_Pnt

        try:
            vertex = BRepBuilderAPI_MakeVertex(gp_Pnt(*point)).Vertex()
            extrema = BRepExtrema_DistShapeShape(vertex, shape)
            if not (extrema.IsDone() and extrema.NbSolution() >= 1):
                return None
            return float(extrema.Value()), extrema.PointOnShape2(1)
        except Exception:
            return None

    def face_at(self, index: int, point: list[float]) -> tuple[float, list[float], list[float] | None] | None:
        """How far ``point`` is from face ``index``, the point of it nearest and the face's outward normal there
        (None where the surface has none); None when the distance cannot be measured."""
        from build123d import Face, Vector

        probed = self._probe(self._faces[index], point)
        if probed is None:
            return None
        distance, at = probed
        try:
            normal = _xyz(Face(self._faces[index]).normal_at(Vector(at.X(), at.Y(), at.Z())))
        except Exception:
            normal = None
        return distance, [at.X(), at.Y(), at.Z()], normal

    def edge_at(self, index: int, point: list[float]) -> tuple[float, list[float]] | None:
        """How far ``point`` is from edge ``index`` and the point of it nearest; None when that cannot be measured."""
        probed = self._probe(self._all_edges()[index], point)
        if probed is None:
            return None
        distance, at = probed
        return distance, [at.X(), at.Y(), at.Z()]

    def nearest_facing(
        self, key: str, point: list[float], normal: list[float] | None, within: float, degrees: float
    ) -> int | None:
        """The index of the face nearest ``point`` among those within ``within`` mm of it whose outward normal at
        the nearest point is within ``degrees`` of ``normal`` (any, when ``normal`` is None); None when no face is.
        Ties in distance go to the one most nearly facing ``normal``, then to the lowest index."""
        best: tuple[float, float, int] | None = None
        for index in self._near(self._face_boxes(), point, within):
            found = self.face_at(index, point)
            if found is None or found[0] > within:
                continue
            angle = 0.0
            if normal is not None:
                if found[2] is None:
                    continue
                angle = _angle(normal, found[2])
                if angle > degrees:
                    continue
            rank = (round(found[0], 6), angle, index)
            if best is None or rank < best:
                best = rank
        return None if best is None else best[2]

    def nearest_edge(self, key: str, point: list[float], within: float) -> int | None:
        """The index of the edge nearest ``point`` when it is within ``within`` mm of it; None when none is."""
        best: tuple[float, int] | None = None
        for index in self._near(self._edge_boxes(), point, within):
            found = self.edge_at(index, point)
            if found is None or found[0] > within:
                continue
            rank = (round(found[0], 6), index)
            if best is None or rank < best:
                best = rank
        return None if best is None else best[1]

    @staticmethod
    def _boxes_of(shapes: list[Any]) -> list[tuple[float, ...] | None]:
        from OCP.BRepBndLib import BRepBndLib
        from OCP.Bnd import Bnd_Box

        boxes: list[tuple[float, ...] | None] = []
        for shape in shapes:
            try:
                box = Bnd_Box()
                BRepBndLib.Add_s(shape, box, False)
                low, high = (None, None) if box.IsVoid() else (box.CornerMin(), box.CornerMax())
                boxes.append(None if low is None else (low.X(), low.Y(), low.Z(), high.X(), high.Y(), high.Z()))
            except Exception:
                boxes.append(None)
        return boxes

    def _face_boxes(self) -> list[tuple[float, ...] | None]:
        if self._face_box_list is None:
            self._face_box_list = self._boxes_of(self._faces)
        return self._face_box_list

    def _edge_boxes(self) -> list[tuple[float, ...] | None]:
        if self._edge_box_list is None:
            self._edge_box_list = self._boxes_of(self._all_edges())
        return self._edge_box_list

    @staticmethod
    def _near(boxes: list[tuple[float, ...] | None], point: list[float], within: float) -> list[int]:
        """The indices of the boxes ``within`` mm of ``point``: the only ones whose shape can be that near."""
        x, y, z = point
        return [
            i
            for i, box in enumerate(boxes)
            if box is not None
            and box[0] - within <= x <= box[3] + within
            and box[1] - within <= y <= box[4] + within
            and box[2] - within <= z <= box[5] + within
        ]

    def _descriptor(self, key: str, index: int) -> str | None:
        """The descriptor of a face, or None for one that cannot be described."""
        if index not in self._descriptors:
            try:
                if self._span is None:
                    self._span = extent.span(self._shape)
                described = _describe_face(f"{key}/F{index}", self._faces[index], self._span)["descriptor"]
            except Exception:
                # One odd face is not a reason to say nothing of the other anchors.
                described = None
            self._descriptors[index] = described
        return self._descriptors[index]

    def _face_under(self, key: str, support_type: Any, support: Any) -> int:
        """The index of the face a nearest point is on: of the lowest, on an edge or a corner."""
        from OCP.BRepExtrema import BRepExtrema_SupportType

        if support_type == BRepExtrema_SupportType.BRepExtrema_IsInFace:
            numbers = [self._index.FindIndex(support)]
        else:
            on_edge = support_type == BRepExtrema_SupportType.BRepExtrema_IsOnEdge
            around = self._faces_around("edge" if on_edge else "vertex")
            # Nothing around it when the edge or the corner is of no face: a wire in the part.
            faces = around.FindFromKey(support) if around.Contains(support) else []
            numbers = [self._index.FindIndex(face) for face in faces]
        # FindIndex answers 0 for a shape the map does not have: taken as an
        # index that would be -1, the last face.
        if not numbers or min(numbers) < 1:
            raise QueryError(
                "exception",
                f"the point of {key} nearest to the anchor is on none of its faces",
            )
        return min(numbers) - 1

    def _faces_around(self, kind: str) -> Any:
        if kind not in self._around:
            self._around[kind] = TopTools_IndexedDataMapOfShapeListOfShape()
            TopExp.MapShapesAndAncestors_s(
                self._shape, self._kinds[kind], TopAbs_FACE, self._around[kind]
            )
        return self._around[kind]


def _angle(a: list[float], b: list[float]) -> float:
    """The angle between two vectors, degrees."""
    la, lb = math.sqrt(sum(c * c for c in a)), math.sqrt(sum(c * c for c in b))
    if la == 0 or lb == 0:
        return 180.0
    return math.degrees(math.acos(max(-1.0, min(1.0, sum(x * y for x, y in zip(a, b)) / (la * lb)))))


def _pnt(point: Any) -> tuple[float, float, float]:
    return point.X(), point.Y(), point.Z()


def _index(match: re.Match[str]) -> int:
    """The number a ref ends in; one too long to be the number of anything is past every list."""
    digits = match["index"]
    return int(digits) if len(digits) <= _INDEX_DIGITS else 10**_INDEX_DIGITS


def _pick(items: list[Any], index: int, key: str, plural: str, letter: str) -> Any:
    if index >= len(items):
        raise QueryError(
            "bad_ref",
            f"{key} has {len(items)} {plural}, {letter}0 to {letter}{len(items) - 1}; "
            f"there is no {letter}{index}",
        )
    return items[index]


def _describe_part(key: str, shape: Any, kept: dict[Any, Any] | None) -> dict[str, Any]:
    low, high = box_of(shape, key, kept)
    # From one integral a face where it is not exact, as its faces' descriptors: what is to be relied on is asked of measure.
    area = area_at_a_glance_of(shape, key, kept)
    volume = volume_of(shape, key, kept)
    facts = {
        "kind": "part",
        "key": key,
        "bbox": {"min": list(low), "max": list(high)},
        "bboxExact": boxed_exactly_of(shape, key, kept),
        "volume": volume.value,
        "volumeExact": volume.exact,
        "area": area.value,
        "areaExact": area.exact,
        "faceCount": len(topo.faces(shape)),
        "edgeCount": len(topo.edges(shape)),
        "valid": valid_of(shape, key, kept),
        # Which solids are inside out: absent of a sound part.
        **({"reversed": list(volume.reversed)} if volume.reversed else {}),
        # Bought, not made: present only of a reference.
        **({"role": "reference"} if is_reference(kept, key) else {}),
    }
    return {**facts, "descriptor": descriptor("part", facts)}


def _describe_face(ref: str, topods_face: Any, span: float) -> dict[str, Any]:
    """What a face is. ``span`` is about how large its part is, mm: its descriptor
    tells nothing as a coordinate that is nothing next to that."""
    from build123d import Face

    face = Face(topods_face)
    # On a curved face this is the point at the middle of its parameter range,
    # which lies on the surface, so the normal there is well defined.
    center = face.center()
    try:
        normal = _xyz(face.normal_at(center))
    except Exception:
        normal = None
    radius = face.radius  # None unless the face is a cylinder or a sphere
    try:
        # None unless the face is a surface of revolution; the descriptor wants a cylinder's.
        axis = face.axis_of_rotation
        axis = None if axis is None else _xyz(axis.direction)
    except Exception:
        axis = None
    # From one integral where it is not exact: what is to be relied on is asked of measure.
    area = extent.area_at_a_glance(topods_face)
    facts = {
        "kind": "face",
        "ref": ref,
        "type": face.geom_type.name.lower(),
        "area": area.value,
        "areaExact": area.exact,
        "center": _xyz(center),
        "normal": normal,
        "radius": None if radius is None else float(radius),
    }
    return {**facts, "descriptor": descriptor("face", {**facts, "axis": axis, "span": span})}


def _describe_edge(ref: str, topods_edge: Any) -> dict[str, Any]:
    from build123d import Edge

    edge = Edge(topods_edge)
    try:
        center = _xyz(edge.center())
    except Exception:
        # A degenerate edge, such as a sphere's pole, has no curve: it is a point.
        center = _xyz(edge.vertices()[0].center())
    try:
        radius = float(edge.radius)  # of a circle; anything else has none
    except Exception:
        radius = None
    facts = {
        "kind": "edge",
        "ref": ref,
        "type": edge.geom_type.name.lower(),
        "length": float(edge.length),
        "center": center,
    }
    return {**facts, "descriptor": descriptor("edge", {**facts, "radius": radius})}


def _xyz(vector: Any) -> list[float]:
    # Adding 0.0 turns -0.0 into 0.0.
    return [float(vector.X) + 0.0, float(vector.Y) + 0.0, float(vector.Z) + 0.0]
