"""The exact outline a plane cuts of each part: the ``section`` query.

Nothing here changes a shape. The outlines come from the B-rep, not from the
mesh, so their areas are exact and their points lie on the part.
"""

import math
from typing import Any

import numpy as np

from . import extent, topo
from .queries import QueryError, as_point, need_layout, need_part

# How far a drawn outline may stray from the true one, mm: unless a finer one
# is asked for, and never finer than the finest.
DEFLECTION = 0.05
FINEST = 0.005
# No loop is told with more points than this: one that needs more is drawn coarser.
MAX_POINTS = 2000
# Ends of cut edges closer than this are one point, mm.
_JOIN = 1e-6
# What a part's entry says of how it was cut.
SOLID = "cross-section of the solid"
SURFACE = "outline of the surface: the part is not a solid"
MIXED = "cross-section of its solids; its loose faces are not cut"
_ZERO = 1e-12


def section(shapes: dict[str, Any], args: dict[str, Any]) -> dict[str, Any]:
    """Answer ``section``: ``args`` are ``layout``, ``plane`` (``origin`` and ``normal``), to
    cut only some, ``parts``, a list of names, and, to draw the outlines finer than within
    0.05 mm, ``deflection``, mm: 0.005 at least, and one over 0.05 is 0.05.

    The reply's ``plane`` carries the unit ``normal`` and the axes the points
    are along: ``x`` is the world axis least along the normal (the first of
    equals), laid into the plane, and ``y`` is ``normal × x``. A point
    ``[u, v]`` is ``origin + u·x + v·y`` in the frame of the layout.

    Each part asked of is listed, in the build's order, with its ``loops``
    (none where the plane misses it), and ``how`` it was cut:

    - ``cross-section of the solid``, of a part that has solids: what of the
      plane is in each solid, its surface included. So a plane that lies on a
      face of the solid has that face in the cross-section, whichever way it
      looks, and one that only touches the solid (along an edge, or a line of
      a round side) cuts nothing. "On" is to OCC's tolerance: a plane within
      1e-7 mm outside a face is answered as on it. Every loop is closed and ``open`` is 0. A
      cross-section may come in pieces that share an edge; solids of one part
      that overlap are each cut, and both counted. Of a part that also has
      faces of no solid only the solids are cut, and ``how`` is
      ``cross-section of its solids; its loose faces are not cut``.
    - ``outline of the surface: the part is not a solid``, of a shell or a
      face: the curves the plane cuts of it, joined end to end. ``open`` is
      how many of them are not closed, and then the part's ``area`` is null:
      what an open outline bounds cannot be told.

    A loop has its ``points``, whether it is ``closed`` (then the last point
    joins the first, which is not told twice), its ``area`` and the
    ``deflection`` it is drawn at: the one asked for, or more when the loop
    would otherwise have over 2,000 points. The area is that of the true outline, not
    of the polygon: positive for a loop that bounds material, which runs
    counter-clockwise, negative for a hole in it, which runs clockwise, and
    null for a loop that is not closed. ``areaExact`` is false of a loop whose
    area could only be taken of its polygon, and of a part with such a loop.
    Closed loops come largest first, open ones after them. A part's ``area``
    is the sum.

    ``bounds`` is the box of every point in ``[u, v]``, null when nothing is cut.

    ``axes`` (``x`` and ``y``, each three numbers) is the caller's own frame for the plane,
    used in place of the one above: the two must be unit vectors at right angles within
    1e-6 whose ``x × y`` is along the normal, else ``bad_request``. Every ``[u, v]`` of the
    reply is then along them, and the reply's ``plane`` says them.

    ``snaps: true`` gives each loop, besides, what a point can be snapped to, all exact (of
    the B-rep's own cut edges, never of the polyline): ``corners``, ``[u, v]`` at the ends of
    its cut edges, each once (an edge that is closed on itself, a whole circle, has no end),
    and ``circles``, one ``{centre, radius}`` for each cut edge that is a circle or an arc of
    one, with its ``edge`` (``E<i>``, as ``topo`` numbers the part's edges) when it lies on a
    circular edge of the part. Arcs of one circle that lie on different edges are entries of their
    own, each with its edge; entries that name the same edge are told once. Without ``snaps`` no
    loop carries either.
    """
    layout, plane, names = args.get("layout"), args.get("plane"), args.get("parts")
    origin = as_point(plane.get("origin")) if isinstance(plane, dict) else None
    normal = as_point(plane.get("normal")) if isinstance(plane, dict) else None
    if not isinstance(layout, str) or origin is None or normal is None:
        raise QueryError(
            "bad_request",
            "section needs args.layout, a string, and args.plane with origin and normal, each "
            "three finite numbers",
        )
    if names is not None and (
        not isinstance(names, list) or not names or not all(isinstance(n, str) for n in names)
    ):
        raise QueryError(
            "bad_request", "args.parts of section, if given, is a list of part names, at least one"
        )
    length = math.sqrt(sum(c * c for c in normal))
    if length < _ZERO:
        raise QueryError("bad_request", "the normal of the section plane has no length")
    deflection = _deflection(args.get("deflection"))
    unit = np.array(normal) / length
    axes = _axes(args.get("axes"), unit)
    snaps = args.get("snaps", False)
    if not isinstance(snaps, bool):
        raise QueryError("bad_request", "args.snaps of section, if given, is true or false")
    need_layout(shapes, layout)
    if names is None:
        names = [key.split(":", 1)[1] for key in shapes if key.startswith(f"{layout}:")]
    frame = _Frame(np.array(origin), unit, deflection, axes, snaps=snaps)
    parts = []
    for name in dict.fromkeys(names):
        parts.append({"part": name, **_cut(need_part(shapes, layout, name), frame, f"{layout}:{name}")})
    drawn = [loop["points"] for part in parts for loop in part["loops"]]
    bounds = None
    if drawn:
        every = np.vstack(drawn)
        bounds = {"min": _out(every.min(axis=0)), "max": _out(every.max(axis=0))}
    for part in parts:
        for loop in part["loops"]:
            loop["points"] = [_out(point) for point in loop["points"]]
    return {
        "plane": {
            "origin": origin,
            "normal": _out(frame.normal),
            "x": _out(frame.x),
            "y": _out(frame.y),
        },
        "parts": parts,
        "bounds": bounds,
    }


# How far the caller's axes may be from a right-handed orthonormal pair along the normal.
_AXES_TOLERANCE = 1e-6


def _axes(asked: Any, normal: np.ndarray) -> tuple[np.ndarray, np.ndarray] | None:
    """The caller's axes for the plane, or None when it gave none; ``bad_request`` for a pair
    that is not of unit vectors at right angles with ``x × y`` along ``normal``."""
    if asked is None:
        return None
    pair = None
    if isinstance(asked, dict) and set(asked) == {"x", "y"}:
        x, y = as_point(asked["x"]), as_point(asked["y"])
        if x is not None and y is not None:
            pair = np.array(x), np.array(y)
    if pair is None:
        raise QueryError(
            "bad_request", "args.axes of section, if given, is {x, y}, each three finite numbers"
        )
    x, y = pair
    off = max(
        abs(float(np.linalg.norm(x)) - 1),
        abs(float(np.linalg.norm(y)) - 1),
        abs(float(x @ y)),
        float(np.max(np.abs(np.cross(x, y) - normal))),
    )
    if off > _AXES_TOLERANCE:
        raise QueryError(
            "bad_request",
            "args.axes of section are not a right-handed pair of unit vectors at right angles "
            f"with x × y along the plane's normal (within {_AXES_TOLERANCE:g})",
        )
    return x, y


def _deflection(asked: Any) -> float:
    """How far the outlines may stray from the true ones, mm, given what the request asks."""
    if asked is None:
        return DEFLECTION
    try:
        # An integer of hundreds of digits, which JSON may hold, is not finite to a float.
        usable = (
            isinstance(asked, (int, float))
            and not isinstance(asked, bool)
            and math.isfinite(asked)
            and asked > 0
        )
    except OverflowError:
        usable = False
    if not usable:
        raise QueryError(
            "bad_request",
            "args.deflection of section, if given, is a positive number of mm, how far the "
            f"outline drawn may stray from the true one: {DEFLECTION:g} when none is given, "
            f"{FINEST:g} at least",
        )
    return min(DEFLECTION, max(FINEST, float(asked)))


class _Frame:
    """A plane, the two axes its points are told along, and how finely its outlines are drawn."""

    def __init__(
        self,
        origin: np.ndarray,
        normal: np.ndarray,
        deflection: float = DEFLECTION,
        axes: tuple[np.ndarray, np.ndarray] | None = None,
        snaps: bool = False,
    ) -> None:
        self.origin = origin
        self.normal = normal
        self.deflection = deflection
        # Whether each loop is to carry its corners and circles.
        self.snaps = snaps
        if axes is not None:
            self.x, self.y = axes
            return
        # argmin takes the first of equals: X before Y before Z.
        least = np.eye(3)[int(np.argmin(np.abs(normal)))]
        along = least - (least @ normal) * normal
        self.x = along / np.linalg.norm(along)
        self.y = np.cross(normal, self.x)

    def plane(self) -> Any:
        from OCP.gp import gp_Ax3, gp_Dir, gp_Pln, gp_Pnt

        return gp_Pln(
            gp_Ax3(
                gp_Pnt(*map(float, self.origin)),
                gp_Dir(*map(float, self.normal)),
                gp_Dir(*map(float, self.x)),
            )
        )

    def flat(self, points: np.ndarray) -> np.ndarray:
        """Points of the object as ``[u, v]`` of the plane."""
        return (points - self.origin) @ np.stack([self.x, self.y]).T


def _cut(shape: Any, frame: _Frame, key: str) -> dict[str, Any]:
    """What ``section`` says of one part, but its name."""
    wrapped = getattr(shape, "wrapped", shape)
    solids = topo.solids(wrapped)
    snapper = _Snapper(wrapped, frame) if frame.snaps else None
    if solids:
        loops, area, exact = _cross_section(solids, frame, key, snapper)
        how = MIXED if topo.loose_faces(wrapped) else SOLID
    else:
        loops, exact = _outline(wrapped, frame, key, snapper)
        closed = all(loop["closed"] for loop in loops)
        # Of an outline that is not closed, what it bounds cannot be told.
        area = sum(loop["area"] for loop in loops) if closed else None
        how = SURFACE
    # Largest first; those that are not closed have no area and come last.
    loops.sort(key=lambda loop: (not loop["closed"], -abs(loop["area"] or 0.0)))
    return {
        "loops": loops,
        "area": area,
        "areaExact": exact,
        "open": sum(1 for loop in loops if not loop["closed"]),
        "how": how,
    }


def _cross_section(
    solids: list[Any], frame: _Frame, key: str, snapper: "_Snapper | None" = None
) -> tuple[list[dict[str, Any]], float, bool]:
    """The loops round what of the plane is in each solid, their area and whether it is exact.

    Each solid is intersected with a sheet of the plane larger than itself.
    What comes back is faces, whole whatever the plane touches on its way:
    their outer wires bound material and their inner ones holes.
    """
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Common
    from OCP.BRepTools import BRepTools

    plane = frame.plane()
    loops: list[dict[str, Any]] = []
    total, exact = 0.0, True
    for solid in solids:
        sheet = _sheet(solid, frame, plane)
        if sheet is None:
            continue
        common = BRepAlgoAPI_Common(solid, sheet)
        if not common.IsDone():
            raise QueryError("exception", f"the section of {key} could not be computed")
        for face in topo.faces(common.Shape()):
            rim = BRepTools.OuterWire_s(face)
            around = [
                _ring(plane, wire, frame, hole=not wire.IsSame(rim), snapper=snapper)
                for wire in topo.wires(face)
            ]
            around = [loop for loop in around if loop is not None]
            area = _face_area(face)
            if area is None or not all(loop["areaExact"] for loop in around):
                # The polygons are the best there is.
                area, exact = sum(loop["area"] for loop in around), False
            total += area
            loops += around
    return loops, total, exact


def _sheet(solid: Any, frame: _Frame, plane: Any) -> Any:
    """A face of the plane that reaches past the solid on every side, or None when the
    plane passes the solid by."""
    from OCP.BRepBndLib import BRepBndLib
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace
    from OCP.Bnd import Bnd_Box

    box = Bnd_Box()
    # Of the geometry, which the box may exceed but never falls short of.
    BRepBndLib.Add_s(solid, box, False)
    if box.IsVoid():
        return None
    low, high = box.CornerMin(), box.CornerMax()
    corners = np.array(
        [
            [x, y, z]
            for x in (low.X(), high.X())
            for y in (low.Y(), high.Y())
            for z in (low.Z(), high.Z())
        ]
    )
    off = (corners - frame.origin) @ frame.normal
    if off.min() > _JOIN or off.max() < -_JOIN:
        return None
    flat = frame.flat(corners)
    (u0, v0), (u1, v1) = flat.min(axis=0) - 1, flat.max(axis=0) + 1
    return BRepBuilderAPI_MakeFace(plane, float(u0), float(u1), float(v0), float(v1)).Face()


def _ring(
    plane: Any,
    wire: Any,
    frame: _Frame,
    hole: bool,
    drawn: tuple[np.ndarray | None, float] | None = None,
    snapper: "_Snapper | None" = None,
) -> dict[str, Any] | None:
    """A closed loop as it is told: its points turning the way that says what it bounds.

    ``drawn`` is its outline and the deflection it was drawn at (``_closed_outline``),
    when the wire was drawn already.
    """
    outline, drawn_at = _closed_outline(wire, frame) if drawn is None else drawn
    if outline is None:
        return None
    area, exact = _wire_area(plane, wire, outline)
    if (_shoelace(outline) < 0) != hole:
        outline = outline[::-1]
    points, deflection = _within_limit(outline, True, drawn_at)
    ring = {
        "points": points,
        "closed": True,
        "area": -area if hole else area,
        "areaExact": exact,
        "deflection": deflection,
    }
    if snapper is not None:
        ring.update(snapper.of(wire))
    return ring


def _closed_outline(wire: Any, frame: _Frame) -> tuple[np.ndarray | None, float]:
    """The points of a closed wire in the plane, the first not told again at the end, and
    the deflection they are drawn at. No points of a wire that bounds nothing."""
    outline, drawn_at = _drawn(wire, frame)
    return _shut(outline), drawn_at


def _shut(outline: np.ndarray) -> np.ndarray | None:
    """The points of a wire drawn as those of a closed one: the first not told again at
    the end. None of a wire that bounds nothing."""
    if len(outline) >= 2 and np.linalg.norm(outline[0] - outline[-1]) <= _JOIN:
        outline = outline[:-1]
    return outline if len(outline) >= 3 else None


def _drawn(wire: Any, frame: _Frame) -> tuple[np.ndarray, float]:
    """The points of a wire in the plane and the deflection they are drawn at.

    The one asked for; or, of a wire that has more than MAX_POINTS at one
    finer than DEFLECTION, twice that and twice again, as far as DEFLECTION:
    drawing a curve coarser keeps more of it than dropping points does.
    """
    deflection = frame.deflection
    while True:
        outline = frame.flat(_polyline(wire, deflection))
        if len(outline) <= MAX_POINTS or deflection >= DEFLECTION:
            return outline, deflection
        deflection = min(DEFLECTION, deflection * 2)


def _outline(
    shape: Any, frame: _Frame, key: str, snapper: "_Snapper | None" = None
) -> tuple[list[dict[str, Any]], bool]:
    """The loops a plane cuts of a shape that is no solid, and whether their areas are exact.

    The cut is loose edges, joined end to end. A loop inside an odd number of
    others is taken for a hole.
    """
    # build123d and OCP come from the user's workspace, so they are imported only when used.
    from build123d import Edge, Wire
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Section

    plane = frame.plane()
    cut = BRepAlgoAPI_Section(shape, plane, False)
    # The curves as they are, not splines put through them.
    cut.Approximation(False)
    cut.Build()
    if not cut.IsDone():
        raise QueryError("exception", f"the section of {key} could not be computed")
    edges = topo.edges(cut.Shape())
    if not edges:
        return [], True
    closed, loops = [], []
    for wire in Wire.combine([Edge(edge) for edge in edges], tol=_JOIN):
        # Drawn once, whatever becomes of it: a part may have thousands.
        outline, drawn_at = _drawn(wire.wrapped, frame)
        shut = _shut(outline) if wire.is_closed else None
        if shut is not None:
            closed.append((wire.wrapped, shut, drawn_at))
            continue
        if len(outline) >= 2:
            points, deflection = _within_limit(outline, False, drawn_at)
            loop = {
                "points": points,
                "closed": False,
                "area": None,
                "areaExact": True,
                "deflection": deflection,
            }
            if snapper is not None:
                loop.update(snapper.of(wire.wrapped))
            loops.append(loop)
    for wire, outline, drawn_at in closed:
        depth = sum(1 for _, other, _ in closed if other is not outline and _inside(outline[0], other))
        loops.append(
            _ring(plane, wire, frame, hole=depth % 2 == 1, drawn=(outline, drawn_at), snapper=snapper)
        )
    return loops, all(loop["areaExact"] for loop in loops)


# How near a model edge's circle is to the cut's, mm, to be the same one.
_SAME = 1e-6


class _Snapper:
    """What of the cut a point may be snapped to, from the B-rep's own edges: the ends of each
    cut edge, and the centre and radius of each that is a circle.

    ``model`` is the part's circular edges, found once and only when a circle is cut.
    """

    def __init__(self, shape: Any, frame: _Frame) -> None:
        self.shape = shape
        self.frame = frame
        self._model: list[tuple[int, Any, np.ndarray, float]] | None = None

    def of(self, wire: Any) -> dict[str, Any]:
        """``corners`` and ``circles`` of a wire of the cut, in ``[u, v]``."""
        from OCP.BRep import BRep_Tool
        from OCP.BRepAdaptor import BRepAdaptor_Curve
        from OCP.BRepTools import BRepTools_WireExplorer
        from OCP.GeomAbs import GeomAbs_CurveType
        from OCP.TopExp import TopExp
        from OCP.TopoDS import TopoDS_Vertex

        ends: list[np.ndarray] = []
        circles: list[dict[str, Any]] = []
        walk = BRepTools_WireExplorer(wire)
        while walk.More():
            edge = walk.Current()
            walk.Next()
            if BRep_Tool.Degenerated_s(edge):
                continue
            first, last = TopoDS_Vertex(), TopoDS_Vertex()
            TopExp.Vertices_s(edge, first, last, True)
            # A circle closed on itself has no end, only the seam its vertex is on.
            if not first.IsSame(last):
                for vertex in (first, last):
                    p = BRep_Tool.Pnt_s(vertex)
                    ends.append(np.array([p.X(), p.Y(), p.Z()]))
            curve = BRepAdaptor_Curve(edge)
            if curve.GetType() == GeomAbs_CurveType.GeomAbs_Circle:
                circle = curve.Circle()
                centre = circle.Location()
                at = np.array([centre.X(), centre.Y(), centre.Z()])
                found: dict[str, Any] = {
                    "centre": _out(self.frame.flat(at[None, :])[0]),
                    "radius": float(circle.Radius()),
                }
                index = self._on_model(
                    at, float(circle.Radius()), curve.Value((curve.FirstParameter() + curve.LastParameter()) / 2)
                )
                if index is not None:
                    found["edge"] = f"E{index}"
                    # An arc cut in pieces by corners is told once, on the edge it lies on.
                    if any(c.get("edge") == found["edge"] for c in circles):
                        continue
                circles.append(found)
        corners: list[list[float]] = []
        kept: list[np.ndarray] = []
        for point in ends:
            if not any(np.linalg.norm(point - other) <= _JOIN for other in kept):
                kept.append(point)
                corners.append(_out(self.frame.flat(point[None, :])[0]))
        return {"corners": corners, "circles": circles}

    def _on_model(self, centre: np.ndarray, radius: float, middle: Any) -> int | None:
        """The index (as ``topo`` numbers edges) of the part's circular edge in the plane that the
        cut edge, of this centre and radius and through the point ``middle``, lies on, or None.

        Several edges may share a circle (a bore broken by slots); the one that has ``middle`` is it.
        """
        from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex
        from OCP.BRepExtrema import BRepExtrema_DistShapeShape

        if self._model is None:
            from OCP.BRepAdaptor import BRepAdaptor_Curve
            from OCP.GeomAbs import GeomAbs_CurveType

            self._model = []
            for i, edge in enumerate(topo.edges(self.shape)):
                curve = BRepAdaptor_Curve(edge)
                if curve.GetType() != GeomAbs_CurveType.GeomAbs_Circle:
                    continue
                circle = curve.Circle()
                at, axis = circle.Location(), circle.Axis().Direction()
                # Only a circle in the plane is of this cut.
                if abs(np.array([axis.X(), axis.Y(), axis.Z()]) @ self.frame.normal) < 1 - 1e-9:
                    continue
                self._model.append((i, edge, np.array([at.X(), at.Y(), at.Z()]), float(circle.Radius())))
        vertex = BRepBuilderAPI_MakeVertex(middle).Vertex()
        for i, edge, at, r in self._model:
            if abs(r - radius) > _SAME or np.linalg.norm(at - centre) > _SAME:
                continue
            apart = BRepExtrema_DistShapeShape(vertex, edge)
            if apart.IsDone() and apart.Value() <= _SAME:
                return i
        return None


def _polyline(wire: Any, deflection: float) -> np.ndarray:
    """The points a wire is drawn through, in its order, no further than ``deflection`` from it."""
    from OCP.BRep import BRep_Tool
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.TopAbs import TopAbs_Orientation
    from OCP.BRepTools import BRepTools_WireExplorer
    from OCP.GCPnts import GCPnts_QuasiUniformDeflection

    points: list[tuple[float, float, float]] = []
    walk = BRepTools_WireExplorer(wire)
    while walk.More():
        edge = walk.Current()
        walk.Next()
        if BRep_Tool.Degenerated_s(edge):
            continue
        curve = BRepAdaptor_Curve(edge)
        spread = GCPnts_QuasiUniformDeflection(curve, deflection)
        if spread.IsDone() and spread.NbPoints() >= 2:
            run = [spread.Value(i) for i in range(1, spread.NbPoints() + 1)]
        else:
            run = [curve.Value(curve.FirstParameter()), curve.Value(curve.LastParameter())]
        if edge.Orientation() == TopAbs_Orientation.TopAbs_REVERSED:
            run.reverse()
        # Each edge starts where the one before ended.
        points.extend((p.X(), p.Y(), p.Z()) for p in (run[1:] if points else run))
    return np.array(points, dtype=np.float64).reshape(-1, 3)


def _wire_area(plane: Any, wire: Any, outline: np.ndarray) -> tuple[float, bool]:
    """The area a closed wire of the plane bounds, and whether it is of the wire itself
    or only of the polygon drawn of it."""
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace

    area = None
    try:
        face = BRepBuilderAPI_MakeFace(plane, wire, True)
        if face.IsDone():
            area = _face_area(face.Face())
    except Exception:
        pass
    if area is None:
        return abs(_shoelace(outline)), False
    return area, True


def _face_area(face: Any) -> float | None:
    """The exact area of a face, or None when none can be measured of it."""
    area = extent.area(face).value
    return area if math.isfinite(area) and area > 0 else None


def _shoelace(outline: np.ndarray) -> float:
    """The signed area of a polygon: positive when it runs counter-clockwise."""
    u, v = outline[:, 0], outline[:, 1]
    return float(u @ np.roll(v, -1) - v @ np.roll(u, -1)) / 2


def _inside(point: np.ndarray, outline: np.ndarray) -> bool:
    """Whether a point is inside a polygon: a ray from it crosses the edge an odd number of times."""
    u, v = outline[:, 0], outline[:, 1]
    next_u, next_v = np.roll(u, -1), np.roll(v, -1)
    straddles = (v > point[1]) != (next_v > point[1])
    with np.errstate(divide="ignore", invalid="ignore"):
        crossing = u + (point[1] - v) * (next_u - u) / (next_v - v)
    return int(np.count_nonzero(straddles & (point[0] < crossing))) % 2 == 1


def _within_limit(outline: np.ndarray, closed: bool, drawn_at: float) -> tuple[np.ndarray, float]:
    """The outline, drawn at ``drawn_at``, in at most MAX_POINTS points, and how far it may
    now stray from the true one."""
    points, deflection = outline, drawn_at
    ring = np.vstack([outline, outline[:1]]) if closed else outline
    while len(points) > MAX_POINTS:
        deflection *= 2
        # The outline is already that far off: what is dropped may add the rest.
        points = _thinned(ring, deflection - drawn_at)
        if closed:
            points = points[:-1]
    return points, deflection


def _thinned(points: np.ndarray, tolerance: float) -> np.ndarray:
    """The polyline through fewer of its points, none of those dropped further than
    ``tolerance`` from it (Ramer-Douglas-Peucker). The ends are kept."""
    keep = np.zeros(len(points), dtype=bool)
    keep[0] = keep[-1] = True
    spans = [(0, len(points) - 1)]
    while spans:
        first, last = spans.pop()
        if last <= first + 1:
            continue
        along = points[last] - points[first]
        between = points[first + 1 : last] - points[first]
        length = float(np.linalg.norm(along))
        if length < _ZERO:
            # A ring: its ends are one point, and the furthest from it is kept.
            off = np.linalg.norm(between, axis=1)
        else:
            off = np.abs(along[0] * between[:, 1] - along[1] * between[:, 0]) / length
        furthest = int(np.argmax(off))
        if off[furthest] > tolerance:
            middle = first + 1 + furthest
            keep[middle] = True
            spans += [(first, middle), (middle, last)]
    return points[keep]


def _out(vector: np.ndarray) -> list[float]:
    # Adding 0.0 turns -0.0 into 0.0.
    return [float(c) + 0.0 for c in vector]
