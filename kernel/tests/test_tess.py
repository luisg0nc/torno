import math
import json
from itertools import pairwise
from pathlib import Path

import numpy as np
import pytest

from torno_kernel import topo
from torno_kernel.loader import load_scene
from torno_kernel.tess import build_scene

MESH_BUFFERS = {
    "vertices",
    "normals",
    "triangles",
    "edges",
    "trianglesPerFace",
    "segmentsPerEdge",
    "faceTypes",
    "edgeTypes",
}
# What a build also tells for snapping: the B-rep's vertices and its circles.
SNAP_BUFFERS = {"points", "circles"}


@pytest.fixture(scope="module")
def bracket():
    ws = Path(__file__).parent / "fixtures" / "ws"
    return build_scene(load_scene(ws / "bracket", "bracket.py"), "bracket.py")


def read(blob: bytes, buf: dict, dtype: str) -> np.ndarray:
    return np.frombuffer(blob, dtype=dtype, count=buf["length"] // 4, offset=buf["offset"])


def part(scene: dict, key: str) -> dict:
    return next(p for p in scene["parts"] if p["key"] == key)


def assert_counts_agree(p: dict, blob: bytes, shape) -> None:
    mesh = p["mesh"]
    triangles_per_face = read(blob, mesh["trianglesPerFace"], "<u4")
    segments_per_edge = read(blob, mesh["segmentsPerEdge"], "<u4")
    triangles = read(blob, mesh["triangles"], "<u4")
    vertices = read(blob, mesh["vertices"], "<f4")

    assert p["triangleCount"] > 0
    assert triangles_per_face.sum() == p["triangleCount"] == len(triangles) / 3
    assert len(triangles_per_face) == p["faceCount"] == len(topo.faces(shape))
    assert len(segments_per_edge) == p["edgeCount"] == len(topo.edges(shape))

    assert len(read(blob, mesh["faceTypes"], "<u4")) == p["faceCount"]
    assert len(read(blob, mesh["edgeTypes"], "<u4")) == p["edgeCount"]
    assert len(read(blob, mesh["edges"], "<f4")) == 6 * segments_per_edge.sum()
    assert len(read(blob, mesh["normals"], "<f4")) == len(vertices)
    assert len(vertices) % 3 == 0
    assert triangles.max() < len(vertices) / 3


def to_object_frame(flat: np.ndarray, loc: dict) -> np.ndarray:
    """Apply a part's pose to flat xyz floats; returns an (n, 3) array."""
    v = flat.reshape(-1, 3).astype(np.float64)
    u, w = np.array(loc["q"][:3]), loc["q"][3]
    return v + 2 * w * np.cross(u, v) + 2 * np.cross(u, np.cross(u, v)) + np.array(loc["t"])


def assert_inside(points: np.ndarray, box, what: str) -> None:
    tol = 0.05
    assert (points >= np.array(list(box.min)) - tol).all(), what
    assert (points <= np.array(list(box.max)) + tol).all(), what


def assert_mesh_lies_on_topology(p: dict, blob: bytes, shape) -> None:
    """Face i's triangles lie on topo.faces(shape)[i]; likewise edge segments."""
    from build123d import Edge, Face

    mesh = p["mesh"]
    vertices = to_object_frame(read(blob, mesh["vertices"], "<f4"), p["loc"])
    triangles = read(blob, mesh["triangles"], "<u4").reshape(-1, 3)
    start = 0
    for i, count in enumerate(read(blob, mesh["trianglesPerFace"], "<u4")):
        box = Face(topo.faces(shape)[i]).bounding_box()
        assert_inside(vertices[triangles[start : start + count].ravel()], box, f"face {i}")
        start += count

    segments = to_object_frame(read(blob, mesh["edges"], "<f4"), p["loc"]).reshape(-1, 2, 3)
    start = 0
    for i, count in enumerate(read(blob, mesh["segmentsPerEdge"], "<u4")):
        if count:
            box = Edge(topo.edges(shape)[i]).bounding_box()
            assert_inside(segments[start : start + count].reshape(-1, 3), box, f"edge {i}")
        start += count


def test_bracket_scene_lists_model_layouts_and_part_keys(bracket):
    scene, _, shapes = bracket
    assert scene["model"] == "bracket.py"
    assert scene["layouts"] == ["assembly", "print"]
    keys = ["assembly:base", "assembly:post", "print:base", "print:post"]
    assert [p["key"] for p in scene["parts"]] == keys
    assert list(shapes) == keys
    assert [(p["layout"], p["name"]) for p in scene["parts"]] == [
        ("assembly", "base"),
        ("assembly", "post"),
        ("print", "base"),
        ("print", "post"),
    ]
    assert "seconds" not in scene
    assert "output" not in scene


def test_bracket_mesh_counts_agree_with_topology(bracket):
    scene, blob, shapes = bracket
    for p in scene["parts"]:
        assert_counts_agree(p, blob, shapes[p["key"]])


def test_bracket_buffers_are_aligned_and_inside_the_blob(bracket):
    scene, blob, _ = bracket
    spans = []
    for p in scene["parts"]:
        assert set(p["mesh"]) == MESH_BUFFERS | SNAP_BUFFERS
        for buf in p["mesh"].values():
            assert set(buf) == {"offset", "length"}
            assert buf["offset"] % 4 == 0
            assert buf["length"] % 4 == 0
            assert 0 <= buf["offset"] and buf["offset"] + buf["length"] <= len(blob)
            spans.append((buf["offset"], buf["offset"] + buf["length"]))
    spans.sort()
    for (_, end), (start, _) in pairwise(spans):
        assert end <= start


def test_bracket_base_bbox_and_volume(bracket):
    scene, _, _ = bracket
    base = part(scene, "assembly:base")
    assert base["bbox"]["min"] == pytest.approx([-20, -15, -2.5], abs=1e-3)
    assert base["bbox"]["max"] == pytest.approx([20, 15, 2.5], abs=1e-3)
    assert base["volume"] == pytest.approx(6000, abs=1e-6)
    assert base["valid"] is True
    assert base["faceCount"] == 6
    assert base["edgeCount"] == 12
    assert base["triangleCount"] == 12


def test_bracket_post_bbox_has_the_pose_applied(bracket):
    scene, _, _ = bracket
    post = part(scene, "assembly:post")
    assert post["bbox"]["min"][2] == pytest.approx(2.5, abs=1e-3)
    assert post["bbox"]["max"][2] == pytest.approx(22.5, abs=1e-3)


def test_bracket_rotated_post_bbox_is_in_the_object_frame(bracket):
    # print:post is Pos(60, 0, 4) * Rot(90, 0, 0) * Cylinder(4, 20): its axis lies along Y.
    scene, _, _ = bracket
    post = part(scene, "print:post")
    assert post["bbox"]["min"] == pytest.approx([56, -10, 0], abs=0.05)
    assert post["bbox"]["max"] == pytest.approx([64, 10, 8], abs=0.05)


def test_bracket_loc_takes_mesh_vertices_to_the_object_frame(bracket):
    scene, blob, shapes = bracket
    for p in scene["parts"]:
        points = to_object_frame(read(blob, p["mesh"]["vertices"], "<f4"), p["loc"])
        box = shapes[p["key"]].bounding_box()
        assert points.min(axis=0) == pytest.approx(list(box.min), abs=0.05)
        assert points.max(axis=0) == pytest.approx(list(box.max), abs=0.05)


def test_bracket_mesh_faces_and_edges_lie_on_their_topology(bracket):
    scene, blob, shapes = bracket
    for p in scene["parts"]:
        assert_mesh_lies_on_topology(p, blob, shapes[p["key"]])


def test_bracket_shapes_for_queries_are_in_the_object_frame(bracket):
    _, _, shapes = bracket
    assert shapes["assembly:post"].center().Z == pytest.approx(12.5)
    assert shapes["print:post"].center().X == pytest.approx(60)


def test_bracket_scene_is_json_serialisable(bracket):
    scene, _, _ = bracket
    assert json.loads(json.dumps(scene)) == scene


def test_bracket_hashes_are_strings_shared_by_equal_geometry_only(bracket):
    scene, _, _ = bracket
    hashes = {p["key"]: p["hash"] for p in scene["parts"]}
    assert all(isinstance(h, str) and h for h in hashes.values())
    assert hashes["assembly:base"] != hashes["assembly:post"]


def test_face_order_matches_build123d_faces(bracket):
    _, _, shapes = bracket
    for shape in shapes.values():
        ours = topo.faces(shape)
        theirs = [f.wrapped for f in shape.faces()]
        assert len(ours) == len(theirs)
        assert all(a.IsSame(b) for a, b in zip(ours, theirs))


def test_sphere_topped_part_counts_degenerate_edges():
    from build123d import Cylinder, Pos, Sphere

    shape = Cylinder(5, 10) + Pos(0, 0, 5) * Sphere(5)
    scene, blob, shapes = build_scene({"main": {"dome": shape}}, "dome.py")
    (p,) = scene["parts"]
    assert p["key"] == "main:dome"
    assert_counts_agree(p, blob, shapes["main:dome"])
    assert_mesh_lies_on_topology(p, blob, shapes["main:dome"])
    # The sphere's pole is a degenerate edge, which shape.edges() leaves out.
    assert p["edgeCount"] == 5
    assert len(shape.edges()) == 4


# ---- print layouts are spread along X ----


def xy_boxes(scene: dict, layout: str) -> list[tuple[float, float, float, float]]:
    return [
        (p["bbox"]["min"][0], p["bbox"]["max"][0], p["bbox"]["min"][1], p["bbox"]["max"][1])
        for p in scene["parts"]
        if p["layout"] == layout
    ]


def overlapping(boxes) -> bool:
    return any(
        a[0] < b[1] and b[0] < a[1] and a[2] < b[3] and b[2] < a[3]
        for i, a in enumerate(boxes)
        for b in boxes[i + 1 :]
    )


@pytest.fixture(scope="module")
def stacked():
    """Three parts, each posed for the bed at the origin, as printables() often returns them."""
    from build123d import Box, Cylinder, Pos

    named = {
        "plate": Pos(0, 0, 1) * Box(40, 30, 2),
        "post": Pos(0, 5, 10) * Cylinder(4, 20),
        "cap": Pos(3, -2, 2.5) * Box(10, 10, 5),
    }
    volumes = {name: shape.volume for name, shape in named.items()}
    layouts = {"assembly": dict(named), "print": dict(named)}
    scene, blob, shapes = build_scene(layouts, "stacked.py")
    return scene, blob, shapes, volumes


def test_overlapping_print_parts_are_spread_side_by_side_along_x(stacked):
    scene, _, _, _ = stacked
    boxes = xy_boxes(scene, "print")
    assert not overlapping(boxes)
    # In insertion order, 10 mm apart; the first stays where it was.
    assert boxes[0][0] == pytest.approx(-20, abs=0.01)
    for a, b in pairwise(boxes):
        assert b[0] - a[1] == pytest.approx(10, abs=0.05)


def test_spread_parts_keep_their_own_y_and_z_and_say_how_far_they_moved(stacked):
    scene, _, _, _ = stacked
    plate, post, cap = (part(scene, f"print:{name}") for name in ("plate", "post", "cap"))
    assert "arranged" not in plate
    # post: its left edge was at -4, and goes to 20 + 10.
    assert post["arranged"] == pytest.approx([34, 0, 0], abs=0.01)
    # cap: its left edge was at -2, and goes to 38 + 10.
    assert cap["arranged"] == pytest.approx([50, 0, 0], abs=0.01)
    assert post["bbox"]["min"][1:] == pytest.approx([1, 0], abs=0.05)
    assert post["bbox"]["max"][1:] == pytest.approx([9, 20], abs=0.05)
    assert cap["bbox"]["min"][1:] == pytest.approx([-7, 0], abs=0.05)


def test_spreading_moves_the_shapes_kept_for_queries_and_changes_no_volume(stacked):
    scene, _, shapes, volumes = stacked
    for name, volume in volumes.items():
        p = part(scene, f"print:{name}")
        assert p["volume"] == pytest.approx(volume)
        box = shapes[f"print:{name}"].bounding_box()
        assert list(box.min) == pytest.approx(p["bbox"]["min"], abs=0.05)
        assert list(box.max) == pytest.approx(p["bbox"]["max"], abs=0.05)


def test_only_the_print_layout_is_spread(stacked):
    scene, _, shapes, _ = stacked
    assert overlapping(xy_boxes(scene, "assembly"))
    for p in scene["parts"]:
        if p["layout"] == "assembly":
            assert "arranged" not in p
    assert shapes["assembly:post"].center().X == pytest.approx(0)


def test_a_print_layout_that_does_not_overlap_is_left_alone(bracket):
    scene, _, shapes = bracket
    for p in scene["parts"]:
        assert "arranged" not in p
    assert shapes["print:post"].center().X == pytest.approx(60)


def test_print_parts_that_only_touch_are_left_alone():
    from build123d import Box, Pos

    layouts = {"print": {"a": Box(10, 10, 2), "b": Pos(10, 0, 0) * Box(10, 10, 2)}}
    scene, _, _ = build_scene(layouts, "touch.py")
    assert all("arranged" not in p for p in scene["parts"])


def test_spread_scene_is_json_serialisable(stacked):
    json.dumps(stacked[0], allow_nan=False)


# Volumes: once per solid, never as finely as costs minutes


def test_a_solid_placed_in_two_layouts_is_integrated_once_and_a_build_spends_little_on_volumes(monkeypatch):
    from build123d import Circle, Ellipse, Pos, loft

    from torno_kernel import extent

    horn = loft([Circle(10).face(), Pos(0, 0, 15) * Ellipse(13.5, 5).face(), Pos(3, 0, 30) * Circle(4).face()])
    other = loft([Circle(8).face(), Pos(0, 0, 15) * Ellipse(13.5, 5).face(), Pos(3, 0, 30) * Circle(4).face()])
    asked: list[float] = []
    clock = [0.0]
    integrate = extent._gauss_kronrod

    def counted(wrapped, tolerance, centre):
        asked.append(tolerance)
        clock[0] += 0.5  # as on a part of a hundred freeform faces
        return integrate(wrapped, tolerance, centre)

    monkeypatch.setattr(extent, "_gauss_kronrod", counted)
    monkeypatch.setattr(extent, "_clock", lambda: clock[0])
    layouts = {
        "assembly": {"horn": horn, "other": Pos(40, 0, 0) * other},
        "print": {"horn": Pos(0, 50, 0) * horn, "other": Pos(40, 50, 0) * other},
    }
    kept: dict = {}
    scene, _, shapes = build_scene(layouts, "horns.py", kept)
    # Two solids in two layouts each: one integral of each solid, which took all a volume has
    # by this clock, and no second of unknown cost.
    assert asked == [extent.VOLUME_TOLERANCES[0]] * 2
    assert clock[0] == 1.0
    volumes = {p["key"]: (p["volume"], p["volumeExact"]) for p in scene["parts"]}
    assert volumes["assembly:horn"] == volumes["print:horn"] != volumes["assembly:other"]
    assert all(volume > 0 and exact is False for volume, exact in volumes.values())
    assert {key: (kept["volume", key].value, kept["volume", key].exact) for key in shapes} == volumes


def test_the_scene_says_which_volumes_are_exact(bracket):
    scene, _, _ = bracket
    assert all(p["volumeExact"] is True for p in scene["parts"])


# A part's box: the kernel's, the same wherever it is told, and exact only when it is


def horn_and_ball():
    from build123d import Circle, Ellipse, Pos, Rot, Sphere, loft

    horn = loft([Circle(10).face(), Pos(0, 0, 15) * Ellipse(13.5, 5).face(), Pos(3, 0, 30) * Circle(4).face()])
    return {"horn": Pos(5, 0, 0) * Rot(20, 30, 40) * horn, "ball": Pos(60, 0, 0) * Sphere(7)}


def test_the_box_of_planes_and_cylinders_is_the_kernel_s_and_exact(bracket):
    scene, _, _ = bracket
    base, post = part(scene, "assembly:base"), part(scene, "print:post")
    # Of the B-rep, not of a mesh kept in single precision: to the last digit.
    assert (base["bbox"], base["bboxExact"]) == ({"min": [-20, -15, -2.5], "max": [20, 15, 2.5]}, True)
    assert post["bboxExact"] is True
    assert post["bbox"]["min"] == pytest.approx([56, -10, 0], abs=1e-9)
    assert post["bbox"]["max"] == pytest.approx([64, 10, 8], abs=1e-9)


@pytest.mark.parametrize("keeping", [True, False])
def test_scene_describe_and_measure_tell_one_box_of_a_freeform_part_and_none_as_exact(keeping):
    from torno_kernel import queries

    kept: dict = {}
    scene, _, shapes = build_scene({"assembly": horn_and_ball()}, "horn.py", kept)
    for name in ("horn", "ball"):
        key = f"assembly:{name}"
        told = part(scene, key)
        assert told["bboxExact"] is False
        # As a worker answers, from what its build kept, and as a query with nothing kept.
        held = kept if keeping else None
        described = queries.run(shapes, "describe", {"ref": key}, held)
        measured = queries.run(shapes, "measure", {"kind": "bbox", "a": {"ref": key}}, held)
        assert described["bbox"] == told["bbox"] == {"min": measured["min"], "max": measured["max"]}
        assert (described["bboxExact"], measured["exact"]) == (False, False)
        assert described["descriptor"].startswith("part, ≈ ")
    ball = part(scene, "assembly:ball")["bbox"]
    assert ball["min"] == pytest.approx([53, -7, -7], abs=1e-3)
    assert ball["max"] == pytest.approx([67, 7, 7], abs=1e-3)


def test_a_box_the_kernel_has_short_of_a_freeform_part_holds_its_mesh_all_the_same(monkeypatch):
    """OCC's optimal box was 0.56 mm short of a pad 130 mm wide: no point drawn is outside the box told."""
    from build123d import Sphere

    from torno_kernel import extent, queries

    monkeypatch.setattr(extent, "box", lambda shape, within=None: ([-6.0, -6.5, -9.0], [6.0, 6.5, 6.0]))
    kept: dict = {}
    scene, blob, shapes = build_scene({"assembly": {"ball": Sphere(7)}}, "ball.py", kept)
    told = part(scene, "assembly:ball")
    vertices = read(blob, told["mesh"]["vertices"], "<f4").reshape(-1, 3)
    # The lower Z of what OCC said is kept: it is no nearer than the mesh's.
    assert told["bbox"]["min"] == pytest.approx([*vertices.min(axis=0)[:2], -9.0], abs=1e-6)
    assert told["bbox"]["max"] == pytest.approx(vertices.max(axis=0), abs=1e-6)
    assert queries.run(shapes, "describe", {"ref": "assembly:ball"}, kept)["bbox"] == told["bbox"]
    assert queries.run(shapes, "describe", {"ref": "assembly:ball"}, None)["bbox"] == told["bbox"]


def test_a_box_that_takes_too_long_is_left_to_the_first_query_and_the_scene_has_the_mesh_s(bracket, monkeypatch):
    from torno_kernel import extent, queries, tess

    ws = Path(__file__).parent / "fixtures" / "ws"
    clock = [0.0]

    def ticking() -> float:
        # Each look at the clock is 0.3 s after the last: a face is boxed in as long.
        clock[0] += 0.3
        return clock[0]

    monkeypatch.setattr(extent, "_clock", ticking)
    kept: dict = {}
    scene, blob, shapes = build_scene(load_scene(ws / "bracket", "bracket.py"), "bracket.py", kept)
    base = part(scene, "assembly:base")
    # Six faces: the fourth is past the second a part has. The mesh's box, said as approximate.
    assert base["bboxExact"] is False
    assert base["bbox"]["min"] == pytest.approx([-20, -15, -2.5], abs=1e-3)
    assert ("box", "assembly:base") not in kept
    assert tess.BOX_SECONDS == 1.0
    # Asked, it is worked out however long it takes, and kept.
    monkeypatch.setattr(extent, "_clock", lambda: 0.0)
    described = queries.run(shapes, "describe", {"ref": "assembly:base"}, kept)
    assert (described["bbox"], described["bboxExact"]) == ({"min": [-20, -15, -2.5], "max": [20, 15, 2.5]}, True)
    assert kept["box", "assembly:base"] == ([-20, -15, -2.5], [20, 15, 2.5])


def test_a_box_taken_face_by_face_is_the_one_occ_takes_of_the_whole(bracket):
    from build123d import Box, Compound, Edge, Sphere, Vertex
    from OCP.Bnd import Bnd_Box
    from OCP.BRepBndLib import BRepBndLib

    from torno_kernel import extent

    _, _, shapes = bracket
    loose = Compound([Box(10, 10, 10), Edge.make_line((0, 0, 0), (30, 40, 50)), Vertex(-9, -8, -7)])
    for shape in (*shapes.values(), *horn_and_ball().values(), Sphere(7).faces()[0], loose):
        whole = Bnd_Box()
        BRepBndLib.AddOptimal_s(shape.wrapped, whole, False, False)
        low, high = whole.CornerMin(), whole.CornerMax()
        assert extent.box(shape) == (
            [low.X() + 0.0, low.Y() + 0.0, low.Z() + 0.0],
            [high.X() + 0.0, high.Y() + 0.0, high.Z() + 0.0],
        )


def test_a_box_is_not_widened_by_what_single_precision_leaves_of_a_mesh(monkeypatch):
    from build123d import Sphere

    from torno_kernel import extent, tess

    monkeypatch.setattr(extent, "box", lambda shape, within=None: ([0.0, 0.0, 0.0], [10.0, 10.0, 10.0]))
    drawn = {"min": [-2.7e-6, 0.0, -1.0], "max": [10.000001, 10.0, 9.0]}
    # A vertex 0.0000027 mm under a part of 17 mm is on it: one a millimetre under is not.
    assert tess.part_box(Sphere(7), drawn=drawn) == ([0.0, 0.0, -1.0], [10.0, 10.0, 10.0])


# The sanity of a part, told with every build: its solids, its open shells and what its own mesh encloses


def sanity_of(**named):
    scene, _, _ = build_scene({"assembly": named}, "sane.py")
    return {p["name"]: p for p in scene["parts"]}


def open_box():
    """A 10 mm box without its top: one shell with four free edges, and no solid."""
    from build123d import Box, Shell

    return Shell(Box(10, 10, 10).faces()[:-1])


def void_turned_outward():
    """A 20 mm box with a 10 mm cavity whose shell faces into it: OCC integrates the void as material."""
    from build123d import Box, Solid
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeSolid
    from OCP.TopoDS import TopoDS

    made = BRepBuilderAPI_MakeSolid(TopoDS.Shell(Box(20, 20, 20).shells()[0].wrapped))
    made.Add(TopoDS.Shell(Box(10, 10, 10).shells()[0].wrapped))
    return Solid(made.Solid())


def test_a_part_says_how_many_solids_it_has():
    from build123d import Box, Compound, Pos

    parts = sanity_of(one=Box(10, 10, 10), two=Compound([Box(10, 10, 10), Pos(30, 0, 0) * Box(5, 5, 5)]), shell=open_box())
    assert [parts[name]["solids"] for name in ("one", "two", "shell")] == [1, 2, 0]


def test_a_part_counts_the_shells_with_free_edges():
    from build123d import Box, Cylinder, Sphere

    # A seam and a pole are no free edge: a cylinder and a sphere are closed.
    parts = sanity_of(box=Box(10, 10, 10), cylinder=Cylinder(5, 10), ball=Sphere(5), shell=open_box(), void=void_turned_outward())
    assert {name: p["openShells"] for name, p in parts.items()} == {"box": 0, "cylinder": 0, "ball": 0, "shell": 1, "void": 0}


def test_a_void_turned_outward_is_not_valid():
    from build123d import Box

    # Its volume reads 9000 where 7000 is the material, and positive: only OCC's check says it is broken.
    parts = sanity_of(void=void_turned_outward(), cut=Box(20, 20, 20) - Box(10, 10, 10))
    assert (parts["void"]["valid"], parts["void"]["volume"]) == (False, pytest.approx(9000))
    assert (parts["cut"]["valid"], parts["cut"]["volume"]) == (True, pytest.approx(7000))


def test_a_part_tells_the_volume_its_mesh_encloses_and_that_it_agrees():
    from build123d import Box, Compound, Cylinder, Pos, Sphere

    parts = sanity_of(box=Box(10, 10, 10), cylinder=Cylinder(5, 10), ball=Sphere(5), two=Compound([Box(10, 10, 10), Pos(30, 0, 0) * Box(5, 5, 5)]))
    assert parts["box"]["meshVolume"] == pytest.approx(1000)
    assert parts["two"]["meshVolume"] == pytest.approx(1125)
    # Chords cut inside a curved face: a little less, within what the mesh's deflection explains.
    for name, exact in (("cylinder", math.pi * 25 * 10), ("ball", 4 / 3 * math.pi * 125)):
        assert exact * 0.99 < parts[name]["meshVolume"] < exact
    assert all("meshDisagrees" not in p for p in parts.values())
    json.dumps(list(parts.values()), allow_nan=False)


def test_a_mesh_that_disagrees_with_the_b_rep_is_said(monkeypatch):
    from build123d import Box

    from torno_kernel import extent, tess

    # As a boolean that left the B-rep smaller than what is drawn of it.
    monkeypatch.setattr(tess.extent, "volume", lambda shape, known=None: extent.Volume(700.0, True))
    parts = sanity_of(box=Box(10, 10, 10))
    assert (parts["box"]["volume"], parts["box"]["meshVolume"], parts["box"]["meshDisagrees"]) == (700.0, pytest.approx(1000), True)


def test_a_mesh_is_not_held_against_a_part_whose_volume_says_nothing():
    from test_extent import cube_reversed

    # Inside out, or open: the mesh's volume is no check of it, and what is wrong is said otherwise.
    parts = sanity_of(bad=cube_reversed(), shell=open_box())
    assert parts["bad"]["meshVolume"] == pytest.approx(1000)
    assert all("meshDisagrees" not in p for p in parts.values())


def test_a_number_that_is_not_exact_comes_with_how_far_the_kernel_says_it_may_be_out():
    from build123d import Box

    from torno_kernel import extent

    parts = sanity_of(box=Box(10, 10, 10), **horn_and_ball())
    # Exact: nothing to doubt, and nothing told.
    assert "volumeDoubt" not in parts["box"] and "bboxDoubt" not in parts["box"]
    horn = parts["horn"]
    assert (horn["volumeExact"], horn["bboxExact"]) == (False, False)
    # The volume's spread, as extent says it of the integrals; the box's, the deflection the part was drawn at.
    loft = horn_and_ball()["horn"]
    assert horn["volumeDoubt"] == pytest.approx(extent.volume(loft).spread, rel=0.5, abs=1e-9)
    assert horn["volumeDoubt"] >= 0
    assert 0 < horn["bboxDoubt"] < 1
    # A sphere's volume is exact, its box is not.
    assert "volumeDoubt" not in parts["ball"] and parts["ball"]["bboxDoubt"] > 0


# ---- the B-rep's vertices and circles, for snapping ----


def holed_box_scene():
    """A box 20 x 20 x 10 with its corner at the origin and a through hole of radius 4 along Z at its centre."""
    from build123d import Box, Cylinder, Pos

    shape = Pos(10, 10, 5) * Box(20, 20, 10) - Pos(10, 10, 5) * Cylinder(4, 10)
    scene, blob, shapes = build_scene({"main": {"plate": shape}}, "plate.py")
    (p,) = scene["parts"]
    return p, blob, shape, shapes["main:plate"]


def test_a_part_carries_its_vertices_in_the_order_v_names_them():
    p, blob, shape, kept = holed_box_scene()
    points = read(blob, p["mesh"]["points"], "<f4").reshape(-1, 3)
    # 8 corners, and a seam vertex on each of the hole's two rims.
    assert len(points) == len(shape.vertices()) == 10
    ours = [v.wrapped for v in shape.vertices()]
    assert len(topo.vertices(kept)) == 10
    assert all(a.IsSame(b) for a, b in zip(topo.vertices(kept), ours))
    for point, vertex in zip(points, shape.vertices()):
        assert np.allclose(point, [vertex.X, vertex.Y, vertex.Z], atol=1e-4)


def test_a_part_carries_its_circles_with_the_index_the_edge_has():
    p, blob, shape, kept = holed_box_scene()
    circles = read(blob, p["mesh"]["circles"], "<f4").reshape(-1, 8)
    assert len(circles) == 2
    assert sorted(float(c[3]) for c in circles) == pytest.approx([0.0, 10.0], abs=1e-4)
    for edge, cx, cy, cz, ax, ay, az, r in circles:
        assert r == pytest.approx(4.0, abs=1e-5)
        assert (cx, cy) == pytest.approx((10.0, 10.0), abs=1e-4)
        assert (ax, ay) == pytest.approx((0.0, 0.0), abs=1e-6)
        assert abs(az) == pytest.approx(1.0, abs=1e-6)
        # The index is the kernel's edge index: that edge is a circle of this centre and radius.
        from build123d import Edge

        e = Edge(topo.edges(kept)[int(edge)])
        assert e.geom_type.name == "CIRCLE"
        assert e.radius == pytest.approx(4.0)
        assert e.arc_center.Z == pytest.approx(cz, abs=1e-4)


def test_an_edge_that_is_not_a_circle_has_no_circle_entry():
    from build123d import BuildLine, BuildPart, BuildSketch, Line, Spline, extrude, make_face

    # A slab with a spline edge on its outline: every other edge is a line.
    with BuildPart() as slab:
        with BuildSketch():
            with BuildLine():
                s = Spline((0, 0), (5, 3), (10, 0), (15, 4))
                Line(s @ 1, (15, -5))
                Line((15, -5), (0, -5))
                Line((0, -5), s @ 0)
            make_face()
        extrude(amount=5)
    scene, blob, _ = build_scene({"main": {"slab": slab.part}}, "slab.py")
    (p,) = scene["parts"]
    assert any(e.geom_type.name == "BSPLINE" for e in slab.part.edges())
    assert p["mesh"]["circles"]["length"] == 0
    assert len(read(blob, p["mesh"]["points"], "<f4")) > 0


def test_a_posed_part_tells_its_points_part_local():
    from build123d import Box, Cylinder, Pos, Rot

    shape = Pos(30, 0, 0) * Rot(0, 0, 90) * (Box(20, 20, 10) - Cylinder(4, 10))
    scene, blob, _ = build_scene({"main": {"p": shape}}, "p.py")
    (p,) = scene["parts"]
    points = read(blob, p["mesh"]["points"], "<f4")
    local = to_object_frame(points, p["loc"]).reshape(-1, 3)
    mine = np.array([[v.X, v.Y, v.Z] for v in shape.vertices()])
    assert np.allclose(local, mine, atol=1e-3)
    circles = read(blob, p["mesh"]["circles"], "<f4").reshape(-1, 8)
    centres = to_object_frame(circles[:, 1:4].ravel(), p["loc"])
    assert np.allclose(centres[:, :2], [30, 0], atol=1e-3)
