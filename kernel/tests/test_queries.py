"""Queries and descriptors, in-process, on the shapes of the fixture models."""

import math
from pathlib import Path

import pytest

from torno_kernel import queries, topo
from torno_kernel.describe import descriptor, number
from torno_kernel.loader import load_scene
from torno_kernel.tess import build_scene

WS = Path(__file__).parent / "fixtures" / "ws"


@pytest.fixture(scope="module")
def shapes():
    _, _, shapes = build_scene(load_scene(WS / "bracket", "bracket.py"), "bracket.py")
    return shapes


def face_of(shapes, key: str, **facts) -> dict:
    """The one face of a part whose description holds these facts."""
    count = len(topo.faces(shapes[key]))
    described = [queries.describe(shapes, f"{key}/F{i}") for i in range(count)]
    found = [d for d in described if all(d[k] == pytest.approx(v) for k, v in facts.items())]
    assert len(found) == 1, found
    return found[0]


# Numbers


@pytest.mark.parametrize(
    ("value", "text"),
    [
        (20, "20"),
        (20.0, "20"),
        (1180.0, "1180"),
        (502.6548, "502.7"),
        (25.1327, "25.13"),
        (6000.0000001, "6000"),
        (12345.6, "12350"),
        (0.5, "0.5"),
        (0.012346, "0.01235"),
        (-2.5, "-2.5"),
        (-0.0, "0"),
        (1e-12, "0"),
        (-1e-12, "0"),
        # What modelling leaves where it means nothing.
        (-0.0000001, "0"),
        (9e-7, "0"),
        (0.000002, "0.000002"),
        (-0.00025, "-0.00025"),
    ],
)
def test_numbers_have_at_most_four_significant_digits_and_no_trailing_zeros(value, text):
    assert number(value) == text


# Descriptors from facts


@pytest.mark.parametrize(
    ("normal", "center", "text"),
    [
        ([0, 0, 1], [3, 4, 20], "plane, normal +Z, z = 20, 1180 mm²"),
        ([0, 0, -1], [3, 4, -2.5], "plane, normal -Z, z = -2.5, 1180 mm²"),
        ([1, 0, 0], [20, 4, 1], "plane, normal +X, x = 20, 1180 mm²"),
        ([-1, 0, 0], [-20, 4, 1], "plane, normal -X, x = -20, 1180 mm²"),
        ([0, 1, 0], [3, 15, 1], "plane, normal +Y, y = 15, 1180 mm²"),
        ([0, -1, 0], [3, -15, 1], "plane, normal -Y, y = -15, 1180 mm²"),
    ],
)
def test_plane_on_an_axis_names_it_and_the_coordinate_it_sits_at(normal, center, text):
    facts = {"type": "plane", "normal": normal, "center": center, "area": 1180.0}
    assert descriptor("face", facts) == text


def test_tilted_plane_gives_its_normal_as_a_vector():
    s = math.sqrt(0.5)
    facts = {"type": "plane", "normal": [s, 0, s], "center": [1, 2, 3], "area": 1180.0}
    assert descriptor("face", facts) == "plane, normal (0.71, 0, 0.71), 1180 mm²"


def test_plane_within_half_a_degree_of_an_axis_is_named_and_beyond_it_is_not():
    def tilted(degrees):
        a = math.radians(degrees)
        return {"type": "plane", "normal": [math.sin(a), 0, math.cos(a)], "center": [0, 0, 20], "area": 100.0}

    assert descriptor("face", tilted(0.4)) == "plane, normal +Z, z = 20, 100 mm²"
    assert descriptor("face", tilted(0.6)) == "plane, normal (0.01, 0, 1), 100 mm²"


def test_plane_without_a_normal_is_still_described():
    facts = {"type": "plane", "normal": None, "center": [0, 0, 0], "area": 12.0}
    assert descriptor("face", facts) == "plane, 12 mm²"


def test_cylinder_gives_radius_and_axis():
    facts = {"type": "cylinder", "radius": 4.0, "axis": [0, 0, 1], "area": 502.6548}
    assert descriptor("face", facts) == "cylinder, radius 4, axis Z, 502.7 mm²"
    # An axis has no sense: pointing down is the same axis.
    assert descriptor("face", {**facts, "axis": [0, -1, 0]}) == "cylinder, radius 4, axis Y, 502.7 mm²"
    s = math.sqrt(0.5)
    assert descriptor("face", {**facts, "axis": [s, s, 0]}) == (
        "cylinder, radius 4, axis (0.71, 0.71, 0), 502.7 mm²"
    )


def test_an_area_that_is_not_exact_is_said_as_about():
    facts = {"type": "bspline", "area": 913.2, "areaExact": False, "radius": None}
    assert descriptor("face", facts) == "bspline, ≈ 913.2 mm²"
    assert descriptor("face", {**facts, "areaExact": True}) == "bspline, 913.2 mm²"


def test_other_faces_give_their_type_and_area():
    assert descriptor("face", {"type": "bspline", "area": 913.2, "radius": None}) == "bspline, 913.2 mm²"
    assert descriptor("face", {"type": "sphere", "area": 201.06, "radius": 4.0}) == "sphere, 201.1 mm²"


def test_edges():
    assert descriptor("edge", {"type": "line", "length": 40.0}) == "line, 40 mm"
    assert descriptor("edge", {"type": "circle", "radius": 4.0, "length": 25.1327}) == (
        "circle, radius 4, 25.13 mm"
    )
    assert descriptor("edge", {"type": "bspline", "length": 31.4}) == "bspline, 31.4 mm"


def test_part():
    facts = {
        "bbox": {"min": [-20, -15, -2.5], "max": [20, 15, 2.5]},
        "volume": 6000.0,
        "faceCount": 6,
    }
    assert descriptor("part", facts) == "part, 40 × 30 × 5 mm, 6000 mm³, 6 faces"
    assert descriptor("part", {**facts, "faceCount": 1}) == "part, 40 × 30 × 5 mm, 6000 mm³, 1 face"


def test_unknown_kind_is_refused():
    with pytest.raises(ValueError):
        descriptor("vertex", {})


# describe carries the descriptor


def test_describe_part_carries_its_descriptor(shapes):
    assert queries.describe(shapes, "assembly:base")["descriptor"] == (
        "part, 40 × 30 × 5 mm, 6000 mm³, 6 faces"
    )


def test_describe_plane_on_each_axis(shapes):
    found = {
        queries.describe(shapes, f"assembly:base/F{i}")["descriptor"] for i in range(6)
    }
    assert found == {
        "plane, normal +X, x = 20, 150 mm²",
        "plane, normal -X, x = -20, 150 mm²",
        "plane, normal +Y, y = 15, 200 mm²",
        "plane, normal -Y, y = -15, 200 mm²",
        "plane, normal +Z, z = 2.5, 1200 mm²",
        "plane, normal -Z, z = -2.5, 1200 mm²",
    }


def test_describe_cylinder_names_the_axis_it_has_in_this_layout(shapes):
    upright = face_of(shapes, "assembly:post", type="cylinder")
    assert upright["descriptor"] == "cylinder, radius 4, axis Z, 502.7 mm²"
    # The same post lies on its side on the print bed.
    lying = face_of(shapes, "print:post", type="cylinder")
    assert lying["descriptor"] == "cylinder, radius 4, axis Y, 502.7 mm²"


def test_describe_line_and_circle_edges(shapes):
    assert queries.describe(shapes, "assembly:base/E1")["descriptor"] == "line, 30 mm"
    count = len(topo.edges(shapes["assembly:post"]))
    edges = [queries.describe(shapes, f"assembly:post/E{i}") for i in range(count)]
    circles = [e["descriptor"] for e in edges if e["type"] == "circle"]
    assert circles == ["circle, radius 4, 25.13 mm"] * 2


def test_the_centre_of_an_edge_is_on_the_edge_also_of_a_circle(shapes):
    # A mark placed on an edge by its ref alone is put at this point: it has to be on the edge.
    count = len(topo.edges(shapes["assembly:post"]))
    checked = 0
    for i in range(count):
        edge = queries.describe(shapes, f"assembly:post/E{i}")
        if edge["type"] != "circle":
            continue
        (anchor,) = nearest_with(shapes, "assembly", {"part": "post", "point": edge["center"], "edge": f"post/E{i}"})
        assert anchor["edgeFound"] is True
        assert anchor["edgeDistance"] == pytest.approx(0, abs=1e-6)
        # Not the middle of the circle, which is 4 mm from it.
        x, y, _ = edge["center"]
        assert math.hypot(x, y) == pytest.approx(4)
        checked += 1
    assert checked == 2


def test_describe_keeps_the_fields_it_had_and_says_whether_an_area_is_exact(shapes):
    edge = queries.describe(shapes, "assembly:base/E1")
    assert set(edge) == {"kind", "ref", "type", "length", "center", "descriptor"}
    face = queries.describe(shapes, "assembly:base/F0")
    assert set(face) == {
        "kind", "ref", "type", "area", "areaExact", "center", "normal", "radius", "descriptor"
    }  # fmt: skip
    assert face["areaExact"] is True
    assert queries.describe(shapes, "assembly:post")["areaExact"] is True


def test_describe_tilted_plane():
    from build123d import Box, Rot

    shapes = {"main:wedge": Rot(0, 45, 0) * Box(10, 10, 10)}
    found = {queries.describe(shapes, f"main:wedge/F{i}")["descriptor"] for i in range(6)}
    assert "plane, normal (0.71, 0, 0.71), 100 mm²" in found
    assert "plane, normal (-0.71, 0, -0.71), 100 mm²" in found
    assert "plane, normal +Y, y = 5, 100 mm²" in found


# nearest


def nearest(shapes, layout, *anchors):
    args = {"layout": layout, "anchors": [{"part": part, "point": point} for part, point in anchors]}
    return queries.run(shapes, "nearest", args)["anchors"]


def nearest_with(shapes, layout, *anchors):
    """``nearest`` with the anchors as they go over the wire."""
    return queries.run(shapes, "nearest", {"layout": layout, "anchors": list(anchors)})["anchors"]


def test_nearest_above_the_base_is_its_top_face(shapes):
    top = face_of(shapes, "assembly:base", normal=[0, 0, 1])
    [anchor] = nearest(shapes, "assembly", ("base", [5, 3, 5.5]))
    assert anchor == {
        "part": "base",
        "found": True,
        "point": pytest.approx([5, 3, 2.5]),
        "normal": pytest.approx([0, 0, 1]),
        # Without the layout: the reply is about one layout already.
        "ref": top["ref"].removeprefix("assembly:"),
        "distance": pytest.approx(3),
        "descriptor": "plane, normal +Z, z = 2.5, 1200 mm²",
        "support": "face",
    }


def test_nearest_below_the_base_points_down(shapes):
    [anchor] = nearest(shapes, "assembly", ("base", [5, 3, -4.5]))
    assert anchor["normal"] == pytest.approx([0, 0, -1])
    assert anchor["distance"] == pytest.approx(2)
    assert anchor["descriptor"] == "plane, normal -Z, z = -2.5, 1200 mm²"


def test_nearest_beside_the_post_is_its_cylindrical_face(shapes):
    cylinder = face_of(shapes, "assembly:post", type="cylinder")
    [anchor] = nearest(shapes, "assembly", ("post", [7, 0, 12]))
    assert anchor["ref"] == cylinder["ref"].removeprefix("assembly:")
    assert anchor["point"] == pytest.approx([4, 0, 12])
    assert anchor["normal"] == pytest.approx([1, 0, 0])
    assert anchor["distance"] == pytest.approx(3)
    assert anchor["descriptor"] == "cylinder, radius 4, axis Z, 502.7 mm²"


def test_nearest_on_the_surface_is_at_distance_zero(shapes):
    [anchor] = nearest(shapes, "assembly", ("base", [5, 3, 2.5]))
    assert anchor["distance"] == pytest.approx(0, abs=1e-9)
    assert anchor["normal"] == pytest.approx([0, 0, 1])


def test_nearest_inside_the_part_is_the_closest_face_not_zero(shapes):
    [anchor] = nearest(shapes, "assembly", ("base", [5, 3, 2]))
    assert anchor["distance"] == pytest.approx(0.5)
    assert anchor["normal"] == pytest.approx([0, 0, 1])


def test_nearest_on_an_edge_or_a_corner_is_the_adjacent_face_of_lowest_index(shapes):
    def faces_at(point):
        """Indices of the base's faces whose plane this point of its surface lies on."""
        found = []
        for i in range(6):
            face = queries.describe(shapes, f"assembly:base/F{i}")
            offset = [p - c for p, c in zip(point, face["center"], strict=True)]
            if abs(sum(o * n for o, n in zip(offset, face["normal"], strict=True))) < 1e-9:
                found.append(i)
        return found

    # Beyond the edge between the top and the +X side.
    [on_edge] = nearest(shapes, "assembly", ("base", [23, 3, 5.5]))
    assert on_edge["point"] == pytest.approx([20, 3, 2.5])
    assert on_edge["distance"] == pytest.approx(math.hypot(3, 3))
    assert len(faces_at([20, 3, 2.5])) == 2
    assert on_edge["ref"] == f"base/F{min(faces_at([20, 3, 2.5]))}"
    # Beyond a corner.
    [on_corner] = nearest(shapes, "assembly", ("base", [23, 18, 5.5]))
    assert on_corner["point"] == pytest.approx([20, 15, 2.5])
    assert len(faces_at([20, 15, 2.5])) == 3
    assert on_corner["ref"] == f"base/F{min(faces_at([20, 15, 2.5]))}"
    # The normal is the one of the face named.
    named = queries.describe(shapes, f"assembly:{on_corner['ref']}")
    assert on_corner["normal"] == pytest.approx(named["normal"])
    assert on_corner["descriptor"] == named["descriptor"]


def test_nearest_of_many_anchors_on_a_part_is_what_each_alone_would_get(shapes):
    # One search of the part serves every anchor on it: none is answered with another's result.
    points = [[5, 3, 5.5], [5, 3, 2], [23, 3, 5.5], [23, 18, 5.5], [-30, 0, 0], [5, 3, -4.5], [0, 0, 0]]
    together = nearest(shapes, "assembly", *(("base", point) for point in points), ("post", [7, 0, 12]))
    alone = [nearest(shapes, "assembly", ("base", point))[0] for point in points]
    assert together[:-1] == alone
    assert [a["distance"] for a in alone[:3]] == pytest.approx([3, 0.5, math.hypot(3, 3)])
    assert together[-1] == nearest(shapes, "assembly", ("post", [7, 0, 12]))[0]


def test_nearest_on_a_face_that_cannot_be_described_still_answers_every_anchor(shapes, monkeypatch):
    top = face_of(shapes, "assembly:base", normal=[0, 0, 1])["ref"]
    describe_face = queries._describe_face

    def odd(ref, face, span):
        if ref == top:
            raise RuntimeError("no parameter range")
        return describe_face(ref, face, span)

    monkeypatch.setattr(queries, "_describe_face", odd)
    above, below = nearest(shapes, "assembly", ("base", [5, 3, 5.5]), ("base", [5, 3, -4.5]))
    assert above["found"] is True
    assert above["ref"] == top.removeprefix("assembly:")
    assert above["distance"] == pytest.approx(3)
    assert above["descriptor"] is None
    assert below["descriptor"] == "plane, normal -Z, z = -2.5, 1200 mm²"


def test_nearest_point_on_no_face_of_the_part_is_an_error_not_its_last_face(shapes):
    from build123d import Box
    from OCP.BRepExtrema import BRepExtrema_SupportType as On

    surface = queries._Surface(shapes["assembly:base"])
    own = topo.faces(shapes["assembly:base"])[3]
    assert surface._face_under("assembly:base", On.BRepExtrema_IsInFace, own) == 3
    # A face, an edge and a corner that are not the part's: its map of faces does not have them.
    stranger = Box(1, 2, 3)
    foreign = [
        (On.BRepExtrema_IsInFace, topo.faces(stranger)[0]),
        (On.BRepExtrema_IsOnEdge, topo.edges(stranger)[0]),
        (On.BRepExtrema_IsVertex, stranger.vertices()[0].wrapped),
    ]
    for support_type, support in foreign:
        with pytest.raises(queries.QueryError) as e:
            surface._face_under("assembly:base", support_type, support)
        assert e.value.kind == "exception"
        assert e.value.message == "the point of assembly:base nearest to the anchor is on none of its faces"


def test_nearest_anchor_that_cannot_be_answered_says_so_and_the_others_are_answered(shapes, monkeypatch):
    # One anchor whose nearest point is on no face is that anchor's failure, not the call's.
    face_under = queries._Surface._face_under

    def odd(self, key, support_type, support):
        if key == "assembly:post":
            raise queries.QueryError("exception", f"the point of {key} nearest to the anchor is on none of its faces")
        return face_under(self, key, support_type, support)

    monkeypatch.setattr(queries._Surface, "_face_under", odd)
    on_base, on_post, gone, again = nearest(
        shapes, "assembly", ("base", [5, 3, 5.5]), ("post", [7, 0, 12]), ("lid", [0, 0, 0]), ("base", [5, 3, -4.5])
    )
    assert on_base["distance"] == pytest.approx(3)
    assert on_post == {
        "part": "post",
        "found": True,
        "error": "the point of assembly:post nearest to the anchor is on none of its faces",
    }
    assert gone == {"part": "lid", "found": False}
    assert again["distance"] == pytest.approx(2)


def test_nearest_says_what_the_point_lies_on_and_names_the_edge_and_the_faces_that_meet_there(shapes):
    top = face_of(shapes, "assembly:base", normal=[0, 0, 1])["ref"].removeprefix("assembly:")
    side = face_of(shapes, "assembly:base", normal=[1, 0, 0])["ref"].removeprefix("assembly:")
    in_face, on_edge, on_corner, beyond = nearest(
        shapes,
        "assembly",
        ("base", [5, 3, 2.5]),
        ("base", [20, 3, 2.5]),
        ("base", [20, 15, 2.5]),
        ("base", [23, 3, 5.5]),
    )
    assert in_face["support"] == "face"
    assert not {"edgeUnder", "between", "edgeUnderDescriptor"} & set(in_face)
    assert on_edge["support"] == "edge"
    assert on_edge["between"] == sorted([top, side], key=lambda ref: int(ref.split("/F")[1]))
    # The edge it names is the one whose middle is there, described as describe would.
    named = queries.describe(shapes, f"assembly:{on_edge['edgeUnder']}")
    assert named["type"] == "line"
    assert named["length"] == pytest.approx(30)
    assert named["center"] == pytest.approx([20, 0, 2.5])
    assert on_edge["edgeUnderDescriptor"] == named["descriptor"] == "line, 30 mm"
    # The face it names is still the adjacent one of lowest index.
    assert on_edge["ref"] == on_edge["between"][0]
    assert on_corner["support"] == "vertex"
    assert "edgeUnder" not in on_corner
    # Off the part, the nearest point is on that edge all the same: the distance says it is not on it.
    assert (beyond["support"], beyond["edgeUnder"]) == ("edge", on_edge["edgeUnder"])
    assert beyond["distance"] == pytest.approx(math.hypot(3, 3))


def test_nearest_on_the_seam_of_a_cylinder_is_on_its_face_not_on_an_edge(shapes):
    # A seam is where one face meets itself: nothing a person would call an edge.
    [seam] = nearest(shapes, "assembly", ("post", [4, 0, 12]))
    assert seam["distance"] == pytest.approx(0, abs=1e-9)
    assert seam["support"] == "face"
    assert "edgeUnder" not in seam
    # The rim of its top is an edge between two faces.
    [rim] = nearest(shapes, "assembly", ("post", [4 * math.cos(0.3), 4 * math.sin(0.3), 22.5]))
    assert rim["support"] == "edge"
    assert len(rim["between"]) == 2
    assert rim["edgeUnderDescriptor"].startswith("circle, radius 4")


def test_nearest_naming_an_edge_says_which_faces_meet_at_it(shapes):
    [on_edge] = nearest(shapes, "assembly", ("base", [20, 3, 2.5]))
    [named] = nearest_with(
        shapes, "assembly", {"part": "base", "point": [20, 3.2, 2.5], "edge": on_edge["edgeUnder"]}
    )
    assert named["edgeFound"] is True
    assert named["edgeBetween"] == on_edge["between"]


def test_nearest_keeps_what_it_worked_out_of_a_part_for_the_life_of_the_worker(shapes, monkeypatch):
    made = []
    surface = queries._Surface

    class Counted(surface):
        def __init__(self, shape):
            made.append(shape)
            super().__init__(shape)

    monkeypatch.setattr(queries, "_Surface", Counted)
    args = {"layout": "assembly", "anchors": [{"part": "base", "point": [5, 3, 5.5]}, {"part": "post", "point": [7, 0, 12]}]}
    kept: dict = {}
    first = queries.run(shapes, "nearest", args, kept)
    assert len(made) == 2
    second = queries.run(shapes, "nearest", args, kept)
    other = queries.run(shapes, "nearest", {"layout": "assembly", "anchors": [{"part": "base", "point": [23, 3, 5.5]}]}, kept)
    assert len(made) == 2
    assert second == first
    # Another layout's part of the same name is another shape.
    queries.run(shapes, "nearest", {"layout": "print", "anchors": [{"part": "base", "point": [5, 3, 5.5]}]}, kept)
    assert len(made) == 3
    # What is kept changes no answer: the same as from a worker that kept nothing.
    assert first == queries.run(shapes, "nearest", args)
    assert other == queries.run(shapes, "nearest", {"layout": "assembly", "anchors": [{"part": "base", "point": [23, 3, 5.5]}]})


def test_spread_fixture_sets_its_lid_further_along_when_its_tray_grows(tmp_path):
    """The model the app's keeping of marks on spread parts is tried on."""
    import shutil

    folder = tmp_path / "spread"
    shutil.copytree(WS / "spread", folder, ignore=shutil.ignore_patterns("__pycache__"))

    def built(width):
        (folder / "width.txt").write_text(f"{width}\n")
        scene, _, shapes = build_scene(load_scene(folder, "spread.py"), "spread.py")
        return {p["name"]: p.get("arranged") for p in scene["parts"]}, shapes

    arranged, shapes = built(30)
    assert arranged == {"tray": None, "lid": pytest.approx([35, 0, 0])}
    # The middle of the lid's top, where it was moved to.
    [before] = nearest(shapes, "print", ("lid", [35, 0, 2]))
    assert before["distance"] == pytest.approx(0, abs=1e-9)

    arranged, shapes = built(40)
    assert arranged == {"tray": None, "lid": pytest.approx([40, 0, 0])}
    # The same point of the lid is 5 mm further along.
    [after] = nearest(shapes, "print", ("lid", [40, 0, 2]))
    assert (after["ref"], after["distance"]) == (before["ref"], pytest.approx(0, abs=1e-9))


def test_nearest_says_how_far_the_anchor_is_from_the_edge_it_names(shapes):
    edge = queries.describe(shapes, "assembly:base/E3")
    assert edge["type"] == "line"
    x, y, z = edge["center"]
    # Its middle is on it; a point pushed 2 mm off the plate's corner line is 2 mm from it.
    if abs(x) == 20:
        away = [x + math.copysign(2, x), y, z]
    else:
        away = [x, y + math.copysign(2, y), z]
    on, off, plain = nearest_with(
        shapes,
        "assembly",
        {"part": "base", "point": [x, y, z], "edge": "base/E3"},
        {"part": "base", "point": away, "edge": "base/E3"},
        {"part": "base", "point": [x, y, z]},
    )
    assert on["edgeFound"] is True
    assert on["edgeDistance"] == pytest.approx(0, abs=1e-9)
    assert on["edgeDescriptor"] == edge["descriptor"]
    assert on["edgePoint"] == pytest.approx([x, y, z])
    assert off["edgePoint"] == pytest.approx([x, y, z])
    assert on["distance"] == pytest.approx(0, abs=1e-9)
    assert off["edgeDistance"] == pytest.approx(2)
    assert off["distance"] == pytest.approx(2)  # of the surface, as ever
    # An anchor that names no edge is told nothing of one.
    assert not {"edgeFound", "edgeDistance", "edgeDescriptor"} & set(plain)


def test_nearest_says_how_far_the_anchor_is_from_the_face_it_names(shapes):
    top = face_of(shapes, "assembly:base", normal=[0, 0, 1])
    other = face_of(shapes, "assembly:base", normal=[-1, 0, 0])
    named = {"part": "base", "point": [5, 3, 5.5], "face": top["ref"].split(":", 1)[1]}
    on, off, gone, plain = nearest_with(
        shapes,
        "assembly",
        named,
        {**named, "face": other["ref"].split(":", 1)[1]},
        {**named, "face": "base/F99"},
        {"part": "base", "point": [5, 3, 5.5]},
    )
    assert on["faceFound"] is True
    assert on["faceDistance"] == pytest.approx(3)
    assert on["faceDescriptor"] == top["descriptor"]
    assert on["faceNormal"] == pytest.approx([0, 0, 1])
    assert on["facePoint"] == pytest.approx([5, 3, 2.5])
    assert off["faceDistance"] == pytest.approx(math.hypot(25, 3))  # the face is bounded: its nearest point is on its rim
    assert gone["faceFound"] is False
    assert not {"faceFound", "faceDistance"} & set(plain)


@pytest.mark.parametrize(
    "edge",
    ["base/E99", "post/E0", "base/F0", "base", "E3", "", "base/E-1", "base/E1234567", "base/E" + "9" * 5000],
)
def test_nearest_naming_an_edge_the_part_does_not_have_says_so(shapes, edge):
    [anchor] = nearest_with(shapes, "assembly", {"part": "base", "point": [5, 3, 5.5], "edge": edge})
    assert anchor["found"] is True
    assert anchor["distance"] == pytest.approx(3)
    assert anchor["edgeFound"] is False
    assert "edgeDistance" not in anchor


def test_describe_of_a_number_too_long_to_be_one_is_a_bad_ref_not_a_crash(shapes):
    for ref in ("assembly:base/F" + "9" * 5000, "assembly:base/E1234567"):
        with pytest.raises(queries.QueryError) as failed:
            queries.run(shapes, "describe", {"ref": ref})
        assert failed.value.kind == "bad_ref"
    # Six digits are still a number: of a face the part does not have.
    with pytest.raises(queries.QueryError) as failed:
        queries.run(shapes, "describe", {"ref": "assembly:base/F999999"})
    assert failed.value.kind == "bad_ref"
    assert "faces" in str(failed.value)


def test_nearest_edge_of_a_missing_part_is_only_not_found(shapes):
    assert nearest_with(shapes, "assembly", {"part": "gone", "point": [0, 0, 0], "edge": "gone/E1"}) == [
        {"part": "gone", "found": False}
    ]


def test_nearest_edge_that_is_not_a_string_is_a_bad_request(shapes):
    with pytest.raises(queries.QueryError) as e:
        nearest_with(shapes, "assembly", {"part": "base", "point": [0, 0, 0], "edge": 3})
    assert e.value.kind == "bad_request"


def test_nearest_missing_part_is_not_found_and_the_others_are_answered(shapes):
    anchors = nearest(shapes, "assembly", ("gone", [0, 0, 0]), ("base", [5, 3, 5.5]))
    assert anchors[0] == {"part": "gone", "found": False}
    assert anchors[1]["found"] is True
    assert nearest(shapes, "assembly") == []


def test_nearest_answers_in_the_frame_of_the_layout_asked_for(shapes):
    # On the print bed the post lies along Y at x = 60, z = 4.
    [anchor] = nearest(shapes, "print", ("post", [60, 0, 11]))
    assert anchor["point"] == pytest.approx([60, 0, 8])
    assert anchor["normal"] == pytest.approx([0, 0, 1], abs=1e-9)
    assert anchor["distance"] == pytest.approx(3)
    assert anchor["descriptor"] == "cylinder, radius 4, axis Y, 502.7 mm²"


def test_nearest_on_parts_spread_apart_answers_where_they_were_moved_to():
    # Two plates posed on top of each other for the bed: the second is moved along X.
    source = {"print": {"a": __import__("build123d").Box(20, 20, 2), "b": __import__("build123d").Box(20, 20, 2)}}
    scene, _, shapes = build_scene(source, "plates.py")
    moved = next(p for p in scene["parts"] if p["key"] == "print:b")["arranged"]
    assert moved == pytest.approx([30, 0, 0])
    [anchor] = nearest(shapes, "print", ("b", [30, 0, 4]))
    assert anchor["point"] == pytest.approx([30, 0, 1])
    assert anchor["distance"] == pytest.approx(3)


def test_nearest_unknown_layout_is_bad_ref_naming_the_layouts(shapes):
    with pytest.raises(queries.QueryError) as e:
        nearest(shapes, "exploded", ("base", [0, 0, 0]))
    assert e.value.kind == "bad_ref"
    assert e.value.message == "no layout 'exploded'; the layouts are assembly, print"


@pytest.mark.parametrize(
    "args",
    [
        None,
        {},
        {"layout": "assembly"},
        {"layout": 3, "anchors": []},
        {"layout": "assembly", "anchors": {}},
        {"layout": "assembly", "anchors": ["base"]},
        {"layout": "assembly", "anchors": [{"part": "base"}]},
        {"layout": "assembly", "anchors": [{"part": 1, "point": [0, 0, 0]}]},
        {"layout": "assembly", "anchors": [{"part": "base", "point": [0, 0]}]},
        {"layout": "assembly", "anchors": [{"part": "base", "point": [0, 0, "1"]}]},
        {"layout": "assembly", "anchors": [{"part": "base", "point": [0, 0, True]}]},
        {"layout": "assembly", "anchors": [{"part": "base", "point": [0, 0, float("nan")]}]},
        {"layout": "assembly", "anchors": [{"part": "base", "point": [0, 0, float("inf")]}]},
    ],
)
def test_nearest_with_bad_arguments_is_a_bad_request(shapes, args):
    with pytest.raises(queries.QueryError) as e:
        queries.run(shapes, "nearest", args)
    assert e.value.kind == "bad_request"


def test_unknown_query_names_the_queries(shapes):
    with pytest.raises(queries.QueryError) as e:
        queries.run(shapes, "nope", {})
    assert e.value.kind == "bad_request"
    assert e.value.message == "unknown query 'nope'; the queries are describe, nearest, measure, section, check, scan_clash, scan_deviation, scan_section, export, export_check, features, try_fillet, match_edges, selectors, refind and face_prints"


def test_nearest_after_a_rebuild_with_other_topology_names_the_face_now_there():
    """Review focus 1: a mark keeps its point; its ref is the face that is there now."""
    from build123d import Box, Cylinder, Pos

    def top_of(shapes):
        """The ref of the plate's largest face that looks up."""
        count = len(topo.faces(shapes["main:plate"]))
        faces = [queries.describe(shapes, f"main:plate/F{i}") for i in range(count)]
        up = [f for f in faces if f["type"] == "plane" and f["normal"] == pytest.approx([0, 0, 1])]
        return max(up, key=lambda f: f["area"])["ref"].removeprefix("main:")

    point = [5, 3, 2.5]  # a pin on the top of a plate 5 mm thick
    before = {"main:plate": Box(40, 30, 5)}
    [placed] = nearest(before, "main", ("plate", point))
    assert (placed["ref"], placed["distance"]) == (top_of(before), pytest.approx(0, abs=1e-9))

    # A hole through it and a boss beside it: the faces are numbered otherwise.
    holed = Box(40, 30, 5) - Pos(-10, 0, 0) * Cylinder(3, 5) + Pos(12, -8, 5) * Cylinder(2, 5)
    after = {"main:plate": holed}
    assert top_of(after) != top_of(before)
    [same_place] = nearest(after, "main", ("plate", point))
    assert same_place["ref"] == top_of(after)
    assert same_place["distance"] == pytest.approx(0, abs=1e-9)
    assert same_place["normal"] == pytest.approx([0, 0, 1])

    # The plate made thinner: the surface moved away from the pin, and the distance says so.
    thinner = {"main:plate": Pos(0, 0, -1) * Box(40, 30, 3)}
    [drifted] = nearest(thinner, "main", ("plate", point))
    assert drifted["ref"] == top_of(thinner)
    assert drifted["point"] == pytest.approx([5, 3, 0.5])
    assert drifted["distance"] == pytest.approx(2)

    # The part renamed away.
    assert nearest({"main:slab": Box(40, 30, 5)}, "main", ("plate", point)) == [
        {"part": "plate", "found": False}
    ]


def test_morph_fixture_moves_its_top_and_loses_its_post(tmp_path):
    """The model the app's re-anchoring is tried on: what ``variant.txt`` says is what is built."""
    import shutil

    folder = tmp_path / "morph"
    shutil.copytree(WS / "morph", folder, ignore=shutil.ignore_patterns("__pycache__"))

    def built(variant):
        (folder / "variant.txt").write_text(variant)
        return build_scene(load_scene(folder, "morph.py"), "morph.py")[2]

    a = built("a")
    assert sorted(a) == ["main:plate", "main:post"]
    assert len(topo.faces(a["main:plate"])) == 6
    on_top, on_post = nearest(a, "main", ("plate", [14, 9, 2.5]), ("post", [0, 0, 22.5]))
    assert on_top["distance"] == pytest.approx(0, abs=1e-9)
    assert on_top["descriptor"] == "plane, normal +Z, z = 2.5, 1200 mm²"
    assert on_post["distance"] == pytest.approx(0, abs=1e-9)

    b = built("b")
    assert sorted(b) == ["main:plate"]
    assert len(topo.faces(b["main:plate"])) == 10
    moved, lost = nearest(b, "main", ("plate", [14, 9, 2.5]), ("post", [0, 0, 22.5]))
    assert moved["distance"] == pytest.approx(3)
    assert moved["normal"] == pytest.approx([0, 0, 1])
    assert moved["descriptor"] == "plane, normal +Z, z = 5.5, 1064 mm²"
    assert moved["ref"] != on_top["ref"]
    assert lost == {"part": "post", "found": False}

    # An edge number belongs to another edge after the rebuild. Marks at the middle of a's E1 and
    # E2 are on b's surface still, and millimetres from the edges that now have those numbers.
    middles = {i: queries.describe(a, f"main:plate/E{i}")["center"] for i in (1, 2)}
    for i, gap in ((1, 2.0), (2, 2.5)):
        anchor = {"part": "plate", "point": middles[i], "edge": f"plate/E{i}"}
        [before] = nearest_with(a, "main", anchor)
        [after] = nearest_with(b, "main", anchor)
        assert before["edgeDistance"] == pytest.approx(0, abs=1e-9)
        assert after["distance"] == pytest.approx(0, abs=1e-9)
        assert after["edgeFound"] is True
        assert after["edgeDistance"] == pytest.approx(gap)

    (folder / "variant.txt").write_text("c")
    with pytest.raises(Exception, match="it must say a or b"):
        load_scene(folder, "morph.py")


def test_nearest_of_a_point_inside_a_part_that_is_a_bare_solid_is_on_its_surface():
    from build123d import Box, Pos, Solid

    shapes = {"assembly:made": Pos(-10, -10, -5) * Solid.make_box(20, 20, 10), "assembly:picked": Box(20, 20, 10).solid(), "assembly:part": Box(20, 20, 10)}
    for part in ("made", "picked", "part"):
        [inside, outside] = queries.nearest(shapes, "assembly", [{"part": part, "point": [0.5, 0.5, 1]}, {"part": part, "point": [0.5, 0.5, 9]}], {})
        assert inside["distance"] == pytest.approx(4) and inside["point"] == pytest.approx([0.5, 0.5, 5]) and inside["support"] == "face"
        assert outside["distance"] == pytest.approx(4) and outside["ref"] == inside["ref"]


# What a descriptor costs, and what it calls nothing


def test_the_descriptor_of_a_freeform_face_takes_one_integral_and_measure_area_three(monkeypatch):
    """After every build each face a mark is on is described: one integral of each, not three."""
    from build123d import Circle, Ellipse, Pos, loft

    from torno_kernel import extent

    horn = loft([Circle(10).face(), Pos(0, 0, 15) * Ellipse(13.5, 5).face(), Pos(3, 0, 30) * Circle(4).face()])
    made = {"assembly:horn": horn}
    asked: list = []
    integrated = extent._integrated

    def counted(face, tolerance):
        asked.append(tolerance)
        return integrated(face, tolerance)

    monkeypatch.setattr(extent, "_integrated", counted)
    [anchor] = nearest(made, "assembly", ("horn", [30, 0, 10]))
    side = f"assembly:{anchor['ref']}"
    # At a fixed order: what it costs does not depend on the face.
    assert asked == [None]
    assert anchor["descriptor"].startswith("bspline, ≈ ")
    del asked[:]
    described = queries.describe(made, side)
    assert asked == [None]
    assert (described["areaExact"], described["descriptor"]) == (False, anchor["descriptor"])
    del asked[:]
    measured = queries.run(made, "measure", {"kind": "area", "a": {"ref": side}})
    assert asked == [None, 1e-9, 1e-12]
    # The one integral is near enough for the four digits a descriptor shows after its ≈.
    assert described["area"] == pytest.approx(measured["value"], rel=1e-3)
    # An area that is exact is as it was, by the one integral or the one length it always took.
    flat = next(r for r in (f"assembly:horn/F{i}" for i in range(3)) if queries.describe(made, r)["type"] == "plane")
    del asked[:]
    assert (queries.describe(made, flat)["areaExact"], asked) == (True, [1e-9])


def test_describe_of_a_whole_freeform_part_takes_one_integral_a_face_and_measure_area_three(monkeypatch):
    """The whole area of a part, as `describe` tells it, costs what its faces' descriptors would: one integral each."""
    from build123d import Circle, Ellipse, Pos, loft

    from torno_kernel import extent, topo

    horn = loft([Circle(10).face(), Pos(0, 0, 15) * Ellipse(13.5, 5).face(), Pos(3, 0, 30) * Circle(4).face()])
    made = {"assembly:horn": horn}
    faces = topo.faces(horn)
    freeform = [face for face in faces if extent._known_area(face) is None]
    assert 0 < len(freeform) < len(faces)
    asked: list = []
    integrated = extent._integrated

    def counted(face, tolerance):
        asked.append(tolerance)
        return integrated(face, tolerance)

    monkeypatch.setattr(extent, "_integrated", counted)
    kept: dict = {}
    described = queries.describe(made, "assembly:horn", kept)
    # One integral of every face: at a fixed order of a freeform one, to the tolerance an exact one always took.
    assert len(asked) == len(faces)
    assert sorted(asked, key=str) == sorted([None] * len(freeform) + [1e-9] * (len(faces) - len(freeform)), key=str)
    # It is said as approximate, as it was.
    assert described["areaExact"] is False
    # Asked again of the same build, it costs nothing.
    del asked[:]
    assert queries.describe(made, "assembly:horn", kept)["area"] == described["area"]
    assert asked == []
    # It is the sum of what each face is described with.
    each = [queries.describe(made, f"assembly:horn/F{i}")["area"] for i in range(len(faces))]
    assert described["area"] == pytest.approx(sum(each), rel=1e-12)
    # What is to be relied on is asked of measure, which takes three of each freeform face and says how far
    # they agree: describe having been asked first does not make it take fewer, nor tell describe's number as its own.
    del asked[:]
    measured = queries.run(made, "measure", {"kind": "area", "a": {"ref": "assembly:horn"}}, kept)
    assert asked.count(None) == len(freeform) and asked.count(1e-12) == len(freeform)
    assert len(asked) == 3 * len(freeform) + (len(faces) - len(freeform))
    assert measured["exact"] is False and "digits" in measured["how"]
    assert described["area"] == pytest.approx(measured["value"], rel=1e-3)
    # And describe after it is still its own one integral a face: the same number as before.
    assert queries.describe(made, "assembly:horn", kept)["area"] == described["area"]


def test_describe_of_a_part_whose_every_face_is_exact_tells_its_area_as_exact_as_before(shapes, monkeypatch):
    from torno_kernel import extent

    before = queries.describe(shapes, "assembly:post")
    assert before["areaExact"] is True
    assert before["area"] == pytest.approx(extent.area(shapes["assembly:post"]).value, rel=1e-12)


@pytest.mark.parametrize(
    "span, text",
    [
        (None, "plane, normal +Z, z = -0.000004772, 100 mm²"),
        (207.0, "plane, normal +Z, z = 0, 100 mm²"),  # under a millionth of the part: nothing
        (2.0, "plane, normal +Z, z = -0.000004772, 100 mm²"),  # of a part of 2 mm it is something
    ],
)
def test_a_coordinate_under_a_millionth_of_its_part_is_told_as_zero(span, text):
    facts = {"type": "plane", "normal": [0, 0, 1], "center": [3, 4, -0.000004772], "area": 100.0}
    assert descriptor("face", facts if span is None else {**facts, "span": span}) == text


def test_a_size_under_a_millionth_of_its_part_is_told_as_zero():
    facts = {"bbox": {"min": [0, 0, 0], "max": [60, 0.000003338, 20]}, "volume": 12.0, "faceCount": 6}
    assert descriptor("part", facts) == "part, 60 × 0 × 20 mm, 12 mm³, 6 faces"
    assert number(0.000003338) == "0.000003338"
    assert number(0.000003338, least=63e-6) == "0"
    assert number(-0.00007, least=63e-6) == "-0.00007"


def test_describe_and_nearest_tell_a_plane_meant_at_zero_as_at_zero():
    """A plane a model leaves at z = -0.0000048 on a part 200 mm long is at 0."""
    from build123d import Box, Pos

    made = {"assembly:slab": Pos(0, 0, 10 - 0.000004772) * Box(200, 60, 20)}
    [anchor] = nearest(made, "assembly", ("slab", [5, 3, -4]))
    assert anchor["descriptor"] == "plane, normal -Z, z = 0, 12000 mm²"
    described = queries.describe(made, f"assembly:{anchor['ref']}")
    assert described["descriptor"] == anchor["descriptor"]
    # The data are in full.
    assert described["center"][2] == pytest.approx(-0.000004772, rel=1e-6)
