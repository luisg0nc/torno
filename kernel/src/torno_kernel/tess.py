"""Tessellate a loaded scene into the Scene JSON and its binary blob."""

import hashlib
import math
from typing import Any

import numpy as np

from . import arrange, extent, topo
from .describe import OF_THE_PART

DEVIATION = 0.1
ANGULAR_TOLERANCE = 0.2
# The layout whose parts are spread out when they overlap (see arrange.spread).
ARRANGED_LAYOUT = "print"

# Seconds a build gives the box of one part. Past them the scene tells the
# box of the part's mesh, as approximate, and the kernel's is worked out when
# it is first asked for.
BOX_SECONDS = 1.0

# How much of what a part's own mesh encloses its B-rep volume may differ by and still agree: this many times its
# deflection over the mesh's area (chords cut inside a curved face by at most the deflection), and the B-rep's own
# doubt. Measured: a cylinder of 10 mm and a sphere of 5 mm, 0.2 and 0.5 of one deflection over their areas.
MESH_SLACK = 2.0

# Scene mesh key → (ocp-tessellate key, little-endian dtype in the blob).
_BUFFERS = {
    "vertices": ("vertices", "<f4"),
    "normals": ("normals", "<f4"),
    "triangles": ("triangles", "<u4"),
    "edges": ("edges", "<f4"),
    "trianglesPerFace": ("triangles_per_face", "<u4"),
    "segmentsPerEdge": ("segments_per_edge", "<u4"),
    "faceTypes": ("face_types", "<u4"),
    "edgeTypes": ("edge_types", "<u4"),
}


# The ``role`` of a part that is a reference (``loader.Layouts``); a part with none is one to make.
REFERENCE = "reference"


def build_scene(
    layouts: dict[str, dict[str, Any]], model: str, kept: dict[Any, Any] | None = None
) -> tuple[dict[str, Any], bytes, dict[str, Any]]:
    """Tessellate every part of every layout.

    Returns the Scene dict (without ``seconds`` and ``output``), the blob its
    buffers point into, and the shapes by part key, in the object frame, for
    queries. Into ``kept``, when one is given, goes what was worked out of
    each part that a query would otherwise work out again (``queries.run``):
    its ``volume`` (an ``extent.Volume``), its ``box`` and whether that is
    its own (``boxed``), whether it is ``valid`` and the ``deflection`` it
    was drawn with, each under ``(what, key)``.

    The names in ``layouts.references`` (``loader.Layouts``) are told ``role: "reference"`` and noted in ``kept``.

    Parts of the print layout that overlap are first moved apart along X. The
    shape itself is moved, so the mesh, the bounding box and the shape kept for
    queries all agree; the part says how far in ``arranged``.
    """
    blob = bytearray()
    parts = []
    shapes = {}
    references = getattr(layouts, "references", frozenset())
    # The solids integrated so far: one placed in two layouts is integrated once.
    solids: list[tuple[Any, extent.Volume]] = []
    for layout, named in layouts.items():
        moves: dict[str, list[float]] = {}
        if layout == ARRANGED_LAYOUT:
            named, moves = arrange.spread(named)
        # One layout at a time, so a name may repeat across layouts.
        for name, shape, mesh, loc, cache_id, drawn_at in _tessellate(named):
            key = f"{layout}:{name}"
            shapes[key] = shape
            volume = extent.volume(shape, solids)
            part = _part(key, name, layout, shape, mesh, loc, cache_id, blob, volume, drawn_at)
            # Whether its box is the kernel's, to keep for queries: not for the scene.
            boxed = part.pop("boxed")
            if kept is not None:
                kept["volume", key] = volume
                kept["valid", key] = part["valid"]
                kept["deflection", key] = drawn_at
                if boxed:
                    kept["box", key] = (part["bbox"]["min"], part["bbox"]["max"])
                    kept["boxed", key] = part["bboxExact"]
            if name in moves:
                part["arranged"] = moves[name]
            if name in references:
                # Bought, not made: drawn and checked against, left out of what is printed, weighed and exported.
                part["role"] = REFERENCE
                if kept is not None:
                    kept["reference", key] = True
            parts.append(part)
    scene = {"model": model, "layouts": list(layouts), "parts": parts}
    return scene, bytes(blob), shapes


def part_box(
    shape: Any, within: float | None = None, drawn: dict[str, list[float]] | None = None
) -> tuple[list[float], list[float]]:
    """The box of a part in the object frame, as the scene, ``describe`` and ``measure`` tell it.

    The kernel's (``extent.box``). Of a part whose box is not exact
    (``extent.boxed_exactly``) it is widened to hold the mesh the part is
    drawn with, ``drawn`` when the caller has its box: every vertex of that
    is a point of the part, to a millionth of its extent, and OCC's box has
    been short of one. ``within`` as ``extent.box`` takes it.
    """
    low, high = extent.box(shape, within)
    if extent.boxed_exactly(shape):
        return low, high
    if drawn is None:
        try:
            drawn = _span(mesh_of(shape)[0])
        except Exception:
            # What cannot be meshed alone is drawn with nothing to hold.
            return low, high
    # Not by what single precision leaves of a vertex: 0.000003 mm under a part of 200 is on it.
    least = OF_THE_PART * math.dist(low, high)
    return (
        [b if b < a - least else a for a, b in zip(low, drawn["min"], strict=True)],
        [b if b > a + least else a for a, b in zip(high, drawn["max"], strict=True)],
    )


def mesh_of(shape: Any) -> tuple[np.ndarray, np.ndarray]:
    """The mesh one part is drawn with: its vertices in the object frame, and its triangles.

    The same tessellation as the scene's, at the same tolerances, so what is
    found of it is true of what is shown and exported. ocp-tessellate keeps
    the mesh of a shape it has meshed, so asking again costs little.
    """
    [(_, _, mesh, loc, _, _)] = _tessellate({"part": shape})
    vertices = np.asarray(mesh["vertices"]).reshape(-1, 3)
    triangles = np.asarray(mesh["triangles"]).reshape(-1, 3)
    return _posed(vertices, [float(x) for x in loc[0]], [float(x) for x in loc[1]]), triangles


def mesh_faces(shape: Any) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """As ``mesh_of``, with how many of the triangles each face has, in the order of the faces."""
    [(_, _, mesh, loc, _, _)] = _tessellate({"part": shape})
    vertices = np.asarray(mesh["vertices"]).reshape(-1, 3)
    triangles = np.asarray(mesh["triangles"]).reshape(-1, 3)
    per_face = np.asarray(mesh["triangles_per_face"], dtype=np.int64).reshape(-1)
    return _posed(vertices, [float(x) for x in loc[0]], [float(x) for x in loc[1]]), triangles, per_face


def deflection(shape: Any) -> float:
    """How far, in mm, the mesh a part is drawn with may be from its faces.

    Asked of ocp-tessellate itself, of the box it meshes the part by: the
    part's own, before it is posed, so a part turned in its layout is drawn
    as finely as one that is not. 0 for a part with no extent.

    That box is not the same once the part carries a mesh: what a build drew
    a part with is what ``build_scene`` kept of it, not what this says after.
    """
    from ocp_tessellate.convert import to_ocpgroup

    _, instances = to_ocpgroup(shape, names=["part"])
    return _quality(instances[0]["obj"]) if instances else 0.0


def _quality(instance: Any) -> float:
    """The deflection ocp-tessellate meshes one of its instances at, mm."""
    from ocp_tessellate.ocp_utils import bounding_box
    from ocp_tessellate.tessellator import compute_quality

    try:
        box = bounding_box(instance, loc=None, optimal=False)
        return float(compute_quality(box, deviation=DEVIATION))
    except ValueError:
        # A box with a side of no length has no logarithm to round it by.
        return 0.0


def _tessellate(named: dict[str, Any]) -> list[tuple[str, Any, dict, Any, str | None, float]]:
    """Mesh one layout: (name, shape, mesh arrays, loc, cache id, deflection) per part."""
    # ocp-tessellate needs OCP from the user's workspace, so it is imported only here.
    from ocp_tessellate.convert import tessellate_group, to_ocpgroup

    names = list(named)
    group, instances = to_ocpgroup(*named.values(), names=names)
    # Before they are meshed, as ocp-tessellate works it out itself. A part's
    # ref numbers its instance here: ocp-tessellate renumbers them only when it
    # drops one whose mesh is empty, and then a part is missing and this fails below.
    drawn_at = [_quality(instance["obj"]) for instance in instances]
    meshed, tree, mapping = tessellate_group(
        group,
        instances,
        kwargs={"deviation": DEVIATION, "angular_tolerance": ANGULAR_TOLERANCE},
    )
    nodes = tree["parts"]
    if len(nodes) != len(names) or any("shape" not in node for node in nodes):
        raise ValueError(
            f"expected one solid shape per part for {', '.join(names)}; "
            "a part that is not a single shape cannot be shown"
        )
    return [
        (
            name,
            named[name],
            meshed[node["shape"]["ref"]],
            node["loc"],
            mapped.get("shape", {}).get("cache_id"),
            drawn_at[node["shape"]["ref"]],
        )
        for name, node, mapped in zip(names, nodes, mapping["parts"], strict=True)
    ]


def _part(
    key: str,
    name: str,
    layout: str,
    shape: Any,
    mesh: dict[str, np.ndarray],
    loc: Any,
    cache_id: str | None,
    blob: bytearray,
    volume: extent.Volume,
    drawn_at: float = 0.0,
) -> dict[str, Any]:
    t = [float(x) for x in loc[0]]
    q = [float(x) for x in loc[1]]
    arrays = {
        scene_key: np.ascontiguousarray(mesh[source]).astype(dtype, copy=False).ravel()
        for scene_key, (source, dtype) in _BUFFERS.items()
    }
    vertices = arrays["vertices"]
    drawn = _bbox(vertices, t, q)
    try:
        low, high = part_box(shape, BOX_SECONDS, drawn)
        box, boxed, exact = {"min": low, "max": high}, True, extent.boxed_exactly(shape)
    except extent.TookTooLong:
        box, boxed, exact = drawn, False, False
    told = {
        "key": key,
        "name": name,
        "layout": layout,
        "loc": {"t": t, "q": q},
        "bbox": box,
        "bboxExact": exact,
        "boxed": boxed,
        # Above 0 of a solid: the window cuts a part with a volume as a closed one. A size even
        # of a solid turned inside out, which ``reversed`` then names.
        "volume": volume.value,
        "volumeExact": volume.exact,
        "faceCount": len(arrays["trianglesPerFace"]),
        "edgeCount": len(arrays["segmentsPerEdge"]),
        "triangleCount": len(arrays["triangles"]) // 3,
        "valid": bool(shape.is_valid),
        "hash": cache_id or hashlib.sha256(vertices.tobytes()).hexdigest(),
        "mesh": {scene_key: _append(blob, array) for scene_key, array in {**arrays, **_snap(shape, t, q)}.items()},
    }
    if volume.reversed:
        # Which solids of the part are inside out, 0-based in OCC's order: absent of a sound part.
        told["reversed"] = list(volume.reversed)
    # How far a number that is not exact may be from the true one, as the kernel can say it: so that two builds of an
    # untouched part, whose last digits may differ, are not told apart. Of the volume its spread (``extent.Volume``);
    # of the box the deflection it was drawn at, which bounds how far the mesh it is widened to, or is, lies off.
    if not volume.exact:
        told["volumeDoubt"] = volume.spread
    if not exact:
        told["bboxDoubt"] = drawn_at
    told.update(_sanity(shape, arrays, volume, drawn_at))
    return told


def _snap(shape: Any, t: list[float], q: list[float]) -> dict[str, np.ndarray]:
    """What a window snaps a point to, exact from the B-rep and part-local like the mesh.

    ``points``: every vertex, three floats each, in the order ``V<i>`` names them (``topo.vertices``). ``circles``:
    eight floats for each edge whose curve is a circle, whole or an arc: ``edge`` (its ``E<i>`` index, ``topo.edges``),
    the centre, the axis (a unit vector) and the radius. A degenerate edge has no curve and no entry.
    """
    from OCP.BRep import BRep_Tool
    from OCP.BRepAdaptor import BRepAdaptor_Curve

    rotation, shift = _rotation(q), np.array(t)

    def local(point: Any) -> np.ndarray:
        return rotation.T @ (np.array([point.X(), point.Y(), point.Z()]) - shift)

    points = np.array([local(BRep_Tool.Pnt_s(v)) for v in topo.vertices(shape)], dtype="<f4").reshape(-1, 3)
    circles = []
    for index, edge in enumerate(topo.edges(shape)):
        if BRep_Tool.Degenerated_s(edge):
            continue
        try:
            curve = BRepAdaptor_Curve(edge)
            if extent._kind(curve) != "CIRCLE":
                continue
            circle = curve.Circle()
            direction = circle.Axis().Direction()
            centre = local(circle.Location())
            axis = rotation.T @ np.array([direction.X(), direction.Y(), direction.Z()])
            circles.append([index, *centre, *axis, circle.Radius()])
        except Exception:
            # An edge with no curve to read: no snap on it.
            continue
    return {"points": points.ravel(), "circles": np.array(circles, dtype="<f4").ravel()}


def _sanity(shape: Any, arrays: dict[str, np.ndarray], volume: extent.Volume, drawn_at: float) -> dict[str, Any]:
    """What a build tells of a part besides its sizes, for main to hold one build against the next.

    ``solids``, how many it has, and ``openShells``, how many of its shells have a free edge; ``meshVolume``, the size
    of what its own mesh encloses (never exact: a sum over the triangles it is drawn with, no integral), and
    ``meshDisagrees``, only when that and the B-rep's volume are further apart than the mesh's deflection and the
    volume's own doubt explain (``MESH_SLACK``): one of the two is wrong. Not judged of a part with no solid, an open
    shell or a solid inside out, whose mesh is no check of its volume and which is told as broken otherwise.
    """
    shells = topo.open_shells(shape)
    told: dict[str, Any] = {"solids": len(topo.solids(shape)), "openShells": shells}
    enclosed, area = _enclosed(arrays["vertices"], arrays["triangles"])
    told["meshVolume"] = abs(enclosed)
    if told["solids"] > 0 and shells == 0 and not volume.reversed:
        slack = MESH_SLACK * drawn_at * area + volume.spread + 1e-9 * volume.value
        if abs(abs(enclosed) - volume.value) > slack:
            told["meshDisagrees"] = True
    return told


def _enclosed(vertices: np.ndarray, triangles: np.ndarray) -> tuple[float, float]:
    """The volume a mesh encloses, with the sign its triangles' winding gives it, and its area: part-local, mm³ and mm²."""
    points = vertices.reshape(-1, 3).astype(np.float64)
    corners = triangles.reshape(-1, 3)
    if len(corners) == 0:
        return 0.0, 0.0
    a, b, c = points[corners[:, 0]], points[corners[:, 1]], points[corners[:, 2]]
    volume = float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum()) / 6
    area = float(np.linalg.norm(np.cross(b - a, c - a), axis=1).sum()) / 2
    return volume, area


def _append(blob: bytearray, array: np.ndarray) -> dict[str, int]:
    """Add an array to the blob on a 4-byte boundary and return its Buf."""
    blob.extend(b"\0" * (-len(blob) % 4))
    data = array.tobytes()
    buf = {"offset": len(blob), "length": len(data)}
    blob.extend(data)
    return buf


def _bbox(vertices: np.ndarray, t: list[float], q: list[float]) -> dict[str, list[float]]:
    """Bounding box of part-local vertices after the pose, in the object frame."""
    return _span(_posed(vertices.reshape(-1, 3), t, q))


def _span(points: np.ndarray) -> dict[str, list[float]]:
    return {"min": points.min(axis=0).tolist(), "max": points.max(axis=0).tolist()}


def _posed(points: np.ndarray, t: list[float], q: list[float]) -> np.ndarray:
    """Part-local points after the pose, in the object frame."""
    return points.astype(np.float64) @ _rotation(q).T + np.array(t)


def _rotation(q: list[float]) -> np.ndarray:
    """Rotation matrix of a unit quaternion given as xyzw."""
    x, y, z, w = q
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]
    )
